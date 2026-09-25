#!/usr/bin/env python3
"""Package and verify a native build. A macOS signing identity is opt-in."""
import argparse
import hashlib
import json
import os
import platform
import plistlib
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tarfile
import tempfile
import tomllib
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent.parent


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def icon_png(size: int) -> bytes:
    # The same capture-corner mark as the tray; no icon-generation dependency.
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            a, b = x / size, y / size
            mark = (0.17 <= a < 0.83 and 0.17 <= b < 0.83 and
                    (((a < 0.29 or a >= 0.71) and (b < 0.42 or b >= 0.58)) or
                     ((b < 0.29 or b >= 0.71) and (a < 0.42 or a >= 0.58))))
            rows.extend((78, 170, 245, 255) if mark else (0, 0, 0, 0))

    def chunk(kind: bytes, value: bytes) -> bytes:
        return (struct.pack('>I', len(value)) + kind + value +
                struct.pack('>I', zlib.crc32(kind + value)))

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def third_party_notices() -> tuple[str, int]:
    host = next(line.split(': ', 1)[1] for line in subprocess.check_output(
        ['rustc', '-vV'], text=True, cwd=ROOT).splitlines() if line.startswith('host: '))
    metadata = json.loads(subprocess.check_output(
        ['cargo', 'metadata', '--locked', '--format-version', '1', '--filter-platform', host],
        text=True, encoding='utf-8', cwd=ROOT))
    resolved = {node['id'] for node in metadata['resolve']['nodes']}
    packages = sorted((p for p in metadata['packages']
                       if p['id'] in resolved and p['id'] not in metadata['workspace_members']),
                      key=lambda p: (p['name'], p['version']))
    parts = ['ScreenFling third-party notices\n\n'
             'License texts from the resolved Cargo packages for this build host.\n'
             'This inventory also includes build-time dependencies; it is not a list\n'
             'of only the code linked into the executable. System libraries are separate.\n']
    overrides = json.loads((ROOT / 'assets' / 'license-overrides.json').read_text(encoding='utf-8'))
    missing = []
    for package in packages:
        root = Path(package['manifest_path']).parent
        files = {p for p in root.rglob('*') if p.is_file() and
                 p.suffix.lower() in ('', '.txt', '.md', '.rst') and
                 (p.name.lower().startswith(('license', 'licence', 'copying', 'notice',
                                             'ofl', 'ufl', 'copyright')) or
                  any(part.lower() in ('licenses', 'licences') for part in p.relative_to(root).parts[:-1]))}
        if package['name'] == 'epaint_default_fonts':
            files.update((root / 'fonts').glob('*.txt'))
        if package.get('license_file'):
            explicit = root / package['license_file']
            if explicit.is_file():
                files.add(explicit)
        texts = []
        for path in sorted(files):
            # Do not copy font binaries or arbitrary external files into the notices.
            if not path.resolve().is_relative_to(root.resolve()):
                continue
            try:
                texts.append((path.relative_to(root).as_posix(), path.read_text(encoding='utf-8')))
            except UnicodeError:
                continue
        if not texts:
            # A few published crates omit their repository's license files. Use
            # reviewed upstream texts only for the exact versions recorded here.
            for entry in overrides:
                if entry['packages'].get(package['name']) == package['version']:
                    if entry['license'] not in (package.get('license') or '').split():
                        raise RuntimeError(f"License changed for {package['name']}")
                    texts.append((entry['source'], entry['text']))
                    break
        if not texts:
            missing.append(f"{package['name']} {package['version']}")
            continue
        parts.append(f"\n{'=' * 72}\n{package['name']} {package['version']}\n"
                     f"Declared license: {package.get('license') or 'see license text'}\n"
                     f"Source: {package.get('repository') or package.get('source') or 'local'}\n")
        for name, text in texts:
            parts.append(f'\n--- {name} ---\n{text}\n')
    if missing:
        raise RuntimeError('Missing packaged license text: ' + ', '.join(missing))
    return ''.join(parts), len(packages)


def source_state() -> dict:
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT,
                                         text=True, stderr=subprocess.DEVNULL).strip()
        changed = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT,
                                          text=True, stderr=subprocess.DEVNULL)
        return {'commit': commit, 'dirty': bool(changed.strip())}
    except (OSError, subprocess.CalledProcessError):
        return {'commit': None, 'dirty': None}


def verify_runtime(binary: Path, system: str, version: str) -> list[str]:
    """Check actual link imports and launch the staged binary outside the checkout.

    These are loader checks on the build host, not clean-machine GUI acceptance.
    SDL's optional dlopen desktop integrations still require platform acceptance.
    """
    def read(*args):
        return subprocess.check_output(args, text=True, errors='replace', timeout=30)

    if system == 'Windows':
        dumpbin = shutil.which('dumpbin')
        if not dumpbin:
            vswhere = Path(os.environ['ProgramFiles(x86)']) / 'Microsoft Visual Studio/Installer/vswhere.exe'
            install = Path(read(str(vswhere), '-latest', '-products', '*', '-requires',
                                'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                                '-property', 'installationPath').strip())
            toolset = (install / 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt').read_text().strip()
            dumpbin = str(install / 'VC/Tools/MSVC' / toolset / 'bin/Hostx64/x64/dumpbin.exe')
        output = read(dumpbin, '/nologo', '/dependents', str(binary))
        libraries = sorted(set(re.findall(r'^\s*([^\s]+\.dll)\s*$', output, re.MULTILINE | re.IGNORECASE)))
        system_dir = Path(os.environ['SystemRoot']) / 'System32'
        for library in libraries:
            name = library.lower()
            if re.match(r'(vcruntime|msvcp\d|msvcr\d|ucrtbase|api-ms-win-crt-)', name):
                raise RuntimeError(f'Expected a static C/C++ runtime, found {library}')
            if not name.startswith(('api-ms-win-', 'ext-ms-win-')) and not (system_dir / library).is_file():
                raise RuntimeError(f'Unbundled non-system DLL: {library}')
    elif system == 'Darwin':
        libraries = [line.strip().split(' (', 1)[0]
                     for line in read('otool', '-L', str(binary)).splitlines()[1:] if line.strip()]
        for library in libraries:
            if not library.startswith(('/System/Library/', '/usr/lib/')):
                raise RuntimeError(f'Unbundled non-system macOS library: {library}')
    else:
        output = read('ldd', str(binary))
        if 'not found' in output:
            raise RuntimeError(f'Missing Linux runtime library:\n{output}')
        resolved = re.findall(r'^\s*(\S+)\s+=>\s+(\S+)', output, re.MULTILINE)
        libraries = [name for name, _ in resolved]
        for name, path in resolved:
            if not any(Path(path).resolve().is_relative_to(root)
                       for root in ('/lib', '/lib64', '/usr/lib', '/usr/lib64')):
                raise RuntimeError(f'Non-system Linux runtime library: {name}: {path}')
    if not libraries or any('sdl' in name.lower() for name in libraries):
        raise RuntimeError('Could not verify the statically linked SDL runtime.')
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('LD_', 'DYLD_')) and key not in ('DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET')}
    result = subprocess.run([str(binary), '--version'], cwd=binary.parent, env=env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, timeout=10, check=True)
    if result.stdout.strip() != f'ScreenFling {version}' or result.stderr.strip():
        raise RuntimeError('The staged executable did not report the expected version cleanly.')
    return libraries


def verify_archive(archive: Path, expected: dict[str, str], executable: str) -> None:
    """Check the actual archive, including docs, licenses, and the signed binary."""
    if archive.suffix == '.zip':
        with zipfile.ZipFile(archive) as output:
            actual = {item.filename: digest(output.read(item))
                      for item in output.infolist() if not item.is_dir()}
    else:
        with tarfile.open(archive, 'r:gz') as output:
            actual = {}
            for item in output.getmembers():
                if item.isdir():
                    continue
                if not item.isfile():
                    raise RuntimeError(f'Unexpected non-file in package: {item.name}')
                stream = output.extractfile(item)
                if stream is None:
                    raise RuntimeError(f'Could not read package member: {item.name}')
                with stream:
                    actual[item.name] = digest(stream.read())
            if not output.getmember(executable).mode & 0o111:
                raise RuntimeError('Packaged binary is not executable.')
    if actual != expected:
        raise RuntimeError('Package contents do not match the staged native build.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--signing-identity', help='macOS code-signing certificate SHA-1 fingerprint (40 hex digits)')
    parser.add_argument('--signing-keychain', type=Path, help='Optional keychain containing that certificate')
    options = parser.parse_args()
    if options.signing_keychain and not options.signing_identity:
        parser.error('--signing-keychain requires --signing-identity')
    if options.signing_identity and (platform.system() != 'Darwin' or not re.fullmatch(r'[0-9a-fA-F]{40}', options.signing_identity)):
        parser.error('--signing-identity requires macOS and a full certificate SHA-1 fingerprint')
    package = tomllib.loads((ROOT / 'Cargo.toml').read_text(encoding='utf-8'))['package']
    version = package['version']
    system = platform.system()
    if system not in ('Windows', 'Darwin', 'Linux'):
        raise SystemExit(f'Unsupported packaging host: {system}')
    arch = platform.machine().lower().replace('amd64', 'x86_64').replace('aarch64', 'arm64')
    name = f'screenfling-{version}-{system.lower()}-{arch}'
    binary = ROOT / 'target' / 'release' / ('screenfling.exe' if system == 'Windows' else 'screenfling')
    if not binary.is_file():
        raise SystemExit('Run cargo build --release --locked with the default target directory first.')
    notices, dependency_count = third_party_notices()
    source = source_state()
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sf-package-') as temporary:
        folder = Path(temporary) / name
        folder.mkdir()
        shutil.copy2(ROOT / 'LICENSE', folder)
        # The portfolio README has repository-relative code/image links. Packages
        # instead get the standalone usage guide, so offline instructions work.
        shutil.copy2(ROOT / 'docs' / 'USAGE.md', folder / 'README.md')
        (folder / 'THIRD_PARTY_NOTICES.txt').write_text(notices, encoding='utf-8')
        if system == 'Darwin':
            app = folder / 'ScreenFling.app'
            contents = app / 'Contents'
            (contents / 'MacOS').mkdir(parents=True)
            (contents / 'Resources').mkdir()
            packaged_binary = contents / 'MacOS' / 'screenfling'
            shutil.copy2(binary, packaged_binary)
            payload = b''
            for kind, size in ((b'ic07', 128), (b'ic08', 256), (b'ic09', 512)):
                png = icon_png(size)
                payload += kind + struct.pack('>I', len(png) + 8) + png
            (contents / 'Resources' / 'ScreenFling.icns').write_bytes(
                b'icns' + struct.pack('>I', len(payload) + 8) + payload)
            info = {
                'CFBundleName': 'ScreenFling', 'CFBundleDisplayName': 'ScreenFling',
                'CFBundleIdentifier': 'dev.screenfling.ScreenFling', 'CFBundleExecutable': 'screenfling',
                'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': version,
                'CFBundleVersion': version, 'CFBundleIconFile': 'ScreenFling',
                'LSMinimumSystemVersion': '14.0', 'NSHighResolutionCapable': True,
                'NSPrincipalClass': 'NSApplication',
            }
            (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
            signing = ['codesign', '--force', '--sign', options.signing_identity or '-']
            if options.signing_keychain:
                signing += ['--keychain', str(options.signing_keychain)]
            # Use codesign's certificate-bound default requirement. Never replace it
            # with an identifier-only requirement or silently fall back to ad-hoc.
            subprocess.run([*signing, str(app)], check=True)
            subprocess.run(['codesign', '--verify', '--strict', str(app)], check=True)
        else:
            packaged_binary = folder / binary.name
            shutil.copy2(binary, packaged_binary)
            if system == 'Linux':
                shutil.copy2(ROOT / 'assets' / 'dev.screenfling.ScreenFling.desktop', folder)
                shutil.copy2(ROOT / 'assets' / 'icon.svg', folder / 'dev.screenfling.ScreenFling.svg')
        libraries = verify_runtime(packaged_binary, system, version)
        files = {p.relative_to(folder.parent).as_posix(): digest(p.read_bytes())
                 for p in sorted(folder.rglob('*')) if p.is_file()}
        executable = packaged_binary.relative_to(folder.parent).as_posix()
        executable_bytes = packaged_binary.stat().st_size
        if system == 'Windows':
            archive = dist / f'{name}.zip'
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
                for path in sorted(folder.rglob('*')):
                    if path.is_file():
                        output.write(path, path.relative_to(folder.parent))
        else:
            archive = dist / f'{name}.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                output.add(folder, arcname=name)
        verify_archive(archive, files, executable)
    archive_hash = digest(archive.read_bytes())
    record = {
        'target': f'{system}-{arch}', 'version': version, 'source': source,
        'archive': archive.name, 'executable': executable,
        'executable_bytes': executable_bytes, 'executable_sha256': files[executable],
        'package_bytes': archive.stat().st_size, 'package_sha256': archive_hash,
        'third_party_packages': dependency_count, 'archive_verified': True,
        'runtime_libraries': libraries, 'packaged_cli_verified': True,
        'signing': (f'certificate {options.signing_identity}; not notarized' if options.signing_identity else 'ad-hoc only; not notarized') if system == 'Darwin' else 'unsigned',
    }
    (dist / 'build.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    (dist / 'SHA256SUMS').write_text(f'{archive_hash}  {archive.name}\n', encoding='utf-8')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Package an already-built native binary. Python is a build tool, not a runtime dependency."""
import hashlib
import json
import platform
import plistlib
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile
import tomllib
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent.parent


def icon_png(size):
    # The same capture-corner mark as the tray; no icon-generation dependencies.
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            a, b = x / size, y / size
            mark = (0.17 <= a < 0.83 and 0.17 <= b < 0.83 and
                    (((a < 0.29 or a >= 0.71) and (b < 0.42 or b >= 0.58)) or
                     ((b < 0.29 or b >= 0.71) and (a < 0.42 or a >= 0.58))))
            rows.extend((78, 170, 245, 255) if mark else (0, 0, 0, 0))
    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')


def main():
    package = tomllib.loads((ROOT / 'Cargo.toml').read_text())['package']
    version = package['version']
    system = platform.system()
    arch = platform.machine().lower().replace('amd64', 'x86_64').replace('aarch64', 'arm64')
    name = f'screenfling-{version}-{system.lower()}-{arch}'
    binary = ROOT / 'target' / 'release' / ('screenfling.exe' if system == 'Windows' else 'screenfling')
    if not binary.is_file():
        raise SystemExit('Run cargo build --release --locked first.')
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sf-package-') as temporary:
        folder = Path(temporary) / name
        folder.mkdir()
        for filename in ('LICENSE', 'README.md'):
            shutil.copy2(ROOT / filename, folder)
        if system == 'Darwin':
            app = folder / 'ScreenFling.app'
            contents = app / 'Contents'
            (contents / 'MacOS').mkdir(parents=True)
            (contents / 'Resources').mkdir()
            shutil.copy2(binary, contents / 'MacOS' / 'screenfling')
            payload = b''
            for kind, size in ((b'ic07', 128), (b'ic08', 256), (b'ic09', 512)):
                png = icon_png(size)
                payload += kind + struct.pack('>I', len(png) + 8) + png
            (contents / 'Resources' / 'ScreenFling.icns').write_bytes(b'icns' + struct.pack('>I', len(payload) + 8) + payload)
            info = {
                'CFBundleName': 'ScreenFling', 'CFBundleDisplayName': 'ScreenFling',
                'CFBundleIdentifier': 'dev.screenfling.ScreenFling', 'CFBundleExecutable': 'screenfling',
                'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': version,
                'CFBundleVersion': version, 'CFBundleIconFile': 'ScreenFling',
                'LSMinimumSystemVersion': '14.0', 'NSHighResolutionCapable': True,
                'NSPrincipalClass': 'NSApplication',
            }
            (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
            subprocess.run(['codesign', '--force', '--sign', '-', str(app)], check=True)
            subprocess.run(['codesign', '--verify', '--strict', str(app)], check=True)
        else:
            shutil.copy2(binary, folder / binary.name)
            if system == 'Linux':
                shutil.copy2(ROOT / 'assets' / 'dev.screenfling.ScreenFling.desktop', folder)
                shutil.copy2(ROOT / 'assets' / 'icon.svg', folder / 'dev.screenfling.ScreenFling.svg')
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
    record = {
        'target': f'{system}-{arch}', 'version': version,
        'executable_bytes': binary.stat().st_size, 'package_bytes': archive.stat().st_size,
        'package_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'signing': 'ad-hoc only; not notarized' if system == 'Darwin' else 'unsigned',
    }
    (dist / 'build.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()

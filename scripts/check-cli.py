#!/usr/bin/env python3
"""Check non-GUI launch options against the real release executable on each OS."""
import os
from pathlib import Path
import subprocess
import tomllib

ROOT = Path(__file__).resolve().parent.parent


def main():
    binary = ROOT / 'target' / 'release' / ('screenfling.exe' if os.name == 'nt' else 'screenfling')
    version = tomllib.loads((ROOT / 'Cargo.toml').read_text(encoding='utf-8'))['package']['version']
    env = os.environ.copy()
    # These commands must work without an initialized graphical desktop.
    env['SDL_VIDEO_DRIVER'] = 'screenfling-intentionally-unavailable'
    env.pop('DISPLAY', None)
    env.pop('WAYLAND_DISPLAY', None)
    for args, code, expected in [
        (['--version'], 0, f'ScreenFling {version}'),
        (['--help'], 0, 'Usage: screenfling'),
        (['--unknown'], 2, 'No capture was started.'),
        (['--capture', '--unknown'], 2, 'No capture was started.'),
        (['--version', '--capture'], 2, 'No capture was started.'),
    ]:
        result = subprocess.run([str(binary), *args], env=env, cwd=ROOT,
                                capture_output=True, text=True, encoding='utf-8', timeout=8)
        assert result.returncode == code, (args, result.returncode, result.stderr)
        assert expected in result.stdout + result.stderr, (args, result.stdout, result.stderr)
    print('Release CLI: version, help, unknown options, and conflicting options passed without a desktop.')


if __name__ == '__main__':
    main()

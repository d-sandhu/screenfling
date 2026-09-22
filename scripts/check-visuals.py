#!/usr/bin/env python3
"""Capture the real release UI on a disposable Xvfb desktop, never a user's desktop.
Run: xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/check-visuals.py --isolated-xvfb
Needs ImageMagick, DejaVu Sans, xdotool and xclip. No application/runtime dependency.
Screenshots are evidence for human review, not an assertion of pixel-perfect portability.
"""
import json
import os
from pathlib import Path
import re
import subprocess as sp
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist' / 'visuals'


def command(*args, check=True):
    result = sp.run(args, stdout=sp.PIPE, stderr=sp.PIPE, timeout=15)
    if check and result.returncode:
        raise RuntimeError(f'{args}: {result.stderr.decode(errors="replace")}')
    return result


def main():
    display = os.environ.get('DISPLAY', '')
    if sys.argv[1:] != ['--isolated-xvfb'] or not re.fullmatch(r':\d+(\.\d+)?', display):
        raise SystemExit('Run only with --isolated-xvfb under the documented private xvfb-run command.')
    xvfb = False
    for process in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            args = process.read_bytes().split(b'\0')
            xvfb |= bool(args and Path(os.fsdecode(args[0])).name == 'Xvfb' and display.split('.')[0].encode() in args)
        except OSError:
            pass
    if not xvfb:
        raise SystemExit('Refusing to capture or replace a clipboard outside Xvfb.')
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sf-visuals-') as directory:
        home = Path(directory)
        for name in ('config', 'run', 'cache', 'data'):
            (home / name).mkdir(mode=0o700)
        for name in list(os.environ):
            if name.startswith(('WEZTERM_', 'LUA_', 'DBUS_')) or name in ('WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'SWAYSOCK', 'PIPEWIRE_REMOTE'):
                os.environ.pop(name)
        os.environ.update(HOME=directory, XDG_CONFIG_HOME=str(home / 'config'), XDG_RUNTIME_DIR=str(home / 'run'),
                          XDG_CACHE_HOME=str(home / 'cache'), XDG_DATA_HOME=str(home / 'data'),
                          SDL_VIDEO_DRIVER='x11', XDG_SESSION_TYPE='x11', LIBGL_ALWAYS_SOFTWARE='1')
        # This synthetic deployment error is the captured subject, not a ScreenFling error.
        fixture = home / 'fixture.png'
        command('convert', '-size', '1280x800', 'xc:#e8edf4', '-font', 'DejaVu-Sans',
                '-fill', '#ffffff', '-draw', 'rectangle 100,100 699,439',
                '-fill', '#e2e8f0', '-draw', 'rectangle 100,155 699,156',
                '-fill', '#1e293b', '-pointsize', '20', '-draw', 'text 124,135 "Atlas / Deployments"',
                '-pointsize', '26', '-draw', 'text 124,197 "Preview deployment"',
                '-fill', '#475569', '-pointsize', '16', '-draw', 'text 124,227 "atlas-dashboard  /  feature/settings-panel"',
                '-fill', '#fff1f2', '-draw', 'roundrectangle 124,249 675,351 8,8',
                '-fill', '#9f1239', '-pointsize', '18', '-draw', 'text 142,278 "Build failed"',
                '-fill', '#881337', '-pointsize', '15', '-draw', 'text 142,308 "Missing PUBLIC_API_URL in the preview environment."',
                '-pointsize', '13', '-draw', 'text 142,334 "src/config.ts:12"',
                '-fill', '#dbeafe', '-draw', 'roundrectangle 124,372 280,414 7,7',
                '-fill', '#1e40af', '-pointsize', '16', '-draw', 'text 143,398 "View build log"', str(fixture))
        background = sp.Popen(['display', '-window', 'root', str(fixture)], stdout=sp.DEVNULL, stderr=sp.DEVNULL)
        owner = sp.Popen(['xclip', '-selection', 'clipboard', '-in', '-quiet'], stdin=sp.PIPE, stdout=sp.DEVNULL, stderr=sp.DEVNULL)
        sentinel = b'screenfling-visual-review-must-not-deliver'
        owner.stdin.write(sentinel)
        owner.stdin.close()
        app = None
        records = []
        with (OUT / 'application.log').open('w+b') as log:
            try:
                time.sleep(0.4)
                # Compare to independently read display pixels, not the pre-display
                # ImageMagick file (which may be quantized while installing a wallpaper).
                reference = OUT / 'synthetic-reference.png'
                command('import', '-window', 'root', str(reference))
                expected = command('convert', str(reference), '-crop', '600x340+100+100', '+repage', '-depth', '8', 'rgba:-').stdout
                generated = command('convert', str(fixture), '-crop', '600x340+100+100', '+repage', '-depth', '8', 'rgba:-').stdout
                assert len(expected) == 600 * 340 * 4
                assert len(set(expected)) > 32, 'The synthetic desktop did not render'
                app = sp.Popen([str(ROOT / 'target/release/screenfling')], stdout=log, stderr=log)

                def window(title, focus=True):
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline:
                        assert app.poll() is None, 'Application exited during visual check'
                        result = command('xdotool', 'search', '--onlyvisible', '--pid', str(app.pid), '--name', title, check=False)
                        if result.returncode == 0 and result.stdout.strip():
                            handle = result.stdout.splitlines()[0].decode()
                            if not focus or command('xdotool', 'windowfocus', '--sync', handle, check=False).returncode == 0:
                                return handle
                        time.sleep(0.05)
                    raise AssertionError(f'Window did not reach {title}')

                def key(title, value):
                    window(title)
                    command('xdotool', 'key', '--clearmodifiers', value)
                    time.sleep(0.2)

                def click(title, x, y):
                    handle = window(title)
                    command('xdotool', 'mousemove', '--window', handle, str(x), str(y), 'click', '1')
                    time.sleep(0.25)

                def unchanged():
                    assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel

                def shot(title, name, size):
                    handle = window(title)
                    command('xdotool', 'mousemove', '0', '0')
                    time.sleep(0.25)
                    path = OUT / f'{name}.png'
                    command('import', '-window', handle, str(path))
                    dimensions = command('identify', '-format', '%wx%h', str(path)).stdout.decode()
                    assert dimensions == f'{size[0]}x{size[1]}', (name, dimensions)
                    variation = float(command('convert', str(path), '-format', '%[fx:standard_deviation]', 'info:').stdout)
                    assert variation > 0.03, f'{name} is blank or incompletely rendered'
                    records.append({'screen': name, 'dimensions': list(size), 'nonblank': True})

                def resize(title, width, height):
                    handle = window(title)
                    command('xdotool', 'windowsize', '--sync', handle, str(width), str(height))
                    time.sleep(0.25)

                shot('^ScreenFling$', 'idle', (1000, 740))
                click('^ScreenFling$', 945, 42)
                shot('^ScreenFling$', 'more-menu', (1000, 740))
                key('^ScreenFling$', 'Escape')
                window('^ScreenFling$')
                unchanged()
                key('^ScreenFling$', 'F10')
                shot('^ScreenFling$', 'settings', (1000, 740))
                # Read back saved preferences to prove native typing reached the field.
                click('^ScreenFling$', 300, 275)
                key('^ScreenFling$', 'ctrl+a')
                typed_path = '/visual-fixture/not-installed-wezterm'
                command('xdotool', 'type', '--clearmodifiers', '--delay', '5', typed_path)
                click('^ScreenFling$', 110, 457)
                settings_path = home / 'config' / 'screenfling' / 'settings.json'
                assert json.loads(settings_path.read_text())['connection']['executable'] == typed_path, 'Native text input did not reach Settings'
                unchanged()
                resize('^ScreenFling$', 640, 480)
                shot('^ScreenFling$', 'settings-compact', (640, 480))
                key('^ScreenFling$', 'Escape')
                unchanged()
                resize('^ScreenFling$', 1000, 740)
                key('^ScreenFling$', 'F8')
                window('Select region$')
                command('xdotool', 'mousemove', '100', '100', 'mousedown', '1', 'sleep', '0.15', 'mousemove', '700', '440')
                time.sleep(0.25)
                command('import', '-window', window('Select region$'), str(OUT / 'selection.png'))
                command('xdotool', 'mouseup', '1')
                shot('Review crop$', 'review', (1000, 740))
                unchanged()
                click('Review crop$', 195, 232)
                shot('Review crop$', 'review-native-pixels', (1000, 740))
                handle = window('Review crop$')
                command('xdotool', 'mousemove', '--window', handle, '425', '400', 'click', '--repeat', '12', '--delay', '30', '5')
                shot('Review crop$', 'review-native-scrolled', (1000, 740))
                unchanged()
                click('Review crop$', 120, 232)
                click('Review crop$', 700, 505)
                command('xdotool', 'type', '--clearmodifiers', '--delay', '5', 'Check why the preview deployment is missing its API URL.')
                click('Review crop$', 600, 145)
                shot('Review crop$', 'review-note', (1000, 740))
                unchanged()
                click('Review crop$', 730, 232)
                time.sleep(0.3)
                shot('Review crop$', 'review-connection-error', (1000, 740))
                unchanged()
                key('Review crop$', 'F10')
                key('Review crop$', 'Escape')
                window('Review crop$')
                unchanged()
                resize('Review crop$', 640, 480)
                shot('Review crop$', 'review-compact', (640, 480))
                handle = window('Review crop$')
                command('xdotool', 'mousemove', '--window', handle, '450', '280', 'click', '--repeat', '30', '--delay', '30', '5')
                shot('Review crop$', 'review-compact-scrolled', (640, 480))
                unchanged()
                resize('Review crop$', 1000, 740)
                shot('Review crop$', 'review-restored', (1000, 740))
                key('Review crop$', 'F6')
                shot('Result$', 'copy-result', (1000, 740))
                copied = command('xclip', '-selection', 'clipboard', '-out', '-target', 'image/png').stdout
                assert copied.startswith(b'\x89PNG\r\n\x1a\n')
                (OUT / 'synthetic-copied.png').write_bytes(copied)
                decoded = sp.run(['convert', 'png:-', '-depth', '8', 'rgba:-'], input=copied,
                                 stdout=sp.PIPE, stderr=sp.PIPE, check=True, timeout=10).stdout
                assert decoded == expected, f'Copied pixels differ from the rendered reference: lengths {len(decoded)}/{len(expected)}, first mismatch {next((i for i, (a, b) in enumerate(zip(decoded, expected)) if a != b), None)}'
                command('convert', str(OUT / 'review.png'), '-quality', '88', str(OUT / 'preview.webp'))
                report = {'source': command('git', 'rev-parse', 'HEAD').stdout.decode().strip(),
                          'scope': 'Actual release executable, isolated Xvfb/software OpenGL, synthetic deployment-error subject. No agent attachment claim.',
                          'wallpaper_file_matches_rendered_pixels': generated == expected,
                          'checks': ['menu Escape dismisses only the menu', 'native text entry persists exact settings', 'settings back preserves review', 'selection/review/settings/resize preserve clipboard', 'preview modes and note editing preserve clipboard', 'copied pixels equal the independently read rendered fixture crop', 'viewport dimensions and nonblank frames'],
                          'screens': records}
                (OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
                print(json.dumps(report, indent=2))
            except BaseException:
                log.flush()
                log.seek(0)
                print(log.read().decode(errors='replace'))
                raise
            finally:
                for process in (app, owner, background):
                    if process and process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except sp.TimeoutExpired:
                            process.kill()
                            process.wait()


if __name__ == '__main__':
    main()

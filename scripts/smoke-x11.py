#!/usr/bin/env python3
"""One real desktop smoke check, using a synthetic Xvfb screen. No test framework.
Run: xvfb-run -a -s '-screen 0 1280x800x24' python3 scripts/smoke-x11.py
"""
import json
import os
from pathlib import Path
import struct
import subprocess as sp
import tempfile
import time
import zlib


def command(*args, check=True):
    return sp.run(args, check=check, stdout=sp.PIPE, stderr=sp.PIPE, timeout=8)


def cpu_ticks(pid):
    fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    return int(fields[11]) + int(fields[12])


def check_png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'Copy did not provide a PNG image'
    width, height, depth, color = struct.unpack('>IIBB', data[16:26])
    assert (width, height, depth, color) == (200, 150, 8, 6), (width, height, depth, color)
    offset, compressed = 8, bytearray()
    while offset + 12 <= len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        if data[offset + 4:offset + 8] == b'IDAT':
            compressed.extend(data[offset + 8:offset + 8 + length])
        offset += length + 12
    rows = zlib.decompress(compressed)
    # All PNG filter predictors are zero at the first pixel of the first row.
    assert rows[0] <= 4 and rows[1:5] == bytes([0x34, 0x56, 0x78, 255]), rows[:5]
    return [width, height]


def main():
    os.environ.update(SDL_VIDEO_DRIVER='x11', XDG_SESSION_TYPE='x11', LIBGL_ALWAYS_SOFTWARE='1')
    os.environ.pop('WAYLAND_DISPLAY', None)
    output = Path('dist')
    output.mkdir(exist_ok=True)
    command('xsetroot', '-solid', '#345678')
    sentinel = b'screenfling-cancel-must-not-change-clipboard'
    owner = sp.Popen(['xclip', '-selection', 'clipboard', '-in', '-quiet'], stdin=sp.PIPE,
                     stdout=sp.DEVNULL, stderr=sp.DEVNULL)
    owner.stdin.write(sentinel)
    owner.stdin.close()
    app = None
    with tempfile.TemporaryDirectory(prefix='sf-smoke-') as config, tempfile.TemporaryFile() as log:
        env = os.environ.copy()
        env['XDG_CONFIG_HOME'] = config
        try:
            time.sleep(0.2)
            assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel
            start = time.monotonic()
            app = sp.Popen(['target/release/screenfling'], env=env, stdout=log, stderr=log)

            def window(title):
                deadline = time.monotonic() + 12
                while time.monotonic() < deadline:
                    assert app.poll() is None, 'Application exited unexpectedly'
                    found = command('xdotool', 'search', '--onlyvisible', '--pid', str(app.pid), '--name', title, check=False)
                    if found.returncode == 0 and found.stdout.strip():
                        return found.stdout.splitlines()[0].decode()
                    time.sleep(0.05)
                raise AssertionError(f'Window did not reach {title}')

            def key(title, value):
                handle = window(title)
                command('xdotool', 'windowfocus', '--sync', handle)
                command('xdotool', 'key', '--clearmodifiers', value)

            window('^ScreenFling$')
            startup_ms = round((time.monotonic() - start) * 1000, 1)
            time.sleep(1)
            before = cpu_ticks(app.pid)
            sample = time.monotonic()
            time.sleep(2)
            idle_cpu = 100 * (cpu_ticks(app.pid) - before) / os.sysconf('SC_CLK_TCK') / (time.monotonic() - sample)
            status = dict(line.split(':', 1) for line in Path(f'/proc/{app.pid}/status').read_text().splitlines() if ':' in line)
            command('xdotool', 'mousemove', '0', '0')
            key('^ScreenFling$', 'F8')
            key('Select region$', 'Escape')
            window('^ScreenFling$')
            assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel
            key('^ScreenFling$', 'F8')
            handle = window('Select region$')
            command('xdotool', 'windowfocus', '--sync', handle)
            command('xdotool', 'mousemove', '100', '100', 'mousedown', '1', 'sleep', '0.15',
                    'mousemove', '300', '250', 'sleep', '0.15', 'mouseup', '1')
            window('Review crop$')
            assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel
            key('Review crop$', 'F6')
            window('Result$')
            png = command('xclip', '-selection', 'clipboard', '-out', '-target', 'image/png').stdout
            size = check_png(png)
            result = {
                'environment': 'GitHub Linux runner / Xvfb / software OpenGL; not a hardware benchmark',
                'startup_to_visible_window_ms': startup_ms,
                'idle_cpu_percent_of_one_core': round(idle_cpu, 2),
                'idle_rss_kib': int(status['VmRSS'].split()[0]),
                'idle_threads': int(status['Threads'].strip()),
                'checks': ['start', 'cancel keeps clipboard', 'frozen crop review keeps clipboard', 'explicit Copy serves exact PNG pixels'],
                'copied_dimensions': size,
            }
            (output / 'smoke-x11.json').write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result, indent=2))
        except BaseException:
            if app and app.poll() is None:
                app.terminate()
                app.wait(timeout=5)
            log.seek(0)
            print(log.read().decode(errors='replace'))
            raise
        finally:
            for process in (app, owner):
                if process and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except sp.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""One real desktop smoke check, using a synthetic Xvfb screen. No test framework.
Run: xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/smoke-x11.py
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
    result = sp.run(args, stdout=sp.PIPE, stderr=sp.PIPE, timeout=8)
    if check and result.returncode:
        raise RuntimeError(f'{args}: {result.stderr.decode(errors="replace").strip()}')
    return result


def cpu_ticks(pid):
    fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    return int(fields[11]) + int(fields[12])


def marked(x, y):
    # An asymmetric tile catches wrong crop origins, channel order, and flipped rows.
    x, y = x % 19, y % 17
    return (x * 7 + y * 11 + x * y) % 23 < 9


def install_pattern(directory):
    bitmap = Path(directory) / 'pattern.xbm'
    values = [sum(int(marked(x, y)) << (x % 8)
                  for x in range(start, min(start + 8, 19)))
              for y in range(17) for start in range(0, 19, 8)]
    bitmap.write_text('#define pattern_width 19\n#define pattern_height 17\n'
                      'static unsigned char pattern_bits[] = {\n' +
                      ',\n'.join(','.join(hex(v) for v in values[i:i + 12])
                                  for i in range(0, len(values), 12)) + '\n};\n')
    command('xsetroot', '-bitmap', str(bitmap), '-fg', '#c43a71', '-bg', '#345678')


def check_png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'Copy did not provide a PNG image'
    width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', data[16:29])
    assert (width, height, depth, color, compression, filtering, interlace) == (200, 150, 8, 6, 0, 0, 0)
    offset, compressed = 8, bytearray()
    while offset + 12 <= len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        if data[offset + 4:offset + 8] == b'IDAT':
            compressed.extend(data[offset + 8:offset + 8 + length])
        offset += length + 12
    rows = zlib.decompress(compressed)
    stride = width * 4
    assert len(rows) == height * (stride + 1), 'PNG has an incomplete pixel buffer'
    previous = bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        kind = rows[start]
        assert 0 <= kind <= 4, 'Unsupported PNG row filter'
        current = bytearray(rows[start + 1:start + 1 + stride])
        for i in range(stride):
            left = current[i - 4] if i >= 4 else 0
            above = previous[i]
            upper_left = previous[i - 4] if i >= 4 else 0
            if kind == 4:
                prediction = left + above - upper_left
                pa, pb, pc = abs(prediction - left), abs(prediction - above), abs(prediction - upper_left)
                predictor = left if pa <= pb and pa <= pc else above if pb <= pc else upper_left
            else:
                predictor = (0, left, above, (left + above) // 2)[kind]
            current[i] = (current[i] + predictor) & 255
        expected = bytes(channel for x in range(width)
                         for channel in ((196, 58, 113, 255) if marked(x + 100, y + 100)
                                         else (52, 86, 120, 255)))
        assert current == expected, f'Crop pixels differ from the frozen fixture on row {y}'
        previous = current
    return [width, height]


def main():
    os.environ.update(SDL_VIDEO_DRIVER='x11', XDG_SESSION_TYPE='x11', LIBGL_ALWAYS_SOFTWARE='1')
    os.environ.pop('WAYLAND_DISPLAY', None)
    output = Path('dist')
    output.mkdir(exist_ok=True)
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
            install_pattern(config)
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
            # Exercise the native global shortcut and whole-display review, then cancel.
            command('xdotool', 'key', '--clearmodifiers', 'ctrl+shift+9')
            key('Select region$', 'space')
            key('Review crop$', 'Escape')
            window('^ScreenFling$')
            assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel
            key('^ScreenFling$', 'F8')
            handle = window('Select region$')
            # Changing the desktop now must not change the frozen capture being reviewed.
            command('xsetroot', '-solid', '#112233')
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
                'checks': ['start', 'cancel keeps clipboard', 'native global shortcut',
                           'whole-display review cancellation keeps clipboard',
                           'frozen crop review keeps clipboard',
                           'explicit Copy serves every expected pixel from the original frozen frame'],
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

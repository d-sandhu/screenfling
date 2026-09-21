#!/usr/bin/env python3
"""One real desktop smoke check, using a synthetic Xvfb/Openbox screen.
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
    header = struct.unpack('>IIBBBBB', data[16:29])
    assert header == (200, 150, 8, 6, 0, 0, 0), f'Unexpected crop PNG header: {header}'
    width, height = header[:2]
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
                predictor = left if pa <= pb and pa <= pc else upper_left
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
    for name in ('WAYLAND_DISPLAY', 'WAYLAND_SOCKET'):
        os.environ.pop(name, None)
    output = Path('dist')
    output.mkdir(exist_ok=True)
    sentinel = b'screenfling-cancel-must-not-change-clipboard'
    owner = sp.Popen(['xclip', '-selection', 'clipboard', '-in', '-quiet'], stdin=sp.PIPE,
                     stdout=sp.DEVNULL, stderr=sp.DEVNULL)
    owner.stdin.write(sentinel)
    owner.stdin.close()
    app = manager = None
    with tempfile.TemporaryDirectory(prefix='sf-smoke-') as config, tempfile.TemporaryFile() as log:
        env = os.environ.copy()
        env['XDG_CONFIG_HOME'] = config
        # This fixture has no tray service. Closing must exit, not strand a hidden app.
        env['DBUS_SESSION_BUS_ADDRESS'] = 'unix:path=' + str(Path(config) / 'no-session-bus')
        try:
            wm_config = Path(config) / 'openbox.xml'
            wm_config.write_text('<openbox_config xmlns="http://openbox.org/3.4/rc"/>\n')
            manager = sp.Popen(['openbox', '--sm-disable', '--config-file', str(wm_config)],
                               env=env, stdout=log, stderr=log)
            deadline = time.monotonic() + 10
            while command('wmctrl', '-m', check=False).returncode:
                assert manager.poll() is None and time.monotonic() < deadline, 'Window manager did not start'
                time.sleep(0.05)
            install_pattern(config)
            time.sleep(0.2)
            assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel
            start = time.monotonic()
            app = sp.Popen(['target/release/screenfling'], env=env, stdout=log, stderr=log)

            def window(title, focus=False):
                deadline = time.monotonic() + 12
                # xdotool defaults to OR matching: PID alone would otherwise let
                # an earlier phase satisfy a wait for a later review/result title.
                search = ('xdotool', 'search', '--all', '--onlyvisible', '--pid', str(app.pid), '--name', title)
                while time.monotonic() < deadline:
                    assert app.poll() is None, 'Application exited unexpectedly'
                    found = command(*search, check=False)
                    if found.returncode == 0 and found.stdout.strip():
                        handle = found.stdout.splitlines()[0].decode()
                        if not focus:
                            return handle
                        # SDL can unmap/remap a window while changing its border.
                        # Wait for readiness; never repeat the key or delivery action.
                        focused = command('xdotool', 'windowfocus', '--sync', handle, check=False)
                        confirmed = command(*search, check=False)
                        if focused.returncode == 0 and handle.encode() in confirmed.stdout.splitlines():
                            return handle
                    time.sleep(0.05)
                raise AssertionError(f'Window did not reach {title}')

            def key(title, value):
                window(title, focus=True)
                command('xdotool', 'key', '--clearmodifiers', value)

            def state(handle, property_name, expected):
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    actual = command('xprop', '-id', handle, property_name).stdout.decode()
                    if all(value in actual for value in expected):
                        return
                    time.sleep(0.05)
                raise AssertionError(f'Window did not reach {expected}: {actual}')

            handle = window('^ScreenFling$')
            startup_ms = round((time.monotonic() - start) * 1000, 1)
            time.sleep(1)
            before = cpu_ticks(app.pid)
            sample = time.monotonic()
            time.sleep(2)
            idle_cpu = 100 * (cpu_ticks(app.pid) - before) / os.sysconf('SC_CLK_TCK') / (time.monotonic() - sample)
            status = dict(line.split(':', 1) for line in Path(f'/proc/{app.pid}/status').read_text().splitlines() if ':' in line)
            children = Path(f'/proc/{app.pid}/task/{app.pid}/children').read_text().split()
            command('wmctrl', '-ir', handle, '-b', 'add,maximized_vert,maximized_horz')
            state(handle, '_NET_WM_STATE', ['_NET_WM_STATE_MAXIMIZED_VERT', '_NET_WM_STATE_MAXIMIZED_HORZ'])
            command('xdotool', 'mousemove', '0', '0')
            key('^ScreenFling$', 'F8')
            overlay = window('Select region$', focus=True)
            geometry = dict(line.split('=', 1) for line in command(
                'xdotool', 'getwindowgeometry', '--shell', overlay).stdout.decode().splitlines())
            assert [int(geometry[k]) for k in ('X', 'Y', 'WIDTH', 'HEIGHT')] == [0, 0, 1280, 800], geometry
            key('Select region$', 'Escape')
            handle = window('^ScreenFling$')
            assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel
            # A real minimized window, not a synthetic flag. The native global
            # shortcut must reopen selection, not reapply SDL's hidden pending state.
            command('xdotool', 'windowminimize', '--sync', handle)
            state(handle, 'WM_STATE', ['Iconic'])
            command('xdotool', 'key', '--clearmodifiers', 'ctrl+shift+9')
            key('Select region$', 'space')
            key('Review crop$', 'Escape')
            window('^ScreenFling$')
            assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel
            key('^ScreenFling$', 'F8')
            window('Select region$', focus=True)
            # Changing the desktop now must not change the frozen capture being reviewed.
            command('xsetroot', '-solid', '#112233')
            command('xdotool', 'mousemove', '100', '100', 'mousedown', '1', 'sleep', '0.15',
                    'mousemove', '300', '250', 'sleep', '0.15', 'mouseup', '1')
            window('Review crop$')
            assert command('xclip', '-selection', 'clipboard', '-out').stdout == sentinel
            key('Review crop$', 'F6')
            handle = window('Result$')
            png = command('xclip', '-selection', 'clipboard', '-out', '-target', 'image/png').stdout
            size = check_png(png)
            command('wmctrl', '-ic', handle)
            assert app.wait(timeout=8) == 0, 'Closing without a tray did not exit cleanly'
            result = {
                'environment': 'GitHub Linux runner / Xvfb / Openbox / software OpenGL; not a hardware benchmark',
                'startup_to_visible_window_ms': startup_ms,
                'idle_cpu_percent_of_one_core': round(idle_cpu, 2),
                'idle_rss_kib': int(status['VmRSS'].split()[0]),
                'idle_threads': int(status['Threads'].strip()),
                'idle_child_processes': len(children),
                'checks': ['start', 'maximized capture uses exact display bounds', 'cancel keeps clipboard',
                           'native global shortcut restores minimized capture',
                           'whole-display review cancellation keeps clipboard',
                           'frozen crop review keeps clipboard',
                           'explicit Copy serves every expected pixel from the original frozen frame',
                           'close without a tray exits cleanly'],
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
            for process in (app, manager, owner):
                if process and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except sp.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == '__main__':
    main()

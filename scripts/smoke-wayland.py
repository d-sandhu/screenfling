#!/usr/bin/env python3
"""Exercise the real portal/PipeWire/Wayland path on an isolated synthetic desktop.
Never connects to the user's compositor, D-Bus, PipeWire, settings, or clipboard.
Needs: sway, swaybg, pipewire, wireplumber, xdg-desktop-portal{,-wlr}, wtype,
wl-clipboard, dbus-daemon. Run from the repository root after the release build.
"""
import json
import os
from pathlib import Path
import runpy
import shlex
import struct
import subprocess as sp
import sys
import tempfile
import time
import traceback
import zlib

ROOT = Path(__file__).resolve().parent.parent


def command(*args, check=True):
    result = sp.run(args, stdout=sp.PIPE, stderr=sp.PIPE, timeout=10)
    if check and result.returncode:
        raise RuntimeError(f'{args}: {result.stderr.decode(errors="replace").strip()}')
    return result


def wait_for(check, description, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if value := check():
            return value
        time.sleep(0.05)
    raise AssertionError(f'Timed out: {description}')


def session():
    home = Path(os.environ['SF_SMOKE_HOME'])
    assert home.name.startswith('sf-wayland-') and Path(os.environ['XDG_RUNTIME_DIR']) == home / 'run'
    fixture = runpy.run_path(str(ROOT / 'scripts' / 'smoke-x11.py'))
    pixels = bytes(channel for y in range(800) for x in range(1280)
                   for channel in ((196, 58, 113, 255) if fixture['marked'](x, y)
                                   else (52, 86, 120, 255)))

    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value))

    wallpaper = home / 'fixture.png'
    rows = b''.join(b'\0' + pixels[y * 5120:(y + 1) * 5120] for y in range(800))
    wallpaper.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1280, 800, 8, 6, 0, 0, 0)) +
                          chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
    config = home / 'sway.conf'
    config.write_text(f'xwayland disable\noutput HEADLESS-1 mode 1280x800\n'
                      f'output HEADLESS-1 bg {wallpaper} fill\nseat seat0 fallback true\n'
                      'default_border none\nfocus_follows_mouse no\n')
    portal_config = home / 'config' / 'xdg-desktop-portal'
    portal_config.mkdir()
    (portal_config / 'portals.conf').write_text('[preferred]\ndefault=wlr\n')
    chooser = home / 'choose'
    chooser.write_text(f'#!/bin/sh\n[ -e {shlex.quote(str(home / "deny"))} ] && exit 1\nprintf "HEADLESS-1\\n"\n')
    backend_config = home / 'config' / 'xdg-desktop-portal-wlr'
    backend_config.mkdir()
    xdpw_config = backend_config / 'config'
    xdpw_config.write_text(f'[screencast]\nchooser_type=simple\nchooser_cmd=/bin/sh {chooser}\nmax_fps=10\n')
    processes = []
    logs = []

    def start(name, *args, stdin=None):
        log = open(home / f'{name}.log', 'wb')
        logs.append(log)
        process = sp.Popen(args, stdin=stdin, stdout=log, stderr=log)
        processes.append(process)
        return process

    def sway(text):
        reply = json.loads(command('swaymsg', '-r', text).stdout)
        assert all(item.get('success') for item in reply), reply

    def nodes(node):
        yield node
        for child in node.get('nodes', []) + node.get('floating_nodes', []):
            yield from nodes(child)

    try:
        compositor = start('sway', 'sway', '--config', str(config))
        def socket():
            assert compositor.poll() is None, 'Virtual compositor stopped'
            return next((home / 'run').glob('sway-ipc.*.sock'), None)
        os.environ['SWAYSOCK'] = str(wait_for(socket, 'private Sway socket'))
        os.environ['WAYLAND_DISPLAY'] = wait_for(
            lambda: next((p.name for p in (home / 'run').glob('wayland-*') if p.is_socket()), None), 'Wayland socket')
        command('dbus-update-activation-environment', 'WAYLAND_DISPLAY', 'SWAYSOCK', 'XDG_CURRENT_DESKTOP')
        start('pipewire', 'pipewire')
        wait_for(lambda: (home / 'run' / 'pipewire-0').exists(), 'private PipeWire socket')
        start('wireplumber', 'wireplumber')
        start('portal-wlr', '/usr/libexec/xdg-desktop-portal-wlr', '--config', str(xdpw_config))
        # Acquire the backend name first so D-Bus cannot race a second instance.
        command('gdbus', 'wait', '--session', '--timeout', '15', 'org.freedesktop.impl.portal.desktop.wlr')
        start('portal', '/usr/libexec/xdg-desktop-portal', '--verbose')
        command('gdbus', 'wait', '--session', '--timeout', '15', 'org.freedesktop.portal.Desktop')
        sentinel = b'screenfling-wayland-cancel-preserves-clipboard'
        owner = start('clipboard-owner', 'wl-copy', '--foreground', '--type', 'text/plain', stdin=sp.PIPE)
        owner.stdin.write(sentinel)
        owner.stdin.close()
        def unchanged():
            assert command('wl-paste', '--no-newline', '--type', 'text/plain').stdout == sentinel
        time.sleep(0.3)
        unchanged()
        app = start('screenfling', 'gdb', '--batch', '--return-child-result',
                    '-ex', 'set debuginfod enabled off', '-ex', 'run',
                    '-ex', 'thread apply all bt', '--args',
                    str(ROOT / 'target' / 'release' / 'screenfling'))
        def window(title):
            def ready():
                assert app.poll() is None, f'ScreenFling exited unexpectedly: {app.returncode}'
                tree = json.loads(command('swaymsg', '-t', 'get_tree', '-r').stdout)
                return next((n for n in nodes(tree) if n.get('app_id') == 'dev.screenfling.ScreenFling' and
                             (n.get('name') or '').endswith(title) and n.get('visible', True)), None)
            found = wait_for(ready, title)
            sway(f'[con_id={found["id"]}] focus')
            return found
        def key(title, value):
            window(title)
            print(f'Wayland input: {title} -> {value}', flush=True)
            # Give the virtual keyboard time to publish its keymap and focus.
            command('wtype', '-s', '200', '-k', value)
        window('ScreenFling')
        # A declined chooser must return control without replacing the clipboard.
        (home / 'deny').touch()
        key('ScreenFling', 'F8')
        window('Result')
        unchanged()
        (home / 'deny').unlink()
        key('Result', 'F8')
        key('Select region', 'Escape')
        window('ScreenFling')
        unchanged()
        key('ScreenFling', 'F8')
        key('Select region', 'space')
        key('Review crop', 'Escape')
        window('ScreenFling')
        unchanged()
        key('ScreenFling', 'F8')
        window('Select region')
        sway('output HEADLESS-1 bg #112233 solid_color')
        sway('seat seat0 cursor set 100 100')
        sway('seat seat0 cursor press button1')
        time.sleep(0.15)
        sway('seat seat0 cursor set 300 250')
        time.sleep(0.15)
        sway('seat seat0 cursor release button1')
        window('Review crop')
        unchanged()
        key('Review crop', 'F6')
        window('Result')
        copied = command('wl-paste', '--type', 'image/png').stdout
        dimensions = fixture['check_png'](copied)
        assert not list((home / 'config' / 'screenfling').glob('*.png')), 'Unexpected stored screenshot'
        result = {'environment': 'Isolated headless Sway, real ScreenCast portal/PipeWire, software rendering',
                  'checks': ['portal chooser rejection preserves clipboard', 'capture recovers after rejection',
                             'selection and whole-display review cancellation preserve clipboard',
                             'native Wayland region selection', 'every copied pixel matches the frozen frame'],
                  'copied_dimensions': dimensions}
        (ROOT / 'dist' / 'smoke-wayland.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
    except BaseException:
        (home / 'failure.log').write_text(traceback.format_exc())
        if os.environ.get('SWAYSOCK'):
            result = command('swaymsg', '-t', 'get_tree', '-r', check=False)
            (home / 'tree.log').write_bytes(result.stdout + result.stderr)
        raise
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except sp.TimeoutExpired:
                    process.kill()
                    process.wait()
        for log in logs:
            log.close()
        report = '\n'.join(f'--- {p.name} ---\n{p.read_text(errors="replace")[-6000:]}' for p in home.glob('*.log'))
        (ROOT / 'dist' / 'smoke-wayland.log').write_text(report)
        if sys.exc_info()[0] is not None:
            print(report, file=sys.stderr)


def main():
    (ROOT / 'dist').mkdir(exist_ok=True)
    if sys.argv[1:] == ['--session']:
        session()
        return
    assert len(sys.argv) == 1, 'No external desktop/session options are accepted'
    with tempfile.TemporaryDirectory(prefix='sf-wayland-') as directory:
        home = Path(directory)
        for name in ('run', 'config', 'data', 'cache'):
            (home / name).mkdir(mode=0o700)
        env = os.environ.copy()
        for name in ('DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'SWAYSOCK', 'DBUS_SESSION_BUS_ADDRESS',
                     'DBUS_STARTER_ADDRESS', 'DBUS_STARTER_BUS_TYPE', 'PIPEWIRE_REMOTE'):
            env.pop(name, None)
        env.update(HOME=directory, SF_SMOKE_HOME=directory, XDG_RUNTIME_DIR=str(home / 'run'),
                   XDG_CONFIG_HOME=str(home / 'config'), XDG_DATA_HOME=str(home / 'data'),
                   XDG_CACHE_HOME=str(home / 'cache'), XDG_CURRENT_DESKTOP='sway', XDG_SESSION_TYPE='wayland',
                   WLR_BACKENDS='headless', WLR_RENDERER='pixman', WLR_HEADLESS_OUTPUTS='1',
                   SDL_VIDEO_DRIVER='wayland', LIBGL_ALWAYS_SOFTWARE='1')
        sp.run(['dbus-run-session', '--', sys.executable, str(Path(__file__).resolve()), '--session'],
               env=env, cwd=ROOT, check=True, timeout=150)


if __name__ == '__main__':
    main()

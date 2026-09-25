#!/usr/bin/env python3
"""Remember the original terminal, change focus, paste back, and verify the image."""
import json
import os
from pathlib import Path
import subprocess as sp
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent

def main():
    display = os.environ.get('DISPLAY', '')
    private = False
    for entry in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            args = entry.read_bytes().split(b'\0')
            private |= bool(args and Path(os.fsdecode(args[0])).name == 'Xvfb' and display.encode() in args)
        except OSError:
            pass
    if not private:
        raise SystemExit('Refusing to run outside a private Xvfb display.')
    env = dict(os.environ)
    for name in ('WAYLAND_DISPLAY', 'WAYLAND_SOCKET'):
        env.pop(name, None)
    processes = []
    with tempfile.TemporaryDirectory(prefix='screenfling-paste-') as directory:
        home = Path(directory)
        env.update(HOME=directory, XDG_CONFIG_HOME=directory, XDG_SESSION_TYPE='x11', GDK_BACKEND='x11')
        receiver = home / 'receiver.py'
        receiver.write_text('''import os, select, subprocess, sys, time, tty
from pathlib import Path
out = Path(sys.argv[1])
tty.setraw(0)
out.write_bytes(b'')
end = time.monotonic() + 30
while time.monotonic() < end:
    if select.select([0], [], [], 0.2)[0]:
        data = os.read(0, 4096)
        with out.open('ab') as f: f.write(data)
        if data == bytes([22]):
            png = subprocess.check_output(['xclip', '-selection', 'clipboard', '-target', 'image/png', '-out'], timeout=3)
            out.with_suffix('.png').write_bytes(png)
''')
        try:
            processes.append(sp.Popen(['openbox'], env=env, stdout=sp.DEVNULL, stderr=sp.DEVNULL))
            time.sleep(0.4)
            names = ['screenfling-paste-fixture-A', 'screenfling-paste-fixture-B']
            files = [home / 'a.bin', home / 'b.bin']
            for name, path in zip(names, files):
                processes.append(sp.Popen(['xfce4-terminal', '--disable-server', '--title', name, '--execute', 'python3', str(receiver), str(path)], env=env))
            deadline = time.monotonic() + 10
            while not all(path.exists() for path in files):
                if time.monotonic() >= deadline: raise RuntimeError('Terminal receiver did not start')
                time.sleep(0.05)
            for index in range(2):
                expected_png = home / f'expected-{index}.png'
                original = sp.check_output(['xdotool', 'search', '--name', names[index]], env=env).splitlines()[0]
                sp.run(['xdotool', 'windowactivate', '--sync', original], env=env, check=True)
                sender = sp.Popen([str(ROOT/'target/release/examples/check-send'), '--isolated-xvfb', names[index], str(expected_png)], env=env)
                processes.append(sender)
                deadline = time.monotonic() + 5
                while not expected_png.with_suffix('.ready').exists():
                    if sender.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('Sender did not remember the original terminal')
                    time.sleep(0.02)
                other = sp.check_output(['xdotool', 'search', '--name', names[1-index]], env=env).splitlines()[0]
                sp.run(['xdotool', 'windowactivate', '--sync', other], env=env, check=True)
                expected_png.with_suffix('.go').write_text('go')
                assert sender.wait(timeout=10) == 0
                assert files[index].read_bytes() == bytes([22]), files[index].read_bytes()
                assert files[index].with_suffix('.png').read_bytes() == expected_png.read_bytes()
                expected_other = b'' if index == 0 else bytes([22])
                assert files[1-index].read_bytes() == expected_other
            report = {'scope': 'Two synthetic receivers in Xfce Terminal; no real agent attachment claim', 'checks': ['remembered origin overrides misleading focus', 'Ctrl+V and exact PNG image bytes', 'no Enter', 'other receiver untouched']}
            (ROOT/'dist').mkdir(exist_ok=True)
            (ROOT/'dist/smoke-send.json').write_text(json.dumps(report, indent=2)+'\n')
            print(json.dumps(report))
        finally:
            for process in reversed(processes):
                if process.poll() is not None: continue
                process.terminate()
                try: process.wait(timeout=3)
                except sp.TimeoutExpired:
                    process.kill()
                    process.wait()

if __name__ == '__main__':
    main()

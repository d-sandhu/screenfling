#!/usr/bin/env python3
"""Exercise native window selection and paste into real terminals on private Xvfb."""
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
        env.update(HOME=directory, XDG_CONFIG_HOME=directory)
        receiver = home / 'receiver.py'
        receiver.write_text('''import os, select, sys, termios, time, tty
from pathlib import Path
out = Path(sys.argv[1])
tty.setraw(0)
out.write_bytes(b'')
end = time.monotonic() + 30
while time.monotonic() < end:
    if select.select([0], [], [], 0.2)[0]:
        with out.open('ab') as f: f.write(os.read(0, 4096))
''')
        try:
            processes.append(sp.Popen(['openbox'], env=env, stdout=sp.DEVNULL, stderr=sp.DEVNULL))
            time.sleep(0.4)
            names = ['screenfling-paste-fixture-A', 'screenfling-paste-fixture-B']
            files = [home / 'a.bin', home / 'b.bin']
            for name, path in zip(names, files):
                processes.append(sp.Popen(['xterm', '-T', name, '-e', 'python3', str(receiver), str(path)], env=env))
            deadline = time.monotonic() + 10
            while not all(path.exists() for path in files):
                if time.monotonic() >= deadline: raise RuntimeError('Terminal receiver did not start')
                time.sleep(0.05)
            payloads = ['Inspect this image /tmp/synthetic capture-a.png', 'Review /tmp/synthetic-capture-b.png']
            for index, payload in enumerate(payloads):
                # Put the OTHER terminal in front before choosing the intended one.
                other = sp.check_output(['xdotool', 'search', '--name', names[1-index]], env=env).splitlines()[0]
                sp.run(['xdotool', 'windowactivate', '--sync', other], env=env, check=True)
                sp.run([str(ROOT/'target/release/examples/check-send'), '--isolated-xvfb', names[index], payload], env=env, check=True, timeout=10)
                assert files[index].read_bytes() == payload.encode(), files[index].read_bytes()
                expected_other = b'' if index == 0 else payloads[0].encode()
                assert files[1-index].read_bytes() == expected_other
            report = {'scope': 'X11 window paste into two real xterm sessions; no agent attachment claim', 'checks': ['selected window overrides misleading focus', 'exact path and note bytes', 'no Enter', 'other receiver untouched']}
            (ROOT/'dist').mkdir(exist_ok=True)
            (ROOT/'dist/smoke-send.json').write_text(json.dumps(report, indent=2)+'\n')
            print(json.dumps(report))
        finally:
            for process in reversed(processes):
                process.terminate()
                try: process.wait(timeout=3)
                except sp.TimeoutExpired:
                    process.kill()
                    process.wait()

if __name__ == '__main__':
    main()

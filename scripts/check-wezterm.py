#!/usr/bin/env python3
"""Check production routing in a fresh Linux mux. Never use an existing terminal.
Run after cargo build --release --locked --example check-wezterm.
Requires wezterm and wezterm-mux-server on PATH; no screenshot/clipboard access.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess as sp
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent


def main():
    if sys.platform != 'linux':
        raise SystemExit('This disposable mux fixture requires Linux.')
    wezterm = shutil.which('wezterm')
    server = shutil.which('wezterm-mux-server')
    if not wezterm or not server:
        raise SystemExit('Install WezTerm and its mux server before this opt-in check.')
    helper = ROOT / 'target/release/examples/check-wezterm'
    if not helper.is_file():
        raise SystemExit('Build the check-wezterm example first.')
    with tempfile.TemporaryDirectory(prefix='sf-mux-') as directory:
        root = Path(directory)
        env = os.environ.copy()
        for key in list(env):
            if key.startswith(('WEZTERM_', 'LUA_')):
                env.pop(key)
        env.update(HOME=directory, XDG_CONFIG_HOME=directory, XDG_RUNTIME_DIR=directory,
                   WEZTERM_UNIX_SOCKET=str(root / 'mux.sock'), SHELL='/bin/sh',
                   WEZTERM_LOG='debug')
        env.pop('DISPLAY', None)
        env.pop('WAYLAND_DISPLAY', None)
        config = root / 'wezterm.lua'
        config.write_text('return {unix_domains={{name="fixture",socket_path=' +
                          json.dumps(str(root / 'mux.sock')) + '}}}\n')
        receiver = root / 'receiver.py'
        receiver.write_text('''import os, pathlib, sys, tty
tty.setraw(0)
path = pathlib.Path(sys.argv[1])
with path.open('wb', buffering=0) as output:
    os.write(1, b'\\x1b]0;same label - not an address\\x07')
    path.with_suffix('.ready').write_text('ready')
    while True:
        data = os.read(0, 4096)
        if not data:
            break
        output.write(data)
''')
        def run(*args):
            result = sp.run(args, env=env, stdout=sp.PIPE, stderr=sp.PIPE, timeout=15)
            if result.returncode:
                raise RuntimeError(result.stderr.decode(errors='replace'))
            return result.stdout

        def cli(*args):
            return run(wezterm, '--skip-config', 'cli', '--no-auto-start', *args)

        with (root / 'server.log').open('w+b') as log:
            mux = sp.Popen([server, '--config-file', str(config), '--', sys.executable,
                            str(receiver), str(root / 'first.bytes')], env=env,
                           stdout=log, stderr=log, start_new_session=True)
            try:
                deadline = time.monotonic() + 15
                while not ((root / 'mux.sock').exists() and (root / 'first.ready').exists()):
                    if mux.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError(f'Isolated mux did not become ready: exit={mux.poll()}, '
                                           f'socket={(root / "mux.sock").exists()}, '
                                           f'receiver={(root / "first.ready").exists()}.')
                    time.sleep(0.05)
                panes = json.loads(cli('list', '--format', 'json'))
                assert len(panes) == 1
                first = panes[0]['pane_id']
                second = int(cli('split-pane', '--pane-id', str(first), '--horizontal', '--',
                                 sys.executable, str(receiver), str(root / 'second.bytes')))
                deadline = time.monotonic() + 10
                while not (root / 'second.ready').exists():
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Synthetic decoy pane did not become ready.')
                    time.sleep(0.05)
                cli('activate-pane', '--pane-id', str(second))
                (root / 'panes.json').write_text(json.dumps([first, second]))
                (root / 'fixture-ready').write_text('native-wezterm-fixture-v1')
                # A wrong focus hint must never substitute for the selected target.
                env['WEZTERM_PANE'] = str(second)
                output = run(str(helper), '--isolated-fixture', directory, wezterm)
                version = run(wezterm, '--version').decode().strip()
                result = {'wezterm': version, 'result': output.decode().strip(),
                          'scope': 'isolated local Linux mux; no agent/image-attachment claim'}
                (ROOT / 'dist').mkdir(exist_ok=True)
                (ROOT / 'dist/smoke-wezterm.json').write_text(json.dumps(result, indent=2) + '\n')
                print(json.dumps(result, indent=2))
            except BaseException:
                print('Fixture entries:', sorted(str(p.relative_to(root)) for p in root.rglob('*')))
                if (root / 'mux.sock').exists():
                    for arguments in [('list', '--format', 'json'), ('get-text', '--pane-id', '0')]:
                        try:
                            print(arguments, cli(*arguments).decode(errors='replace')[-4000:])
                        except Exception as error:
                            print('Fixture diagnostic:', error)
                # Temporary diagnostics for reproducing the fixture outside CI.
                diagnostic = ROOT / 'dist/fixture-tools'
                diagnostic.mkdir(parents=True, exist_ok=True)
                for executable in (wezterm, server):
                    shutil.copy2(executable, diagnostic)
                log.flush()
                log.seek(0)
                print(log.read().decode(errors='replace'))
                raise
            finally:
                if mux.poll() is None:
                    os.killpg(mux.pid, signal.SIGTERM)
                    try:
                        mux.wait(timeout=5)
                    except sp.TimeoutExpired:
                        os.killpg(mux.pid, signal.SIGKILL)
                        mux.wait()


if __name__ == '__main__':
    main()

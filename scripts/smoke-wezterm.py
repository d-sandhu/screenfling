#!/usr/bin/env python3
"""Check production routing against an isolated Linux WezTerm mux.
Synthetic raw input only: no coding agent, desktop, or user clipboard.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess as sp
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
PROBE = r'''
#[path = "../src/trusted.rs"] mod trusted;
#[path = "../src/relay.rs"] mod relay;
#[path = "../src/wezterm.rs"] mod wezterm;
use std::{fs, io, path::Path, process::Command, time::{Duration, Instant}};
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let settings = wezterm::ConnectionSettings {
        executable: args[1].clone(), socket: args[2].clone(), paste_confirmed: true,
    };
    let target_id: u32 = args[3].parse().unwrap();
    let other_id: u32 = args[4].parse().unwrap();
    let root = Path::new(&args[5]);
    let cli = |arguments: &[&str]| {
        let output = Command::new(&settings.executable)
            .args(["--skip-config", "cli", "--no-auto-start"])
            .args(arguments).env("WEZTERM_UNIX_SOCKET", &settings.socket)
            .env_remove("WEZTERM_PANE").output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        output.stdout
    };
    let destinations = wezterm::discover(&settings).expect("discover exact mux");
    assert_eq!(destinations.len(), 2);
    let selected = destinations.iter().find(|d| d.pane_id == target_id).unwrap();
    let other = destinations.iter().find(|d| d.pane_id == other_id).unwrap();
    assert_eq!(selected.title, other.title, "Fixture titles must be identical");
    cli(&["activate-pane", "--pane-id", &other_id.to_string()]);
    let note = "Inspect this crop. Café.";
    let result = wezterm::stage(selected, note, || true).expect("stage through pinned relay");
    assert!(result.contains("unverified"));
    let expected = screenfling::model::stage_input(note).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while fs::read(root.join("one")).unwrap() != expected {
        assert!(Instant::now() < deadline, "Exact bytes did not reach the selected pane");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(fs::read(root.join("two")).unwrap().is_empty());
    assert!(wezterm::stage(selected, "blocked", || false).is_err());
    assert!(wezterm::stage(selected, "no\nsubmit", || true).is_err());
    assert_eq!(fs::read(root.join("one")).unwrap(), expected);
    assert!(fs::read(root.join("two")).unwrap().is_empty());
    wezterm::reveal(selected).expect("separate exact-pane Reveal");
    let original = root.join("original-socket");
    fs::rename(&settings.socket, &original).unwrap();
    let decoy = std::os::unix::net::UnixListener::bind(&settings.socket).unwrap();
    decoy.set_nonblocking(true).unwrap();
    assert!(wezterm::stage(selected, "wrong socket", || true).is_err());
    assert_eq!(decoy.accept().unwrap_err().kind(), io::ErrorKind::WouldBlock);
    drop(decoy);
    fs::remove_file(&settings.socket).unwrap();
    fs::rename(&original, &settings.socket).unwrap();
    cli(&["kill-pane", "--pane-id", &target_id.to_string()]);
    assert!(wezterm::stage(selected, "closed pane", || true).is_err());
    assert!(fs::read(root.join("two")).unwrap().is_empty());
    println!("Exact pane, no-submit bytes, rejected gate, separate Reveal, replaced socket, and closed pane passed.");
}
'''


def main():
    if os.name != 'posix' or not Path('/proc').is_dir():
        raise SystemExit('Run this isolated mux check on Linux.')
    cli = shutil.which('wezterm')
    server = shutil.which('wezterm-mux-server')
    if not cli or not server:
        raise SystemExit('Install WezTerm and its mux server before running this check.')
    example = ROOT / 'examples' / 'route_probe.rs'
    if example.exists():
        raise SystemExit('Refusing to overwrite an existing route_probe example.')
    example.parent.mkdir(exist_ok=True)
    try:
        example.write_text(PROBE, encoding='utf-8')
        sp.run(['cargo', 'build', '--release', '--locked', '--example', 'route_probe'],
               cwd=ROOT, check=True, timeout=300)
        with tempfile.TemporaryDirectory(prefix='sf-route-') as directory:
            root = Path(directory)
            for name in ('config', 'data', 'cache', 'run'):
                (root / name).mkdir(mode=0o700)
            env = os.environ.copy()
            for name in ('WEZTERM_UNIX_SOCKET', 'WEZTERM_PANE', 'WEZTERM_CONFIG_FILE',
                         'WEZTERM_CONFIG_DIR', 'LUA_PATH', 'LUA_CPATH', 'DISPLAY', 'WAYLAND_DISPLAY'):
                env.pop(name, None)
            env.update(HOME=directory, XDG_CONFIG_HOME=str(root / 'config'),
                       XDG_DATA_HOME=str(root / 'data'), XDG_CACHE_HOME=str(root / 'cache'),
                       XDG_RUNTIME_DIR=str(root / 'run'))
            socket = str(root / 'mux-socket')
            config = root / 'wezterm.lua'
            config.write_text('return {check_for_updates=false, unix_domains={{name="smoke", socket_path=' +
                              json.dumps(socket) + '}}}\n')
            sink = root / 'sink.py'
            sink.write_text('import os, sys, tty\nfrom pathlib import Path\n'
                            'tty.setraw(0)\nos.write(1, b"\\x1b]2;Same coding session\\x07")\n'
                            'path=Path(sys.argv[1]); path.write_bytes(b"")\n'
                            'path.with_suffix(".ready").touch()\n'
                            'with path.open("ab", buffering=0) as f:\n'
                            ' while True:\n'
                            '  data=os.read(0, 4096)\n'
                            '  if not data: break\n'
                            '  f.write(data)\n')
            with (root / 'mux.log').open('wb') as log:
                mux = sp.Popen([server, '--config-file', str(config), '--', 'python3', str(sink),
                                str(root / 'one')], env=env, stdout=log, stderr=log,
                               start_new_session=True)
                try:
                    deadline = time.monotonic() + 15
                    while not Path(socket).exists() or not (root / 'one.ready').exists():
                        if mux.poll() is not None or time.monotonic() >= deadline:
                            raise AssertionError('Isolated mux did not become ready')
                        time.sleep(0.05)
                    env['WEZTERM_UNIX_SOCKET'] = socket
                    def command(*args):
                        return sp.check_output([cli, '--skip-config', 'cli', '--no-auto-start', *args],
                                               env=env, timeout=15)
                    first = json.loads(command('list', '--format', 'json'))[0]['pane_id']
                    second = int(command('split-pane', '--pane-id', str(first), '--horizontal', '--',
                                         'python3', str(sink), str(root / 'two')))
                    deadline = time.monotonic() + 10
                    while True:
                        panes = json.loads(command('list', '--format', 'json'))
                        if ((root / 'two.ready').exists() and len(panes) == 2 and
                                all(p['title'] == 'Same coding session' for p in panes)):
                            break
                        if time.monotonic() >= deadline:
                            raise AssertionError('Raw-input panes did not become ready')
                        time.sleep(0.05)
                    result = sp.check_output([str(ROOT / 'target/release/examples/route_probe'), cli,
                                              socket, str(first), str(second), directory],
                                             env=env, timeout=90, text=True)
                    record = {'environment': 'Isolated local headless WezTerm mux; no clipboard or coding agent',
                              'wezterm_version': sp.check_output([cli, '--version'], text=True).strip(),
                              'result': result.strip()}
                    (ROOT / 'dist').mkdir(exist_ok=True)
                    (ROOT / 'dist/smoke-wezterm.json').write_text(json.dumps(record, indent=2) + '\n')
                    print(json.dumps(record, indent=2))
                except BaseException:
                    print((root / 'mux.log').read_text(errors='replace'))
                    raise
                finally:
                    if mux.poll() is None:
                        os.killpg(mux.pid, signal.SIGTERM)
                        try:
                            mux.wait(timeout=5)
                        except sp.TimeoutExpired:
                            os.killpg(mux.pid, signal.SIGKILL)
                            mux.wait()
    finally:
        example.unlink(missing_ok=True)
        try:
            example.parent.rmdir()
        except OSError:
            pass


if __name__ == '__main__':
    main()

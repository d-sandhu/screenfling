#!/usr/bin/env python3
"""One-off native image clipboard check on disposable Windows/macOS CI runners."""
import json
import os
from pathlib import Path
import platform
import subprocess as sp

ROOT = Path(__file__).resolve().parent.parent
SOURCE = r'''
#[path = "../src/clipboard.rs"] mod clipboard;
use screenfling::model::Pixels;
fn main() {
    let mut native = arboard::Clipboard::new().unwrap();
    let sentinel = "screenfling-disposable-runner-clipboard";
    native.set_text(sentinel).unwrap();
    let mut delivery = clipboard::Clipboard::new().unwrap();
    assert_eq!(native.get_text().unwrap(), sentinel);
    let reviewed = Pixels::new(3, 2, vec![
        1, 22, 203, 255, 40, 5, 6, 255, 17, 180, 9, 255,
        211, 12, 13, 255, 14, 155, 16, 255, 27, 18, 199, 255,
    ]).unwrap();
    delivery.copy(&reviewed).unwrap();
    let readback = native.get_image().unwrap();
    assert_eq!((readback.width, readback.height), (3, 2));
    assert_eq!(readback.bytes.as_ref(), reviewed.rgba.as_slice());
    let mut replacement = reviewed.clone();
    replacement.rgba[20] ^= 1;
    native.set_image(arboard::ImageData {
        width: 3, height: 2,
        bytes: std::borrow::Cow::Borrowed(&replacement.rgba),
    }).unwrap();
    assert!(!delivery.matches(&reviewed));
    assert!(delivery.matches(&replacement));
    assert_eq!(native.get_image().unwrap().bytes.as_ref(), replacement.rgba.as_slice());
    native.set_text(sentinel).unwrap();
    assert!(!delivery.matches(&reviewed));
    assert_eq!(native.get_text().unwrap(), sentinel);
    native.clear().unwrap();
    println!("Native clipboard image round-trip, changed-pixel rejection, and read-only verification passed.");
}
'''


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or platform.system() not in ('Windows', 'Darwin'):
        raise SystemExit('This check writes only a disposable Windows/macOS CI clipboard.')
    example = ROOT / 'examples' / 'native_clipboard_probe.rs'
    if example.exists():
        raise SystemExit('Refusing to replace an existing example.')
    example.parent.mkdir(exist_ok=True)
    try:
        example.write_text(SOURCE, encoding='utf-8')
        sp.run(['cargo', 'build', '--release', '--locked', '--example', 'native_clipboard_probe'],
               cwd=ROOT, check=True, timeout=300)
        exe = 'native_clipboard_probe' + ('.exe' if os.name == 'nt' else '')
        result = sp.check_output([str(ROOT / 'target' / 'release' / 'examples' / exe)],
                                 cwd=ROOT, text=True, timeout=30)
        record = {'platform': platform.system(), 'environment': 'Disposable hosted runner; no capture or coding agent',
                  'result': result.strip()}
        (ROOT / 'dist').mkdir(exist_ok=True)
        (ROOT / 'dist' / 'native-clipboard.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(record, indent=2))
    finally:
        example.unlink(missing_ok=True)
        try:
            example.parent.rmdir()
        except OSError:
            pass


if __name__ == '__main__':
    main()

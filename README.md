<div align="center">
  <h1><img src="assets/icon.svg" width="36" height="36" alt=""> ScreenFling</h1>
  <p><strong>Show the problem. Keep your context.</strong><br>
  Capture a screen region, review it, and bring it into your coding session.</p>
  <p><strong>Rust</strong> · egui · SDL3 / OpenGL · Windows / macOS / Linux</p>
  <p><a href="#try-it">Build & run</a> · <a href="#engineering">Engineering</a> · <a href="docs/USAGE.md">User guide</a></p>
</div>

![ScreenFling reviewing a screenshot before sending it to a coding session](docs/preview.webp)

*The actual native app, showing a synthetic deployment error.*

A screenshot often explains a bug faster than a paragraph. ScreenFling gives you a small, native capture-and-paste workflow for your coding agent.

## How it works

1. **Capture** a region with the button or global shortcut.
2. **Review** the image at Fit or 1:1 size.
3. **Copy image**, switch to your agent, and press **Ctrl+V**.

Started capture from a terminal? **Paste back** returns to that terminal and presses Ctrl+V for you. You choose the agent by focusing it before capture. ScreenFling never presses Enter.

No agent accounts, terminal plugins, socket configuration or saved image files. The clipboard is the handoff. Your agent must support clipboard images and your terminal must pass through its image-paste shortcut. [Usage and platform support](docs/USAGE.md).

## Engineering

- **One image model.** Native Windows, macOS, X11 and Wayland capture adapters produce the same RGBA pixels. Selection preserves the original resolution, including fractional display scaling. [Capture](src/capture/) · [geometry](src/model.rs)
- **Explicit state.** Capture → selection → review → delivery. Late capture results are discarded; cancelling leaves the clipboard unchanged. [Application](src/app.rs)
- **Small platform boundaries.** Image clipboard access and optional focus/paste adapters stay separate from the UI. Paste checks focus and clipboard, sends once, and leaves submission to you. [Clipboard](src/clipboard.rs) · [paste back](src/send.rs)

[CI](.github/workflows/check.yml) builds and packages all three platforms. Tests compare every crop pixel on X11 and Wayland at 125% scale, read native clipboards from separate processes, and verify paste-back delivery in disposable terminals. [Reproduce the checks](docs/DEVELOPMENT.md#checks).

## Try it

Install **Rust, CMake and a native C/C++ toolchain**. Follow the [platform prerequisites](docs/DEVELOPMENT.md#build-prerequisites), including Linux development libraries and macOS 14+.

```sh
git clone https://github.com/d-sandhu/screenfling.git
cd screenfling
cargo run --release --locked
```

Start with **Capture region** or **F8**. The [user guide](docs/USAGE.md) covers shortcuts, permissions and Paste back.

## Status

**Pre-release.** Automated checks cover Windows x86-64, macOS Apple Silicon and Linux x86-64. Physical desktop testing, real coding-agent attachment, and public signing/notarization remain on the [release checklist](docs/DEVELOPMENT.md#remaining-release-acceptance).

[Development & contributing](docs/DEVELOPMENT.md) · [Visual design](docs/VISUALS.md) · [Report an issue](https://github.com/d-sandhu/screenfling/issues) · [MIT](LICENSE)

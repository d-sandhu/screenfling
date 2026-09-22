<div align="center">
  <img src="assets/icon.svg" width="56" height="56" alt="">
  <h1>ScreenFling</h1>
  <p><strong>Show the problem. Keep your context.</strong></p>
  <p>A native desktop utility that turns a screen region into a reviewed image<br>you can copy or stage in the exact coding session you choose.</p>
  <p><strong>Rust</strong> · egui · SDL3 / OpenGL · Windows / macOS / Linux</p>
  <p><a href="#try-it">Build & run</a> · <a href="docs/USAGE.md">User guide</a> · <a href="#engineering-highlights">Engineering</a> · <a href="docs/DEVELOPMENT.md">Development</a></p>
</div>

![ScreenFling's native review workspace showing a synthetic deployment error, original crop dimensions, destination setup, an optional note, and explicit Copy and Stage actions](docs/preview.webp)

*The running native application, not a mockup. The captured deployment error is a synthetic example. Stage is unavailable until its connection and exact destination are confirmed.*

> **Pre-release:** this is a native development build. CI exercises the supported build targets; physical desktop acceptance, real coding-agent attachment, public signing and notarization remain separate checks.

## The problem

A screenshot can show an error, layout issue or unexpected state that is awkward to describe. Getting it into the right coding session usually means saving a file, finding its path and switching between windows. Multiple terminal panes make a focus-based shortcut especially easy to misdirect.

ScreenFling makes that handoff explicit: **capture → select → review → copy or stage**. It is a focused desktop tool, not an image editor, screen recorder or cloud-sharing service.

## The workflow

1. **Capture a region.** Start with a shortcut or the Capture button. Drag on a frozen frame, or select the whole display.
2. **Review before delivery.** Inspect the crop in a fit-to-window or 1:1 pixel preview. Add an optional one-line note for the coding agent.
3. **Choose the handoff.** Copy the image for manual use, or select an exact local WezTerm pane and Stage. Reveal that destination separately and inspect the attachment before submitting.

**Copy needs no terminal integration. Stage sends Ctrl+V and the note, never Enter.** A successful terminal write does not prove that an agent attached the image; the result keeps that distinction visible.

## Engineering highlights

| Decision | Why it matters | Implementation |
| --- | --- | --- |
| Native application, no embedded browser | Rust, egui and a statically linked SDL video/tray subset; system graphics and desktop services remain dependencies. | [`main.rs`](src/main.rs), [`app_view.rs`](src/app_view.rs) |
| Pixels first, not guessed DPI | Selection maps to the captured image's actual dimensions. Preview scaling never changes the delivered crop. | [`model.rs`](src/model.rs), [`frame.rs`](src/frame.rs) |
| Explicit state transitions | Only the current capture can advance to delivery. Cancellation and late worker results cannot deliver a newer or abandoned image. | [`app.rs`](src/app.rs) |
| Identity instead of focus | Pin the local mux endpoint and validate pane/window/tab IDs. Titles are labels, not routing addresses. | [`wezterm.rs`](src/wezterm.rs), [`relay.rs`](src/relay.rs) |
| Fail closed at the handoff | Verify clipboard pixels and filesystem identity, reject changed destinations, and never automatically retry uncertain delivery. | [`clipboard.rs`](src/clipboard.rs), [`trusted.rs`](src/trusted.rs) |

The platform boundary is deliberately small: Windows monitor capture, macOS ScreenCaptureKit, X11, and Wayland ScreenCast/PipeWire feed the same image model. On Wayland, the compositor grants a display-sharing session; ScreenFling does not silently fall back to X11 or use a file-returning screenshot portal.

The UI waits when idle and uses a bounded worker for desktop operations. Screenshots and notes are not written to application storage. Explicit clipboard writes, clipboard history, OS swap and destination storage are separate concerns.

## Try it

Install **Rust, CMake and a native C/C++ toolchain**. Linux also needs the development libraries in the [build prerequisites](docs/DEVELOPMENT.md#build-prerequisites).

```sh
git clone https://github.com/d-sandhu/screenfling.git
cd screenfling
cargo run --release --locked
```

| Platform | Build / runtime notes |
| --- | --- |
| Windows x86-64 | MSVC, Visual Studio C++ Build Tools and Windows SDK; OpenGL 3.2 graphics support. |
| macOS Apple Silicon | Xcode Command Line Tools; macOS 14+ and screen-recording permission for capture. |
| Linux x86-64 | Built on Ubuntu 24.04; system graphics libraries. Wayland also requires PipeWire and a matching ScreenCast portal backend. |

Use **Ctrl+Shift+9** globally, or **Command+Shift+9** on macOS. Wayland's portal manages its own binding. In the app: **F8** captures, **F6** copies a reviewed image, **F10** opens settings, and **Escape** goes back or cancels. **Space** selects the whole frozen display.

Stage requires a local WezTerm instance and a coding agent whose Ctrl+V binding attaches an image without submitting. It does not target arbitrary terminals, browser chats, SSH hosts or WSL agents. Follow the [connection setup](docs/USAGE.md#configure-stage-in-wezterm); do not guess a socket path.

## Verification, not just a screenshot

[The native CI workflow](.github/workflows/check.yml) builds and packages all three targets. The checks run against real code paths rather than a separate demo implementation.

| Area | Automated evidence |
| --- | --- |
| Build quality | Formatting, strict Clippy, locked release tests/build, and CLI behavior without a desktop. |
| Image correctness | Windows synthetic-window capture; cross-process clipboard comparison on Windows/macOS; frozen-frame, every-pixel crop checks on X11 and headless Wayland. |
| Destination safety | Disposable real WezTerm mux: duplicate labels, misleading focus, exact bytes without Enter, clipboard rejection, separate Reveal and closed-pane rejection. |
| Visual behavior | Contrast and layout regressions; actual application screenshots at normal and compact sizes; settings navigation and resize checks without implicit delivery. |
| Development packages | Archive-member verification, executable/archive hashes, offline instructions, third-party notices and a lockfile advisory report. |

```sh
cargo fmt --all --check
cargo clippy --release --locked --all-targets -- -D warnings
cargo test --release --locked --all-targets
cargo build --release --locked
```

See [development checks](docs/DEVELOPMENT.md#checks) and [visual design notes](docs/VISUALS.md) for reproduction instructions and the design references. CI screenshots use an isolated synthetic desktop, not personal screen content.

### Known boundaries

Real hardware still needs permission/denial recovery, mixed-DPI and multi-monitor testing, tray/global-shortcut behavior, clean-machine installation and performance measurements. Actual agent attachment and desktop focus after Reveal must be inspected separately. Synthetic desktops and green builds do not establish those results.

Windows packages are unsigned; macOS packages are ad-hoc signed, not notarized. Linux packages depend on system libraries rather than claiming universal static portability. This repository does not publish releases automatically.

## Contributing

Start with the [code map](docs/DEVELOPMENT.md#code-map-and-boundaries), then make a small, reproducible change. Include the platform, expected behavior, observed failure and a targeted check. Keep private screenshots and full local socket paths out of issue reports.

[MIT](LICENSE) · Maintained in [d-sandhu/screenfling](https://github.com/d-sandhu/screenfling). Native packages include third-party notices.

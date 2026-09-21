# ScreenFling

**Capture what you see. Stage it in the right coding session. Keep working.**

A native desktop tool that turns a screen region into a reviewed image you can copy or stage in an exact local WezTerm pane. No screenshot file to manage. No switching to a guessed terminal window. No automatic prompt submission.

![ScreenFling's native crop review window showing a clipped button in a synthetic example UI](docs/preview.webp)

*Actual Linux application, reviewing a synthetic UI example. Stage stays disabled until a destination is selected.*

## Why it exists

A screenshot can explain a layout bug faster than a paragraph. Getting that screenshot into the correct coding session should not require saving a file, finding its path, or trusting whichever window has focus.

ScreenFling keeps the workflow small:

1. **Capture and select.** Use a global shortcut or the Capture button, then drag a region on the frozen image.
2. **Review.** Check the exact crop and optionally add a one-line note.
3. **Copy or Stage.** Copy the image for manual use, or request an image paste in one selected WezTerm pane. Reveal that pane separately and inspect the attachment before submitting.

Copy works without WezTerm. Stage writes **Ctrl+V and the note, never Enter**. A successful write is not proof that the agent attached the image; the result says so.

## Build and run

**Pre-release.** The native rewrite is introduced in [PR #64](https://github.com/d-sandhu/screenfling/pull/64). Adopting it on `main` makes Rust the development baseline; it does not publish a release. Physical desktop acceptance and public signing are still pending.

Install Rust, CMake, and your platform's native compiler first. Linux also needs the development libraries listed in the [build guide](docs/DEVELOPMENT.md#build-prerequisites).

```sh
git clone https://github.com/d-sandhu/screenfling.git
cd screenfling
```

While PR #64 is open, select the native implementation with `git switch rust-egui-rewrite-2026-09-20`. After it is merged, stay on `main`. Then run:

```sh
cargo run --release --locked
```

The default capture shortcut is **Ctrl+Shift+9**, or **Command+Shift+9** on macOS. Wayland's desktop portal controls its own binding. In the application, **F8** captures, **Space** selects the whole frozen image, **F6** copies a reviewed crop, and **Escape** cancels a capture.

For Stage, configure the local WezTerm executable and socket, confirm the agent's Ctrl+V image binding, and select a pane. The [usage guide](docs/USAGE.md) covers setup, packages, permissions, shortcuts, and recovery.

## Engineering choices

**Rust + egui + SDL3/OpenGL.** One desktop application process, with short-lived WezTerm command processes only when needed. No Electron, Chromium, WebView, JavaScript runtime, account, or cloud service.

| Concern | Implementation and tradeoff |
| --- | --- |
| Native capture | Windows capture, macOS ScreenCaptureKit, X11, and Wayland ScreenCast/PipeWire. Wayland uses an explicit display-sharing chooser. |
| Correct crops | Map the displayed selection to the actual captured pixel dimensions, not an assumed screen scale. |
| Explicit delivery | Review is required. Copy and Stage are separate user actions. Cancel does not replace the clipboard. |
| Exact routing | Pin the local socket and check pane/window/tab IDs. Titles are labels, never routing identities. |
| Failure handling | Reject stale work and changed clipboard contents. Never fall back to focus or automatically retry uncertain delivery. |
| Small runtime | Event-driven UI and a statically linked SDL video/tray subset. System graphics and desktop services remain dependencies. |

Start with [`app.rs`](src/app.rs) for the workflow, [`model.rs`](src/model.rs) for its invariants, [`capture/`](src/capture) for platform code, and [`wezterm.rs`](src/wezterm.rs) / [`relay.rs`](src/relay.rs) for delivery. The [development guide](docs/DEVELOPMENT.md) explains the boundaries and checks.

## Verification and limits

```sh
cargo fmt --all --check
cargo clippy --release --locked --all-targets -- -D warnings
cargo test --release --locked --all-targets
cargo build --release --locked
```

[One CI workflow](https://github.com/d-sandhu/screenfling/actions/workflows/check.yml) builds and packages Windows x86-64, macOS Apple Silicon, and Linux x86-64. A small Rust suite checks the failure-prone logic. Windows additionally captures and crops a synthetic window. Native clipboard checks compare every pixel across processes on Windows/macOS. Linux checks exercise X11, headless Wayland with real portal/PipeWire services, and exact Stage/Reveal routing in a disposable WezTerm instance.

These checks do **not** establish real-agent attachment, mixed-DPI behavior, permissions on physical desktops, or hardware performance. Build records and scoped measurements are evidence, not a promise of a particular startup time or RAM footprint.

Stage currently targets **local WezTerm panes with the same OS clipboard**, not arbitrary terminals, browser chats, SSH hosts, or WSL agents. Screenshot pixels and notes are not saved by ScreenFling. Explicit clipboard delivery, clipboard managers, OS swap, and the destination application's storage are separate concerns.

## Contributing and license

Small, focused fixes are welcome. Include the platform, the observed failure, and a targeted regression check; avoid sharing private screenshots or full local socket paths. See the [development guide](docs/DEVELOPMENT.md#contributing).

ScreenFling's code is [MIT licensed](LICENSE). Native packages include third-party notices. The previous Electron implementation is preserved in Git history, not maintained as a second runtime.

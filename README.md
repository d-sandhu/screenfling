<div align="center">
  <h1><img src="assets/icon.svg" width="36" height="36" alt=""> ScreenFling</h1>
  <p><strong>Show the problem. Keep your context.</strong><br>
  Capture a screen region, review it, and bring it into your coding session.</p>
  <p><strong>Rust</strong> · egui · SDL3 / OpenGL · Windows / macOS / Linux</p>
  <p><a href="#try-it">Build & run</a> · <a href="#engineering">Engineering</a> · <a href="docs/USAGE.md">User guide</a></p>
</div>

![ScreenFling reviewing a screenshot before sending it to a coding session](docs/preview.webp)

*The actual native app, showing a synthetic deployment error.*

A screenshot often explains a bug faster than a paragraph. ScreenFling captures the problem and puts the image into your coding agent’s prompt.

## How it works

1. **Capture.** Click Capture or use the global shortcut, then select a region.
2. **Review.** Check the crop at Fit or 1:1 size.
3. **Send to agent.** Choose a detected agent terminal and paste the image. You decide when to submit.

**Send pastes the actual image with Ctrl+V; it never presses Enter.** Detection recognizes foreground Claude Code, Codex and OpenCode processes on macOS and Linux X11. It lists eligible agent terminals rather than every desktop window. **Copy image** lets you paste manually anywhere your agent supports clipboard images.

Automatic targeting is still limited: mixed shell/agent tabs, remote sessions, Windows and Wayland use manual Copy. Terminal bindings and agent image support vary. [Compatibility and permissions](docs/USAGE.md#send-to-your-session).

## Engineering

- **Native platform integration.** Rust, egui and SDL3 connect Windows capture, macOS ScreenCaptureKit, X11 and Wayland ScreenCast/PipeWire to one image model. The UI waits when idle; a bounded worker handles desktop operations. [Platform adapters](src/capture/) · [architecture](docs/DEVELOPMENT.md#code-map-and-boundaries)
- **Original pixels throughout.** Selection maps to actual captured dimensions, including fractional display scaling. Resizing the preview never resizes the delivered crop. [Geometry and crop tests](src/model.rs)
- **Explicit state transitions.** Capture generations prevent late background results from advancing an abandoned capture. Delivery requires the current reviewed image. [State machine](src/model.rs) · [application flow](src/app.rs)
- **One handoff, native adapters.** A shared coordinator checks the image clipboard, foreground agent processes and selected window before requesting paste. Changed destinations and uncertain results never trigger a fallback or automatic retry. [Window sending](src/send.rs) · [Agent detection](src/agents.rs)

[CI](.github/workflows/check.yml) builds, lints, tests and packages all three platforms. Integration checks compare every crop pixel on X11 and on Wayland at 125% scale, verify native image clipboards, and exercise agent filtering, window targeting and image paste in disposable terminals. The optional advanced WezTerm integration has separate routing checks. [Reproduce the checks](docs/DEVELOPMENT.md#checks).

## Try it

Install **Rust, CMake and a native C/C++ toolchain**. Follow the [platform prerequisites](docs/DEVELOPMENT.md#build-prerequisites), including Linux development libraries and macOS 14+.

```sh
git clone https://github.com/d-sandhu/screenfling.git
cd screenfling
cargo run --release --locked
```

Start with **Capture region** or **F8**. The [user guide](docs/USAGE.md) covers shortcuts, permissions and the optional WezTerm integration.

## Status

**Pre-release.** Automated checks cover Windows x86-64, macOS Apple Silicon and Linux x86-64. Physical desktop testing, real coding-agent attachment, and public signing/notarization remain on the [release checklist](docs/DEVELOPMENT.md#remaining-release-acceptance).

[Development & contributing](docs/DEVELOPMENT.md) · [Visual design](docs/VISUALS.md) · [Report an issue](https://github.com/d-sandhu/screenfling/issues) · [MIT](LICENSE)

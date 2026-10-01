# Developing ScreenFling

ScreenFling has one image handoff: the OS clipboard. Optional Paste back remembers the terminal used before capture and sends its image-paste key once. There are no agent plugins, process scanners, socket relays or screenshot files.

## Build prerequisites

Install the selected Rust toolchain, **CMake** and a native C/C++ compiler. Cargo builds SDL3 from source. Python is used for development checks and packaging, not at runtime.

- macOS: Xcode Command Line Tools, CMake, macOS 14+. Packages target Apple Silicon.
- Windows: MSVC, Visual Studio C++ Build Tools and Windows SDK. C/C++ dependencies use the static runtime. Packages target x86-64.
- Linux: packages target Ubuntu 24.04 x86-64. Other distributions may need different library packages.

```sh
sudo apt-get install build-essential cmake pkg-config clang libclang-dev \
  libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxfixes-dev libxi-dev \
  libxss-dev libxtst-dev libxkbcommon-dev libwayland-dev wayland-protocols \
  libegl1-mesa-dev libgl1-mesa-dev libdrm-dev libgbm-dev libdecor-0-dev \
  libpipewire-0.3-dev libdbus-1-dev
cargo run --release --locked
```

The GUI requires OpenGL 3.2. Wayland additionally needs PipeWire and the compositor’s ScreenCast portal backend. Capture imports CPU-readable shared memory; GPU-only buffers are not supported. Missing tray/global-shortcut services leave the Capture button available.

## Checks

```sh
cargo fmt --all --check
cargo clippy --release --locked --all-targets -- -D warnings
cargo test --release --locked --all-targets
cargo build --release --locked
python3 scripts/check-cli.py
```

Unit tests cover crop bounds, fractional scaling, stale capture generations, review-gated delivery, clipboard/focus replacement, retryable copy failures, legacy preference migration, menu dismissal and settings navigation. They do not capture a desktop or write the clipboard.

CI has three native jobs. Each runs linting, tests, build, CLI checks and packaging. Linux also audits the lockfile. These checks provide reproducible evidence, not a claim that every desktop or agent was manually tested.

### Desktop and paste fixtures

```sh
sudo apt-get install xvfb openbox xfce4-terminal xdotool xclip x11-utils \
  x11-xserver-utils wmctrl imagemagick fonts-dejavu-core
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/smoke-x11.py
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/check-visuals.py --isolated-xvfb
cargo build --release --locked --example check-send
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/check-send.py
```

X11 capture tests compare every cropped pixel against an independent reference after the live desktop changes. They also test cancellation, overlay bounds and minimized/maximized windows. The Wayland fixture performs the same pixel check at 125% scale inside headless Sway with real portal/PipeWire services; its Ubuntu 26.04 container command is in `.github/workflows/check.yml`.

The paste fixture starts two raw-input receivers in real Xfce Terminal windows. It remembers the original terminal, deliberately focuses the other one, and requests Paste back. The original must receive only Ctrl+V, read the exact PNG bytes from the clipboard, and receive no Enter; the other must receive nothing. It also launches the actual app, captures through its global shortcut, reviews the image and clicks Paste back. No receiver pretends to be a named coding agent. This verifies transport, not agent attachment.

Windows/macOS use a separate-process image clipboard check. Windows also captures and verifies a synthetic window. **Run this only on a disposable desktop; it replaces the clipboard:**

```sh
cargo run --release --locked --example check-native-clipboard -- --allow-clipboard-write
```

The reader compares all 200 × 150 pixels. A second writer changes the last pixel; stale-image verification must reject it. Ordinary `cargo test` does not run this check.

Rendered app screenshots and pixel-comparison reports are under `dist/visuals/`. Inspect normal and compact layouts, rather than relying only on dimensions or nonblank-image assertions. [Visual checks](VISUALS.md).

## Code map and boundaries

| Module | Responsibility |
| --- | --- |
| `main.rs`, `desktop.rs` | SDL event loop, tray, shortcut, window lifecycle |
| `app.rs`, `app_view.rs` | Actions/state and egui presentation |
| `model.rs`, `frame.rs` | Validated RGBA pixels, crop mapping and capture generations |
| `capture/` | Native capture adapters |
| `clipboard.rs` | Write and verify the reviewed image |
| `send.rs`, `send/` | Remember original terminal, activate it, verify focus, send Ctrl+V once |
| `settings.rs` | One saved shortcut, bounded reads and atomic replacement |

Capture runs on one bounded worker; native UI/clipboard work stays on the main thread. The event loop sleeps when idle. No arbitrary terminal text is generated, and no terminal process inventory is maintained. Focus and clipboard are checked immediately before delivery; OS event delivery still has an unavoidable race, so the result asks the user to inspect the attachment.

macOS remembers the terminal application and returns to its active window/pane. Windows/X11 remember a window and its process start identity. This is an explicit return-to-origin action, not agent or tab discovery. Wayland exposes Copy only.

## Packaging

```sh
python3 scripts/package.py
```

The package includes the standalone user guide and dependency license notices. `build.json` records source state, archive/executable hashes, signing and loader checks. `SHA256SUMS` applies to the inner native archive, not GitHub’s outer artifact ZIP. Checksums verify file integrity, not publisher identity.

### macOS signing

By default, development packages are ad-hoc signed. Their identity changes with each binary, which can invalidate saved macOS permissions even when the old permission switch is still on.

For repeated local builds, reuse a code-signing certificate from your keychain:

```sh
python3 scripts/package.py --signing-identity CERTIFICATE_SHA1_FINGERPRINT
```

A dedicated keychain can be supplied with `--signing-keychain /absolute/path/to/keychain`. The full 40-digit fingerprint prevents selecting the wrong same-named certificate. Signing failure stops packaging; it never silently falls back to ad-hoc. No certificate, keychain or trust setting is created by this script.

The script uses `codesign`’s normal certificate-bound designated requirement. Do not replace it with an identifier-only requirement to suppress permission prompts. Reuse the same certificate and installed bundle path across updates. Initial Screen Recording and optional Accessibility consent are still required.

Apple documents [designated requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements) and [self-signed identities for local development](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html). A local development certificate is not Developer ID notarization or a public-distribution identity.

## v0.1.0 scope

Three additions are planned on top of the current surface. All extend the existing focus/clipboard-verified send path; none adds an agent-specific protocol.

- **Send loop.** After a successful Paste back the window hides, so the global shortcut can start the next capture immediately. The intended rhythm is capture, send, capture, send.
- **Destination picker.** Send targets any open terminal window, not only the terminal used before capture. Granularity is the OS window, never a process, tab or pane inside the terminal. macOS enumerates `CGWindowList` and raises with the Accessibility permission Paste back already needs; Windows uses `EnumWindows` and `SetForegroundWindow`; X11 uses `_NET_CLIENT_LIST` and `_NET_ACTIVE_WINDOW`. Wayland remains Copy image only. The pick is remembered for the session.
- **Optional message.** A short text typed after the image paste, over the same verified-focus synthetic-input path. ScreenFling never sends Enter; submitting stays with the user.

Agent paste keys verified against official documentation in October 2026: Claude Code pastes images with Ctrl+V (Cmd+V in iTerm2, Alt+V on Windows/WSL); Codex CLI and OpenCode bind Ctrl+V. Physical attachment checks still apply per agent/terminal combination.

## Remaining release acceptance

- CI evidence for the additions: the X11 paste fixture gains destination-picker targeting and message-typing assertions.
- Physical macOS acceptance: capture across DPI changes and multiple displays, permission grant/deny/revoke recovery, picker raise with focus verification, and image plus message into real Claude Code, Codex and OpenCode composers.
- Physical Windows smoke: capture, Copy image, and one Send in a supported terminal; record which image-paste key each agent expects there.
- Linux: the CI pixel and paste fixtures stand as evidence; Wayland limits stay documented in USAGE.md.
- Packages remain ad-hoc/unsigned with the existing install-recovery documentation. Tag v0.1.0 when the rows above pass.

Out of scope for v0.1.0: signing and notarization, installers, annotation, image history, saved files, tab/pane/session discovery, and any form of submission.

Contributions should keep the clipboard contract small. Add regression tests for wrong pixels, unintended input, lost crops or broken recovery. Avoid extra delivery protocols for individual agents.

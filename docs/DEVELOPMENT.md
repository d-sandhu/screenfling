# Developing ScreenFling

This guide describes the native Rust application on `main`.

## Build prerequisites

Install the Rust toolchain selected by `rust-toolchain.toml`, **CMake**, and a native C/C++ compiler. Cargo builds the SDL3 video/tray subset from source; no separately installed SDL runtime is needed.

**Windows:** use the MSVC target and Visual Studio Build Tools with the C++ workload and Windows SDK. Rust and native C/C++ code use the same static C runtime. **macOS:** install Xcode Command Line Tools and CMake. The deployment target is macOS 14 because of ScreenCaptureKit still capture; do not substitute SDL's lower minimum.

On Ubuntu 24.04:

```sh
sudo apt-get update
sudo apt-get install build-essential cmake pkg-config clang libclang-dev \
  libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxfixes-dev libxi-dev \
  libxss-dev libxtst-dev libxkbcommon-dev libwayland-dev wayland-protocols \
  libegl1-mesa-dev libgl1-mesa-dev libdrm-dev libgbm-dev libdecor-0-dev \
  libpipewire-0.3-dev libdbus-1-dev
cargo run --release --locked
```

Other distributions use different package names. The GUI requires OpenGL 3.2. Wayland capture also requires PipeWire and the compositor's matching ScreenCast portal backend. Python is a development/packaging tool, not an application dependency.

## Checks

```sh
cargo fmt --all --check
cargo clippy --release --locked --all-targets -- -D warnings
cargo test --release --locked --all-targets
cargo build --release --locked
python3 scripts/check-cli.py
```

The CLI check runs the real release executable without a desktop, checking help/version and rejecting unknown or conflicting options before capture. The Rust tests cover geometry and pixel bounds, fractional-scale edge selections, stale generations, review-gated delivery, no-submit bytes, exact IDs, settings persistence and draft isolation, clipboard write gating, endpoint replacement, private-directory ancestry, and Wayland session detection. Platform-specific tests exercise macOS bitmap conversion and Linux shared-memory offsets and truncation. Ordinary `cargo test` does not capture your screen or write your clipboard.

Keep regression tests focused on behavior that could corrupt a crop, route to the wrong destination, submit input, or prevent recovery. Extend the existing native test runner; do not add a test framework just to add assertions.

### Isolated desktop and destination checks

For the synthetic X11 workflow:

```sh
sudo apt-get install xvfb xdotool xclip x11-xserver-utils libgl1-mesa-dri
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/smoke-x11.py
```

This checks the global shortcut, selection/review cancellation, and an external client's PNG clipboard read. Every pixel of an asymmetric crop is compared with the frozen desktop after the live desktop changes. A wrong crop origin, row flip, changed channel, or accidental live-frame copy fails the check. The fixture clears inherited Wayland display/socket hints; CI deliberately supplies both to exercise that isolation.

The Wayland smoke uses a private headless Sway session with real ScreenCast/PipeWire services. It rejects and accepts the display chooser, checks cancellation and recovery, and compares the copied crop with the frozen frame. CI runs it in Ubuntu 26.04 because that fixture's portal supports headless shared-memory capture; the release executable is built on Ubuntu 24.04. The container command and prerequisites are in `.github/workflows/check.yml`. It does not use your normal desktop, D-Bus, PipeWire, settings, or clipboard.

The Windows/macOS clipboard check uses the production clipboard module. On Windows, it also draws a synthetic window, captures its monitor through the production capture adapter, and verifies the crop before copying it. **It accesses the Windows desktop and replaces the system clipboard with synthetic images. Run it only on a disposable desktop:**

```sh
cargo run --release --locked --example check-native-clipboard -- --allow-clipboard-write
```

A separate process compares all 200 × 150 image pixels, then another replaces the last pixel and exits. The original image must be rejected and the replacement must remain readable. Without the explicit flag the check refuses to access the desktop or clipboard. It is not executed by `cargo test` or included in native packages. This does not test macOS screen-recording consent or the Windows review UI.

For the real WezTerm transport check on Linux, install a matching WezTerm CLI and mux server on PATH, then run:

```sh
cargo build --release --locked --example check-wezterm
python3 scripts/check-wezterm.py
```

The script creates a private home, configuration, socket, and two synthetic raw-input panes. It never selects an existing session or reads the clipboard. It tests duplicate pane labels, exact Stage bytes, a wrong focus hint, rejected clipboard verification, separate Reveal, and a closed destination. Receiver bytes must contain only Ctrl+V and the intended note, never Enter, and the other pane must stay untouched. This checks terminal transport, **not coding-agent image attachment**.

CI remains one workflow with three native jobs. Pull requests run real checks against the test-merge commit; `main` pushes are checked after integration. Every job checks formatting, strict Clippy, Rust tests, release compilation, CLI behavior, and packaging. Windows/macOS additionally check their native image clipboard, with Windows capture as described above. Linux runs the isolated desktop and WezTerm checks and audits the complete lockfile. Python assertions remain enabled. There are no publishing steps, ignored failures, or new runtime dependencies for these checks.

To repeat the dependency check:

```sh
cargo install cargo-audit --version 0.22.2 --locked --no-default-features
cargo audit --deny warnings
```

CI records the RustSec report in `dist/audit.json`. Do not silence an advisory or weaken routing checks to manufacture a pass. Build success and synthetic desktops are not physical acceptance results.

## Code map and boundaries

| File | Responsibility |
| --- | --- |
| `src/main.rs`, `src/desktop.rs` | Window, event wakeups, tray, shortcut, and lifecycle |
| `src/cli.rs` | Launch options checked before desktop initialization |
| `src/app.rs` | User actions, crop review, and operation results |
| `src/model.rs`, `src/frame.rs` | State, geometry, pixel validation, and no-submit bytes |
| `src/capture/` | Windows, macOS, X11, and Wayland capture adapters |
| `src/clipboard.rs` | Explicit image writes and read-only verification |
| `src/wezterm.rs`, `src/trusted.rs`, `src/relay.rs` | Exact destinations, endpoint identity, and bounded CLI transport |
| `src/settings.rs`, `src/portal_shortcut.rs` | Local preferences and the Wayland shortcut session |

Only the current capture generation can advance through Capture → Select → Review → Delivering → Result. Selection and review do not deliver anything. The full desktop image is dropped after cropping; crop pixels and notes are dropped after completion or cancellation. An explicitly copied image may remain owned by the OS clipboard.

The main thread handles the UI. A bounded worker handles capture and terminal operations and posts results through SDL. Late work must not change a new capture or leave a stale discovery request active. The event loop waits when idle. ScreenFling explicitly permits normal screensaver behavior instead of using SDL's default inhibition.

Stage checks the selected socket and pane/window/tab IDs. A short-lived AF_UNIX relay connects upstream before spawning the CLI and checks endpoint identity and the reviewed clipboard before upstream writes. There is no TCP listener, persistent relay service, focused-window fallback, or automatic delivery retry. The CLI neither loads user configuration nor starts an absent mux. Titles are labels, not addresses.

Settings and transient relay directories validate their ancestry as well as the private leaf: another user must not be able to replace a parent directory. Legitimate platform aliases are resolved before checking; an untrusted chain fails closed. A failed creation removes only the newly created empty directory, never an existing settings directory.

This is not a sandbox against code running as the same user or an administrator. A pane ID does not prove which foreground program is running inside it. The user's Ctrl+V binding confirmation and inspection of the result remain necessary.

Wayland uses ScreenCast/PipeWire, not the file-returning Screenshot portal. It negotiates shared memory and copies a held buffer through its granted file descriptor using bounded reads, without dereferencing GPU-only or optionally mapped pointers. Session detection checks the actual video driver and Wayland environment, including inherited sockets; a missing `WAYLAND_DISPLAY` does not force X11 capture. The driver is read on the main thread before workers start. Hidden Wayland windows are not rendered; the window is shown and its OpenGL context rebound before drawing. Other platforms choose the display under the pointer. Crop geometry uses actual captured dimensions and independent horizontal/vertical ratios, not an assumed display scale.

## Build native packages without publishing

```sh
cargo build --release --locked
python3 scripts/package.py
```

Use Python 3.11 or later; `python scripts/package.py` is equivalent on Windows. Build and package on the native target OS with Cargo's default target directory. The script packages an existing release executable; do not pair an old executable with a new checkout.

Windows gets a portable ZIP. macOS gets an ad-hoc-signed `.app` archive, checked with `codesign --verify --strict`. Linux gets the executable, desktop launcher, and icon. Each includes an offline usage README, project license, and third-party notices, including native-library and embedded-font license texts. No standalone font files are distributed.

Some crates omit their upstream license files. `assets/license-overrides.json` records reviewed texts, source blob IDs, and exact package versions; recheck these on dependency updates. The notice inventory includes build-time dependencies and is not a claim that every listed crate is linked into the executable.

Packaging verifies archive members and executable bytes, then writes `build.json` and `SHA256SUMS` with source identity, hashes, sizes, and signing status. On macOS, the executable hash describes the signed copy in the app. Cargo has `publish = false`; no workflow creates a tag or release.

## Remaining release acceptance

The native application is the official development baseline, not a physically accepted release. Record the OS, hardware/compositor, exact commit/package, and observations for these remaining checks:

- Permissions, denial and recovery, tray/global-shortcut behavior, close/reopen, normal idle screen locking, and clean-machine installation on Windows, macOS, and Wayland.
- Mixed-DPI/multiple monitors, negative origins, rotation, disconnection, captured color/orientation, and hardware startup/idle CPU/RAM.
- Real coding-agent attachment, a different focused pane, clipboard replacement during Stage, closed/moved destinations, and explicit Reveal/focus behavior. Confirm no submission.

Public signing, notarization, release approval, and publication are separate owner decisions. CI software rendering is not a hardware benchmark. Do not present a development package as a fully validated public release.

The README preview is an actual Linux/Xvfb review window with a synthetic UI fixture. Only its surrounding virtual desktop was cropped away. It is not a confirmed agent-attachment demonstration.

## Contributing

Read the relevant module, make the smallest useful fix, and add or extend a targeted regression. Keep dependencies, services, and CI jobs limited to a demonstrated need. Run the applicable checks above and state which physical checks were not performed.

Report the platform, compositor when relevant, commit/package, expected behavior, and observed error. Redact local paths and private screenshots; do not post captured desktop data just to demonstrate that a test ran.

# Developing ScreenFling

This guide describes the native Rust rewrite. The old Electron tree and its tests are not part of this build. Use the rewrite branch shown in the root README until its pull request is merged.

## Build prerequisites

Install the toolchain selected by `rust-toolchain.toml`, **CMake**, and a native C/C++ compiler. Cargo builds the SDL3 video/tray subset from source; a separately installed SDL runtime is not required.

On Windows, use the MSVC Rust target and Visual Studio Build Tools with the C++ workload and Windows SDK. The x86-64 MSVC build links the C runtime statically to avoid a separate Visual C++ runtime install. On macOS, install Xcode Command Line Tools and CMake. The deployment target is macOS 14. Do not replace it with SDL's lower minimum: ScreenCaptureKit still images set the application's requirement.

On Ubuntu 24.04, install:

```sh
sudo apt-get update
sudo apt-get install build-essential cmake pkg-config clang libclang-dev \
  libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxfixes-dev libxi-dev \
  libxss-dev libxtst-dev libxkbcommon-dev libwayland-dev wayland-protocols \
  libegl1-mesa-dev libgl1-mesa-dev libdrm-dev libgbm-dev libdecor-0-dev \
  libpipewire-0.3-dev libdbus-1-dev
cargo run --release --locked
```

Other distributions use different package names. An OpenGL 3.2-capable desktop is needed to run the GUI. Wayland capture additionally needs the compositor's ScreenCast portal backend and PipeWire at runtime. Python is a development/packaging tool only, not an application dependency.

## Checks

```sh
cargo fmt --all --check
cargo test --release --locked --all-targets
cargo build --release --locked
```

Keep tests focused on behavior that could corrupt a crop, select the wrong destination, submit input, or leave the application unable to recover. The small Rust suite covers crop/buffer bounds, stale generations, review-gated one-shot delivery, no-submit input, exact IDs, clipboard write gating, and local endpoint replacement. New regression checks should reuse the native test runner, not add another test framework.

The one desktop smoke test runs against a synthetic X11 display:

```sh
sudo apt-get install xvfb xdotool xclip x11-xserver-utils libgl1-mesa-dri
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/smoke-x11.py
```

It launches the release binary and tests cancellation, frozen selection, review, and an external client's PNG clipboard read. No private desktop or live coding-agent session is involved. Run it from the repository root after the release build. It writes its diagnostic record to `dist/`.

CI stays in `.github/workflows/check.yml`: one workflow, three native jobs. It runs the small test suite and packages Windows x86-64, macOS arm64, and Linux x86-64. Only Linux runs the Xvfb smoke. Build success on a hosted OS is not a physical acceptance result.

For a focused code or dependency review, use `cargo clippy --release --locked --all-targets` and RustSec's `cargo audit` against `Cargo.lock`. These are development checks, not extra application dependencies. Do not silence an advisory or change routing protections just to obtain a green check.

## Code map and boundaries

| File | Responsibility |
| --- | --- |
| `src/main.rs`, `src/desktop.rs` | SDL window, event wakeups, tray, global shortcut, and lifecycle |
| `src/app.rs` | User actions, capture generation, crop review, and operation results |
| `src/model.rs`, `src/frame.rs` | Pure state transitions, geometry, pixel-buffer validation, and no-submit bytes |
| `src/capture/` | Small Windows, macOS, X11, and Wayland capture adapters |
| `src/clipboard.rs` | Explicit native image writes and read-only verification |
| `src/wezterm.rs`, `src/trusted.rs`, `src/relay.rs` | Exact pane selection, local endpoint identity, and bounded CLI transport |
| `src/settings.rs`, `src/portal_shortcut.rs` | Local preferences and the Wayland shortcut session |

```text
Capture -> Selecting -> Review -> Delivering -> Result
    \---------- Cancel -> Idle --------/
```

Only the current generation can advance. Selection and review do not deliver anything. The full desktop image is dropped after cropping. Crop pixels and notes are dropped after completion or cancellation; an explicitly copied image can remain owned by the OS clipboard.

The UI runs on the main thread. Capture and terminal operations run in a bounded worker, posting results through the SDL event queue. A late result must not update a new capture or leave a stale discovery request active. The event loop waits when idle instead of continuously repainting.

Stage validates the selected local socket and pane/window/tab IDs. A short-lived AF_UNIX relay connects upstream before spawning the WezTerm CLI. It checks connection identity and the reviewed clipboard before upstream writes. There is no TCP listener, persistent relay service, focused-window fallback, or automatic delivery retry. The CLI is run without loading user configuration or starting an absent mux.

This is not a sandbox against code running as the same user or an administrator. A correct pane ID also does not prove that the foreground program inside that pane is the intended coding agent. The user's local Ctrl+V binding confirmation and post-Stage inspection remain necessary.

Wayland uses consent-based ScreenCast/PipeWire, not the file-returning Screenshot portal. Windows and X11 choose the monitor under the pointer; macOS uses ScreenCaptureKit. Crop mapping uses captured image dimensions and separate horizontal/vertical ratios. Desktop scale, image pixels, and GUI coordinates are not assumed to be interchangeable.

## Build native packages without publishing

```sh
cargo build --release --locked
python3 scripts/package.py
```

Use Python 3.11 or later; on Windows, `python scripts/package.py` is equivalent. Build and package on the native target OS. Cross-compilation is not inferred from the host's architecture.

The script packages an existing release executable. Windows receives a portable ZIP. macOS receives an ad-hoc-signed `.app` in a tar archive and runs `codesign --verify --strict`. Linux receives the binary, desktop launcher, and icon in a tar archive. Each package includes an offline usage README, the project's license, and third-party notices collected from the resolved Cargo packages, including nested native-library/font license texts. A few crates omit their upstream license files; `assets/license-overrides.json` contains reviewed license texts, source blob IDs, and exact package versions for those cases. Recheck these entries when updating the locked dependencies. The inventory may include build-time dependencies; it is not a claim that every listed crate is linked into the final executable.

The script verifies the archive contents and executable bytes, then writes `build.json` and `SHA256SUMS`. The record includes source identity, archive and executable hashes, sizes, and signing status. On macOS, the executable hash describes the signed copy inside the app, not the unsigned build output. Cargo publication is disabled with `publish = false`; no workflow creates a tag or release.

## Remaining release acceptance

These are **not run** by hosted build checks. Record the OS, hardware/compositor, exact commit/package, and observed result when performing them:

- Windows, macOS, and Wayland: permission allow/deny and recovery, tray and global-shortcut behavior, closing/reopening, and a clean-machine installation.
- Multiple monitors: mixed scale factors, negative origins, rotation, disconnection during capture, and captured color/orientation.
- Real local coding agents: correct image attachment in the selected pane, a different focused pane, changed clipboard during Stage, closed/moved panes, and separate Reveal behavior. Confirm no submission.
- Physical performance: cold/warm startup and idle CPU/RAM with the real GPU and normal desktop services. CI software rendering is not a hardware benchmark.

Signing, notarization, release approval, and publication are separate owner decisions. None follows automatically from successful tests. An application download should not be presented as a verified public release before these decisions and checks.

The README preview is an actual native Linux/Xvfb crop-review window from the rewrite, using a synthetic UI fixture. Only the surrounding virtual desktop was cropped away. It is not an illustration of a confirmed coding-agent attachment.

## Contributing

Read the relevant small module, make the smallest useful fix, and add or extend a targeted regression test. Keep dependencies, background services, and CI jobs limited to a demonstrated need. Run the commands above and state which physical checks were not performed.

For bug reports, include the OS, compositor when relevant, commit/package, expected behavior, and observed error. Redact local paths and private screenshot content. Do not post captured desktop data merely to demonstrate that a test ran.

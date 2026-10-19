# Developing ScreenFling

ScreenFling has one image handoff: the OS clipboard. Send adds one step on top of it: return to the window that was active before capture and press that window's image-paste key once. There are no agent plugins, process scanners, sockets or screenshot files.

## Build prerequisites

Install the pinned Rust toolchain, **CMake** and a native C/C++ compiler. Cargo builds SDL3 from source and links it statically. Python is used only for development fixtures and packaging.

- **Windows:** MSVC (Visual Studio C++ Build Tools) and the Windows SDK. Packages target x86-64 with the static C runtime.
- **macOS:** Xcode Command Line Tools and macOS 14+. Packages target Apple Silicon.
- **Linux:** packages target Ubuntu 24.04 x86-64. Other distributions may need different package names.

```sh
sudo apt-get install build-essential cmake pkg-config clang libclang-dev \
  libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxfixes-dev libxi-dev \
  libxss-dev libxtst-dev libxkbcommon-dev libwayland-dev wayland-protocols \
  libegl1-mesa-dev libgl1-mesa-dev libdrm-dev libgbm-dev libdecor-0-dev \
  libpipewire-0.3-dev libdbus-1-dev
cargo run --release --locked
```

The GUI requires OpenGL 3.2. Wayland capture also needs PipeWire and the compositor's ScreenCast portal backend; it imports CPU-readable shared memory, not GPU-only buffers.

## Code map

| Module | Responsibility |
| --- | --- |
| `main.rs` | SDL event loop and frame painting |
| `app.rs` | The workflow state machine and its actions |
| `app_view.rs` | egui presentation: home window, selection overlay, toolbar |
| `desktop.rs` | Event bus, overlay placement, tray, global shortcut |
| `model.rs`, `frame.rs` | Validated RGBA pixels, crop mapping, packed-buffer conversion |
| `capture/` | Native capture: Windows, macOS ScreenCaptureKit, X11, Wayland portal + PipeWire |
| `clipboard.rs` | Write and verify the image clipboard |
| `send.rs`, `send/` | Remember the active window, return to it, verify focus, press one paste chord |
| `settings.rs` | The capture shortcut, read with bounds and saved atomically |

## Design

**State machine.** `App::stage` is `Idle`, `Capturing`, `Selecting` or `Sending`. Each variant carries its own data: the worker's cancel flag and generation id, the frozen pixels and selection, or the pending paste and its image. A capture result whose generation id is not current is discarded. Delivery is possible only from `Selecting`, and it takes the pixels from that stage.

**Capture.** The window hides, then after 100 ms a single worker reads the display under the pointer. The overlay shows the frozen frame at 1:1, anchored at the display's top-left corner. Selections map to pixels through the captured image's real size (`model::map_crop`), which stays exact at fractional scaling.

On Windows the overlay is one row taller than its monitor. Drivers promote a borderless OpenGL window that exactly covers a monitor to an uncomposited present. The compositor, screen capture and screen sharing then keep showing the first frame, so the selection appears frozen, and entering that mode can flicker. The extra row keeps the window composited, and the top-left anchoring keeps every captured pixel visible and selectable.

**Delivery.** Copy writes the clipboard and reads it back before reporting success. A failed write leaves the selection in place, so retrying is one key. Send also activates the remembered window, then polls for up to 2 s until that window owns focus. It checks again that focus and clipboard are unchanged and sends one chord. It never retries, because an OS acknowledgment is not proof of attachment and a repeated chord could paste twice. Keyboard-triggered actions wait until every key is released, so no held or auto-repeating key reaches the destination.

**Paste chord.** Each adapter classifies the window it remembered:

| Platform | Terminal | Other apps |
| --- | --- | --- |
| Windows | Alt+V. Built-in hosts are matched by window class (`ConsoleWindowClass`, `CASCADIA_HOSTING_WINDOW_CLASS`), third-party terminals by executable name. | Ctrl+V |
| macOS | Ctrl+V, matched by bundle identifier | Cmd+V |
| X11 | Ctrl+V | Ctrl+V |

Sources, checked in October 2026:
- Claude Code binds image paste to Ctrl+V, and to Alt+V on Windows and WSL ([keybindings](https://code.claude.com/docs/en/keybindings)).
- Codex accepts Ctrl+V or Alt+V, and only Alt-chords get through Windows Terminal (`codex-rs/tui`).
- OpenCode binds Ctrl+V.
- Windows Terminal consumes Ctrl+V for text paste by default and passes Alt+V through.

Windows names the destination by its executable's FileDescription, as Task Manager does.

**Clipboard formats.**
- **Windows:** arboard writes the registered `PNG` format and `CF_DIBV5`. Windows synthesizes the bitmap formats that .NET and PowerShell readers use; Claude Code reads through those.
- **macOS:** one pasteboard item carries `public.png` and TIFF. Claude Code asks for PNG, while NSImage and arboard readers such as Codex read TIFF.
- **Linux:** SDL serves `image/png` from this process for as long as it owns the selection.

## Checks

```sh
cargo fmt --all --check
cargo clippy --release --locked --all-targets -- -D warnings
cargo test --release --locked --all-targets
cargo build --release --locked
```

Unit tests cover the invariants that matter:
- Crop mapping, bounds and pixel extraction.
- Fractional-scale edge selection.
- Packed-buffer row padding.
- The single-paste guarantee: no paste after a focus or clipboard change, and no retry.
- Atomic settings writes and rejection of invalid or oversized settings.
- Launch options and Wayland session detection.

They do not touch the desktop or the clipboard.

### Desktop fixtures

These run in CI on disposable displays. Each one refuses to run outside a private Xvfb display or its own headless compositor.

```sh
sudo apt-get install xvfb openbox xfce4-terminal xdotool xclip x11-utils \
  x11-xserver-utils wmctrl imagemagick
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/smoke-x11.py
cargo build --release --locked --example check-send
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/check-send.py
```

- **X11 smoke.** Runs the real app with its global shortcut. It checks that:
  - the overlay matches the display bounds, even from a maximized or minimized window;
  - cancelling and selecting leave the clipboard unchanged;
  - Enter copies a region whose every pixel matches the frozen frame, even after the live desktop changes.
- **Wayland smoke.** Does the same inside headless Sway with the real ScreenCast portal and PipeWire, at 125% scale. It also checks recovery after the display chooser is declined. The container command is in `.github/workflows/check.yml`.
- **Send.** Starts two raw-input receivers in real Xfce Terminal windows. It remembers one, focuses the other, then sends. The original must receive exactly Ctrl+V and the exact PNG bytes, with no Enter; the other must receive nothing. The real app is then driven through shortcut, Space and Enter, and must stay hidden after Send and after cancel. No receiver pretends to be a coding agent: this checks delivery, not attachment.

On Windows and macOS, a separate-process clipboard check writes a synthetic image and reads all of its pixels back from another process. It then confirms that verification rejects a one-pixel replacement. On Windows it also captures a synthetic window through the production capture path. **It replaces the clipboard, so run it only on a disposable desktop:**

```sh
cargo run --release --locked --example check-native-clipboard -- --allow-clipboard-write
```

## Packaging

```sh
python3 scripts/package.py
```

The package includes the user guide and dependency license notices. `build.json` records the source state, archive and executable hashes, signing and loader checks. `SHA256SUMS` covers the inner native archive, not GitHub's outer artifact ZIP. Checksums verify integrity, not publisher identity.

### macOS signing

Development packages are ad-hoc signed by default. Their identity changes with every binary, which can invalidate saved macOS permissions even when the switch still shows as on.

For repeated local builds, reuse a code-signing certificate from your keychain:

```sh
python3 scripts/package.py --signing-identity CERTIFICATE_SHA1_FINGERPRINT
```

Supply a dedicated keychain with `--signing-keychain /absolute/path/to/keychain`. The full 40-digit fingerprint prevents selecting the wrong certificate when two share a name. If signing fails, packaging stops; it never silently falls back to ad-hoc. Keep the certificate and the installed bundle path the same across updates. Screen Recording consent, and Accessibility for Send, are still required once.

Apple documents [designated requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements) and [self-signed identities for local development](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html). A local development certificate is not Developer ID notarization.

## Release checklist

v0.1.0 is: capture, select, then Copy or Send, with Send returning to any app.

- [x] Windows, physical desktop: Send into Windows Terminal delivers one Alt+V and no Enter. Send into a GUI window delivers Ctrl+V. Copy sends no keys. Cancel leaves focus in the original window. The clipboard image reads through the .NET API Claude Code uses.
- [x] Windows, real agent: Send attaches `[Image #1]` to a Claude Code 2.1 prompt in Windows Terminal, without submitting it.
- [x] Linux: CI pixel, cancel and Send fixtures on X11, and pixel fixtures on Wayland.
- [ ] macOS, physical desktop:
  - capture across display scales and multiple displays;
  - Screen Recording and Accessibility grant, deny and revoke;
  - Send into Terminal and Ghostty (Ctrl+V) and into a GUI app (Cmd+V);
  - the attachment appears in Claude Code and Codex.
- [ ] Attachment in more agents on Windows: Codex in Windows Terminal; Claude desktop or a browser chat.
- [ ] Tag v0.1.0. Packages stay ad-hoc signed or unsigned, with the recovery steps in USAGE.md.

Out of scope for v0.1.0: signing and notarization, installers, annotation, image history, saved files, choosing a destination other than the original window, and any form of submission.

Contributions should keep this contract small. Add regression tests for wrong pixels, unintended input, lost selections or broken recovery, and avoid agent-specific delivery protocols.

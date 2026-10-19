# Developing ScreenFling

ScreenFling has one image handoff: the OS clipboard. Send adds one step on top of it: activate an agent window and press its image-paste key once. There are no agent plugins, process scanners, sockets or screenshot files.

## Build prerequisites

Install the pinned Rust toolchain and a native linker (MSVC on Windows, Xcode Command Line Tools on macOS). There is no C/C++ build: windowing, drawing and the tray are Rust. Python is used only for development fixtures and packaging.

- **Windows:** MSVC (Visual Studio C++ Build Tools) and the Windows SDK. Packages target x86-64 with the static C runtime.
- **macOS:** Xcode Command Line Tools and macOS 14+. Packages target Apple Silicon.
- **Linux:** packages target Ubuntu 24.04 x86-64. Other distributions may need different package names.

```sh
sudo apt-get install build-essential pkg-config libclang-dev libpipewire-0.3-dev
cargo run --release --locked
```

No GPU is used. X11 (libX11, libX11-xcb, libXcursor, libXi), Wayland and xkbcommon (with xkbcommon-x11 on X11) are loaded at runtime from the desktop, which provides them. Wayland capture needs PipeWire and the compositor's ScreenCast portal backend; it imports CPU-readable shared memory, not GPU-only buffers. Building on Linux needs the PipeWire headers and libclang for its bindings.

## Code map

| Module | Responsibility |
| --- | --- |
| `main.rs` | Launch options, the single running copy, the winit event loop |
| `app.rs` | The workflow state machine, its windows and input |
| `overlay.rs` | The selection overlay: region, toolbar, destination list; layout and hit-testing share one geometry |
| `panel.rs` | Notices, the shortcut prompt, and controls on desktops without a tray |
| `canvas.rs` | CPU drawing into window pixels: rectangles, rounded panels, text (fontdue + Inter subset), the frozen frame |
| `tray.rs` | Tray icon and menu: tray-icon on Windows/macOS, ksni (StatusNotifierItem, no GTK) on Linux |
| `instance.rs` | One copy per user: a later launch forwards a capture request over a private socket or named pipe |
| `autostart.rs` | Start at login through the system's own entry: Run key, LaunchAgent, XDG autostart |
| `desktop.rs` | Event bus into the loop, pointer position, global shortcut, macOS overlay placement |
| `model.rs`, `frame.rs` | Validated RGBA pixels, crop mapping, packed-buffer conversion |
| `capture/` | Native capture: Windows, macOS ScreenCaptureKit, X11, Wayland portal + PipeWire |
| `clipboard.rs` | Write and verify the image clipboard |
| `send.rs`, `send/` | List agent windows by recency, remember the active window, activate, verify focus, press one paste chord |
| `settings.rs` | The capture shortcut, read with bounds and saved atomically |

## Design

**State machine.** `App::stage` is `Idle`, `Capturing`, `Selecting` or `Sending`. Each variant carries its own data: the worker's cancel flag and generation id, the frozen pixels and selection, or the pending paste and its image. A capture result whose generation id is not current is discarded. Delivery is possible only from `Selecting`, and it takes the pixels from that stage.

**Windows and drawing.** ScreenFling has three windows:
- the overlay, borderless and covering the captured display;
- a notice, which never takes focus;
- a panel, for the shortcut prompt and, without a tray, the controls.

All of them are drawn on the CPU and presented with softbuffer, which uses GDI on Windows, CoreGraphics on macOS, and shared memory on X11 and Wayland. A frozen screenshot with a box on it needs no GPU. This also avoids a real failure seen with the earlier OpenGL overlay: Windows drivers promote a GPU window that exactly covers a monitor to an uncomposited present, so screen capture and sharing saw a frozen frame. The frame and its dimmed copy are made once per capture. A redraw copies the dimmed frame, copies the region's rows over it, and draws a few rectangles and labels. A pointer move redraws only while dragging or when the hovered control changes.

**Hiding windows.**
- **Wayland:** a window cannot be unmapped (winit's `set_visible` does nothing there), so hiding drops the window, and it is created again when needed.
- **Windows:** the notice and panel are created with "do not activate", which winit applies on every show, so they appear without taking focus.
- **macOS:** they are ordered front without activating the app.

**Capture.** Notices hide, then after 100 ms a single worker reads the display under the pointer. The overlay then covers that display: borderless fullscreen on its monitor (Windows, X11, Wayland), or a window above the menu bar and Dock on every Space (macOS, set through NSWindow). The overlay stays fullscreen while hidden, because leaving fullscreen restores, and so shows, a window on Windows. Selections map to pixels through the captured image's real size (`model::map_crop`), which stays exact at fractional scaling.

**Delivery.** Copy writes the clipboard and reads it back before reporting success. A failed write leaves the selection in place, so retrying is one key. Send also activates the remembered window, then polls for up to 2 s until that window owns focus. It checks again that focus and clipboard are unchanged and sends one chord. It never retries, because an OS acknowledgment is not proof of attachment and a repeated chord could paste twice. Keyboard-triggered actions, Esc included, wait until every key is released, so no held or auto-repeating key reaches the destination. Key state is the set of physical keys held, modifier keys included, tracked from winit's key events. It does not depend on modifier-state events, which arrive in a different order on each platform. macOS and Wayland do not report releases for keys held as focus leaves, so losing focus clears the set.

**Returning.** Finishing returns to where the user was: the agent after Send, otherwise the window capture started from. Focus is handed back explicitly, because hiding a window does not move it on every platform (macOS would keep ScreenFling active). Without a tray, the home panel reappears behind without taking focus, unless the capture began from it. Errors appear in a notice.

**One copy.** A later launch connects to the running copy, asks for a capture and exits.
- **macOS and Linux:** the running copy is whoever holds an `flock` on a lock file in the user's runtime directory (`$XDG_RUNTIME_DIR`, macOS `$TMPDIR`). The kernel grants it to exactly one process and releases it when that process exits. That process binds the socket beside it; a copy that is still starting is waited for briefly.
- **Windows:** the named pipe carries the user's SID and login session, and its DACL admits only that user. It is created with `FILE_FLAG_FIRST_PIPE_INSTANCE`, and that one instance is reused for every client, so the name never lapses. A launch checks that the pipe's server runs as the same user before trusting it. It then passes on its right to bring a window forward (`AllowSetForegroundWindow`), so the overlay gets keyboard focus.

On macOS, opening the app bundle again only brings the running copy forward: Launch Services does not start a second process. There, run `screenfling --capture`.

**Tray and settings.**
- **Menu:** Capture, Change shortcut…, Start at login, Quit.
- **The shortcut** is the only saved preference. The prompt reads the new combination as winit key codes, whose names are the W3C codes global-hotkey parses; a unit test pins that.
- **Start at login** is not stored by ScreenFling: the system's own entry is the source of truth.
- **No tray:** on desktops without a tray host, such as GNOME without AppIndicator, the panel holds the same controls.

**Destinations.** Capture reads the desktop before ScreenFling's window hides. Two things come back:
- the active window, which is where Copy and Cancel return focus;
- the open agent windows, which are terminals and known agent apps, front to back.

Front-to-back order is the desktop's own most-recently-used record, so nothing is tracked in the background:
- **Windows:** `EnumWindows` z-order, keeping only visible, unowned, uncloaked windows.
- **macOS:** `CGWindowListCopyWindowInfo`, layer 0, one entry per app, because macOS activates apps rather than windows.
- **X11:** `_NET_CLIENT_LIST_STACKING`.

The default destination is the last one sent to, if still open, otherwise the most recent agent window.

Windows Terminal tabs are destinations of their own. They are read through UI Automation, the accessibility interface screen readers use, with no terminal setting or plugin: tab items and their names come from the window's automation tree, and the selected tab is listed first. Send selects the tab through its SelectionItem pattern, after checking that the tab at that position still has the listed name. Other terminals have no comparable interface, so they are targeted by window.

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
- **Linux:** arboard serves `image/png` from a worker thread for as long as ScreenFling runs: over X11, or over Wayland's data-control protocol. Where the compositor lacks data-control it falls back to XWayland.

## Checks

```sh
cargo fmt --all --check
cargo clippy --release --locked --all-targets -- -D warnings
cargo test --release --locked --all-targets
cargo build --release --locked
```

Unit tests cover the invariants that matter:
- Crop mapping, bounds and pixel extraction, and regions mapping to exact captured pixels at any window size.
- Drags clamped to the display; a click is not a region.
- The toolbar stays on screen, and what is drawn is what a click hits.
- Blending and resampling exact at the ends; drawing clipped to the buffer.
- Packed-buffer row padding.
- The single-paste guarantee: no paste after a focus or clipboard change, and no retry.
- Atomic settings writes and rejection of invalid or oversized settings.
- Launch options, Wayland session detection, and destination names.
- Shortcut names from winit parse in global-hotkey.
- Desktop-entry quoting for start at login.

They do not touch the desktop or the clipboard. One opt-in test changes the real login item and restores it: `cargo test -- --ignored login_item`.

### Desktop fixtures

These run in CI on disposable displays. Each one refuses to run outside a private Xvfb display or its own headless compositor.

```sh
sudo apt-get install xvfb openbox xfce4-terminal xdotool xclip x11-utils \
  x11-xserver-utils wmctrl imagemagick
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/smoke-x11.py
cargo build --release --locked --example check-send
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' python3 scripts/check-send.py
```

- **X11 smoke.** Runs the real app with its global shortcut on a desktop without a tray, so its home panel appears. It checks that:
  - the overlay covers exactly the display bounds;
  - cancelling and selecting leave the clipboard unchanged;
  - Enter copies a region whose every pixel matches the frozen frame, even after the live desktop changes;
  - closing the home panel exits cleanly.
- **Wayland smoke.** Does the same inside headless Sway with the real ScreenCast portal and PipeWire, at 125% scale. Captures start the way any launcher can: a second `screenfling --capture` hands over to the running copy. It also checks recovery after the display chooser is declined. The container command is in `.github/workflows/check.yml`.
- **Send.** Starts two raw-input receivers in real Xfce Terminal windows. It remembers one, focuses the other, then sends. The original must receive exactly Ctrl+V and the exact PNG bytes, with no Enter; the other must receive nothing. The real app is then driven through shortcut, Space and Enter. Focus must stay in the original terminal after Send and after cancel, even though this desktop has no tray. No receiver pretends to be a coding agent: this checks delivery, not attachment.

On Windows and macOS, a separate-process clipboard check writes a synthetic image and reads all of its pixels back from another process. It then confirms that verification rejects a one-pixel replacement. On Windows it also shows a synthetic window, drawn the way the app draws, and captures it through the production capture path. **It replaces the clipboard, so run it only on a disposable desktop:**

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
- [x] Windows, Chromium: Send into a local Chrome page delivers the image through an ordinary Ctrl+V paste event. VS Code, Cursor and Claude desktop read the clipboard the same way.
- [x] Windows, keyboard: Ctrl+C copies, and Esc cancels and returns focus. Holding Enter does nothing until release, then pastes once.
- [x] Windows, destinations: capturing from Chrome sends to the most recently used terminal, and Chrome receives nothing. Tab picks another window, and the choice stays the default. Copy returns to Chrome. In one Windows Terminal window with two tabs, Tab then Enter selects the other tab and delivers exactly one Alt+V there.
- [x] Windows, the CPU-drawn rebuild: the overlay updates live under normal screen capture. A second launch, or `--capture`, opens a focused overlay in the running copy and exits. The startup notice shows without taking focus. Start at login round-trips through the Run key.
- [x] Linux: CI pixel, cancel and Send fixtures on X11, and pixel fixtures on Wayland.
- [ ] macOS, physical desktop:
  - capture across display scales and multiple displays;
  - Screen Recording and Accessibility grant, deny and revoke;
  - Send into Terminal and Ghostty (Ctrl+V) and into a GUI app (Cmd+V);
  - the overlay above the menu bar and Dock on each display, the tray menu, and start at login;
  - the attachment appears in Claude Code and Codex.
- [ ] Attachment in Codex in Windows Terminal (not installed on the test machine).
- [ ] Tag v0.1.0. Packages stay ad-hoc signed or unsigned, with the recovery steps in USAGE.md.

Known limits:
- macOS posts the V key by its US-layout key code. On Dvorak and similar layouts Send produces a different chord.

Out of scope for v0.1.0: signing and notarization, installers, annotation, image history, saved files, choosing a destination other than the original window, and any form of submission.

Contributions should keep this contract small. Add regression tests for wrong pixels, unintended input, lost selections or broken recovery, and avoid agent-specific delivery protocols.

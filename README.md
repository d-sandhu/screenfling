# ScreenFling

Capture what you see. Stage it in the exact coding session. Keep working.

ScreenFling is a native Rust + egui desktop utility. One process, an event-driven SDL3/OpenGL window, no Chromium, WebView, JavaScript runtime, account, upload, or telemetry. Windows, macOS, Linux/X11, and Linux/Wayland have native capture implementations.

## Use

Open ScreenFling and select **Capture** (or press **F8** in its window). The default global shortcut is **Ctrl+Shift+9**, or **Command+Shift+9** on macOS. Change it in Settings. Wayland uses the desktop's shortcut portal; the desktop controls the final binding.

The display under the pointer is captured on Windows, macOS, and X11. On Wayland, choose one display in the system sharing dialog. ScreenFling obtains one frame through PipeWire and closes the sharing session. This explicit chooser is a desktop security requirement, not a silent X11 fallback.

Drag a region on the frozen image. **Space** selects the full image. **Escape** cancels. Review the crop, then choose **Copy image** (**F6**) or select an exact WezTerm pane and **Stage**. The optional single-line note is used only by Stage. Copy copies the image, not the note.

**Stage does not submit.** It writes the configured image-paste shortcut and note to the selected pane, without Enter. It does not prove that the coding agent attached the image. Use the separate **Reveal destination** action, inspect the attachment, then submit yourself. Reveal activates the exact pane/tab; some desktops still require switching to its window.

Copy does not need WezTerm. Close hides the application when a tray is available; use Quit in the tray or application to exit. Without a tray, closing the idle application quits. Keep it running on Linux while pasting copied images, since Linux clipboard ownership can depend on the source application.

## WezTerm setup

Run the coding agent locally inside WezTerm. In ScreenFling Settings, select the absolute **WezTerm executable** and the exact **local mux socket**. Inside the intended WezTerm window, print its socket path:

```sh
# macOS / Linux shell
printf '%s\n' "$WEZTERM_UNIX_SOCKET"
```

```powershell
# Windows PowerShell, inside WezTerm
$env:WEZTERM_UNIX_SOCKET
```

Launching ScreenFling from that pane also supplies the socket as a default. Executable examples are `/Applications/WezTerm.app/Contents/MacOS/wezterm`, `/usr/bin/wezterm`, and the absolute `wezterm.exe` path on Windows. Do not enter a window title or guess a socket. Refresh destinations after reconnecting or restarting WezTerm.

Confirm the Settings checkbox only after checking that **Ctrl+V is the coding agent's image-paste binding**. It must reach the agent, not a shell command or a terminal text-paste binding. Remote/SSH/WSL agents with a different clipboard are not supported as image destinations. Copy remains available.

Routing checks the selected socket, filesystem identity, and pane/window/tab IDs. Window titles are display labels only. If the socket changes, the pane closes/moves, or the clipboard no longer matches the reviewed crop, Stage stops. It does not switch to a focused window, restore an old clipboard image, press Enter, or automatically retry an uncertain write.

## Build and run

Install stable Rust and a native C/C++ toolchain (MSVC on Windows; Xcode Command Line Tools on macOS). SDL3's video/tray subset is built and linked statically. OpenGL 3.2 support is required. macOS requires **14 or later** for ScreenCaptureKit still images. Windows requires Windows 10 with AF_UNIX support (1803 or later) for WezTerm staging.

On Debian/Ubuntu, install the native development libraries:

```sh
sudo apt-get install build-essential cmake pkg-config clang libclang-dev \
  libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxfixes-dev libxi-dev \
  libxss-dev libxtst-dev libxkbcommon-dev libwayland-dev wayland-protocols \
  libegl1-mesa-dev libgl1-mesa-dev libdrm-dev libgbm-dev libdecor-0-dev \
  libpipewire-0.3-dev libdbus-1-dev
cargo run --release --locked
```

On Windows/macOS, use the same Cargo command after installing the native toolchain. `screenfling --capture` starts with Capture; `screenfling --version` reports the version. A second invocation is a separate process, not an IPC command to an existing process.

macOS requests screen-recording permission only when you capture. Enable ScreenFling in **System Settings → Privacy & Security → Screen & System Audio Recording** when requested. ScreenFling does not capture audio.

On Wayland, install your desktop's **xdg-desktop-portal backend and PipeWire**. ScreenCast and GlobalShortcuts portal support varies by desktop. Capture works independently of shortcut/tray availability; a missing portal produces an actionable error, never a fake successful capture. ScreenFling does not use an X11-only capture path under Wayland.

## Native packages

```sh
cargo build --release --locked
python3 scripts/package.py
```

Python 3.11+ is needed only to package, not to run ScreenFling. The `dist` directory receives a Windows portable ZIP, a macOS `.app` in a tar archive, or a Linux binary/desktop-icon tar archive. The build record includes executable size, package size, and SHA-256.

macOS packages are **ad-hoc signed, not notarized**. Windows packages are unsigned. CI artifacts are development builds, not signed public releases. On macOS, move the app into Applications and use the system's Open Anyway flow only after verifying that you trust this build; do not disable Gatekeeper globally.

For Linux, put `screenfling` on your PATH. Install `dev.screenfling.ScreenFling.desktop` in `~/.local/share/applications/` and its SVG in `~/.local/share/icons/hicolor/scalable/apps/`. The binary uses system OpenGL, PipeWire, X11/Wayland, and desktop portal libraries; it is not a fully static Linux executable.

## Checks and architecture

```sh
cargo fmt --all --check
cargo test --release --locked --all-targets
cargo build --release --locked
```

The test suite is deliberately small: geometry and pixel bounds, current workflow/review/one-shot delivery, no-submit input, exact IDs, replaced-clipboard write blocking, and local endpoint identity. There is one additional real X11 desktop smoke script, which exercises cancel, frozen crop review, and external PNG clipboard reads. It uses a synthetic Xvfb display, not private desktop content.

CI is one workflow with three native build jobs. It packages all three operating systems and records Linux/Xvfb startup-to-visible-window, idle CPU, RSS, and thread count. These software-rendered CI measurements are not claims about cold startup or GPU memory on real hardware.

`src/app.rs` owns the workflow and UI. `model.rs` and `frame.rs` hold pure safety logic. `capture/` contains small platform capture modules. Clipboard/tray/shortcuts use native APIs. WezTerm commands are short-lived children with a bounded private socket relay; there is no persistent relay service or network listener. Linux async code is limited to desktop portals.

Screenshots and notes remain in memory until explicit Copy or Stage. Settings store only shortcut/connection preferences in the user's application configuration directory. Stage uses the clipboard as an explicit delivery mechanism. No screenshot/notes are written to temporary files. OS swap, clipboard managers, and the destination application's own storage are outside ScreenFling's control.

Before a public release, test physical Windows/macOS/Wayland desktops: mixed-DPI monitors, display disconnects, screen-recording permission allow/deny, tray/global-shortcut behavior, clipboard replacement during Stage, exact WezTerm pane selection, and real agent image attachment. Automated builds do not establish those hardware results.

MIT licensed. The previous Electron implementation remains in Git history, not in the application tree.

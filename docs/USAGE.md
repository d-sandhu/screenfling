# Using ScreenFling

ScreenFling captures one display, lets you select and review a crop, then copies it or stages an image-paste request in one local WezTerm pane. This is a pre-release native build, not a signed public release.

## Open and capture

On Windows, extract the portable ZIP and run `screenfling.exe`. On macOS, extract the archive and move `ScreenFling.app` to Applications. On Linux, extract the archive and run `./screenfling`; the system must provide the graphics and desktop libraries described below.

Launch one copy of the application. Use its tray or global shortcut for later captures. `screenfling --capture` starts a new application with Capture; it does not send an activation message to an existing process. `screenfling --version` reports the version and `screenfling --help` shows launch options. Both work without opening the desktop. Unknown or conflicting options exit with an error before any capture starts.

| Action | Control |
| --- | --- |
| Capture from outside the application | Ctrl+Shift+9; Command+Shift+9 on macOS. Wayland uses the portal's chosen binding. |
| Start a capture from the idle/result window | Capture button or F8 |
| Select a region | Drag on the frozen image |
| Select the entire captured display | Space while selecting |
| Copy the reviewed image | Copy image button or F6 in Review |
| Cancel capture, selection, or review | Escape or Cancel |

Windows, macOS, and X11 capture the display under the pointer. Wayland asks you to choose one display in the system sharing dialog. ScreenFling obtains a frame through the granted PipeWire connection, then closes the sharing session. It does not save a portal screenshot or silently switch to X11 capture.

Review shows only the crop that can be delivered. Copy includes the image, not the optional note. Nothing is copied just because you selected a region. Cancellation leaves the existing clipboard unchanged.

ScreenFling allows the desktop's normal screensaver behavior; leaving it open is not a request to keep the screen awake.

Close hides the application when a tray is available. Use Quit in the tray or application to exit. Without a tray, closing the idle window exits. On Linux, keep ScreenFling running until you paste: another application may need it to serve the clipboard image. Closing the selection window cancels selection first.

## Configure Stage in WezTerm

Run a **local coding agent in WezTerm on the same OS** as ScreenFling. Stage currently supports the agent's Ctrl+V image-attachment binding, not an arbitrary paste shortcut. The application cannot prove which program is running inside a pane. Do not select a shell prompt, an SSH session, or a WSL agent with a different clipboard.

In the intended WezTerm pane, print its exact local socket path:

```sh
# macOS or Linux shell
printf '%s\n' "$WEZTERM_UNIX_SOCKET"
```

```powershell
# Windows PowerShell, inside WezTerm
$env:WEZTERM_UNIX_SOCKET
```

Open ScreenFling Settings. Enter the absolute WezTerm executable path and this socket path. Examples of executable locations are `/Applications/WezTerm.app/Contents/MacOS/wezterm` and `/usr/bin/wezterm`; on Windows, use the absolute path to your installed `wezterm.exe`. These are examples, not paths that ScreenFling assumes exist.

Starting ScreenFling from the intended pane supplies its socket as an initial default. A saved connection takes precedence. Do not guess a socket or use a title as an address. If the socket variable is empty, check the local WezTerm session rather than substituting another instance.

Confirm the checkbox only after checking that Ctrl+V attaches an image in that coding agent and does not submit. Save the connection. Capture and review an image, select **Refresh panes**, then select the intended pane by its title and explicit identifiers. Refresh again after restarting or reconnecting WezTerm.

Select **Stage — do not submit** once. Stage explicitly replaces the clipboard with the reviewed crop and writes Ctrl+V plus the one-line note to the selected pane. It never sends Enter. The write is not an attachment acknowledgment: **inspect the coding agent before submitting**.

**Reveal destination** is a separate action after Stage. It activates the exact pane and tab. Desktop focus policy may still require switching to the WezTerm window. Stage itself does not activate a different window.

During Stage, wait for the result. Quit and cancellation are blocked while delivery is pending. If the result is uncertain, inspect the selected pane before any new attempt. The application does not retry, choose another pane, or restore a replaced clipboard image.

## Platform requirements and permissions

**Windows.** Use Windows 10/11 with a graphics driver that supports OpenGL 3.2. Exact WezTerm staging needs Windows AF_UNIX support. The CI package is x86-64; compilation on a Windows Server runner is not acceptance testing on every Windows desktop. Packages are unsigned.

**macOS.** ScreenCaptureKit still capture requires macOS 14 or later. CI packages target Apple Silicon; no Intel package is claimed here. Screen-recording permission is requested on Capture, not startup. Grant access to ScreenFling in System Settings under Privacy & Security and the screen-recording category. The category name varies by macOS version. ScreenFling does not capture audio. Retry Capture after changing permission; restart the app if macOS requests it.

The `.app` is ad-hoc signed and verified during packaging, but is not notarized. Verify and trust the source of the archive before using the system's Open Anyway control. Do not disable Gatekeeper globally. Move the app to its intended location before granting permissions.

**Linux.** The binary uses system OpenGL, PipeWire, X11/Wayland, and desktop portal services. It is not a fully static binary or a universal Linux package. CI builds on Ubuntu 24.04. On Wayland, the desktop's matching `xdg-desktop-portal` backend and PipeWire must be installed and running. ScreenCast and GlobalShortcuts availability depends on the compositor and portal backend. Missing global shortcuts or a tray do not disable the Capture button; missing screen-sharing support prevents capture and produces an error.

For a Linux application-menu entry, install the binary on the PATH used by your desktop session. Put `dev.screenfling.ScreenFling.desktop` in `~/.local/share/applications/` and `dev.screenfling.ScreenFling.svg` in `~/.local/share/icons/hicolor/scalable/apps/`. If that session cannot find the executable, set the launcher's Exec entries to its absolute installed path. Do not add multiple autostart entries.

## Settings and recovery

Saving connection settings does not save an unfinished shortcut edit. Applying a shortcut does not save unfinished connection edits. Controls are disabled while Stage is pending. If saving a shortcut fails, ScreenFling attempts to restore the previous binding and reports a rollback failure rather than hiding it.

Only shortcut and connection preferences are saved, in `settings.json`:

| Platform | Directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\screenfling\` |
| macOS | `~/Library/Application Support/screenfling/` |
| Linux | `$XDG_CONFIG_HOME/screenfling/`, or `~/.config/screenfling/` when unset |

Use Apply shortcut to change a native global shortcut. If registration fails because it is already in use, use the Capture button and choose another shortcut. Wayland shortcut changes belong to the desktop portal.

If settings cannot be read, the app reports the error and uses defaults. To reset preferences, quit and rename only ScreenFling's `settings.json`; do not remove a whole shared configuration directory. No images or notes are stored in this file.

If a connection changes, a pane closes or moves, or clipboard verification fails, no fallback destination is used. Check the result, inspect any potentially affected pane, then refresh the connection. Copy remains available without WezTerm. Do not weaken directory permissions to bypass a connection check.

## Verify a development package

CI artifacts contain the native archive, `build.json`, `SHA256SUMS`, and the locked dependency inventory. Compare the SHA-256 of the **inner native archive**, not the outer GitHub artifact ZIP, with the build record. Use `sha256sum` on Linux, `shasum -a 256` on macOS, or `Get-FileHash -Algorithm SHA256` in PowerShell.

A matching checksum checks file integrity, not publisher identity. Unsigned/ad-hoc-signed packages are still development builds. The record identifies the checked-out source commit and the packaged executable; the macOS executable hash is taken after ad-hoc signing.

ScreenFling does not upload captures or save screenshot/notes to temporary files. Explicit Copy/Stage makes the image available to the OS clipboard and other applications. Clipboard history, OS swap, and agent storage are outside its control.

Source, build instructions, and issue reporting are in the [ScreenFling repository](https://github.com/d-sandhu/screenfling/tree/rust-egui-rewrite-2026-09-20). Report the platform and error text without posting private screenshots or full local paths.

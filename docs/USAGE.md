# Using ScreenFling

ScreenFling captures one display, lets you select and review a crop, then sends its file path to a chosen coding window or copies the image. This is a pre-release native build, not a signed public release.

## Open and capture

On Windows, extract the portable ZIP and run `screenfling.exe`. On macOS, extract the archive and move `ScreenFling.app` to Applications. On Linux, extract the archive and run `./screenfling`; the system must provide the graphics and desktop libraries described below.

Launch one copy of the application. Use its tray or global shortcut for later captures. `screenfling --capture` starts a new application with Capture; it does not send an activation message to an existing process. `screenfling --version` reports the version, and `screenfling --help` lists the launch options. Both exit without opening a desktop window. Unknown or conflicting options return an error before capture begins.

| Action | Control |
| --- | --- |
| Capture from outside the application | Ctrl+Shift+9; Command+Shift+9 on macOS. Wayland uses the portal's chosen binding. |
| Start a capture from the idle/result page | Capture region button or F8 |
| Select a region | Drag on the frozen image; the selection shows its pixel dimensions |
| Select the entire captured display | Space while selecting |
| Copy the reviewed image | Copy image button or F6 on the Review page |
| Open or close Settings | Settings button or F10, outside selection or pending delivery |
| Return from Settings without discarding the crop | Back to review or Escape |
| Cancel capture, selection, or review | Escape or Cancel, outside Settings |

Windows, macOS, and X11 capture the display under the pointer. Wayland asks you to choose one display in the system sharing dialog. ScreenFling obtains a frame through the granted PipeWire connection, then closes the sharing session. It does not save a portal screenshot or silently switch to X11 capture.

## Review the image

Capture restores a minimized or maximized window for selection. Review and errors return to a normal visible window.

Review shows only the crop that can be delivered. **Fit** preserves its aspect ratio within the preview. **1:1 pixels** displays the crop at its actual pixel size; scroll within the preview when it is larger than the available space. Neither mode changes the original pixels saved or copied.

Review starts with the image. Choose **Send to…** to open the window picker and optional note. Narrow windows stack these sections vertically; the actions remain at the bottom.

Copy includes the image, not the optional note. Nothing is copied just because you selected a region, changed the preview mode, resized the window or visited Settings. Cancellation leaves the existing clipboard unchanged. Send needs a selected window; Copy does not.

Close hides the application when a tray is available. Use **More → Quit ScreenFling**, or Quit in the tray, to exit. Without a tray, closing the idle window exits. On Linux, keep ScreenFling running until you paste: another application may need it to serve the clipboard image. Closing the selection window cancels selection first.

## Send to your session

1. Open your terminal and coding agent. Select the tab or split pane where you want the screenshot.
2. Capture and review a region in ScreenFling, then choose **Send to…**.
3. Choose that terminal window, optionally add a note, and choose **Send · no submit**.
4. Check the agent’s prompt and submit when ready.

ScreenFling saves the original crop as a PNG, copies its absolute path (preceded by your note), activates the selected window, and requests paste once. It does not press Enter or run a shell command. A successful paste request is not proof that an agent loaded the image. This works with local agents that accept image file paths, without requiring a particular terminal or agent plugin. Choose an agent prompt that is ready for input.

The destination is a **window**, using its currently active tab or pane. ScreenFling cannot enumerate Claude Code, Codex, OpenCode or other sessions inside arbitrary terminals. Window titles help you choose; they are not proof of which process is reading input. The advanced WezTerm integration below offers exact pane addressing when needed.

On macOS, allow Accessibility access when requested, then refresh windows. Windows uses Ctrl+V; X11 uses Ctrl+Shift+V; macOS uses Command+V. The selected terminal must use that paste shortcut. Custom bindings and stock xterm require manual paste; ScreenFling does not infer or change terminal keybindings. Windows cannot inject into a higher-privilege application. Wayland currently offers Copy instead of automatic window targeting. Remote and WSL agents need their own access to the file; paths are not translated or uploaded.

**Send and Copy file path save a PNG** in the `captures` subdirectory of the settings directory listed below. Files remain until you delete them, including after a failed send, so agents can finish reading them. Copy image and cancelled captures do not create PNG files. Notes are sent through the clipboard, not saved in the PNG.

If focus or clipboard changes, sending stops. After an uncertain paste, inspect the destination before retrying; there is no automatic retry or fallback window. Keep ScreenFling running until you paste on Linux.

## Configure Stage in WezTerm

**Optional advanced integration.** Enable **More → WezTerm integration** and expand **Advanced: WezTerm integration** in Settings. Ordinary Send to… does not need any of this setup.

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

Confirm the checkbox only after checking that Ctrl+V attaches an image in that coding agent and does not submit. Select **Save connection**. Return to Review, select **Refresh panes**, then select the intended pane by its title and explicit identifiers. Refresh again after restarting or reconnecting WezTerm.

Select **Stage · no submit** once. Stage explicitly replaces the clipboard with the reviewed crop and writes Ctrl+V plus the one-line note to the selected pane. It never sends Enter. The write is not an attachment acknowledgment: **inspect the coding agent before submitting**.

**Reveal destination** is a separate action after Stage. It activates the exact pane and tab. Desktop focus policy may still require switching to the WezTerm window. Stage itself does not activate a different window.

During Stage, wait for the result. Quit, cancellation, and settings changes are blocked while delivery is pending. If the result is uncertain, inspect the selected pane before any new attempt. The application does not retry, choose another pane, or restore a replaced clipboard image.

## Platform requirements and permissions

**Windows.** Use Windows 10/11 with a graphics driver that supports OpenGL 3.2. Exact WezTerm staging needs Windows AF_UNIX support. The CI package is x86-64; compilation on a Windows Server runner is not acceptance testing on every Windows desktop. Packages are unsigned.

**macOS.** ScreenCaptureKit still capture requires macOS 14 or later. CI packages target Apple Silicon; no Intel package is claimed here. Screen-recording permission is requested on Capture, not startup. Grant access to ScreenFling in System Settings under Privacy & Security and the screen-recording category. The category name varies by macOS version. ScreenFling does not capture audio. Retry Capture after changing permission; restart the app if macOS requests it.

The `.app` is ad-hoc signed and verified during packaging, but is not notarized. Verify and trust the source of the archive before using the system's Open Anyway control. Do not disable Gatekeeper globally. Move the app to its intended location before granting permissions. Keep one installed copy, for example `~/Applications/ScreenFling.app`, and launch that copy rather than alternating between extracted build folders.

**Permission is on, but Capture keeps asking:** a replaced development build can have a different signing identity while the old permission switch still appears enabled. Quit all ScreenFling copies, remove only ScreenFling from the Screen Recording list, then use **+** to add your current installed `.app`. Approve **Quit & Reopen**, then retry Capture. Do not reset permissions for other apps. Ad-hoc signing identifies a particular build, so a later rebuild may need approval again; see [Apple’s explanation of code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

**Linux.** The binary uses system OpenGL, PipeWire, X11/Wayland, and desktop portal services. It is not a fully static binary or a universal Linux package. CI builds on Ubuntu 24.04. On Wayland, the desktop's matching `xdg-desktop-portal` backend and PipeWire must be installed and running. ScreenCast and GlobalShortcuts availability depends on the compositor and portal backend. Capture needs a CPU-readable shared-memory stream; GPU-only DMA buffers are not imported. Missing global shortcuts or a tray do not disable the Capture button; missing screen-sharing support prevents capture and produces an error.

For a Linux application-menu entry, install the binary on the PATH used by your desktop session. Put `dev.screenfling.ScreenFling.desktop` in `~/.local/share/applications/` and `dev.screenfling.ScreenFling.svg` in `~/.local/share/icons/hicolor/scalable/apps/`. If that session cannot find the executable, set the launcher's Exec entries to its absolute installed path. Do not add multiple autostart entries.

## Settings and recovery

Settings is a separate page. Escape or Back returns to the current capture without discarding it. F6 and F8 do not copy or start a capture while this page is open. Each section saves explicitly; navigating back does not save unfinished edits.

Shortcut and optional connection preferences are saved in `settings.json`. Explicit Send / Copy file path saves PNGs under `captures/` in the same directory:

| Platform | Directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\screenfling\` |
| macOS | `~/Library/Application Support/screenfling/` |
| Linux | `$XDG_CONFIG_HOME/screenfling/`, or `~/.config/screenfling/` when unset |

Use Apply shortcut to change a native global shortcut. If registration fails because it is already in use, use the Capture button and choose another shortcut. Wayland shortcut changes belong to the desktop portal. Saving the connection does not save an unfinished shortcut edit, and applying a shortcut does not save unfinished connection edits. If a shortcut cannot be saved, ScreenFling attempts to restore the previous active binding and reports any restore failure.

If settings cannot be read, the app reports the error and uses defaults. To reset preferences, quit and rename only ScreenFling's `settings.json`; do not remove a whole shared configuration directory. No images or notes are stored in this file.

ScreenFling's settings directory must be private, and its parent directories must not let another ordinary user replace it. A permission failure leaves defaults in use rather than trusting an unsafe path. The same ancestry protection applies to temporary WezTerm relay directories. Do not broaden directory permissions to bypass these checks.

If a connection changes, a pane closes or moves, or clipboard verification fails, no fallback destination is used. Check the result, inspect any potentially affected pane, then refresh the connection. Copy remains available without WezTerm.

## Verify a development package

CI artifacts contain the native archive, `build.json`, `SHA256SUMS`, and the locked dependency inventory. Compare the SHA-256 of the **inner native archive**, not the outer GitHub artifact ZIP, with the build record. Use `sha256sum` on Linux, `shasum -a 256` on macOS, or `Get-FileHash -Algorithm SHA256` in PowerShell.

A matching checksum checks file integrity, not publisher identity. Unsigned/ad-hoc-signed packages are still development builds. The record identifies the checked-out source commit and the packaged executable; the macOS executable hash is taken after ad-hoc signing. It also records linked libraries and a packaged CLI launch check, not clean-machine desktop acceptance.

ScreenFling does not upload captures. Send and Copy file path explicitly save PNGs as described above. Copy image / advanced Stage make the image available to the OS clipboard and other applications. Clipboard history, OS swap, and agent storage are outside its control.

Source, build instructions, and issue reporting are in the [ScreenFling repository](https://github.com/d-sandhu/screenfling). Report the platform and error text without posting private screenshots or full local paths.

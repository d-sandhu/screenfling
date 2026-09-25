# Using ScreenFling

**Capture → Review → Copy image → Ctrl+V in your coding agent.**

Open the app, click **Capture region**, drag a rectangle, then choose **Copy image**. Switch to Claude Code, Codex, OpenCode or another agent that accepts clipboard images, and paste. On macOS these agents use **Control+V** for images. Check the attachment, then submit when ready.

The image stays at its original resolution. ScreenFling does not upload it, type a file path, save a screenshot file or submit your prompt.

## Paste back

For one less app switch, focus your coding-agent terminal and use the **global capture shortcut**. After review, choose **Paste back to [terminal]**. ScreenFling copies the image, returns to that terminal and presses Ctrl+V once. It does not identify the process inside your terminal or choose a different tab; keep the intended agent active there.

Paste back appears only when capture starts from a supported terminal. Capturing from a browser or from ScreenFling itself still offers Copy image. Capture from any app when manual paste suits the task better.

macOS returns to the original terminal application’s active window/pane. Windows and X11 return to the original terminal window’s active tab/pane. Supported hosts include Ghostty, Terminal, iTerm2, WezTerm, Windows Terminal, classic Windows consoles, Alacritty and common X11 terminals, as applicable to each OS. Wayland offers Copy image because applications cannot freely activate another window or inject input there.

Your terminal must pass Ctrl+V to the agent. Custom bindings, terminal interception, elevated Windows applications, SSH and WSL can need manual paste or their own clipboard integration. ScreenFling does not change terminal settings. After an error the image remains available on the clipboard; inspect your agent before trying again.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Capture from another app | Command+Shift+9 on macOS; Ctrl+Shift+9 on Windows/X11 |
| Capture inside ScreenFling | F8 |
| Select the entire display | Space while selecting |
| Copy reviewed image | F6 |
| Open/close Settings | F10 |
| Cancel, or return from Settings | Escape |

Wayland uses the shortcut chosen in the desktop portal. Settings contains only the capture shortcut. **More** contains Hide to tray and Quit. Keep one copy running. On Linux, keep it open until you paste so it can serve the clipboard image.

## Install and permissions

**macOS 14+.** Extract the archive, move `ScreenFling.app` to `~/Applications`, and launch that copy. Capture needs Screen Recording access; Paste back additionally needs Accessibility. Copy image does not need Accessibility. Permission is requested only for the action that needs it, at most once per launch.

If permission is enabled but capture fails after replacing a development build: quit ScreenFling, remove only its old entry in System Settings → Privacy & Security → Screen & System Audio Recording, and add the current installed app. Quit and reopen when requested. Accessibility can need the same recovery. Ad-hoc signing changes identity with the build; [stable local signing](DEVELOPMENT.md#macos-signing) avoids that build-hash identity change. It still requires initial consent.

CI packages are ad-hoc signed and not notarized. Verify the archive source before using macOS’s Open Anyway control. Keep one installed copy; avoid launching extracted build folders as well.

**Windows 10/11.** Extract the ZIP and run `screenfling.exe`. Requires OpenGL 3.2. Development packages are unsigned. Paste back cannot inject into applications with higher privileges.

**Linux.** Extract and run `./screenfling`. Requires the [native runtime libraries](DEVELOPMENT.md#build-prerequisites). Wayland capture uses the desktop’s ScreenCast portal and PipeWire; choose one display in its sharing dialog. Global shortcut and tray availability depend on the desktop. The Capture button works without either.

## Preferences and recovery

Only the shortcut is saved in `settings.json`:

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/screenfling/` |
| Windows | `%LOCALAPPDATA%\screenfling\` |
| Linux | `$XDG_CONFIG_HOME/screenfling/`, or `~/.config/screenfling/` |

Older connection settings are ignored and disappear on the next save. PNGs saved by older versions are not deleted automatically. No new screenshot files are created by this version. The clipboard and receiving agent may retain images according to their own settings.

`screenfling --help` and `--version` do not open the desktop. `--capture` launches a new instance with Capture; use the tray or shortcut when the app is already running.

Report problems with the platform, build and error text. Do not include private screenshots or credentials.

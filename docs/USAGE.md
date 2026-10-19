# Using ScreenFling

**Shortcut → drag a region → Enter.** The image lands in the app you came from, ready for you to submit.

## Capture

Press the capture shortcut in any app: **Ctrl+Shift+9** on Windows and X11, **Cmd+Shift+9** on macOS. The screen under the pointer freezes. You can also use **Capture region** (F8) in the ScreenFling window, or **Capture** in its tray menu.

Drag a region. Drag again to replace it, or press **Space** to select the whole display. The selection shows its size in pixels, and the crop keeps the display's full resolution.

When the region is right:

| Action | Key | What happens |
| --- | --- | --- |
| **Send** | Enter | Copies the image, returns to the app you came from and presses its image-paste key once. |
| **Copy** | Ctrl+C (Cmd+C on macOS) | Copies the image. You switch apps and paste it yourself. |
| Cancel | Esc | Nothing is copied. The clipboard is unchanged. |

When there is no window to return to, Enter copies instead. That happens when capture starts from the ScreenFling window, and always on Wayland. Actions run when you release the key, so a held key never reaches the destination.

## Send

Send returns to the window that was active when you pressed the capture shortcut and pastes there. It does not choose an agent, tab or pane: keep the agent you want active in that window.

The paste key depends on where it lands:

| Destination | Key Send presses |
| --- | --- |
| Windows terminals: Windows Terminal, console windows, WezTerm, Alacritty, mintty, ConEmu, Tabby, Hyper, Warp | Alt+V |
| macOS terminals: Terminal, iTerm2, Ghostty, WezTerm, kitty, Alacritty, Warp | Ctrl+V |
| X11 terminals | Ctrl+V |
| Other apps, such as browsers, Claude and ChatGPT desktop, VS Code and Cursor chat | Ctrl+V (Cmd+V on macOS) |

Coding agents in a terminal read image paste from their own key, because the terminal keeps its paste shortcut for text. Claude Code and Codex use Alt+V on Windows and Ctrl+V on macOS and Linux. OpenCode uses Ctrl+V.

Send never presses Enter. After a successful Send, ScreenFling stays out of the way, so the shortcut starts the next capture right away. If anything changed first (the window closed, focus moved, or the clipboard was replaced), nothing is pasted and the image stays copied.

**Where Send cannot help:**

- **Integrated terminals in an editor.** VS Code or Cursor count as a GUI app, so Send presses Ctrl+V there. A terminal agent inside them on Windows needs Alt+V: use Copy and press Alt+V.
- **OpenCode in Windows Terminal.** Windows Terminal takes Ctrl+V for text paste. Use Copy and the paste method OpenCode documents for your terminal.
- **SSH, WSL and remote sessions.** A remote agent reads the remote machine's clipboard, not yours.
- **Elevated windows on Windows.** Windows blocks input from a normal app to an administrator window.
- **Wayland.** Apps cannot return focus to another window or press keys there. Copy works.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Capture from any app | Ctrl+Shift+9 (Cmd+Shift+9 on macOS) |
| Capture in the ScreenFling window | F8 |
| Select the whole display | Space |
| Send (or Copy without a destination) | Enter |
| Copy | Ctrl+C (Cmd+C on macOS) |
| Cancel, or hide the window | Esc |

Change the capture shortcut in the ScreenFling window, using names such as `Control+Shift+Digit9` or `Super+Shift+KeyS`. On Wayland the desktop's portal settings assign it.

## Install and permissions

**Windows 10/11.** Extract the ZIP and run `screenfling.exe`. It needs OpenGL 3.2. Development packages are unsigned.

**macOS 14+.** Extract the archive, move `ScreenFling.app` to `~/Applications`, and open that copy. Capture needs **Screen Recording**. Send also needs **Accessibility**, which is requested the first time you send. Copy does not need it.

After replacing a development build, macOS can keep a stale permission entry. Quit ScreenFling, remove its entry in System Settings → Privacy & Security, add the installed app again, and reopen it. Development packages are ad-hoc signed and not notarized; [stable local signing](DEVELOPMENT.md#macos-signing) avoids repeated prompts.

**Linux.** Extract and run `./screenfling`. It needs the [runtime libraries](DEVELOPMENT.md#build-prerequisites). Wayland capture goes through the desktop's ScreenCast portal and PipeWire: pick one display in its dialog. Keep ScreenFling running until you paste, because on Linux the app serves the clipboard image itself.

Keep one copy running. `screenfling --capture` starts a new copy and captures immediately. `--help` and `--version` print without opening a window.

## Privacy and settings

ScreenFling saves no screenshots and uploads nothing. The image exists only in memory and on the clipboard; the receiving app may keep its own copy. The only saved setting is the capture shortcut, in `settings.json`:

| Platform | Directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\screenfling\` |
| macOS | `~/Library/Application Support/screenfling/` |
| Linux | `$XDG_CONFIG_HOME/screenfling/`, or `~/.config/screenfling/` |

When you report a problem, include the platform, the build and the error text. Do not attach private screenshots.

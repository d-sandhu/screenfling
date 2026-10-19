# Using ScreenFling

**Shortcut → drag a region → Enter.** The image lands in your coding agent, ready for you to submit.

## Capture

Press the capture shortcut in any app: **Ctrl+Shift+9** on Windows and X11, **Cmd+Shift+9** on macOS. The screen under the pointer freezes. You can also use **Capture region** (F8) in the ScreenFling window, or **Capture** in its tray menu.

Drag a region. Drag again to replace it, or press **Space** to select the whole display. The selection shows its size in pixels, and the crop keeps the display's full resolution.

When the region is right:

| Action | Key | What happens |
| --- | --- | --- |
| **Send** | Enter | Copies the image, switches to your agent window and presses its image-paste key once. |
| Choose the agent | Tab, or the ⏷ menu | Moves Send to the next open agent window. |
| **Copy** | Ctrl+C (Cmd+C on macOS) | Copies the image and returns you to the app you were in. |
| Cancel | Esc | Nothing is copied. The clipboard is unchanged. |

When no agent window is open, Enter copies instead, and on Wayland Copy is the only action. Actions run when you release the key, so a held key never reaches the destination.

## Send

Send goes to an **agent window**: a terminal, or an app such as Claude, ChatGPT or Codex desktop, Cursor, VS Code, Windsurf or Zed. You can capture from anywhere, such as a browser, a design tool or docs.

- By default Send goes to the agent window you used most recently. If you capture from inside an agent window, that window is the most recent one.
- The toolbar names the destination by its window title. Terminals show the active tab's title, which agents such as Claude Code set to the session name. Tab or the ⏷ menu picks another open agent window.
- The last destination you sent to stays the default while it is open.

In **Windows Terminal**, every tab is its own destination, listed by tab title. Send switches to the chosen tab before pasting. Other terminals are targeted by window, and the image goes to the window's active tab. On macOS Send targets the app's frontmost window.

The paste key depends on where it lands:

| Destination | Key Send presses |
| --- | --- |
| Windows terminals: Windows Terminal, console windows, WezTerm, Alacritty, mintty, ConEmu, Tabby, Hyper, Warp | Alt+V |
| macOS terminals: Terminal, iTerm2, Ghostty, WezTerm, kitty, Alacritty, Warp | Ctrl+V |
| X11 terminals | Ctrl+V |
| Other apps, such as browsers, Claude and ChatGPT desktop, VS Code and Cursor chat | Ctrl+V (Cmd+V on macOS) |

Coding agents in a terminal read image paste from their own key, because the terminal keeps its paste shortcut for text. Claude Code and Codex use Alt+V on Windows and Ctrl+V on macOS and Linux. OpenCode uses Ctrl+V.

Send never presses Enter. Afterwards focus stays in your agent, ready for you to type. Copy and Esc return focus to the app you captured from. Either way, the shortcut starts the next capture right away. ScreenFling hides to its tray icon; on a desktop without a tray, its window stays open behind yours so you can still reach Settings and Quit. If anything changed first (the window closed, focus moved, or the clipboard was replaced), nothing is pasted and the image stays copied.

**Where Send cannot help:**

- **Integrated terminals in an editor.** VS Code or Cursor count as a GUI app, so Send presses Ctrl+V there. A terminal agent inside them on Windows needs Alt+V: use Copy and press Alt+V.
- **OpenCode in Windows Terminal.** Windows Terminal takes Ctrl+V for text paste. Use Copy and the paste method OpenCode documents for your terminal.
- **SSH, WSL and remote sessions.** A remote agent reads the remote machine's clipboard, not yours.
- **Elevated windows on Windows.** Windows blocks input from a normal app to an administrator window.
- **Wayland.** Apps cannot return focus to another window or press keys there. Copy works.
- **Non-QWERTY layouts on macOS.** Send presses the key in the V position of a US layout. With Dvorak or similar layouts, use Copy.

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

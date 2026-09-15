# Using ScreenFling

Start with [Run from source](../README.md#run-from-source), or use a macOS test
build below. This is an early-development app. Use synthetic content while
checking a new build or terminal binding.

## Capture and copy

On macOS, put the pointer on the display to capture and press **Cmd+Shift+9**.
The **Capture region** button starts the same workflow. Drag over the relevant
area on that display and review the resulting crop.

Choose **Copy only**, then paste the image manually in your destination.
Copy does not include the note and does not need a terminal connection. **Done**
returns to the start screen. Change the shortcut on that screen; a failed
registration leaves the capture button available.

Escape cancels selection or review before delivery starts. During Copy, Stage,
or Reveal, wait for the result rather than starting another operation.

## Screen Recording on macOS

Use the app's permission guidance to open System Settings, grant Screen Recording
to the exact build being used, then fully quit and reopen it. The setting can be
named **Screen & System Audio Recording** on newer macOS versions; ScreenFling
captures images, not audio.

Development Electron and `ScreenFling.app` can have different permission entries.
Quit other builds when diagnosing permissions. A granted status alone does not
prove capture works: try a harmless region. If permission is denied or managed,
use the displayed recovery guidance; do not disable system protections.

## Connect WezTerm (experimental)

Direct staging currently requires macOS and WezTerm
`20240203-110809-5046fc22`. It is not verified support for every agent running in
that terminal. ScreenFling addresses a pane; it cannot verify the program inside.

First test your agent's image-attachment key manually with a harmless image.
Confirm that it attaches without submitting, and leave the agent at an idle
composer. Do not stage to a shell prompt. A remapped key or different foreground
program can interpret input differently.

Open **Connect WezTerm · optional** on the start screen:

| Field | What to enter |
| --- | --- |
| WezTerm executable | The absolute executable path inside the app, commonly `/Applications/WezTerm.app/Contents/MacOS/wezterm`, not `WezTerm.app` itself. |
| WezTerm configuration file | The absolute path to the trusted Lua config used by that instance. |
| Exact mux socket | In the target WezTerm instance, run `echo "$WEZTERM_UNIX_SOCKET"` and use its non-empty absolute path. |
| Image attachment key (hex bytes) | The binding you just verified. `16` represents Ctrl+V, but use it only when your agent actually attaches images with that key. |

Use absolute paths, not `~`. If the socket variable is empty, do not guess a path;
check that instance's [WezTerm CLI configuration](https://wezterm.org/cli/cli/index.html).
Recheck it after restarting WezTerm.

**Check connection** only discovers panes. It neither sends input nor proves an
image binding. Confirm the binding checkbox, choose **Save connection**, then
**Restart ScreenFling**. Save rechecks before writing the preference; the previous
connection stays active until restart. **Disconnect after restart** works the
same way.

The config and socket must belong to your user; the executable must belong to
your user or root. The socket needs a private parent directory. Group/other-write
permissions on paths or their ancestors, ACL allow grants, and unreadable security
metadata are rejected. Even a private folder under world-writable `/tmp` is
rejected. Choose a trusted location under your home; do not chmod system folders
or weaken the checks. A Lua config is executable code, not an inert settings file.

## Stage and inspect

After a capture, explicitly select the correct pane in **Exact destination**.
Add an optional single-line note and click **Stage, don’t send** once. ScreenFling
copies the crop, checks the route, and writes the attachment key plus note to
that pane. It does not automatically reveal the terminal or press Enter.

**Staged — unverified** means a dispatch was attempted, not that an image was
confirmed in the agent. Inspect the pane before pasting again. **Reveal
destination** requests that exact pane separately; the OS might not bring its
window to the foreground. Submit manually only after inspecting the attachment
and note.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Shortcut unavailable | Use Capture region and choose a different shortcut on the start screen. |
| No destinations | Copy still works. Check connection settings, the pinned WezTerm version, and the current socket. |
| Path checks failed | Check trusted ownership, ancestor permissions, and ACLs; do not relax the app's checks. |
| Connection saved but not active | Restart ScreenFling. |
| Old selection disappears | Refresh and select the current pane; the app will not substitute another target. |
| Uncertain Stage | Inspect the destination first. Do not repeatedly click Stage or paste. |
| Clipboard verification failed | Do not assume either the new crop or the old clipboard is intact. Try a fresh capture. |
| Broken preview | Do not deliver it. Cancel and take a fresh capture. |

## macOS test builds

The [Check workflow](https://github.com/d-sandhu/screenfling/actions/workflows/check.yml)
retains a macOS artifact for **14 days** after a successful main push run. Select
that run, verify its commit, and download its artifact while signed in to GitHub.
Expired artifacts must be rebuilt; they are not permanent release downloads.

Extract the outer artifact, then verify its contents before opening the app ZIP:

```bash
shasum -a 256 -c SHA256SUMS
```

`candidate.json` records the source and tested commits, architecture, and signing
state. These Apple Silicon builds are ad-hoc signed, not notarized releases. If
macOS blocks one, do not disable Gatekeeper globally. Building locally and trusted
distribution are described in [Contributing](../CONTRIBUTING.md) and
[Releasing](releasing.md).

## Environment override

For controlled development, all four variables can override the saved connection:
`SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE`,
`SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE`,
`SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET`, and
`SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX`.

They correspond to the four fields above. A partial override does not fall back
to a saved endpoint. Start the app without these variables to edit saved settings.

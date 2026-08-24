# Phase 17 WezTerm preflight research

Research date: **2026-08-24**
Scope: current macOS installation guidance and the exact WezTerm boundary that
Phase 17 must exercise. This is a research note, not native acceptance evidence
and not a replacement for the [operator protocol](../docs/acceptance/macos-operator-acceptance.md).

## Method and local observation

Context7 was queried first for the official `/websites/wezterm` documentation,
then the current first-party WezTerm documentation and release page were
checked. The research pass did not launch a GUI or change host settings. The
main operator session then installed the official stable Homebrew cask after
that verification.

The resulting installation is observable read-only: `wezterm --version` and the
relevant `--help` commands returned **`20240203-110809-5046fc22`**, the exact
version pinned by ScreenFling. This is the only WezTerm version tested in this
preflight; no image or agent operation was attempted.

## macOS installation path

The official stable Homebrew path is:

```bash
brew install --cask wezterm
```

The official manual path is to extract the release archive and move
`WezTerm.app` to `/Applications`. The CLI binary is inside
`/Applications/WezTerm.app/Contents/MacOS`; the official documentation says to
add that directory to `PATH` when using `wezterm` from a shell. The project
should use the pinned release above for acceptance, rather than silently
substituting a nightly or an arbitrary newer build.

Sources: [official macOS installation](https://wezterm.org/install/macos.html),
[pinned WezTerm release](https://github.com/wezterm/wezterm/releases/tag/20240203-110809-5046fc22).

## Exact ScreenFling CLI boundary

ScreenFling’s developer configuration requires absolute paths for the
executable, config file, and selected Unix socket, plus the tested image-input
binding. See the [repository configuration contract](../README.md#experimental-wezterm-developer-configuration).
The adapter currently constructs these operations:

| Operation | Required command shape | Input and boundary |
| --- | --- | --- |
| Discovery | `--config-file <file> cli --no-auto-start list --format json` | No stdin; parse bounded JSON and bind a route to exactly one `pane_id`. |
| Stage | `--config-file <file> cli --no-auto-start send-text --no-paste --pane-id <id>` | Stdin contains the configured image-paste bytes followed by the validated note; no Enter or submit byte is added. |
| Reveal | `--config-file <file> cli --no-auto-start activate-pane --pane-id <id>` | Null stdin; this is the separate focus/reveal operation and must never carry image or note bytes. |

Each process sets `WEZTERM_UNIX_SOCKET` to the selected socket and removes any
inherited `WEZTERM_PANE`. Every operation must retain the explicit
`--pane-id`; without it, WezTerm may use `WEZTERM_PANE` or the most recently
interacted focused pane. The local pinned binary’s help confirms both
`--no-auto-start` and `--prefer-mux` as `cli` options. ScreenFling currently uses
the explicit socket environment instead of `--prefer-mux`; adding the latter
would make the config’s first Unix domain part of instance selection and must
not be done casually.

Sources: [ScreenFling WezTerm adapter](../src/main/wezterm-adapter.ts),
[WezTerm CLI targeting](https://wezterm.org/cli/cli/index.html),
[`list`](https://wezterm.org/cli/cli/list.html),
[`send-text`](https://wezterm.org/cli/cli/send-text.html),
[`activate-pane`](https://wezterm.org/cli/cli/activate-pane.html).

## What each command can prove

- `list --format json` proves the selected WezTerm instance exposed window,
  tab, pane, workspace, size, title, and CWD records. It does not prove that a
  pane is a particular Codex conversation or that its composer is ready.
- `--pane-id` makes the target explicit. `send-text` sends input as pasted text;
  `--no-paste` changes bracketed-paste handling to direct input. Neither option
  means “do not submit”: that guarantee comes from the configured image binding,
  the absence of Enter/control-submit bytes, and native observation.
- `activate-pane` is explicitly documented as activating/focusing a pane. A
  successful CLI process does not prove that macOS raised a visible WezTerm
  window, that the correct agent UI is frontmost, or that a human can see it.
- `get-text` can read terminal text, but terminal text read-back does not
  authoritatively expose an image chip or Codex composer attachment state.

## Codex image-attachment evidence boundary

For a passive Stage into an existing Codex TUI, a successful WezTerm
`send-text` only proves process-level acceptance by the selected pane. It cannot
prove Codex recognized the clipboard image, displayed an image indicator, kept
the composer idle, or avoided submission. A pane title, CWD, `pane_id`, or
successful text read-back is not an attachment proof.

The current structured Codex interfaces do not change that boundary: a
`localImage` supplied to app-server `turn/start` is managed input that starts a
turn, not a visible draft in an existing TUI composer. `thread/inject_items` is
not documented as an image-chip or composer API. Those are future managed-`Send`
research paths, not evidence for this surface Stage. See the [official app-server
turn documentation](https://learn.chatgpt.com/docs/app-server#turns) and the
repository's [managed-agent evidence](managed-agent-routing-current-evidence.md).

Phase 17 may record Stage as verified only after direct observation or a
documented authoritative read-back of the selected composer: exactly one image
indicator, the literal note once, idle/no submitted turn, and no change in the
unselected composer across the required trials. Otherwise the honest result is
`dispatched-unverified`, even when WezTerm exits successfully.

## Blockers and assumptions

- The pinned binary is already installed and passed read-only version/help
  checks; installation is not a blocker for this host.
- Native work still must confirm the exact config was loaded, the selected
  socket is the instance used by every command, and `--no-auto-start` does not
  create an endpoint in the fixture. A readable path or successful default
  config fallback is insufficient.
- The configured image binding must be proven for the exact Codex product,
  version, terminal, and keymap under test. WezTerm documentation does not
  establish Codex’s composer behavior.
- No private screenshots, notes, clipboard contents, terminal transcripts,
  credentials, or raw local paths belong in the acceptance report.

## Sources

- [WezTerm macOS installation](https://wezterm.org/install/macos.html)
- [WezTerm CLI targeting](https://wezterm.org/cli/cli/index.html)
- [WezTerm CLI global options](https://wezterm.org/cli/general.html)
- [WezTerm configuration-file resolution](https://wezterm.org/config/files.html)
- [WezTerm `list`](https://wezterm.org/cli/cli/list.html)
- [WezTerm `send-text`](https://wezterm.org/cli/cli/send-text.html)
- [WezTerm `activate-pane`](https://wezterm.org/cli/cli/activate-pane.html)
- [Pinned WezTerm release](https://github.com/wezterm/wezterm/releases/tag/20240203-110809-5046fc22)
- [ScreenFling managed-agent routing evidence](managed-agent-routing-current-evidence.md)

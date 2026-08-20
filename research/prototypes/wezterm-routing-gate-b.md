# PROTOTYPE — WezTerm exact-routing Gate B

Date: 2026-08-20  
Branch: `prototype/wezterm-routing-gate-b` (must not merge)  
Pinned release: `20240203-110809-5046fc22`

## Question

Can an adapter-neutral ScreenFling route use WezTerm's cross-platform mux CLI
to target one of two identical-looking terminal panes, stage literal key/note
bytes without Enter or focus activation, and refuse a stale destination before
dispatch?

This prototype tests the routing primitive. It does not select WezTerm as a
required terminal and does not prove that a particular coding agent interprets
the transported key bytes as an image attachment.

## Reproducible setup

Run:

```sh
npm run prototype:routing
```

The harness:

1. downloads the official stable ZIP for native macOS or Windows;
2. verifies the platform-specific SHA-256 digest;
3. starts an owned headless `wezterm-mux-server` with a unique socket and
   in-memory instance-generation token;
4. creates two raw-mode receivers with the same title and working directory;
5. re-lists the exact mux instance before every dispatch;
6. performs 100 alternating Stage operations, each consisting of a paste-key
   byte sequence and one literal note with no CR/LF;
7. compares every receiver byte to the exact expected buffer;
8. closes one pane and proves the saved route is rejected before another send;
9. stops only the owned server and removes only the owned temporary directory.

Every CLI operation supplies both `WEZTERM_UNIX_SOCKET` and `--pane-id`. The
harness never invokes `activate-pane`, omits a pane ID, reads/writes the
clipboard, or sends Enter.

## Evidence

### macOS arm64

The first execution exposed a harness defect: the receiver inherited canonical
TTY input, which correctly buffered input until a line terminator. Interactive
terminal UIs use raw mode, so the receiver was changed to raw mode and the same
acceptance run was repeated.

The corrected run passed on macOS arm64:

| Check | Result |
| --- | ---: |
| Alternating Stage operations | 100/100 |
| Exact targeted CLI sends | 200/200 |
| Wrong-target writes | 0 |
| Enter bytes | 0 |
| Exact final receiver buffers | yes |
| Closed route refused before send | yes |
| Active-pane fallback | never used |
| Focus/activation command | never used |
| WezTerm ZIP SHA-256 | `e77388cad55f2e9da95a220a89206a6c58f865874a629b7c3ea3c162f5692224` |

This run was headless, so it could not observe human-visible OS focus. Headless
operation does show that dispatch does not require a focus command.

### Native Windows

The identical harness passed on a GitHub-hosted native Windows Server 2025 x64
runner ([workflow run 32387884325](https://github.com/d-sandhu/screenfling/actions/runs/32387884325)):

| Check | Result |
| --- | ---: |
| Alternating Stage operations | 100/100 |
| Exact targeted CLI sends | 200/200 |
| Wrong-target writes | 0 |
| Enter bytes | 0 |
| Exact final receiver buffers | yes |
| Closed route refused before send | yes |
| Active-pane fallback | never used |
| Focus/activation command | never used |
| WezTerm ZIP SHA-256 | `57e5d03b585303d81e8b8e96d1230362852eb39aca92b3b29c7a42cfb82f9ac4` |

The aggregate transport primitive therefore passes on native macOS and native
Windows. As on macOS, the headless runner cannot supply human-visible focus or
real coding-agent attachment evidence.

## Documentation/source validation

Context7 `/websites/wezterm` confirmed that `wezterm cli list --format json`
returns pane IDs and that CLI instance selection honors `--prefer-mux`, then
`WEZTERM_UNIX_SOCKET`, before GUI discovery. Context7 had no matching statement
for native Windows socket support, so the pinned official WezTerm source was
checked directly instead of inferring it from macOS. The stable mux-server
listener uses its local `UnixListener` on Windows and contains Windows-specific
socket-path handling.

Primary sources:

- [WezTerm CLI instance targeting](https://wezterm.org/cli/cli/index.html)
- [WezTerm CLI list](https://wezterm.org/cli/cli/list.html)
- [Pinned stable mux-server source](https://github.com/wezterm/wezterm/blob/20240203-110809-5046fc22/wezterm-mux-server/src/main.rs)
- [Pinned stable local-listener source](https://github.com/wezterm/wezterm/blob/20240203-110809-5046fc22/wezterm-mux-server-impl/src/local.rs)
- [Pinned stable release](https://github.com/wezterm/wezterm/releases/tag/20240203-110809-5046fc22)

## Verdict

The exact-routing primitive passes on both Tier 1 operating systems. It
validates this permanent design direction:

- routes bind an adapter endpoint/instance generation and exact surface ID;
- every Stage revalidates the exact destination;
- a missing/stale target is refused with no fallback and no automatic retry;
- literal note data travels through stdin, not shell or automation source;
- transport success is not attachment verification.

It does **not** yet validate a production WezTerm adapter, human-visible
no-focus behavior on either desktop, configurable agent keybindings, or an
actual image chip in Claude Code/Codex. Those remain explicit Gate B work.

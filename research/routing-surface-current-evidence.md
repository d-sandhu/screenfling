# Current cross-platform exact-routing surface evidence

Research date: 2026-08-19  
Scope: ScreenFling Gate B; macOS and Windows are Tier 1. Linux is optional.  
Status: supporting evidence, not a canonical adapter commitment.

Follow-up on 2026-08-20: the recommended checksum-pinned WezTerm harness passed
its 100-dispatch exact-routing primitive on native macOS and Windows. The
permanent decision and remaining acceptance gaps are recorded in
[ADR 0001](../docs/adr/0001-wezterm-first-stage-adapter.md) and the
[Phase 3 results](phase-3-feasibility-results.md).

## Executive conclusion

For a serious open-source ScreenFling product, **WezTerm is the strongest first
cross-platform Gate B candidate**: it is distributed for macOS and Windows,
exposes a pane ID and an explicit `--pane-id` target, accepts targeted pasted
text, and provides targeted screen-text read-back. Its CLI also documents the
instance-selection rules that must be pinned so an omitted target cannot fall
back to the most recently focused pane.

There is an important release-channel caveat: the official GitHub repository
currently labels `20240203-110809-5046fc22` (2024-02-03) as the latest stable
tag, while the `main` branch and continuous/nightly builds remain active. This
does not remove WezTerm from consideration, but it lowers confidence in a
“stable API” score and makes the tested release channel part of Gate B.

**tmux is the strongest control/reference surface for exactness and lifecycle
testing**, with pane IDs, literal `send-keys`, `capture-pane`, and control-mode
events. It is not a native Windows Tier 1 surface according to its official
installation material; treating WSL as equivalent to native Windows would hide
a product and contributor-reach decision.

Ghostty is useful as an optional macOS adapter or local spike, but it must not
silently become ScreenFling's product route. Its AppleScript surface is macOS
only, has no documented screen read-back, and is explicitly preview-quality in
the 1.3 release notes with expected breaking changes in 1.4. The fact that
Ghostty may be installed on one development machine is not evidence for a
cross-platform product choice.

Gate B should therefore run a two-target harness against a pinned WezTerm
instance on native macOS and native Windows, with tmux as the exactness/read-back
reference where available. If WezTerm fails the stated acceptance tests, the
next decision should be an explicit adapter proposal (for example a managed
bridge or a Windows-specific cooperative surface), not an implicit Ghostty
fallback.

## Method and evidence boundaries

The delegated research environment attempted Context7 first but could not call
it. During integration, the primary agent queried Context7 `/websites/wezterm`
and confirmed pane enumeration and CLI instance-selection behavior. Context7
did not answer the native Windows socket question, so that point was verified
against the pinned official WezTerm source instead of inferred from macOS. The
report links material claims to owning-project documentation or source. Sources
were checked on 2026-08-19 and the follow-up validation ran on 2026-08-20.

This report deliberately separates:

- **Documented fact:** directly stated by the terminal's official docs/source.
- **Engineering inference:** the safety or product consequence ScreenFling
  should derive from those facts.

The matrix describes the control surface, not the current workstation. Local
availability can determine which harness can be run immediately; it cannot
select ScreenFling's public product direction.

## Comparison matrix

Scores are qualitative (1 = weak, 5 = strong) and are not a substitute for the
Gate B harness. “Tier 1 reach” means native macOS + native Windows availability,
not WSL, remote SSH, or a compatibility layer.

| Surface | Exact stable locator | Targeted input without OS focus | Read-back / verification | Stale identity semantics | Tier 1 reach | Install burden / contributor reach | API stability | Gate B view |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| **tmux** | Session `$id`, window `@id`, pane `%id`; IDs are stable and not changed/reused within one running server. Pin the server/socket and pane ID. | `send-keys -t %id`; `send-keys -l` makes note text literal. Structured key injection is exact; an image stage still needs the agent's clipboard-paste key and an image already in the OS clipboard. Does not require selecting an OS window. | `capture-pane -p -t %id`; control mode emits pane output/lifecycle notifications. Strongest terminal-text verification of the candidates. | A closed pane must be rejected after re-enumeration. IDs can be reused by a later server, so the socket/server generation is part of ScreenFling's route (inference). | **2/5** (native macOS/Linux; no native Windows package in official install docs) | Very low on Unix via package managers; mature, broad Unix contributor reach. Windows contributors need a separate supported bridge/WSL decision. | **5/5** mature CLI/control mode; official source shows tmux 3.6b as latest on 2026-05-20. | Exactness/read-back reference; not the sole Tier 1 product surface. |
| **WezTerm** | Pane ID from `wezterm cli list --format json`; instance is separately pinned with `WEZTERM_UNIX_SOCKET`, `--prefer-mux`, or an explicit GUI class. | `wezterm cli send-text --pane-id N` sends paste-style text to the chosen pane. The documented CLI has no structured `send-key`; a tested control byte via `--no-paste` may be usable, but an image stage still depends on the target agent's clipboard-paste binding and the OS clipboard. Do not call `activate-pane` for dispatch because that command focuses. | `wezterm cli get-text --pane-id N` returns pane screen text; list JSON also supplies window/tab/workspace/title/CWD observations. | Re-list against the same pinned GUI/mux instance immediately before dispatch; missing pane is stale. The docs do not promise pane-ID non-reuse across a GUI/mux restart; treating IDs as instance-generation scoped is an engineering inference and must be tested. | **5/5** (official native macOS and Windows packages; Linux also available) | App bundles/installers or portable ZIP; no extra multiplexer required. Strong cross-platform contributor/test reach. | **3/5** documented and version-gated CLI, but latest stable tag is 2024-02-03 while main/nightlies remain active; preflight and pin a release channel. | **Primary cross-platform Gate B candidate, conditional on the image-key probe and stable-channel validation.** |
| **Ghostty** | AppleScript hierarchy `application -> windows -> tabs -> terminals`; terminal `id` is the exact object locator, scoped to the running application instance. | `input text` and `send key` target a terminal object; text, structured keys, and a clipboard-paste key can be dispatched without focus. The image itself still comes from the OS clipboard. `focus` is a separate command, so dispatch can avoid focus. TCC Automation permission is required. | No documented terminal screen/contents, process, PID/TTY, or agent-session read-back in the 1.3 AppleScript dictionary; report `dispatched/unverified`. | Re-enumerate the same app process and terminal ID immediately before dispatch. Treat app restart/terminal disappearance as stale; process-generation binding is an inference. | **1/5** (native macOS; official 1.3 notes say Windows support is still not planned) | Easy macOS app install; Linux packages/builds exist, but no Windows desktop surface. Narrower contributor reach for a Tier 1 project. | **2/5** AppleScript introduced in 1.3 and explicitly preview-quality; maintainers expect breaking changes/significant additions in 1.4. | Optional macOS adapter/spike only; never an implicit default. |
| **kitty** | Window ID from `KITTY_WINDOW_ID` or `kitten @ ls`; target via `--match id:N` and a pinned control socket. Matching can also use title/CWD/PID/cmdline, but those are descriptive or mutable. | `send-key`/`send-text` target matched windows through the remote-control protocol. Structured keys are documented; an image stage still requires the target agent's clipboard-paste key and an image in the OS clipboard. Remote control must be enabled or password-protected; do not rely on active-window defaults. | `kitten @ get-text` and JSON `ls` provide screen/list observations. `send-text` and `send-key` explicitly report success even when no window matched, so command success alone is not verification. | Re-list the same socket and require the exact window ID; reject no-match. The docs do not promise ID non-reuse, so ScreenFling must treat socket identity plus a fresh enumeration as the stale guard (inference). | **2/5** (native macOS/Linux; no native Windows package in official install docs) | Simple prebuilt installer on macOS/Linux; enabling and securing remote control is extra setup. Good Unix reach, no native Windows reach. | **3/5** documented JSON protocol and version handshake; remote-control error behavior is a safety caveat. | Strong optional Unix adapter; not a Tier 1 cross-platform choice. |
| **iTerm2** | Python/AppleScript session ID / unique ID; official API can resolve a session by ID. | Python `async_send_text` writes to the chosen session (the API's targeted-input example uses this for fake keystrokes); activation is a separate operation and should not be used for dispatch. An image stage still depends on the agent's clipboard-paste key and OS clipboard. | `async_get_screen_contents` and `ScreenStreamer` expose screen contents; lifecycle monitor reports terminated session IDs. | Use session ID plus live application connection; reject `InvalidSessionId`/termination and re-enumerate. This is the clearest documented lifecycle signal among the macOS-only surfaces. | **1/5** (macOS only) | iTerm2 install plus its Python integration/loopback connection; mature macOS contributor reach but no Windows path. | **4/5** mature, versioned Python API; still platform-specific and integration-dependent. | Excellent macOS-specific adapter; cannot carry the Tier 1 cross-platform contract. |
| **Windows Terminal** | `wt` can identify a window by integer/name and a tab by index; pane operations are active/relative/directional. Official CLI does not expose a stable external pane locator equivalent to tmux/WezTerm. | `sendInput` is documented as a settings key binding to the shell, not an external exact-pane dispatch API; focus/move/swap commands operate on active panes. | No documented external exact-pane text/read API in the command-line surface. Built-in search is UI-only; output logging is not an attachment-state API. | A missing `-w` window ID/name can create a new window; tab indexes shift. This is unsafe for stale refusal unless a future cooperative bridge supplies an owned identity. | **2/5** as a Windows-only surface; **0/5** as cross-platform | Usually present or easy to install on Windows 10 22H2/11; very broad Windows reach. That low install burden does not compensate for the missing exact external API. | **3/5** active Microsoft-owned CLI/actions, but the documented surface is not deep enough for ScreenFling's contract. | Do not select as the sole exact-routing surface; use a future bridge or a supported multiplexer. |

### Score interpretation

The two scores that matter most for ScreenFling are target safety and
verification. WezTerm and tmux are the only candidates in this set that combine
an explicit pane locator, targeted text input, and documented screen-text
read-back in a way that can be exercised without changing OS focus. WezTerm is
the only one with that shape on both native Tier 1 platforms, but its documented
CLI has no semantic key command; Gate B must therefore prove the configured
image-paste key path with an instrumented receiver. The image is not sent by
these terminal-control surfaces as a native image payload: ScreenFling must
place it in the OS clipboard, then dispatch the target agent's paste binding.
iTerm2 is technically strong but macOS-only. kitty is technically capable on
Unix but deliberately requires remote-control setup and does not make a
successful send command proof that a window matched. Windows Terminal has broad
Windows reach but lacks the external exact-pane contract.

## Surface-by-surface facts and inferences

### tmux

**Facts.** The official Advanced Use documentation states that pane/window/session
IDs are prefixed `%`, `@`, and `$`; IDs are unchanged and not reused within a
running server; IDs can be used as script targets; `send-keys` sends key presses;
and `capture-pane -p` writes pane content to stdout. The official Control Mode
documentation recommends IDs over names/indexes and emits asynchronous `%output`
notifications. The official installation page lists Linux and macOS packages
and source-build requirements. The official repository identifies tmux 3.6b as
the latest release shown on 2026-05-20.

**Inference.** `server/socket identity + pane ID` is the safe route key. A new
server may reuse a numeric-looking pane ID, so ScreenFling must not persist `%0`
without the server/socket generation. tmux is an excellent exactness oracle and
read-back adapter, but native Windows support cannot be inferred from WSL.

Sources: [Advanced Use](https://github.com/tmux/tmux/wiki/Advanced-Use),
[Control Mode](https://github.com/tmux/tmux/wiki/Control-Mode),
[Installing tmux](https://github.com/tmux/tmux/wiki/Installing),
[tmux repository/releases](https://github.com/tmux/tmux).

### WezTerm

**Facts.** `wezterm cli list --format json` exposes window, tab, pane,
workspace, title, size, and CWD fields. `send-text --pane-id` targets a pane
and sends paste-style text. `get-text --pane-id` reads the pane's screen text.
The CLI docs state that commands otherwise choose the instance using
`--prefer-mux`, `WEZTERM_UNIX_SOCKET`, or a GUI selection, and choose the most
recently interacted/focused pane if no pane ID is supplied. The pane API calls
the pane ID the identifier used for CLI API calls. Official installers cover
macOS and Windows; the project also lists Linux packages. The official docs
version-gate `list` and `send-text` at `20220624-141144-bd1b7c5d`, and
`get-text` at `20230320-124340-559cb7b0`; `--prefer-mux` is documented in the
20220624 changelog. Therefore the minimum released version containing the
complete required surface is **20230320-124340-559cb7b0**. The official GitHub
repository currently labels **20240203-110809-5046fc22** (2024-02-03) as the
latest stable tag, while continuous/nightly builds track active `main`.

**Inference.** Every ScreenFling route must store both the instance selector
(socket/domain/class) and the pane ID. Omitting either recreates the exact bug
Gate B is meant to prevent: dispatch to the current or most-recently focused
pane. ScreenFling should treat a failed re-enumeration as stale and never use
`activate-pane` as an input prerequisite. The docs do **not** promise that a
numeric pane ID is never reused after a GUI/mux instance restarts; non-reuse
across restarts is therefore an inference, not a contract. Bind the route to an
instance-generation marker and fresh enumeration, and refuse an ambiguous
target. CLI version gates mean the adapter should preflight capabilities rather
than assume every old build has `get-text`.

**Gate B channel decision.** Use the latest stable tag
`20240203-110809-5046fc22` as the reproducible, gating baseline: it is newer
than the minimum `20230320...` release and contains `list`, `send-text`,
`get-text`, `--pane-id`, and the documented instance-pinning behavior. Run a
nightly/main build only as a non-gating compatibility canary. Do not require a
nightly from contributors or users to pass Gate B; if the stable build fails,
record that failure and make a deliberate release-channel decision rather than
silently switching to nightly.

Sources: [CLI targeting](https://wezterm.org/cli/cli/index.html),
[list](https://wezterm.org/cli/cli/list.html),
[send-text](https://wezterm.org/cli/cli/send-text.html),
[get-text](https://wezterm.org/cli/cli/get-text.html),
[pane ID](https://wezterm.org/config/lua/pane/pane_id.html),
[change log](https://wezterm.org/changelog.html),
[stable releases](https://github.com/wezterm/wezterm/releases),
[macOS install](https://wezterm.org/install/macos.html),
[Windows install](https://wezterm.org/install/windows.html),
[download/platforms](https://wezterm.org/installation.html).

### Ghostty

**Facts.** Ghostty's official AppleScript docs define an object model down to
individual terminals, with terminal `id`, `name`, and `working directory`, and
document `input text` and `send key` targeted to a terminal. `focus` is a
separate operation. AppleScript support requires macOS Automation permission.
The 1.3 release notes date the feature to 2026-03-09, call it a preview, and
say maintainers expect breaking API changes and significant additions in 1.4.
Those notes also say Windows desktop support is still not planned, while
libghostty supports Windows. The 1.3.1 notes describe a macOS AppleScript tab
selection activation fix.

**Inference.** The terminal ID is useful for a macOS adapter but must be scoped
to a running Ghostty app generation. Since the documented dictionary has no
screen contents, ScreenFling cannot claim attachment verification from this
surface alone. Ghostty can be a measured optional adapter; it cannot define the
Tier 1 route or silently substitute for a failed Windows path.

Sources: [AppleScript](https://ghostty.org/docs/features/applescript),
[1.3 release notes](https://ghostty.org/docs/install/release-notes/1-3-0),
[1.3.1 release notes](https://ghostty.org/docs/install/release-notes/1-3-1),
[download/install](https://ghostty.org/docs/install/binary).

### kitty

**Facts.** kitty's remote-control docs provide JSON `ls`, window IDs, matching
by ID/title/CWD/PID/cmdline, `send-key`, `send-text`, and `get-text`. Control
outside kitty requires remote control enabled and can be secured with a socket
and password. The docs explicitly warn that `send-text` and `send-key` report
success even if no window matched. The binary installer documents prebuilt
macOS and Linux binaries; the official quickstart lists those two desktop
platforms.

**Inference.** A ScreenFling adapter must pin the control socket, use a numeric
window ID obtained from a fresh `ls`, and verify the target after dispatch; it
must never trust an exit code. kitty's remote-control protocol version field is
useful for capability negotiation, but the lack of a documented non-reuse rule
means stale handling must be conservative. Native Windows Tier 1 support is not
available from the official install surface.

Sources: [remote control](https://sw.kovidgoyal.net/kitty/remote-control/),
[remote-control protocol](https://sw.kovidgoyal.net/kitty/rc_protocol/),
[binary install](https://sw.kovidgoyal.net/kitty/binary/),
[quickstart/platforms](https://sw.kovidgoyal.net/kitty/quickstart/).

### iTerm2

**Facts.** iTerm2's official Python API exposes `Session`, a `session_id`,
`async_send_text`, `async_get_screen_contents`, and a `ScreenStreamer`. Its
application API can resolve a session by ID. Its lifecycle API reports
terminated session IDs, and the API defines `InvalidSessionId`. AppleScript
documentation also calls the session's unique ID a string uniquely identifying
the session. iTerm2's downloads page is a macOS release page; the product is a
macOS terminal.

**Inference.** iTerm2 is a high-quality macOS reference adapter with stronger
read-back/lifecycle hooks than Ghostty, but its Python loopback integration and
macOS-only scope make it unsuitable as the Tier 1 cross-platform default.

Sources: [Python API](https://iterm2.com/python-api/),
[Session API](https://iterm2.com/python-api/session.html),
[Screen API](https://iterm2.com/python-api/screen.html),
[Life Cycle API](https://iterm2.com/python-api/lifecycle.html),
[App API](https://iterm2.com/python-api/app.html),
[downloads](https://iterm2.com/downloads.html).

### Windows Terminal

**Facts.** Microsoft's CLI docs support opening or addressing a window by
integer/name, focusing a tab by index, moving focus between panes, and moving
or swapping the active pane. The official tips document `sendInput` as a
settings key binding that sends input to the shell. The install docs cover
Windows 11 and Windows 10 22H2 (with the stated update), Microsoft Store,
GitHub, and package-manager routes. The CLI docs say a nonexistent named
window can be created, and pane commands are active/relative rather than
external exact-pane operations.

**Inference.** Window names/IDs and tab indexes are not sufficient stale-safe
locators for ScreenFling: a missing target can create a new window, and indexes
shift as tabs change. The documented external surface cannot provide the
required targeted text/key injection and read-back without focus. Windows
Terminal remains a high-reach host that could become useful behind a future
cooperative bridge, but it should not be selected as the sole exact-routing
surface today.

Sources: [command-line arguments](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments),
[tips and tricks / sendInput](https://learn.microsoft.com/en-us/windows/terminal/tips-and-tricks),
[panes](https://learn.microsoft.com/en-us/windows/terminal/panes),
[installation](https://learn.microsoft.com/en-us/windows/terminal/install),
[open-source product repository](https://github.com/microsoft/terminal).

## Recommendation for Gate B

1. Make the harness contract platform-neutral: `enumerate`, `instance identity`,
   `exact locator`, `revalidate`, `dispatch text/key`, `read back`, and explicit
   stale/error outcomes. Route keys must include the instance boundary, not
   just a pane/window number.
2. Run the primary harness on **stable WezTerm
   `20240203-110809-5046fc22` on native macOS and native Windows**. Pin the
   release artifact and its checksums in the harness fixtures. Run a current
   nightly/main build only as a non-gating canary for API drift.
   Pin the WezTerm instance and pane ID; alternate two instrumented panes;
   verify screen text before/after; and ensure dispatch never calls
   `activate-pane` or otherwise steals focus.
3. Run the same behavioral suite against **tmux on macOS/Linux where present**
   as the exactness/read-back reference. Keep this as a reference adapter or
   later Unix adapter unless a supported native Windows tmux distribution is
   explicitly added to the product scope.
4. Treat Ghostty, kitty, and iTerm2 as optional adapters evaluated by explicit
   proposals. Ghostty may be tested on the local Mac, but its local presence
   must not change Gate B's Tier 1 decision; its no-read-back/preview status
   means any result is `dispatched-unverified`.
5. If no candidate passes on both native Tier 1 platforms, Gate B fails honestly
   and ScreenFling keeps Copy/manual paste as the safe fallback. Do not fall
   back to the focused or frontmost terminal, and do not silently target
   Ghostty because it happens to be installed.

This recommendation is consistent with the current roadmap and product docs:
Gate B is explicitly based on target safety, verification, maintainability, and
contributor reach; Ghostty, tmux, and WezTerm are candidates rather than
dependencies; and Windows is Tier 1 rather than an afterthought. It supersedes
the older machine-specific Ghostty-first experiment only as a current routing
surface comparison; it does not modify the canonical product direction.

## Dated primary-source register

All links above were checked on 2026-08-19. Notable dated source facts:

- Ghostty 1.3.0: released 2026-03-09; 1.3.1: released 2026-03-13; AppleScript
  is called preview and expected to change in 1.4.
- tmux repository: latest release shown as 3.6b on 2026-05-20.
- iTerm2 downloads: stable 3.6.9 built 2026-03-10; macOS 12.4+.
- WezTerm docs version-gate `list` and `send-text` at
  `20220624-141144-bd1b7c5d`, and `get-text` at
  `20230320-124340-559cb7b0`; the latter is the minimum released version for
  the complete required surface. `--prefer-mux` is documented in the 20220624
  changelog. The latest stable GitHub tag is
  `20240203-110809-5046fc22` (2024-02-03), while active main/nightly builds
  continue; Gate B should gate on the stable tag and canary-test nightly.
- WezTerm's official docs do not promise pane-ID non-reuse across GUI/mux
  restarts. Any restart-safe identity rule is ScreenFling engineering
  inference and must use instance generation plus fresh enumeration.
- Windows Terminal install docs state Windows 11 and Windows 10 22H2 coverage
  under the documented update condition.

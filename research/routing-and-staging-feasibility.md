# Routing and staging feasibility

Research date: 2026-08-19

Status: Supporting research snapshot. Its machine-specific adapter recommendation
is historical evidence, not the public product direction. The canonical adapter
choice is governed by [the roadmap's routing gate](../ROADMAP.md#gate-b-exact-routing-harness).

## Historical decision summary

> **Historical local proof only:** the Ghostty choice below records how the first
> research machine could exercise exact routing. It is not the product's first
> adapter commitment; the current roadmap selects that adapter through a shared
> evidence gate.

ScreenFling can prove its differentiator now, but the first supported destination should be much narrower than “a coding agent.” Based on the software actually present on the development machine, the recommended first end-to-end target is:

> **A local Claude Code composer in an explicitly selected Ghostty 1.3.1 terminal on macOS, dispatched as Stage-only and never submitted.**

The route should be keyed by the running Ghostty application instance and stable terminal ID. Ghostty 1.3's AppleScript API can enumerate exact terminal objects, expose their stable IDs/name/CWD, send a modified key, and insert paste-style text into a chosen terminal without first focusing it ([Ghostty AppleScript](https://ghostty.org/docs/features/applescript)). That is enough to test exact routing on this machine today. It is not enough to verify the resulting composer: Ghostty 1.3.1 exposes no terminal contents, foreground process, PID/TTY, or agent-session property in its scripting definition. The result must therefore be reported as **dispatched/unverified**, not “verified staged.”

tmux remains the technically stronger read-back surface because it can inject into and capture an exact pane, but neither tmux nor WezTerm is currently installed in `PATH` on this machine. Requiring a new terminal layer before testing the product would add setup that the available Ghostty API avoids. tmux is now the recommended hardening/verification adapter, not the first local proof.

The concise product answer is:

- **Can do reliably enough to prototype:** exact local Ghostty terminal selection; dispatch an image-paste key and literal note into one chosen terminal; leave the capture on the clipboard; refuse to submit.
- **Can do next:** add a tmux read-back adapter (or install/use tmux inside Ghostty), best-effort project/worktree labels, registered targets with friendly names, and compatibility checks for Ghostty's preview API.
- **Can do only when ScreenFling owns the agent session:** structured Codex thread/image delivery with exact thread IDs and completion events.
- **Cannot honestly promise yet:** universal discovery of live agent conversation IDs, safe submission to arbitrary terminal TUIs, or native image staging across an ordinary SSH boundary.

This means the current “capture first, routing later” sequence should change. Capture-to-clipboard is a useful engineering primitive, but the first product milestone should include one exact route and one successful human-observed stage. Automated attachment verification is a later gate because Ghostty 1.3.1 has no read-back API.

## Research method and Context7 resolution

Context7 was used first, as requested. The resolver selected the following high-reputation sources, and the documentation query was then run against each selected ID:

| Product | Context7 library ID | Material used |
| --- | --- | --- |
| tmux | `/tmux/tmux` | object IDs, formats, `pane_current_path`, control mode, pane enumeration |
| WezTerm | `/websites/wezterm` | JSON pane enumeration, pane activation, `send-text`, domains and CWD |
| Codex CLI | `/openai/codex` | `--image`, `exec resume`, session IDs, app-server threads and image input |

Where Context7 did not cover Claude Code, Git, other terminal control surfaces, or SSH cleanup, this report uses only first-party documentation or the owning project's source.

### Local Ghostty evidence

After the initial Context7 pass, the installed terminal environment was inspected:

- `/Applications/Ghostty.app` is version **1.3.1** (bundle `com.mitchellh.ghostty`);
- its bundled `Ghostty.sdef` SHA-256 is `0ac1bbd8e6fdc7e2ca36cee6b31bc95b2b9e6a4643560d6833c1e031aa022adf`;
- `ghostty` resolves to the application binary; and
- neither `tmux` nor `wezterm` resolves in the current `PATH`.

The installed first-party scripting definition describes window, tab and terminal IDs as stable. A terminal exposes `id`, `name`, and `working directory`; commands include targeted `focus`, `input text`, `send key` with modifiers, and mouse events. It does **not** define terminal screen/contents, process, PID, TTY, or agent-session properties. Ghostty's official docs name the bundled scripting definition as the source of truth and document the same object model and commands ([Ghostty AppleScript](https://ghostty.org/docs/features/applescript)).

AppleScript support was introduced in 1.3, is enabled by default, and is protected by macOS Automation/TCC permission. Ghostty explicitly labels the 1.3 API a preview and expects breaking changes and significant additions in 1.4 ([Ghostty 1.3 release notes](https://ghostty.org/docs/install/release-notes/1-3-0)). Version 1.3.1 also fixed a tab-selection activation regression, reinforcing the need to pin exact compatibility rather than assuming all 1.3 builds behave identically ([Ghostty 1.3.1 release notes](https://ghostty.org/docs/install/release-notes/1-3-1)).

## 1. What is actually addressable?

### Documented facts

A terminal pane can be a real addressable destination when the terminal/multiplexer exposes all of these:

1. an instance boundary (Ghostty application process, tmux socket/server, WezTerm socket/domain, kitty control socket, iTerm2 application connection);
2. an ID scoped to that instance;
3. a direct input path to that ID; and
4. a way to re-enumerate or read the destination before and after staging.

Ghostty 1.3.1 satisfies the first three parts directly. Its AppleScript hierarchy is `application -> windows -> tabs -> terminals`; each terminal has a stable ID; `send key ... to terminal` and `input text ... to terminal` explicitly target that object. `focus` is a separate command, so input need not be preceded by changing the selected/focused terminal. It does not satisfy read-back: the installed scripting definition has no screen-contents property or command.

tmux satisfies all four parts. Its session, window and pane IDs are `$…`, `@…`, and `%…`; within a running server they are never changed or reused. `send-keys` sends keystrokes to an exact pane, while `capture-pane -p` returns visible pane content. tmux control mode also provides asynchronous pane output and lifecycle notifications and recommends IDs instead of names or indexes ([tmux Advanced Use](https://github.com/tmux/tmux/wiki/Advanced-Use), [tmux Control Mode](https://github.com/tmux/tmux/wiki/Control-Mode)).

WezTerm also exposes a strong surface. `wezterm cli list --format json` reports window, tab, pane, workspace, title and CWD fields; `--pane-id` pins commands to a pane; `send-text` writes to it; `get-text` reads its screen; and `activate-pane` can select it ([list](https://wezterm.org/cli/cli/list.html), [send-text](https://wezterm.org/cli/cli/send-text.html), [get-text](https://wezterm.org/cli/cli/get-text.html)). The instance must also be pinned: WezTerm otherwise chooses a GUI/mux instance using `WEZTERM_UNIX_SOCKET`, `--prefer-mux`, or an automatically selected GUI, and chooses the most recently interacted pane if no ID is supplied ([WezTerm CLI targeting](https://wezterm.org/cli/cli/index.html)).

### Product inference

An “agent destination” is therefore not just `Claude Code`, a PID, or a repository. It is primarily a **control endpoint plus live surface locator**. Agent type, conversation, CWD, repository, branch and worktree are separate identity evidence attached to that locator.

The minimum stable key for the first adapter should be approximately:

```text
local user + Ghostty bundle ID + running-process generation/PID + terminal ID
```

The application-process generation matters because “stable” should be assumed to mean stable for that running Ghostty instance, not durable across application restarts. If revalidation cannot find the same Ghostty process generation and terminal ID, ScreenFling must mark the target stale. It must never fall back to `front window` or `focused terminal`. A later tmux adapter needs the equivalent server-generation guard because a new server may reuse `%0`.

## 2. Control-surface comparison

| Surface | Exact live locator | Direct input / read-back | Important constraint | Recommendation |
| --- | --- | --- | --- | --- |
| **Ghostty 1.3.1 (installed)** | Stable terminal ID scoped to running app | `send key`; `input text`; **no screen read-back** | macOS/TCC only; API is preview; no PID/TTY/process/session data | **First environment-specific MVP, dispatched/unverified** ([Ghostty AppleScript](https://ghostty.org/docs/features/applescript)) |
| **tmux (not installed)** | Stable pane ID scoped to server | `send-keys`; `capture-pane`; control-mode output | CWD/process fields are observations; raw SSH hides the remote process | **First hardening/read-back adapter** |
| **WezTerm (not installed)** | Pane ID scoped to GUI/mux instance/domain | `send-text`; `get-text`; `activate-pane` | Must pin the instance; foreground-process info is local-only | Strong later adapter |
| **kitty** | Window ID or explicit match scoped to a control socket | `send-key`/`send-text`; `get-text`; JSON `ls` | Remote control must be enabled and secured; `send-text` is documented to report success even when nothing matched | Good later adapter, never trust command exit alone ([kitty remote control](https://sw.kovidgoyal.net/kitty/remote-control/)) |
| **iTerm2** | Globally unique session ID in its Python API | `async_send_text`, `async_activate`, screen contents/streaming | macOS-only and adds an iTerm2/Python integration | Strong platform-specific adapter ([iTerm2 Session API](https://iterm2.com/python-api/session.html)) |
| **Windows Terminal** | Window/tab operations, mostly active/relative/index based | Focus/move/swap actions are documented; no equivalent documented external exact-pane text/read API | Insufficient as the sole exact-routing surface | Do not claim exact support; use tmux/WSL or a future cooperative bridge ([Windows Terminal CLI](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments)) |

This comparison favors an API already present in the user's terminal over requiring a new multiplexer solely for ScreenFling. Ghostty's targeted Apple events avoid OS-wide focus/paste races, but its lack of read-back weakens verification. The honest first result is therefore `dispatched/unverified`; tmux remains the next choice when automatic screen-text verification is required.

## 3. Discovery is evidence, not identity

### Documented facts

Ghostty 1.3.1 exposes terminal `name` and `working directory`, but its bundled scripting definition has no foreground process, PID, TTY, conversation ID, or terminal-contents field. This is a first-party schema limitation, not merely an unimplemented ScreenFling feature.

tmux can try to read `pane_current_path` from outside a pane, and exposes process/path/title/TTY fields through formats ([tmux working directories](https://github.com/tmux/tmux/wiki/Advanced-Use), [tmux formats](https://github.com/tmux/tmux/wiki/Formats)).

WezTerm's limitations are explicit:

- foreground process information is available only for local panes;
- an ordinary `ssh` process does not reveal the remote foreground process;
- Windows process discovery is heuristic;
- process queries can fail; and
- CWD prefers application-reported OSC 7 data, then falls back to OS-dependent process heuristics and can be a non-file URI ([foreground process](https://wezterm.org/config/lua/pane/get_foreground_process_info.html), [current working directory](https://wezterm.org/config/lua/pane/get_current_working_dir.html)).

Once a trustworthy local CWD exists, Git provides robust parsing primitives. `git rev-parse --show-toplevel` returns the working-tree root, and `git worktree list --porcelain -z` is explicitly stable for scripts and safely handles unusual path characters ([git rev-parse](https://git-scm.com/docs/git-rev-parse), [git worktree](https://git-scm.com/docs/git-worktree.html)).

### Product inference

None of those facts uniquely identifies a conversation:

- two Claude or Codex sessions can run in the same worktree;
- the foreground executable may be `node`, a wrapper, a shell, `ssh`, or a permission helper;
- Ghostty cannot expose that foreground executable through its 1.3.1 AppleScript API at all;
- a CWD can change after discovery;
- detached HEAD has no branch name;
- a remote shell's repo and process are not visible through a local raw-SSH pane; and
- a saved agent session ID is not generally exposed by the terminal surface.

Use confidence and provenance on every label. A user-visible target might read `Claude Code · screenfling · feature/foo`, but the routing key remains the pane. Conversation IDs should be populated only from a supported agent API, an explicit registration, or a session that ScreenFling launched and owns.

For the MVP, let users register or rename a Ghostty terminal target. Automatic detection may suggest a name from terminal title/CWD/Git, but it must not silently merge two terminals because their repo/CWD matches. The exact terminal ID is the route; the CWD is only picker copy.

## 4. Staging into Claude Code and Codex

### Claude Code: suitable for the first terminal Stage adapter

Claude Code documents `Ctrl+V`, `Cmd+V` in iTerm2, and `Alt+V` on Windows as image-paste bindings that insert an image chip into the composer. The docs also warn that terminal shortcuts vary by platform/terminal ([interactive mode](https://code.claude.com/docs/en/interactive-mode)). Since v2.1.18, the `chat:imagePaste` action can be rebound or unbound in `~/.claude/keybindings.json`, and changes apply without restart ([keybindings](https://code.claude.com/docs/en/keybindings)).

Its CLI supports `--continue`/`--resume`, and a resumed invocation with a query is a request to the agent, not a passive composer stage ([Claude CLI reference](https://code.claude.com/docs/en/cli-usage), [sessions](https://code.claude.com/docs/en/sessions)). No official external API found in this research attaches content to the composer of an arbitrary already-running terminal TUI without starting work.

**Inference:** the Ghostty-Claude adapter should resolve the exact terminal object by ID, send the configured `chat:imagePaste` key to that terminal (`send key "v" modifiers "control"` for the default), then use `input text` for the note and omit Enter. It should not call Ghostty's `focus`, because targeted input does not require it. It should read Claude's current binding when available and mark unsupported if the action is unbound. A hard-coded global keyboard shortcut is not a durable contract.

Because Ghostty 1.3.1 cannot read the composer screen, AppleScript success proves only that Ghostty accepted the input request for a live terminal object. It does not prove that Claude was idle, that the key reached `chat:imagePaste`, or that an image chip appeared. Runtime status must remain `dispatched/unverified`; the development acceptance test must add an instrumented terminal receiver and human-observed Claude checks.

### Codex: excellent managed API, less attractive as the first arbitrary-TUI Stage target

Codex's official source exposes `--image/-i` for initial interactive and non-interactive input. `codex exec resume [SESSION_ID] --image FILE PROMPT` can attach an image to a resumed non-interactive turn ([shared CLI options](https://github.com/openai/codex/blob/main/codex-rs/utils/cli/src/shared_options.rs), [exec resume CLI](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)).

The app-server is a stronger long-term integration: clients can start/resume threads by exact thread ID and call `turn/start` with text and `localImage` input, then observe typed turn/item completion events. However, `turn/start` begins generation immediately; it is a structured **Send**, not a passive Stage. It is most reliable when ScreenFling owns the app-server connection and thread lifecycle, not when trying to attach to an unrelated TUI process ([Codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)).

**Inference:** retain a terminal-keystroke Codex experiment, but do not make it the first product gate. Later add a separate `managed-codex` adapter whose capability is verified Send with exact thread events. Do not pretend that its API and an arbitrary visible Codex TUI composer are the same destination.

## 5. Recommended destination and capability contract

The roadmap's boolean capabilities are too coarse. In particular, `exactSession` conflates a pane, an agent conversation and a runtime. Model the evidence and transport separately:

```ts
type DestinationRef = {
  id: string; // ScreenFling registry UUID
  adapter: "ghostty" | "tmux" | "wezterm" | "kitty" | "iterm2" | "managed-codex";
  endpoint: {
    scope: "local" | "ssh" | "wsl" | "container";
    instanceId: string; // socket/domain/app connection + generation
    host?: string;
  };
  surface: {
    kind: "pane" | "terminal-session" | "agent-thread";
    locator: string; // pane/session/thread ID, scoped to endpoint
  };
  agent?: {
    kind: "claude-code" | "codex" | "unknown";
    sessionId?: string;
    confidence: "managed" | "registered" | "observed";
  };
  context?: {
    cwd?: string;
    repoRoot?: string;
    worktree?: string;
    branchOrHead?: string;
    observedAt: string;
  };
};

type DestinationCapabilities = {
  address: "exact" | "best-effort";
  input: Array<"clipboard-image-key" | "local-image" | "remote-file" | "text">;
  activation: "none-needed" | "surface" | "os-focus";
  readBack: "structured" | "screen-text" | "none"; // Ghostty 1.3.1: none
  verify: Array<"target-live" | "composer-ready" | "image-attached" | "turn-started" | "turn-completed">;
  actions: Array<"copy" | "stage" | "send">;
};
```

Two rules should be invariant:

1. `send` is exposed only for a structured agent API, or for an adapter with explicit, versioned proof of composer-ready, attachment-present and submit semantics.
2. An exact route that fails revalidation becomes unavailable; it never degrades to a focused or recent pane.

For Ghostty 1.3.1, the capability value is `address: "exact"`, `activation: "none-needed"`, `readBack: "none"`, `verify: ["target-live"]`, and `actions: ["copy", "stage"]`. The product-level result of that Stage is `dispatched/unverified`. This is intentionally weaker than tmux's `screen-text` read-back while still being stronger than focus-based OS automation for target selection.

## 6. Safe staging transaction

The first adapter should use this state machine:

1. **Compatibility/TCC preflight:** require Ghostty 1.3.1 plus the tested scripting schema; verify Automation permission or guide the user through the macOS prompt. If AppleScript is disabled or permission is denied, expose Copy only.
2. **Discover:** enumerate Ghostty terminal IDs and attach observed name/CWD/Git labels with confidence.
3. **Select:** user chooses an exact terminal or explicitly registered favorite.
4. **Revalidate immediately:** same running Ghostty process generation and terminal ID. Refresh name/CWD/Git labels. Never substitute the front/focused terminal.
5. **Prepare:** place the PNG on the OS clipboard. Keep it there throughout the attempt.
6. **Dispatch image:** send only the configured Claude image-paste key to that terminal object. Do not focus Ghostty or the terminal.
7. **Dispatch note:** use Ghostty `input text` with a parameterized Apple event/script argument; never interpolate user text into AppleScript source or interpret it as key names/shell syntax.
8. **Revalidate existence and report:** return `dispatched/unverified`, `failed`, or `stale-target`. Do not automatically retry because the first image may already be attached.

Ghostty 1.3.1 cannot implement automatic before/after screen verification. tmux `capture-pane`, WezTerm `get-text`, kitty `get-text`, and iTerm2 screen APIs can add read-back later, though even terminal text is not a formal composer state API. This is why the Ghostty MVP is Stage-only, visibly marked unverified, and why Send must wait for a structured agent integration or a future Ghostty API that can prove composer/attachment state.

Clipboard policy for the MVP should be simple: **leave the capture on the clipboard after success or failure.** Restoring earlier clipboard data makes retry harder and can overwrite clipboard changes the user made during staging. A later native clipboard lease may restore only when the pasteboard generation still matches ScreenFling's write; Electron-only “read then blindly restore” is not safe enough.

## 7. Remote SSH delivery and cleanup

### Documented facts

An ordinary SSH pane does not make the local graphical clipboard available to the remote agent process. WezTerm also cannot inspect the foreground process behind a raw `ssh` client. WezTerm's SSH mux domains are different: they run a compatible WezTerm multiplexer on the remote host and expose a named domain, but that still does not make a local clipboard image a native attachment in an arbitrary remote agent TUI ([WezTerm multiplexing](https://wezterm.org/multiplexing.html)).

OpenSSH `scp` now uses SFTP over SSH by default and therefore shares the authentication and transport security of an SSH login ([OpenSSH scp](https://man.openbsd.org/scp.1)). Secure temporary creation should use an atomic temporary file/directory facility; `mkstemp` creates owner-only files and `mkdtemp` owner-only directories, avoiding predictable-name races ([OpenBSD mktemp](https://man.openbsd.org/mkstemp)).

### Product inference and proposed protocol

Remote support should be its own capability, not a fallback hidden inside `image: true`:

1. create a local owner-only temp directory and PNG;
2. connect to the exact configured SSH endpoint;
3. create an owner-only remote temp directory and record its absolute path;
4. transfer through SFTP using argument/API fields, never a shell-concatenated user path;
5. verify remote size, and hash when inexpensive;
6. stage a literal remote path plus note, or use a structured remote agent API that accepts a local image path on that host;
7. retain a cleanup lease until confirmed consumption or expiry;
8. remove remote then local artifacts, and retry orphan cleanup on next startup/connection.

This is not equivalent to a local native image chip. For an arbitrary live remote TUI, staging a path only proves that the file exists and the composer references it; the agent has not consumed it until the user submits. Therefore cleanup cannot run immediately after Stage. Use a durable manifest containing endpoint ID, remote path, created time, target ID and cleanup state. Clean after structured turn completion where available; otherwise use a visible TTL (for example 24 hours), cleanup on next connection, and a manual “clean now” action.

Remote acceptance should come later because it combines routing, file transport, host trust, path quoting, lifecycle recovery and agent-specific consumption semantics. A failed cleanup is a privacy defect, not just disk litter.

## 8. Revised milestone sequence

### Milestone 0 — routing feasibility gate

Use a fixed PNG already on the clipboard. Build a tiny Ghostty 1.3.1 adapter/harness that:

- preflights Ghostty version/schema and macOS Automation permission;
- enumerates local terminals by application-process generation and stable terminal ID;
- lets the developer choose one of two targets without focusing either;
- sends the image-paste key plus parameterized literal note without Enter;
- automatically proves byte-level target isolation with an instrumented receiver running in each terminal; and
- refuses a stale/closed target rather than substituting the focused terminal.

Then repeat the path against two real Claude Code composers and visually confirm the image chips/notes. This split is necessary: the receiver can prove exact Ghostty routing automatically, while Ghostty's current API cannot automatically prove Claude composer state.

### Milestone 1 — first useful product slice

```text
global shortcut -> region capture -> optional note -> exact Ghostty target -> dispatched/unverified Stage
```

Scope: macOS, installed Ghostty **1.3.1** with the tested scripting schema, local same-user terminals, one tested Claude Code version range, required TCC Automation permission, no SSH, no automatic submit, and no generic OS focus automation. “Clipboard only” remains the failure fallback. The UI must say that the stage is unverified.

### Milestone 2 — identity and a second surface

Add registered favorite targets, confidence-bearing CWD/Git/worktree labels, stale-target handling, and a tmux adapter with `capture-pane` read-back. Keep labels and locators separate. WezTerm remains a later option if it becomes part of the user's environment.

### Milestone 3 — managed agent adapters

Launch/own Codex app-server threads and expose structured exact-session Send with local-image input and typed completion. Investigate an equivalent supported Claude Agent SDK ownership model. Present these as managed sessions, not as control of arbitrary pre-existing TUIs.

### Milestone 4 — platform expansion

Add kitty and/or iTerm2 based on user demand. On Windows, prefer a proven multiplexer/cooperative bridge until Windows Terminal exposes sufficient exact external control. Add OS focus/accessibility automation only for adapters that cannot offer direct control, with weaker capabilities shown honestly.

### Milestone 5 — remote

Implement SFTP temp leases and one agent-specific consumption path. Do not start with universal raw-SSH discovery.

## 9. Ghostty 1.3.1 Stage-only acceptance criteria

The first slice is ready only if all of these pass on the pinned Ghostty scripting schema and tested Claude Code version range:

1. **Compatibility gate:** Ghostty must report version 1.3.1 and the expected scripting capabilities. Unknown versions/schema mismatches disable Stage by default rather than guessing. A developer override may exist only behind an explicit experimental flag.
2. **Permission gate:** first-run onboarding explains the macOS Automation request. Denied TCC permission or `macos-applescript = false` produces a clear Copy-only fallback and does not repeatedly prompt.
3. **Exact enumeration:** two simultaneous Ghostty terminals can be listed by distinct stable IDs even when their titles/CWDs are identical. The picker does not merge them.
4. **Automated isolation:** with an instrumented byte receiver in two terminals, 100 alternating image-key-plus-note dispatches modify only the selected receiver. **Wrong-target count is zero**, notes arrive exactly once, and no Enter event is present.
5. **Human-observed Claude path:** across at least 30 alternating stages into two real idle Claude Code composers, each selected composer receives exactly one image chip and the exact note; the other composer never changes; nothing is submitted.
6. **No focus theft:** dispatch does not call Ghostty `focus`, `activate window`, or `select tab`; the active application/window/terminal remains unchanged during automated isolation tests.
7. **Stale refusal:** closing a selected terminal or restarting Ghostty invalidates the stored route. ScreenFling refuses it and never substitutes `front window`, `selected tab`, or `focused terminal`.
8. **Binding safety:** a remapped or unbound Claude `chat:imagePaste` action is detected or produces a clear unsupported result, not a guessed keypress.
9. **Literal-data safety:** notes containing quotes, backslashes, newlines, Unicode, AppleScript-looking text, and terminal key names are passed as data through script arguments/Apple events, never interpolated as AppleScript, keys, or shell input.
10. **Honest status:** after a successful Apple event, ScreenFling reports `dispatched/unverified`, never `verified`, and never retries automatically. A user can manually retry from the preserved clipboard.
11. **Failure fallback:** the PNG remains on the clipboard after every failure or uncertain result so manual paste is available.
12. **Privacy:** capture/routing logs contain version, schema hash, terminal ID, status and timing but never screenshot bytes or note contents by default.

Because Ghostty has no read-back, the human-observed criterion is a release test, not a runtime guarantee. If automatic proof of attachment is required for the MVP definition, Ghostty 1.3.1 alone cannot meet it; add tmux read-back or wait for a richer Ghostty scripting API. Latency remains secondary to zero wrong-target routing and safe refusal.

## 10. Main risks and mitigations

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Ghostty terminal ID observed after an app restart | Wrong target | Include application-process generation and revalidate; never front/focus fallback |
| Ghostty AppleScript preview API changes | Broken or misdirected staging after update | Pin 1.3.1/schema hash; runtime capability check; default unknown versions to Copy only |
| TCC permission denied/reset or AppleScript disabled | Stage fails or prompts unexpectedly | Explicit onboarding/preflight; signed release identity; clear Copy-only fallback |
| No Ghostty screen/process/PID/TTY read-back | Cannot prove agent/composer/attachment | Report `dispatched/unverified`; receiver tests + human release tests; add tmux/managed adapter for stronger proof |
| CWD/terminal title misclassified | Misleading picker label | Record provenance/confidence; allow explicit names; route by terminal ID |
| Agent keybinding/version changes | Missing or malformed stage | Versioned adapter tests; inspect Claude keybindings; unsupported state |
| Agent is busy or a dialog is open | Input enters an unintended TUI state | Stage-only; no Enter; explicit user selection; managed/read-back adapters before Send |
| User changes focus during operation | Wrong target under focus-based automation | Use targeted Ghostty terminal object; never send to focused/front surface |
| Apple event accepted but attachment failed | Duplicate retry or false success | Return `dispatched/unverified`; preserve clipboard; never auto-retry |
| Raw SSH hides agent/CWD and has no local clipboard | Wrong remote identity or unusable image | Registered remote target + SFTP lease + agent-specific path/API |
| Temp cleanup runs too early or never | Agent cannot read image, or sensitive artifact remains | Consumption-aware lease, visible TTL, startup cleanup, manual cleanup |

## Bottom line

The roadmap's thesis is feasible if ScreenFling treats a destination as a versioned control contract, not as an app name. On the actual development machine, prove this local route first:

```text
Ghostty 1.3.1 process + stable terminal ID
-> targeted Ctrl+V image action
-> targeted paste-style note
-> no focus and no Enter
-> dispatched/unverified
```

This is a better first test than installing tmux solely for the prototype. It proves exact target isolation with the tools the user already runs. It does **not** prove the attachment at runtime, so the UI and milestone language must not say “verified Stage.” Add tmux next if screen-text read-back is required, or move directly to a managed agent API when verified Send becomes the goal.

The key architectural choice is to maintain two honest adapter families:

- **surface adapters** for staging into exact existing terminal surfaces, with capability-accurate verification (`none` for Ghostty 1.3.1, screen text for tmux/WezTerm) and no automatic Send; and
- **managed-agent adapters** for exact thread/session APIs, structured image input, lifecycle events and eventually verified Send.

Trying to force both through “focus app and press paste” would erase the safety boundary that makes ScreenFling valuable.

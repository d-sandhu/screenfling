# ScreenFling feasibility and execution plan

Research date: 2026-08-19

Status: Superseded execution proposal. Its machine-specific first-adapter choice
has been replaced by [the roadmap's evidence-based routing gate](../ROADMAP.md#gate-b-exact-routing-harness).
Its feasibility findings and acceptance tests remain supporting evidence.

This document was the first synthesis of Context7 research, current first-party
documentation, the two detailed reports in this directory, and the tools present
on the initial research machine.

Detailed evidence:

- [Capture and platform feasibility](./capture-platform-feasibility.md)
- [Routing and staging feasibility](./routing-and-staging-feasibility.md)

## Historical proposal

> **Superseded:** this section records a locally executable proposal from the
> research date. It is not a current Ghostty or Claude Code product commitment.

**Build ScreenFling, but make the first product slice macOS + Ghostty + one explicitly selected local Claude Code or Codex terminal.**

Electron and TypeScript can implement the capture, crop, clipboard, overlay, shortcut, target picker, and subprocess coordination needed for that slice. Ghostty 1.3.1 is installed on the initial developer machine and its macOS AppleScript API exposes stable terminal IDs, names, working directories, exact focus, paste-style text input, and targeted key injection. That makes an exact-terminal Stage workflow possible without Rust, OS-wide synthetic input, tmux, or WezTerm.

The first slice should be:

```text
global shortcut
-> snapshot the display under the pointer
-> select one region on that display
-> add an optional single-line note
-> choose an exact Ghostty terminal
-> stage image + note without Enter
-> remain in the current app; offer an explicit Reveal action
```

This is an honest **Stage**, not verified delivery and never automatic Send. Ghostty can address the exact terminal without focusing it, but its current AppleScript dictionary does not expose terminal screen read-back, foreground process identity, or an agent conversation ID. An adapter can prove that it targeted a live terminal and that Ghostty accepted its commands; it cannot prove structurally that Claude or Codex attached the image.

Before product UI work, run two disposable feasibility spikes:

1. full-resolution Electron capture, crop, and clipboard performance/pixel accuracy;
2. exact Ghostty terminal selection and Stage-only image/note injection.

Proceed to the alpha only if both gates pass. This tests the uncertain handoff before investing in browser context, remote transfer, native helpers, or broad platform support.

## Concise feasibility map

| Capability | Decision now | Why |
| --- | --- | --- |
| macOS region capture | **Build now** | Electron exposes screen sources, displays, image crop, clipboard, shortcuts, and overlay windows. |
| Exact Ghostty terminal selection | **Build now** | Ghostty 1.3.1 exposes stable terminal IDs and targeted input through AppleScript. |
| Claude Code/Codex image staging | **Spike both; support only passing versions** | Both accept clipboard images through target-specific bindings; the bindings are not universal OS paste semantics. |
| Optional note | **Build now, single line** | Ghostty has targeted paste-style text input; restricting control characters protects Stage-only behavior. |
| Windows capture | **Technically viable, next platform** | Electron supports the required primitives; mixed-DPI and packaging need a separate acceptance run. |
| tmux/WezTerm adapters | **Good next adapters** | Both have exact pane addressing and read-back; neither is installed on the initial machine. |
| Exact agent/conversation discovery | **Label only for now** | Terminal, CWD, repo, process, and conversation are different identities. Existing TUIs do not expose a universal thread locator. |
| Verified Stage in Ghostty | **Not currently available** | The AppleScript API lacks composer state and screen read-back. Report `dispatched/unverified` and offer manual Reveal. |
| Managed Codex Send | **Later, separate adapter** | Codex app-server accepts exact thread and `localImage` input, but `turn/start` starts generation; it is Send, not passive Stage. |
| Linux/X11 capture | **Experimental later** | Likely feasible, but desktop/window-manager variability needs its own test matrix. |
| Native Wayland parity | **Do not promise** | Wayland blocks global cursor/window positioning and PipeWire uses portal-selected capture; Rust cannot portably bypass policy. |
| Raw SSH image staging | **Defer** | It requires secure transfer, remote leases, consumption-aware cleanup, and explicit endpoint identity. |
| Browser/desktop chat adapters | **Defer** | They require separate browser/native accessibility contracts and permission surfaces. |
| Automatic Send to arbitrary apps | **Do not build** | Focus, composer, attachment, and submission cannot be verified generically. |
| Rust helper | **Not justified yet** | No first-slice capability requires it. Add native code only after a measured API or performance failure. |

## What Context7 established

Context7 was queried first, using high-reputation project IDs:

- Electron: `/electron/electron`
- tmux: `/tmux/tmux`
- WezTerm: `/websites/wezterm`
- Codex: `/openai/codex`

The Electron results establish that [`desktopCapturer.getSources`](https://www.electronjs.org/docs/latest/api/desktop-capturer) returns screen/window sources and `NativeImage` thumbnails, [`screen`](https://www.electronjs.org/docs/latest/api/screen) provides displays and DIP geometry, [`NativeImage`](https://www.electronjs.org/docs/latest/api/native-image) can crop images, [`clipboard.writeImage`](https://www.electronjs.org/docs/latest/api/clipboard) can write the result, and [`globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut) can initiate the flow.

Context7 also surfaced important limits that were checked against current first-party docs:

- returned capture image dimensions must be measured rather than inferred from the requested thumbnail size;
- PipeWire capture returns only one portal-selected source on Linux;
- Wayland does not generally permit programmatic global positioning/focus/blur and does not support Electron's global cursor query;
- a clipboard write does not prove that a destination accepted an image;
- renderers should remain sandboxed and context-isolated with a narrow IPC bridge.

One freshness discrepancy matters: Context7 returned older guidance for enabling Electron's Wayland global-shortcut portal with a feature flag. Current Electron documentation says the portal path is enabled by default and depends on a valid installed desktop identity. Version-pinned documentation and packaged-app tests should control over an unversioned summary.

## Local-environment finding: Ghostty changes the first adapter

The initial machine currently has:

```text
Ghostty.app 1.3.1
Codex CLI
Claude Code
```

tmux and WezTerm are not currently on `PATH`.

Ghostty's bundled scripting definition and [official AppleScript documentation](https://ghostty.org/docs/features/applescript) expose:

- `terminal.id`: described as a stable terminal-surface ID;
- `terminal.name`;
- `terminal.working directory`;
- `focus terminal`;
- `input text ... to terminal`;
- `send key ... modifiers ... to terminal`.

AppleScript automation is enabled by default on macOS and protected by macOS Automation permission. Ghostty introduced the surface in 1.3 and labels it preview-quality, so ScreenFling should require a tested version/schema and keep the adapter small and replaceable. Unknown versions should fall back to Copy unless the user explicitly enables experimental compatibility.

The API does **not** currently expose enough information to prove:

- the foreground child is Claude Code or Codex;
- a particular agent conversation owns the terminal;
- the composer is idle and ready;
- an image chip appeared; or
- the staged note is visible.

Therefore the first target ID should be ephemeral: re-enumerate a Ghostty terminal ID immediately before staging and never silently fall back to the frontmost terminal. Do not persist a terminal ID across Ghostty restarts until its instance scoping/reuse behavior is tested.

## First-slice product contract

### Supported environment

- macOS;
- packaged ScreenFling build with a stable bundle identity;
- Ghostty 1.3.1 initially, expanded only after compatibility tests;
- one tested Claude Code range and one tested Codex CLI range;
- local same-user terminals;
- one-display region selection;
- single capture, single-line note, Stage only.

### User-visible behavior

1. A configurable shortcut begins capture or shows an actionable shortcut-conflict error.
2. ScreenFling snapshots the display under the pointer before showing its overlay.
3. The overlay presents a frozen scene and confines selection to that display.
4. Releasing the selection creates an in-memory PNG and puts it on the image clipboard.
5. The picker lists live Ghostty terminals using terminal name and working directory. Repository/worktree labels may be added only when derived from a current local CWD and must be presented as labels, not routing keys.
6. The user chooses the agent binding for the target (`Claude Code`, `Codex`, or explicitly configured custom binding). Do not silently infer it from the repo alone.
7. ScreenFling revalidates the exact terminal ID, sends the configured image-paste key directly to that terminal, and inserts a sanitized single-line note as paste-style text. It never sends Enter.
8. The automated path does not focus Ghostty. Its result notification offers an explicit Reveal action for review because attachment state is not machine-verifiable in the first Ghostty adapter.
9. The result is reported as `dispatched/unverified`, `failed`, or `cancelled`; never `delivered` or `verified`.
10. The capture remains on the clipboard on success or failure, providing a manual fallback.

### Input safety

The MVP note must be one line of printable text with C0 control characters removed. Newlines are rejected or normalized before dispatch. Multiline input is deferred until the adapter proves that every supported destination treats it as inert bracketed paste and cannot submit or execute it. Image/note ordering and any required inter-input delay must be pinned by the compatibility test rather than assumed to be identical across agent versions.

### Explicitly out of scope

- automatic Enter/Send;
- arbitrary active-window paste;
- automatic conversation-ID discovery;
- screenshot history or database;
- permanent screenshots;
- cross-display selections;
- Windows/Linux in the same first branch;
- SSH, WSL, containers, browser context, web chat, desktop chat;
- native helper and generalized plugin framework.

## Architecture that is deep enough, but no deeper

Keep one application package. The important seams are responsibilities, not packages.

```text
Electron main process
  CaptureCoordinator      explicit workflow state machine
  CaptureBackend          Electron still capture; alternative first-frame backend only if measured
  DisplayMapper           display-local DIP -> measured image pixels
  ClipboardService        write/readback sanity check
  DestinationRegistry     live ephemeral targets + user-visible labels
  GhosttyAdapter          enumerate, revalidate, dispatch, optional reveal
  PermissionService       Screen Recording + Automation guidance
  Diagnostics             local timings/status only; never image/note content

Sandboxed renderers
  CaptureOverlay          frozen snapshot + selection only
  NoteAndTargetPicker     note + exact destination choice only
```

All privileged work belongs in the main process. Renderers load bundled local content, use `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, a restrictive CSP, and narrowly typed IPC methods. Electron's current [security checklist](https://www.electronjs.org/docs/latest/tutorial/security) additionally requires sender validation, denied navigation/window creation, and current framework releases.

Run Ghostty automation through a bundled script and Node's argument-array subprocess API, not shell-concatenated AppleScript. Pass terminal IDs and notes as data, cap output, enforce a timeout, and treat any target disappearance as a stale-target failure.

### Core state machine

```text
idle
-> snapshotting
-> selecting
-> editing
-> targetSelected
-> revalidating
-> writingClipboard
-> stagingImage
-> stagingNote
-> dispatchedUnverified
-> idle

any active state
-> cancelled | permissionBlocked | failed
-> idle
```

Every renderer message carries a generated operation ID. A stale message, invalid state transition, dead terminal, invalid coordinate, or second shortcut while active is rejected.

### Destination contract

Do not keep the roadmap's destination capabilities as undifferentiated booleans. Separate address, evidence, transport, verification, and allowed action:

```ts
type Destination = {
  id: string;
  adapter: "ghostty" | "tmux" | "wezterm" | "managed-codex";
  endpoint: {
    scope: "local" | "ssh" | "wsl" | "container";
    instanceId: string;
  };
  surface: {
    kind: "terminal" | "pane" | "agent-thread";
    locator: string;
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
  capabilities: {
    address: "exact" | "best-effort";
    imageInput: "clipboard-key" | "local-file" | "remote-file" | "none";
    textInput: "paste" | "structured" | "none";
    readBack: "structured" | "screen-text" | "none";
    verification: Array<"target-live" | "composer-ready" | "image-attached" | "turn-completed">;
    actions: Array<"copy" | "stage" | "send">;
  };
};
```

The first Ghostty destination is `address: exact`, `imageInput: clipboard-key`, `textInput: paste`, `readBack: none`, `verification: [target-live]`, and `actions: [copy, stage]`. Its successful runtime result is still only `dispatched/unverified`.

## Two feasibility gates before the alpha

### Gate A — capture spike

Build a developer-only harness, not product UI:

1. snapshot one macOS Retina display with `desktopCapturer.getSources` at full physical size;
2. record actual returned image dimensions;
3. map a display-local DIP rectangle to pixels using measured width/height ratios;
4. crop and write to the clipboard;
5. verify against an on-screen pixel grid;
6. repeat with multiple displays, negative origins, mixed scale factors, rotation, sleep/wake, and display reconnect;
7. measure snapshot, overlay-ready, crop, and clipboard time separately.

Pass conditions:

- selected pixels are correct within one physical pixel at every edge;
- no overlay appears in the result because capture precedes overlay;
- warm shortcut to interactive overlay reaches p95 <= 150 ms on the baseline Mac, or there is a measured plan to close the gap;
- release to clipboard reaches p95 <= 150 ms;
- cancel and every failure path leave the clipboard unchanged;
- 200 capture/cancel cycles show no monotonic image/window/listener growth.

If full-size source thumbnails are too slow or degraded, compare a first-frame display-media backend. Consider native ScreenCaptureKit only if both measured Electron approaches fail the agreed target.

### Gate B — Ghostty staging spike

Start with a fixed image already on the clipboard:

1. enumerate two live Ghostty terminals and their stable IDs;
2. present their names and CWDs;
3. select one exact ID;
4. revalidate it;
5. stage the configured image-paste key and a printable single-line note directly to it;
6. confirm that focus does not change, while providing a separate user-triggered Reveal action;
7. never send Enter;
8. repeat with both installed agents, but support only the agent/version combinations that pass the compatibility gate.

Pass conditions:

- an instrumented byte receiver records 100 alternating dispatches across two terminals with zero wrong-target events, no Enter, and exact note bytes, including when CWDs are identical;
- 30 human-observed stages across two idle composers for each candidate supported agent/version produce exactly one image attachment and one exact note in the selected composer, with zero changes to the other composer;
- closing/replacing the selected terminal produces a stale-target refusal;
- a denied Automation permission produces actionable guidance and no fallback paste;
- notes containing quotes, backslashes, Unicode, and key-like words remain inert data, while newlines/control characters are rejected or normalized;
- a remapped/unbound image-paste binding is configurable or produces an unsupported result;
- uncertainty never causes an automatic retry or duplicate attachment;
- the clipboard remains usable for manual paste after every failure.

Because Ghostty has no read-back, attachment checks in this spike are observed/test-harness assertions. The shipped adapter must continue to report `dispatched/unverified`.

## Revised milestone sequence

### Milestone 0 — two proof spikes

Prove Electron capture and Ghostty exact-terminal Stage independently. Throw away spike UI; retain measurements, fixtures, and adapter tests.

### Milestone 1 — first useful alpha

Ship the narrow macOS flow from shortcut through exact Ghostty Stage. Include permission onboarding, safe cancellation, an explicit Reveal action, no automatic focus theft, clipboard fallback, packaged-app testing, and local diagnostics.

At the time, this proposal would have replaced the earlier capture-only product milestone. The current roadmap instead defines independent capture and routing gates followed by one complete alpha workflow.

### Milestone 2 — harden identity and add one stronger surface

Add explicitly named favorite targets and confidence-bearing repo/worktree labels. Add tmux or WezTerm based on real demand; both offer screen read-back and stronger verification than Ghostty. Never route by CWD/repo alone and never fall back to an active pane.

### Milestone 3 — second desktop platform

Port capture and at least one exact/cooperative terminal adapter to Windows. Keep Linux/X11 experimental and give Wayland a separate portal/system-picker capability instead of claiming parity.

### Milestone 4 — managed agent sessions

Add a managed Codex app-server adapter when ScreenFling owns the thread lifecycle. This can support exact thread IDs, structured local-image input, and typed completion events. Present it as verified Send, not staging into an arbitrary existing TUI.

### Milestone 5 — choose from usage

Choose browser context, multi-capture tasks, or remote delivery using observed demand. Remote requires owner-only temp files, SFTP, explicit endpoint identity, a durable cleanup lease, and cleanup after confirmed consumption or visible TTL expiry.

### Milestone 6 — verified Send and broader adapters

Enable Send only for versioned adapters that prove target, composer, attachment, submit semantics, and completion. Generic applications remain Copy or unverified Stage.

## Roadmap edits this research supports

No roadmap file has been changed yet. A careful revision should:

1. distinguish engineering slices from user-valued milestones;
2. make macOS + Ghostty the initial product contract;
3. move one exact route into the first product milestone;
4. explicitly call Ghostty Stage unverified and offer user-triggered target reveal;
5. replace boolean destination capabilities with evidence/transport/action levels;
6. constrain initial capture to one display;
7. define macOS Screen Recording and Automation onboarding as milestone work;
8. move Windows to the next platform milestone and separate Wayland's capability level;
9. defer Rust until a benchmark or missing OS API justifies it;
10. defer remote, browser context, and Send until the local vertical slice demonstrates repeated value.

## Product validation gate

Passing technical tests is necessary but not sufficient. Before expanding scope, use the alpha for real work and compare it against the native screenshot + manual paste baseline.

Record locally, without screenshot or note contents:

- end-to-end time from shortcut to reviewable composer;
- capture failures and reasons;
- stale/failed/uncertain Stage rate;
- wrong-target count, which must remain zero;
- manual clipboard fallback rate;
- repeat use across several working days.

If the end-to-end flow is not meaningfully faster or more dependable than the OS shortcut plus manual paste, improve or reconsider routing before adding platforms and adapters.

## Final recommendation

The roadmap's core thesis is feasible. The disciplined path is not “build a screenshot utility, then eventually route it,” and it is not “solve every terminal and OS first.” It is:

```text
prove capture
+ prove one exact local route
-> ship one narrow end-to-end alpha
-> measure whether the handoff is genuinely better
-> generalize only the parts that survive contact with use
```

For this machine and this moment, Ghostty's new AppleScript surface is the shortest route to that proof. Electron remains the correct shell. Rust, SSH, browser extensions, universal discovery, and automatic Send remain outside the first proof.

# ScreenFling Roadmap

**Capture what you see. Send it to the right coding agent. Keep working.**

This document is the working product and engineering roadmap for ScreenFling. It is intended to make the project understandable without relying on prior chat context.

ScreenFling is an open-source, cross-platform desktop tool for capturing visual context and routing it to the correct AI coding agent or chat session with as little friction as possible.

## Product goal

The core problem is not taking a screenshot. Operating systems and AI tools already do that well.

The problem is the handoff:

1. Notice a visual issue.
2. Capture the right region, window, page, or element.
3. Add only the context that matters.
4. Identify the correct agent, project, worktree, terminal pane, browser chat, or desktop conversation.
5. Deliver the image and note in the format that destination expects.
6. Keep working without managing screenshot files or repeatedly switching windows.

The long-term product should feel like this:

```text
capture -> add context -> choose destination -> stage or send
```

The user should not have to care whether the destination requires a native clipboard image paste, a browser attachment, a local file, or a temporary remote file transfer.

## Product principles

### Clipboard-first

Captures should behave like clipboard content, not like files the user must manage.

For local destinations that support image paste, ScreenFling should put image data on the operating-system clipboard and use the destination's native paste behavior.

Files should be created only when required by a destination, such as a remote CLI session. Those files should be ephemeral and cleaned up automatically.

Permanent saving should be optional.

### Local-first

The core workflow should require:

- no ScreenFling account;
- no hosted backend;
- no cloud image service;
- no telemetry by default.

Sensitive screenshots should stay on the user's machine unless the selected destination itself sends them elsewhere.

### Cross-platform

macOS, Windows, and Linux are product targets.

Cross-platform does not mean pretending every operating system provides identical capabilities. ScreenFling should detect what the current platform and destination can safely support and expose only those actions.

### Stage by default

There are three delivery levels:

- **Copy** — prepare the capture and place it on the clipboard.
- **Stage** — place the capture and note into the selected destination, but do not submit.
- **Send** — stage and submit.

Stage should be the normal automated workflow.

Send should only be enabled for adapters that can reliably identify the intended destination, verify the composer or input state, and know the destination-specific submit behavior.

### TypeScript-first, native where justified

Most of ScreenFling should be written in TypeScript.

Native code should exist only where Electron and standard Node.js APIs cannot reliably provide the required operating-system integration.

The planned native helper is Rust, initially focused on precise desktop UI automation such as macOS Accessibility and Windows UI Automation.

### Small vertical slices

Each implementation branch should prove one user-visible capability end to end.

Avoid building generalized adapter systems, plugin frameworks, cloud services, or other abstractions before a real use case requires them.

## Planned technical direction

The current direction is:

- **TypeScript** as the primary language;
- **Electron** for the cross-platform desktop shell and system integration already exposed by Electron;
- **React** for small desktop UI surfaces such as capture overlays, previews, target selection, history, and settings;
- **Node.js** in the Electron main process for file, process, terminal, SSH, and local IPC work;
- **Rust** as a small standalone native helper only for operating-system automation that cannot be implemented reliably through Electron;
- **Chromium extension** later for browser-specific context such as URL, viewport, selected DOM element, and full-page capture;
- **GitHub Actions** for cross-platform validation and release automation.

The initial repository should stay simple. Do not split the code into many packages until there are multiple real responsibilities that benefit from separation.

## Delivery strategies

ScreenFling should hide destination-specific paste behavior from the user.

Examples:

### Claude Code, local

Use the image clipboard and Claude Code's native image-paste shortcut.

Current expected behavior:

- macOS/Linux: `Ctrl+V` for image paste;
- Windows: `Alt+V` for image paste.

### Codex CLI, local

Use the image clipboard and Codex's native image-paste behavior, currently `Ctrl+V`.

### Browser and desktop chat composers

Use the operating system's normal graphical paste behavior when supported:

- macOS: typically `Cmd+V`;
- Windows/Linux: typically `Ctrl+V`.

A tested browser or desktop adapter may eventually attach the image directly rather than synthesizing a paste.

### Remote CLI sessions

A local clipboard generally cannot be read by a process running over SSH or another remote boundary.

For those destinations ScreenFling may:

1. materialize the capture as a temporary local file;
2. copy it to an ephemeral remote path;
3. insert or reference that remote image in the target agent session;
4. clean up the temporary files later.

The user should not need to manage those files manually.

## Destination capabilities

Adapters should expose capabilities rather than pretending every target supports every action.

Conceptually:

```ts
type DestinationCapabilities = {
  activate: boolean;
  exactSession: boolean;
  image: boolean;
  text: boolean;
  filePath: boolean;
  verifyAttachment: boolean;
  submit: boolean;
};
```

The UI should use those capabilities to decide whether the destination supports Copy, Stage, or Send.

## Milestone 1 — capture to clipboard

**Goal:** prove that ScreenFling can capture visual content quickly and reliably without adding routing complexity yet.

User flow:

```text
launch ScreenFling
-> press global shortcut
-> drag a region
-> release
-> PNG is available on the operating-system clipboard
-> paste manually into an image-capable destination
```

Scope:

- Electron + TypeScript application scaffold;
- background/tray application lifecycle as needed;
- global capture shortcut;
- region selection overlay;
- cancel with `Esc`;
- capture selected pixels;
- place PNG on the image clipboard;
- return to idle cleanly;
- no permanent screenshot saving by default.

Explicitly out of scope:

- destination picker;
- agent detection;
- automatic paste;
- automatic submit;
- Rust/native helper;
- browser extension;
- SSH;
- cloud backend;
- screenshot history beyond what is strictly needed to debug the capture flow.

Success criteria:

1. Capture works repeatedly without leaking windows or slowing down.
2. The resulting image can be manually pasted into Claude Code, Codex CLI, and normal graphical image inputs on supported local environments.
3. `Esc` cancels without modifying the clipboard.
4. Capture does not permanently save screenshots unless explicitly requested in a future feature.
5. The interaction feels close to the speed of the operating system's built-in screenshot tool.

Performance targets should be measured, not claimed before profiling. Initial targets:

- warm shortcut to visible selection UI: under 100 ms p95;
- selection release to clipboard-ready image: under 200–250 ms p95;
- idle CPU near zero;
- no sustained memory growth across repeated captures.

## Milestone 2 — destination picker and simple staging

**Goal:** prove the product's real differentiator: routing the capture instead of merely creating it.

User flow:

```text
capture
-> small target chooser
-> choose destination
-> ScreenFling stages the image there
```

Start with a small set of local destinations. Do not attempt universal agent discovery yet.

Potential initial targets:

- Clipboard only;
- Claude Code;
- Codex CLI;
- a known terminal target such as tmux or WezTerm if it provides a reliable addressing mechanism.

ScreenFling should use each destination's native image-paste method instead of pasting a file path when the destination supports image clipboard input.

Success criteria:

1. The correct selected target receives the image.
2. No destination is submitted automatically.
3. Failure leaves the user with the image still available on the clipboard.
4. Routing behavior is adapter-specific but the user experience is consistent.

## Milestone 3 — exact coding-agent sessions

**Goal:** route to a specific live development context, not merely an application.

A target should eventually be able to show useful identity such as:

```text
Codex
half-it
daily-social worktree
```

or:

```text
Claude Code
treasuretrash
main
```

Possible session sources:

- tmux panes;
- WezTerm panes;
- known terminal processes;
- explicitly named targets;
- later, sessions launched and managed through ScreenFling.

Useful metadata may include:

- agent type;
- process ID;
- working directory;
- Git repository;
- branch/worktree;
- local or remote environment.

Do not build a terminal emulator as part of this milestone. Prefer mature terminal control surfaces and existing PTY libraries where needed.

Success criteria:

1. Multiple simultaneous agent sessions can be distinguished.
2. A capture consistently reaches the chosen session.
3. Project and branch/worktree labels are accurate enough to reduce target-selection mistakes.

## Milestone 4 — remote development

**Goal:** make local visual capture work with agents running in remote environments.

Potential environments:

- SSH;
- WSL;
- remote VPS or workstation;
- dev containers where clipboard access is unavailable.

Typical strategy:

```text
local capture
-> ephemeral file
-> secure transfer
-> remote temp path
-> target session
-> automatic cleanup
```

Success criteria:

1. No public upload is required.
2. Paths with spaces and unusual filenames are handled safely.
3. Temporary local and remote artifacts have documented cleanup behavior.
4. The remote workflow remains close to the local workflow from the user's perspective.

## Milestone 5 — browser visual context

**Goal:** send more useful debugging context than a raw screenshot.

Add a Chromium extension only after the basic ScreenFling workflow is proven.

Potential browser capture modes:

- visible viewport;
- selected element;
- full page;
- current clipboard image.

Potential context fields:

- current URL;
- viewport dimensions;
- device pixel ratio;
- selected element selector;
- element bounding box;
- small DOM fragment;
- relevant computed styles.

Console and network collection should not be added automatically if it requires broad browser permissions. Add it only if user value justifies the additional permission surface.

Success criteria:

1. The browser extension materially improves an agent's ability to identify a visual UI problem.
2. Permissions remain narrow and documented.
3. Browser context is packaged consistently with normal ScreenFling captures.

## Milestone 6 — web and desktop chat adapters

**Goal:** make ScreenFling useful outside terminal coding agents without losing the routing model.

Potential targets:

- ChatGPT web;
- Claude web;
- supported desktop AI applications;
- generic image-capable applications.

Generic fallback:

```text
image clipboard -> activate target -> normal paste
```

More advanced adapters may use browser integration or native accessibility when that provides a significantly more reliable target.

This is the point where the small Rust native helper may become justified.

Likely native responsibilities:

- application/window enumeration beyond Electron's needs;
- precise UI element discovery;
- focusing a known composer;
- invoking supported accessibility actions;
- determining whether a target can support verified staging or submission.

The native helper should remain a separate process with a small request/response protocol instead of embedding product logic in Rust.

## Milestone 7 — verified Send

**Goal:** optionally submit captures without creating a dangerous global "press Enter" feature.

Send must be destination-specific.

Enable Send only when ScreenFling can reliably establish:

1. the correct destination is active;
2. the correct conversation/session is selected;
3. the intended composer/input is targeted;
4. the image attachment or native image paste succeeded where verification is possible;
5. the destination's submit action is known and tested.

Unknown or generic destinations should remain Copy- or Stage-only.

## Milestone 8 — multi-capture visual tasks

**Goal:** allow a developer to send a complete visual problem rather than a series of disconnected screenshots.

Example:

```text
Task: Fix mobile navigation

1. desktop-correct.png
   "Desktop layout is correct."

2. mobile-broken.png
   "Menu covers the leaderboard."

3. expected.png
   "Expected mobile design."

Browser context:
localhost:3000/leaderboard
390 x 844

Destination:
Codex - project/worktree
```

Multi-capture tasks should build on the existing capture and routing model rather than introduce a separate workflow.

## Storage model

The user-facing mental model is clipboard-first.

A capture may exist:

- in memory;
- on the operating-system clipboard;
- as an ephemeral local file when required;
- as an ephemeral remote file when required;
- as a permanent file only when the user explicitly chooses to save it.

If a recent-captures view is added, treat it as temporary working context rather than a permanent screenshot library.

Possible actions:

- send again;
- copy;
- save permanently;
- delete now.

Do not introduce a database until the history requirements actually justify one. A small filesystem-based representation is sufficient initially.

## Security and privacy expectations

ScreenFling can handle sensitive visual information, including source code, credentials, customer data, chats, and private dashboards.

The project should therefore follow these defaults:

- local-first processing;
- no screenshot uploads by ScreenFling itself unless a future feature explicitly requires and explains them;
- no analytics or telemetry by default;
- narrow Electron preload/IPC surface;
- context isolation and sandboxing where applicable;
- request operating-system permissions only when a feature needs them;
- no automatic submission by default;
- visibly identify the selected destination before automated delivery;
- safe handling and cleanup of temporary files;
- never claim a delivery or verification guarantee stronger than the implementation actually provides.

## Performance expectations

ScreenFling should prioritize interaction latency over architectural novelty.

Electron is acceptable if the app remains responsive and its unavoidable Chromium/Node footprint does not turn into unnecessary work.

Engineering rules:

- keep the Electron main process non-blocking;
- avoid synchronous filesystem/process APIs on interactive paths;
- minimize long-lived renderer windows;
- lazy-load work that is not required at startup;
- measure first-capture and warm-capture latency separately;
- benchmark repeated capture cycles for leaks and regressions;
- add Rust for measured or platform-API reasons, not speculative performance optimization.

## Cross-platform expectations

Capabilities should be detected and reported honestly.

Initial conceptual matrix:

| Capability | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Region capture | Target | Target | Target, portal/compositor dependent |
| Window/display capture | Target | Target | Target, portal/compositor dependent |
| Image clipboard | Target | Target | Target |
| Global shortcut | Target | Target | Target, environment dependent |
| Browser extension | Target | Target | Target |
| Precise external-app UI automation | Target | Target | Limited / environment dependent |
| Automatic Send | Adapter-specific | Adapter-specific | Adapter/capability-specific |

Platform differences are not bugs by themselves. The product should provide the strongest safe behavior available on the current platform and communicate limitations clearly.

## Open-source project quality

ScreenFling should eventually demonstrate production-quality OSS practices without front-loading ceremony before code exists.

Add these as the project grows and they become useful:

- automated TypeScript tests;
- Rust tests when the native helper exists;
- cross-platform CI;
- formatting and lint checks;
- security policy;
- contribution guide;
- issue and pull-request templates;
- deterministic packaging;
- signed/notarized releases where practical;
- performance benchmarks;
- architecture/security documentation for non-obvious boundaries.

The codebase should stay approachable to contributors. A simple implementation is preferable to a flexible framework until multiple real features require the abstraction.

## Explicit non-goals for the early project

Do not add these simply because they are technically interesting:

- hosted ScreenFling accounts;
- a cloud backend;
- image hosting;
- built-in AI analysis or OCR;
- a custom terminal emulator;
- a custom PTY implementation;
- an MCP server without a concrete user need;
- a plugin marketplace;
- a large database layer;
- collaboration/team features;
- permanent screenshot management;
- automatic submission to unknown applications;
- a broad Rust rewrite of capabilities already handled well by TypeScript/Electron.

## Implementation sequence

The intended development order is:

```text
1. Capture reliably
2. Route to a chosen local destination
3. Identify exact coding-agent sessions
4. Support remote sessions
5. Add rich browser context
6. Add tested web/desktop adapters
7. Enable verified Send where safe
8. Add multi-capture visual tasks
```

Each phase should remain shippable and useful on its own.

If an earlier phase does not produce a workflow meaningfully better than the operating system screenshot shortcut plus manual paste, stop and rethink the product before adding later complexity.

## Immediate next branch

The next implementation branch should focus only on **Milestone 1: capture to clipboard**.

Suggested branch name:

```text
agent/capture-to-clipboard
```

The branch should not add routing, agent detection, Rust, browser extensions, SSH, or automatic submission.

The only important question for that branch is:

> Can ScreenFling make region capture to image clipboard fast, reliable, repeatable, and cross-platform enough to justify building the routing layer on top of it?

That is the next proof point for the project.

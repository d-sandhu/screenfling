# Roadmap

Status: Active pre-alpha plan

Last reviewed: 2026-08-19

This roadmap turns ScreenFling's [product direction](docs/PRODUCT.md) into
testable releases. It intentionally has no calendar promises. A milestone moves
forward only when its exit criteria are met.

## Direction at a glance

| Horizon | Outcome |
| --- | --- |
| **Now** | Prove capture quality and exact destination staging independently. |
| **Next** | Ship one narrow macOS alpha that performs the complete handoff. |
| **Then** | Harden the macOS release and add a second destination surface. |
| **After that** | Deliver the same core product contract on Windows. |
| **Demand-driven** | Managed agent sessions, browser context, remote delivery, and multi-capture tasks. |
| **Optional** | Linux experiments without a parity or release commitment. |

The first release is implemented on macOS, but the architecture and acceptance
contract are cross-platform. Windows is a Tier 1 follow-up, not an afterthought.
Linux is not on the committed path.

## Release rule

Each milestone must provide a coherent user outcome. Engineering work such as
capture, clipboard, or adapter discovery may land in smaller branches, but those
pieces do not become separate product milestones unless they are useful by
themselves.

The expansion rule is:

~~~text
prove the primitive
-> ship one complete workflow
-> measure real use
-> harden
-> port
-> expand
~~~

If the alpha is not meaningfully better than an operating-system screenshot plus
manual paste, improve or reconsider the handoff before adding more destinations
or platforms.

## Milestone 0 — feasibility gates

Status: **Next**

Goal: retire the two highest-risk technical questions before building polished
product UI.

### Gate A: capture harness

Build a disposable Electron harness that:

1. captures one display at full physical resolution;
2. records the actual returned image dimensions;
3. displays the frozen image in a selection overlay;
4. maps a display-local selection to image pixels using measured ratios;
5. crops the region and writes an in-memory PNG to the image clipboard;
6. records capture, overlay-ready, crop, and clipboard timings separately.

Test Retina/scaled displays, mixed-scale multiple displays, negative origins,
rotation, display reconnect, sleep/wake, cancellation, and permission denial.

Gate A passes when:

- every crop edge is correct within one physical pixel;
- the overlay never appears in the captured result;
- warm shortcut to interactive overlay is p95 <= 150 ms on the reference host,
  or profiling identifies a credible path to that target;
- selection release to clipboard-ready is p95 <= 150 ms;
- cancel and failure leave the previous clipboard unchanged;
- 200 capture/cancel cycles show no monotonic image, window, or listener growth;
- all checks run in a packaged application with a stable identity.

Compare Electron's full-resolution source-thumbnail path with a first-frame
display-media path only if necessary. Native ScreenCaptureKit is considered only
if both practical Electron paths fail the agreed quality or latency target.

### Gate B: exact-routing harness

Build a separate developer harness around the destination contract in
[ARCHITECTURE.md](docs/ARCHITECTURE.md).

Evaluate one documented terminal control surface that provides an exact stable
locator and targeted input. Ghostty, tmux, and WezTerm are current candidates.
The choice must be based on target safety, supported input, verification,
maintainability, and contributor reach—not on which terminal is currently
focused or installed on one developer's computer.

Gate B passes when:

- 100 alternating dispatches across two instrumented targets produce zero
  wrong-target events;
- no test sends Enter or changes an unselected target;
- dispatch does not steal focus;
- a target closed or replaced after selection is rejected as stale;
- duplicate names and working directories do not affect routing identity;
- quotes, backslashes, Unicode, and key-like words remain literal note data;
- newlines and control characters are rejected or normalized;
- denied automation permission produces guidance and no fallback automation;
- uncertainty causes no automatic retry or duplicate attachment;
- the clipboard remains usable as a manual fallback.

Run at least 30 observed Stage trials for each agent/version combination proposed
for support. Record attachment behavior honestly. A surface without read-back may
pass as **dispatched-unverified**; it cannot claim verified staging.

### Milestone 0 deliverables

- minimal Electron/TypeScript project scaffold;
- strict compiler, formatter, test configuration, and Oxlint with the vendored
  generic anti-slop rules enabled at error severity;
- capture benchmark harness and fixture grid;
- destination adapter contract and routing harness;
- recorded results with hardware, OS, terminal, and agent versions;
- an architecture decision naming the first supported adapter;
- a go/no-go decision for the alpha.

Do not build settings, history, remote transfer, browser integration, native
helpers, or a public plugin system during these spikes.

## Milestone 1 — useful macOS alpha

Status: **Blocked by Milestone 0**

Goal: ship the smallest version that proves ScreenFling is more than a screenshot
tool.

User flow:

~~~text
global shortcut
-> frozen one-display region selection
-> optional single-line note
-> choose one exact local destination
-> image copied to clipboard
-> image and note staged without submission
-> review or explicitly reveal destination
~~~

Scope:

- background application lifecycle and configurable global shortcut;
- macOS Screen Recording and destination-automation permission onboarding;
- accurate one-display region selection;
- image clipboard output with no permanent file by default;
- optional sanitized single-line note;
- live destination picker backed by the adapter selected in Milestone 0;
- exact-target revalidation immediately before Stage;
- no Enter, no Send, no automatic focus change;
- copied, dispatched-unverified, failed, and cancelled result states;
- explicit Reveal action;
- clipboard fallback after unsupported or failed Stage;
- local timing and failure diagnostics that exclude user content;
- packaged, signed development builds suitable for repeated dogfooding.

Exit criteria:

- zero wrong-target events in automated and human acceptance runs;
- capture and routing continue to meet the Milestone 0 gates;
- permission denial and revocation have recoverable, actionable UI;
- 200 complete or cancelled workflows show no monotonic resource growth;
- crash recovery leaves no overlay, stuck shortcut, or destination mutation;
- users can complete the workflow without learning implementation-specific paste
  behavior;
- repeated dogfooding shows a meaningful time or reliability improvement over
  screenshot plus manual paste.

No alpha claim may imply the destination attached the image unless the chosen
adapter can read that state back.

## Milestone 2 — macOS public alpha

Status: **Later**

Goal: make the validated workflow installable, understandable, and dependable
for contributors outside the original development environment.

Scope:

- signed and notarized installer;
- first-run onboarding and permission diagnostics;
- shortcut-conflict handling;
- stable settings and adapter configuration;
- accessibility, keyboard navigation, reduced motion, and screen-reader checks;
- a second exact destination surface chosen from demonstrated demand;
- explicitly named favorite targets with stale-target protection;
- versioned compatibility fixtures for supported terminals and agents;
- CI, release checks, contribution documentation, and issue templates;
- a documented local diagnostics export with content redaction.

Exit criteria:

- a clean machine can install, grant permissions, complete the first Stage, and
  uninstall without manual residue cleanup;
- compatibility is stated by tested OS, terminal, and agent version ranges;
- every adapter passes the shared zero-wrong-target suite;
- application startup, idle CPU, memory, and capture latency are recorded for
  release artifacts;
- at least one contributor can build and test the project from the documented
  setup without maintainer intervention.

## Milestone 3 — Windows alpha

Status: **Later, Tier 1**

Goal: deliver the same core product promise on Windows through native validation,
not assumptions based on macOS behavior.

Scope:

- packaged region capture and image clipboard;
- per-monitor and mixed-DPI coordinate correctness;
- global-shortcut registration and conflict UX;
- required Windows permission and security-product guidance;
- one exactly addressable or cooperative local destination adapter;
- the same Copy/Stage semantics and clipboard fallback;
- Windows installer, signing plan, CI, and native acceptance host.

Exit criteria:

- the shared capture and routing suites pass on supported Windows versions;
- mixed-DPI crops remain correct within one physical pixel;
- wrong-target count remains zero;
- the selected Windows adapter has an explicit identity and verification model;
- unsigned-development and signed-release behavior are both tested;
- macOS behavior does not regress as platform services are generalized.

Windows is not considered supported merely because Electron launches there.

## Milestone 4 — stable cross-platform core

Status: **Later**

Goal: establish a reliable macOS and Windows foundation suitable for a first
stable release.

Scope is driven by alpha evidence and may include:

- stable capture and destination contracts;
- at least one supported exact destination path per Tier 1 platform;
- reliable update and rollback policy;
- signed release automation;
- security review of IPC, subprocess, clipboard, and temporary-data boundaries;
- compatibility and performance regression suites;
- documented support matrix and deprecation policy.

Exit criteria:

- both Tier 1 platforms meet the same user-visible product contract;
- release artifacts are reproducible enough to diagnose and replace;
- unsupported capability combinations fail closed to Copy;
- the project can maintain its declared terminal and agent compatibility ranges;
- no native helper exists unless its measured gate and security boundary are
  documented.

## Milestone 5 — stronger destinations

Status: **Demand-driven**

Goal: improve identity or verification where real users need it.

Candidate work:

- tmux or WezTerm adapters with pane-level addressability and read-back;
- a managed Codex adapter using exact thread IDs and structured local-image input;
- cooperative registration from agent sessions;
- richer confidence-bearing repository and worktree labels;
- adapter-specific verified Stage or Send.

A managed agent adapter is a different capability from automating an arbitrary
existing terminal. It may expose verified Send when ScreenFling owns the session
identity and receives structured completion events.

The public plugin API remains deferred until multiple maintained adapters prove
which discovery, capability, and lifecycle contracts are stable.

## Milestone 6 — workflow expansion

Status: **Demand-driven**

Choose the next workflow from observed use rather than implementing all of these:

### Browser context

Potentially add visible viewport, selected element, URL, dimensions, and narrowly
scoped DOM context through a separate browser extension. Permissions must be
minimal and visible.

### Remote development

Potentially add SSH, WSL, or container staging using owner-only temporary files,
explicit endpoint identity, secure transfer, durable cleanup leases, and cleanup
after confirmed consumption or a visible time-to-live.

### Multi-capture tasks

Potentially group several captures and notes into one visual task while reusing
the existing capture and routing model.

Each candidate needs a problem statement, user evidence, threat model, and
acceptance gate before entering committed scope.

## Optional Linux track

Status: **Uncommitted**

Linux support is not required for the macOS/Windows product plan.

Community experiments may explore X11 and desktop-portal workflows behind
explicit capability detection. Wayland cannot be promised the same custom
global-overlay behavior: compositor policy restricts global positioning, cursor
queries, and source selection, and a native helper cannot portably bypass those
rules.

A Linux support tier requires:

- a named maintainer;
- an explicit desktop/compositor test matrix;
- packaged permission and portal testing;
- documented differences from the Tier 1 workflow;
- CI or repeatable native acceptance coverage.

Until then, Linux code is experimental and must not complicate the Tier 1 core.

## Deferred and rejected early work

These items are not on the committed roadmap:

- automatic Send to generic applications;
- arbitrary active-window automation;
- a cloud backend or ScreenFling accounts;
- image hosting or synchronization;
- screenshot-library and database features;
- built-in OCR or AI analysis;
- a custom terminal emulator or PTY;
- a browser extension before local product validation;
- remote file staging before a cleanup and endpoint-security design;
- a public plugin marketplace;
- a speculative Rust or native rewrite;
- simultaneous parity across macOS, Windows, X11, and Wayland.

## Immediate implementation sequence

The next work should be issue-sized and land in this order:

1. Scaffold the single Electron application with strict TypeScript, choose and
   record its package manager, install Oxlint plus the generic anti-slop plugin,
   and add packaged smoke tests.
2. Define the capture result, destination, adapter capability, and workflow-state
   contracts.
3. Build the physical-pixel capture benchmark harness.
4. Build the exact-routing harness and select the first adapter by its gate.
5. Record both spike results and make the alpha go/no-go decision.
6. Implement the macOS alpha as vertical slices from shortcut through Stage.

The first implementation branch should not contain remote support, browser
integration, Linux work, a native helper, history, or automatic submission.

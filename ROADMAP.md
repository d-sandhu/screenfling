# Roadmap

Status: Active pre-alpha plan

Last reviewed: 2026-09-13

This roadmap turns ScreenFling's [product direction](docs/PRODUCT.md) into
testable releases. It intentionally has no calendar promises. A milestone moves
forward only when its exit criteria are met.

## Direction at a glance

| Horizon | Outcome |
| --- | --- |
| **Now** | Finish native acceptance for the joined capture-to-Stage workflow. |
| **Next** | Harden and ship one narrow macOS alpha. |
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

For Milestone 1, Gate A and Gate B apply to the macOS tuple proposed for release.
Windows native rows remain required for the later Windows milestone; they do not
block the macOS alpha. Public signing/notarization remains distinct from a local
ad-hoc dogfood package.

## Milestone 0 — feasibility gates

Status: **In progress**

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
- cancellation and failures before clipboard writes leave the previous clipboard
  unchanged; failed write verification must not claim the old clipboard survived;
- 200 capture/cancel cycles show no monotonic image, window, or listener growth;
- all checks run in a packaged application with a stable identity.

Compare Electron's full-resolution source-thumbnail path with a first-frame
display-media path only if necessary. Native ScreenCaptureKit is considered only
if both practical Electron paths fail the agreed quality or latency target.

**Historical prototype evidence:** the packaged macOS prototype passed the single-display
Retina path on Electron 43.4.1: 20/20 non-empty captures, p95 overlay readiness
124.73 ms, p95 crop 0.0571 ms, p95 clipboard write 23.63 ms, and a 200-cycle
cancel run with unchanged clipboard and no monotonic RSS growth. The permanent
fixture grid covers measured independent ratios and fractional crop edges. Gate
A remains open for end-to-end selection-release timing, mixed-scale/negative
origin hardware, rotation, reconnect, sleep/wake, permission denial/revocation,
and native Windows capture. See the
[Phase 3 results](research/phase-3-feasibility-results.md).

The production capture path now wires exact display-source selection, a hidden
snapshot-first overlay, bounded renderer previews, measured-geometry cropping,
explicit image-clipboard writes with pixel read-back verification, display-event
invalidation, and a registered global shortcut through one main-owned
controller. A packaged macOS dogfood run completed Capture, fast region drag,
review, verified Copy, and Escape cancellation with clean renderer diagnostics.
This closes the implementation gap, but not the remaining Gate A hardware,
latency, permission, or soak rows. See the
[Phase 5 packaged dogfood record](research/phase-5-packaged-capture-dogfood.md).

Phase 8 added fail-closed suspend/resume handling and a repeatable packaged
production runner. On the reference arm64 Mac, a pre-hardening 20-workflow run
without operator selection measured p95 18.24 ms from validated selection
completion to review and p95 106.51 ms through verified image-clipboard
completion. Those timings are historical and superseded by the hardened Phase 18
runner results below; they are not current production acceptance. A separate 200-cancel run returned `cancelled` every cycle, retained
exactly one window after each cancel, and cooled from 638,112 KiB at its first
sample to 546,288 KiB after two minutes. The runner now compares packaged
`Info.plist` identity with expected ScreenFling metadata, verifies `app.asar`, the
internal application URL, and requested/returned capture dimensions. Missing
overlays and rejected or hung overlay actions fail and terminate the packaged
process; any operator-assisted run is discarded.
After a later smoke required the operator to press Escape, the runner added a
second cleanup boundary: a settled bridge response is not accepted until the
overlay page closes, and readiness/action failures explicitly close any retained
overlay before application termination. That operator-assisted smoke is also
discarded evidence.
The runner does not automate the physical drag, real global shortcut, direct
cancel-clipboard fingerprint, hardware/lifecycle matrix, stable signing, or
Windows, so Gate A remains open. See the
[Phase 8 results](research/phase-8-capture-lifecycle-results.md).

Phase 10 extracted the macOS Screen Recording status policy from Electron and
added actionable denied/restricted result copy. Denial closes the prepared
overlay, releases capture state, restores the main surface, and performs no
clipboard write. `not-determined`, `granted`, and `unknown` still attempt the
real capture path; non-macOS platforms do not fabricate a macOS permission
failure. Repository tests cover the policy and recovery contract, but stable-
identity TCC denial, grant, revocation, Settings labeling, and restart behavior
remain native human-operated rows. See the
[Phase 10 results](research/phase-10-permission-recovery-results.md).

Phase 20 closed the warm physical-shortcut latency row narrowly on the reference
Mac. Sanitized profiling first measured the serial packaged path at 197.95 ms
p95, then justified overlapping hidden overlay navigation with a fresh display
capture. The production candidate measured 123.11 ms p95 in the main-owned
scripted control. Its first 20-sample physical run missed at 153.20 ms p95; a
second unchanged 20-sample run passed at 149.25 ms p95, with all 40 shortcuts
reaching selecting, all 40 cancelling cleanly, and zero recorded failures. This
is a reference-host pass with little headroom, not a cross-machine guarantee.
Gate A remains open for the other hardware, lifecycle, permission, end-to-end
clipboard, signing, and Windows rows. See the
[Phase 20 results](research/phase-20-shortcut-latency-results.md).

### Gate B: exact-routing harness

Build a separate developer harness around the destination contract in
[ARCHITECTURE.md](docs/ARCHITECTURE.md).

Evaluate one documented terminal control surface that provides an exact stable
locator and targeted input. Ghostty, tmux, and WezTerm were evaluated; WezTerm
is selected for the first production adapter. The choice is based on target
safety, supported input, verification, maintainability, and contributor reach—not
on which terminal is currently focused or installed on one developer's computer.

Gate B passes when:

- 100 alternating dispatches across two instrumented targets produce zero
  wrong-target events;
- an interleaving test replaces or restarts the selected endpoint at the final
  side-effect boundary and sends zero bytes to the replacement;
- no test sends Enter or changes an unselected target;
- dispatch does not steal focus;
- a target closed or replaced after selection is rejected as stale;
- duplicate names and working directories do not affect routing identity;
- quotes, backslashes, Unicode, and key-like words remain literal note data;
- newlines and control characters are rejected or normalized;
- unavailable or denied CLI/mux access produces guidance and no GUI-automation
  fallback; adapter-specific operating-system permissions are tested only when
  that adapter actually requires them;
- configured executable, config, and socket selectors pass platform ownership,
  permission, and replacement checks before picker exposure;
- uncertainty causes no automatic retry or duplicate attachment;
- the clipboard remains usable as a manual fallback.

Run at least 30 observed Stage trials for each agent/version combination proposed
for support. Record attachment behavior honestly. A surface without read-back may
pass as **dispatched-unverified**; it cannot claim verified staging.

**Current evidence:** the checksum-pinned WezTerm stable routing primitive passed
100 alternating two-pane dispatches on both native macOS and Windows with exact
bytes, zero wrong-target writes, zero Enter bytes, stale refusal before send, and
no active-pane or activation command. The production-tree adapter now adds
runtime-validated discovery, explicit executable/config/socket selection,
generation-scoped stable pane routes, one combined image-binding-and-note write,
bounded subprocesses, a final pre-spawn generation guard, and conservative
uncertain-result handling. Its automated suite repeats 100 alternating exact
routes and covers malformed discovery, endpoint replacement, timeout, literal
input, and no-retry behavior. Gate B remains open for visible no-focus trials and
30 actual attachment trials on every terminal/agent/version combination proposed
for support. WezTerm has no macOS Automation/TCC dependency; ScreenFling must not
add a fallback automation path. See
[ADR 0001](docs/adr/0001-wezterm-first-stage-adapter.md), the
[Phase 3 results](research/phase-3-feasibility-results.md), and the
[Phase 6 results](research/phase-6-wezterm-adapter-results.md).

The joined product path now exposes operation-scoped discovery, explicit exact
destination selection, an optional bounded one-line note, verified clipboard
fallback before one-shot Stage, and honest unverified results. The renderer sends
only a destination ID; executable and mux configuration remain in the main
process. The adapter is available only through a complete opt-in macOS developer
configuration.

Phase 9 added a macOS selector policy for canonical file/socket types, owner and
mode, lexical and canonical ancestors, executable/config access, a private
socket parent, and generation evidence that is checked before every version,
list, and send subprocess. Unsafe or replaced selectors expose no destination or
send zero bytes, preserving Copy. This closes the repository-testable
owner/mode/type portion of the configured-selector row, not Gate B: extended ACL
inspection, exact WezTerm config semantics, visible no-focus trials, native
endpoint replacement, and real-agent attachment trials remain open. See the
[Phase 7 results](research/phase-7-joined-flow-results.md) and
[Phase 9 results](research/phase-9-trusted-selector-results.md).

Phase 11 added a shared Stage-capability policy and a distinct unsupported result
without expanding the privileged bridge. Copy-only destinations are labeled and
cannot enable Stage; empty discovery keeps Copy only visible. Unsupported,
stale, failed, and uncertain post-copy results give explicit manual-paste
guidance, while clipboard verification failure does not claim that fallback.
Adapter dispatch remains single-shot and is not invoked for an unsupported
request. Exact user-triggered Reveal was implemented in Phase 12 below; its native
activation/visibility acceptance remains separate and open. See the
[Phase 11 results](research/phase-11-routing-recovery-results.md).

Phase 12 added exact, user-triggered Reveal as a transaction separate from Stage.
The renderer sends only the current operation ID; the main process consumes the
retained selected route, revalidates the endpoint generation and pane, and asks
WezTerm to activate that explicit pane with no input bytes, Enter, Stage retry,
active-pane fallback, or generic window focus. The Stage result remains
unchanged. Repository tests cover routing, lifetime, command shape, typed
outcomes, and no-data behavior. Packaged macOS/Windows foreground, minimized-
window, pinned-flag, exit-status, and endpoint-race observations remain native
acceptance rows. See the [Phase 12 plan](research/phase-12-exact-reveal-plan.md).
Repository results are recorded in the
[Phase 12 results](research/phase-12-exact-reveal-results.md).

Phase 13 adds main-owned, sanitized workflow diagnostics. The controller records
button versus shortcut starts, bounded phase timings, fixed delivery/failure
categories, and validated Reveal outcomes without retaining content, operation
IDs, or destination identities in its snapshot. A strict read-only bridge lets
the packaged acceptance runner include the in-memory snapshot in its local
report; this phase adds no telemetry, persistence, history, or diagnostics UI.
See the
[Phase 13 audit](research/phase-13-next-slice-audit.md) and
[Phase 13 results](research/phase-13-sanitized-diagnostics-results.md).

Phase 14 replaces the fixed capture accelerator with one bounded, main-owned
configuration transaction. The renderer chooses only from portable modifier and
key options; strict IPC carries the structured value, while Electron registration
and a versioned `userData` preference remain in main. A candidate is registered
and verified before persistence, the old binding remains active until commit,
and registration or write failure retains it. Repository tests cover startup,
rollback, concurrency, cleanup, strict schemas, the production filesystem
adapter, and accessible static markup. This closes the repository seam only:
packaged shortcut delivery, real conflict, restart persistence, non-QWERTY, and
Windows observations remain native acceptance. See the
[Phase 14 research](research/phase-14-shortcut-configuration-research.md) and
[Phase 14 results](research/phase-14-configurable-shortcut-results.md).

Phase 15 adds a main-owned Screen Recording readiness readout. A strict bridge
version 8 reports Electron's closed macOS status values, while other platforms
return `not-applicable` rather than a fabricated grant. The idle surface gives
honest guidance and a manual recheck without requesting permission, opening a
native settings app, disabling Capture, or treating status as pixel evidence.
See the [Phase 15 research](research/phase-15-product-readiness-research.md),
[next-slice audit](research/phase-15-next-slice-audit.md), and
[results](research/phase-15-screen-recording-readiness-results.md).

Phase 16 freezes a versioned
[macOS operator acceptance protocol](docs/acceptance/macos-operator-acceptance.md)
for the remaining native rows. It separates packaged-runner, physical-input, and
human-observed evidence; defines stop, cleanup, and redaction rules; and does not
close any Gate A, Gate B, or milestone row by itself. A launch wizard or new GUI
automation would weaken that evidence boundary, so this phase adds neither.

Phase 18 repeated the hardened runner on the exact packaged arm64 artifact. The
canonical default completed 20 measured Copy workflows and 200 cancellations;
the separate soak completed 200 measured Copy workflows and 200 cancellations.
The larger run measured 66.72 ms p95 from validated bridge selection to verified
clipboard, retained one window after every cancel, recorded zero workflow
failures, and cooled below its pre-cancel process working set. This replaces the
provisional pre-hardening runner measurement for that narrow component. Physical
shortcut and drag timing, Cancel clipboard preservation, listener and native
allocation stability, hardware/lifecycle rows, permissions, Stage, and real-agent
evidence remain open. See the
[Phase 18 results](research/phase-18-packaged-capture-results.md).

Phase 19 began the authorized physical-input matrix on a two-display macOS host.
One shortcut delivered exactly one operation while another app was frontmost,
and 20 warm shortcut attempts reached selecting and cancelled without a recorded
workflow failure, but their 206.78 ms p95 missed the 150 ms target. A physical
mixed-scale attempt failed closed, and diagnosis found that macOS constrained
the frameless right-display overlay 33 DIP below the display origin. The capture
window now opts out of that constraint; the rebuilt package aligned at the exact
`(1920, 0)` origin and accepted a physical scale-2 selection. The original row
remains failed, exact crop-pixel comparison and the remaining native matrix stay
open, and no native capture helper is justified. See the
[Phase 19 results](research/phase-19-native-capture-results.md).

### Milestone 0 deliverables

- [x] minimal Electron/TypeScript project scaffold;
- [x] strict compiler, formatter, test configuration, and Oxlint with the vendored
  generic anti-slop rules enabled at error severity;
- [x] main-owned workflow state machine, runtime-validated destination contract,
  and sender-validated narrow IPC bridge;
- [x] disposable capture benchmark retained on its prototype branch, plus a
  permanent coordinate fixture grid in the production tree;
- [x] destination adapter contract in the production tree and disposable
  cross-platform routing harness retained on its prototype branch;
- [x] production WezTerm discovery and one-shot exact-pane Stage primitive with
  bounded subprocess, stale-generation, literal-input, and no-retry tests;
- [x] recorded primitive results with hardware, OS, and terminal versions, plus
  explicit missing agent-version evidence;
- [x] an architecture decision selecting WezTerm as the first Stage adapter
  implementation, conditional on compatibility acceptance;
- [x] a conditional go/no-go decision: proceed with production adapter work, but
  do not claim or release the alpha until the remaining Gate A and Gate B
  acceptance rows pass.

Do not build a general settings framework, history, remote transfer, browser
integration, native helpers, or a public plugin system during these spikes. The
single versioned shortcut preference above is the bounded Milestone 1 exception.

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
- macOS Screen Recording onboarding and adapter-specific permission diagnostics;
  the WezTerm CLI itself does not require macOS Automation/TCC access;
- accurate one-display region selection;
- image clipboard output with no permanent file by default;
- optional sanitized single-line note;
- live destination picker backed by the adapter selected in Milestone 0;
- exact-target revalidation immediately before Stage;
- no Enter, no Send, no automatic focus change;
- copied, dispatched-unverified, failed, and cancelled result states;
- explicit Reveal action;
- clipboard fallback after unsupported or failed Stage;
- local timing and failure diagnostics that exclude user content; the bounded
  in-memory recorder and acceptance-report bridge are implemented, while
  release measurements remain part of packaged acceptance;
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
- packaged shortcut-conflict acceptance and recovery;
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

- a tmux adapter with pane-level addressability/read-back or deeper WezTerm
  verification and compatibility hardening;
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

The repository implements capture/review, explicit Copy/Stage, separate exact
Reveal, permission/readiness guidance, configurable shortcuts, sanitized local
diagnostics, bounded startup, single-instance behavior, and presentation-only
renderer recovery. Built-renderer fixtures cover the visible workflow. The macOS
selector gate now checks extended ACLs as well as owner/mode/type. Tests and a
packaged idle-lifecycle runner do not close the native rows below.

The Phase 18 **200-complete/200-cancel packaged soak already ran**. Do not reopen
that completed component measurement as if it never happened. Its working-set
and window evidence does not prove listener or native image-allocation stability,
and does not transfer automatically to a changed release candidate. Phase 20's
149.25 ms reference-host physical shortcut pass is also historical evidence for
its exact candidate, not a promise for every host or this new package.

Remaining macOS alpha gates, in execution order:

1. Run the static checks, browser fixtures, dependency audit, package build, and
   packaged lifecycle smoke on the exact candidate. Record actual CI results.
2. Run the operator protocol's Screen Recording grant/denial/revocation/restart
   rows on a stable package identity. Record managed/unknown states as unavailable
   when the host cannot produce them. Developer signing credentials and public
   notarization are not supplied by an ad-hoc CI signature.
3. Finish physical crop-pixel, mixed-scale, negative-origin, rotation when
   available, reconnect, sleep/wake, cancel-clipboard, shortcut conflict and
   persistence, and renderer-recovery observations. Repeat candidate performance
   and resource checks as affected by changes. Retain unavailable hardware rows.
4. Resolve the physical selection-release-to-clipboard measurement boundary:
   review and explicit Copy are intentional user steps. Report release-to-review,
   human review dwell, and Copy-to-verified-clipboard separately. Do not automate
   Copy or relabel scripted component timing as the physical <=150 ms row. That
   row remains open until its reviewed definition and direct evidence agree.
5. Run exact WezTerm selector/config, final endpoint replacement, no-focus,
   literal/control-input, stale/fallback, and separate Reveal visibility rows.
   The CLI has no atomic compare-and-send primitive; native race conformance is
   a release blocker, not something the pre-spawn guard alone proves.
6. Observe at least 30 alternating trials per proposed agent/version/binding
   tuple, with zero wrong-target writes and submissions. Unsupported/remapped
   bindings must remain safe. No agent support is claimed before this evidence.
7. Compare at least five complete workflows with five manual screenshot/paste
   workflows, then record repeated dogfooding and outstanding listener/native
   allocation evidence. Release only after all applicable M0/M1 criteria pass.

Use the [macOS operator protocol](docs/acceptance/macos-operator-acceptance.md)
as the procedure, not a separate new plan. Research remains supporting historical
evidence. No Linux, remote/browser integration, history, automatic Send, or broad
settings/native rewrite belongs in this alpha.

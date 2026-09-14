# Roadmap

Status: Active pre-alpha plan

Last reviewed: 2026-09-13

This roadmap turns ScreenFling's [product direction](docs/PRODUCT.md) into
testable releases. It intentionally has no calendar promises. A milestone moves
forward only when its exit criteria are met.

## Direction at a glance

| Horizon | Outcome |
| --- | --- |
| **Now** | Finish native acceptance for the hardened capture-to-Stage workflow. |
| **Next** | Ship one narrow macOS alpha after its remaining gates pass. |
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
ad-hoc dogfood package. A green CI run is not a native acceptance pass.

## Milestone 0 — feasibility gates

Status: **Implementation complete; macOS native acceptance remains open**

Goal: retire the two highest-risk technical questions before claiming a supported
capture-to-destination product. The harnesses and production integration exist;
do not rebuild them as new milestones. Use the remaining acceptance sequence at
the end of this document.

### Gate A: capture harness

The implemented harness and production path cover full-resolution capture of one
display, returned-image dimensions, a frozen selection overlay, measured-ratio
mapping to physical pixels, an in-memory crop, and explicit image clipboard
output. Production writes are verified by pixel read-back. Cancellation, display
changes, suspend/resume, startup timeouts, and stale completions fail closed.

Gate A passes when:

- every crop edge is correct within one physical pixel;
- the overlay never appears in the captured result;
- warm shortcut to interactive overlay is p95 <= 150 ms on the reference host,
  or profiling identifies a credible path to that target;
- selection release to clipboard-ready is p95 <= 150 ms, subject to the open
  measurement-boundary issue below;
- cancellation and failures before clipboard writes leave the previous clipboard
  unchanged; failed write verification must not claim the old clipboard survived;
- 200 capture/cancel cycles show no monotonic image, window, or listener growth;
- all checks run in a packaged application with a stable identity.

Test Retina/scaled displays, mixed-scale multiple displays, negative origins,
rotation, display reconnect, sleep/wake, cancellation, and permission denial.
The old selection-release-to-clipboard row predates the explicit review step.
It remains open: do not bypass review or silently substitute a component timing
for the physical end-to-end row. The operator protocol records release-to-review,
human review dwell, and explicit Copy-to-verified-clipboard separately pending a
reviewed measurement definition.

Compare Electron's full-resolution source-thumbnail path with a first-frame
display-media path only if necessary. Native ScreenCaptureKit is considered only
if both practical Electron paths fail the agreed quality or latency target.

#### Capture evidence retained

| Evidence | What it proves, and what remains open |
| --- | --- |
| [Phase 3](research/phase-3-feasibility-results.md) and [Phase 5](research/phase-5-packaged-capture-dogfood.md) | Historical Retina prototype and packaged Capture/Copy dogfood results. Not acceptance of every later artifact or display configuration. |
| [Phase 18](research/phase-18-packaged-capture-results.md) | The hardened packaged default and a separate **200-Copy/200-cancel** soak ran. The larger run recorded 66.72 ms p95 from validated bridge selection to verified clipboard, one window after every cancel, zero workflow failures, and a cooled working set below its pre-cancel sample. This supersedes provisional Phase 8 timings, not physical-input, listener, or native-allocation acceptance. |
| [Phase 19](research/phase-19-native-capture-results.md) | A physical mixed-scale failure exposed a 33-DIP overlay-origin constraint. The production fix aligned the rebuilt overlay at `(1920, 0)` and accepted a scale-2 selection. Exact crop-pixel comparison and the rest of the hardware matrix remain open. |
| [Phase 20](research/phase-20-shortcut-latency-results.md) | The second unchanged 20-sample physical-shortcut run passed narrowly at **149.25 ms p95** on the reference Mac; the first run missed at 153.20 ms. All 40 attempts reached selecting and cancelled cleanly. This is an exact-candidate reference-host result, not a cross-machine guarantee. |
| [Phase 21](research/phase-21-macos-alpha-hardening-results.md) | Startup/cancellation, renderer recovery, browser interaction, native ACL fixtures, build/package, and ad-hoc signature checks pass in CI. The packaged lifecycle smoke exercises idle recovery without screen capture or permission changes. |

Permission policy and readiness UI are implemented. Actual grant, denial,
revocation, restart, managed restrictions, physical clipboard preservation, and
hardware observations still require the
[macOS operator protocol](docs/acceptance/macos-operator-acceptance.md).
Earlier implementation and acceptance reports remain in the
[research index](research/README.md); their dated open-item lists do not override
this roadmap.

### Gate B: exact-routing harness

WezTerm is the first selected production surface adapter, as recorded in
[ADR 0001](docs/adr/0001-wezterm-first-stage-adapter.md). Ghostty and tmux were
evaluated; no additional adapter is needed to complete this alpha. Selection was
based on target safety, supported input, verification, and maintainability, not
which terminal happened to be focused or installed.

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

#### Routing evidence retained

The checksum-pinned WezTerm primitive passed 100 alternating two-pane dispatches
on native macOS and Windows with exact bytes, no wrong-target writes or Enter,
and stale refusal before send. See the
[Phase 3 results](research/phase-3-feasibility-results.md). This is routing-primitive
evidence, not real-agent image attachment acceptance.

The production adapter and joined workflow implement explicit operation-scoped
discovery/selection, generation-scoped exact panes, bounded subprocesses, one
combined image-binding-and-note write, a final pre-spawn generation guard, and no
retry on uncertainty. Copy is verified before Stage; unsupported or failed Stage
has honest fallback guidance. Exact Reveal is implemented as a separate one-shot
operation with no input data or Stage retry. See the
[Phase 6 results](research/phase-6-wezterm-adapter-results.md),
[Phase 7 results](research/phase-7-joined-flow-results.md), and
[Phase 12 results](research/phase-12-exact-reveal-results.md).

Owner/mode/type, lexical and canonical ancestors, private socket parent, and
selector-generation checks are implemented. Extended ACL inspection is also
implemented and tested with actual disposable macOS file/socket/ancestor grants,
clean files, deny-only ACLs, and denied security reads. It is no longer an
unimplemented repository task. The narrow native boundary is documented in
[ADR 0002](docs/adr/0002-macos-selector-acl.md). Actual operator selectors and
config semantics still require acceptance.

The integration remains opt-in and experimental. A pathname-only guard was
reproduced delivering to a replacement socket in a negative control. Production
Stage and Reveal now pin an established local connection before authorizing the
CLI. The recorded macOS run passed 20 synthetic socket-replacement interleavings
and 100 alternating, uniquely identified payloads through the actual pinned
WezTerm CLI; a final-boundary replacement received zero connections and bytes.
[ADR 0003](docs/adr/0003-pinned-wezterm-transport.md) records that narrow evidence.
Do not describe the old pathname-only race as still unimplemented, or mistake
these headless results for complete GUI/agent acceptance.

Visible no-focus and Reveal behavior, installed config/binding semantics, and
real-agent trials remain release blockers. Repeat the applicable operator rows
on the release tuple. There is no active-window or GUI-automation fallback. The
WezTerm CLI does not require macOS Automation/TCC permission.

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
integration, speculative native helpers, or a public plugin system during these
spikes. The single versioned shortcut preference is the bounded Milestone 1
settings exception. The ACL inspector is the measured security exception in
ADR 0002, not authorization for a capture or application rewrite.

## Milestone 1 — useful macOS alpha

Status: **Implemented and hardened; release blocked by native M0/M1 acceptance**

Goal: ship the smallest version that proves ScreenFling is more than a screenshot
tool.

User flow:

~~~text
global shortcut
-> frozen one-display region selection
-> review and optional single-line note
-> choose one exact local destination
-> explicit Copy or Stage with verified image clipboard output
-> review or explicitly reveal the staged destination
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

The repository-level hardening and verification results are recorded in
[Phase 21](research/phase-21-macos-alpha-hardening-results.md). Native acceptance
can still reveal implementation defects; passing repository tests is not a claim
that only paperwork remains.

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

Repository-level checks passed for implementation commit `68476f1` in
[Check run 34800803518](https://github.com/d-sandhu/screenfling/actions/runs/34800803518)
on macOS and Windows. The macOS run passed 381 tests, 12 runner tests, 14 browser
fixtures, the headless native WezTerm trial, packaged lifecycle smoke, ad-hoc
signature verification, and archive/extract verification. The downloadable CI
candidate remains explicitly pre-alpha. See [ADR 0003](docs/adr/0003-pinned-wezterm-transport.md)
for the transport change and evidence. The [Phase 21 record](research/phase-21-macos-alpha-hardening-results.md)
is the earlier hardening pass, not verification of subsequent code.

Repeat these checks after changes and verify post-merge CI for the actual main
commit. Merging engineering work does not itself close release acceptance.
[Issue #32](https://github.com/d-sandhu/screenfling/issues/32) tracks the remaining
operator work; this roadmap and the protocol remain the canonical criteria.

Remaining macOS alpha gates, in execution order:

1. Run the operator protocol's Screen Recording grant/denial/revocation/restart
   rows on a stable package identity. Record managed/unknown states as unavailable
   when the host cannot produce them. Developer signing credentials and public
   notarization are not supplied by an ad-hoc CI signature.
2. Finish physical crop-pixel, mixed-scale, negative-origin, rotation when
   available, reconnect, sleep/wake, cancel-clipboard, shortcut conflict and
   persistence, and active renderer-recovery observations. Repeat candidate
   performance and resource checks as affected by changes. Retain unavailable
   hardware rows. The completed Phase 18 soak and Phase 20 reference-host shortcut
   result remain valid for their recorded artifacts, not automatically this one.
3. Resolve the physical selection-release-to-clipboard measurement boundary:
   review and explicit Copy are intentional user steps. Report release-to-review,
   human review dwell, and Copy-to-verified-clipboard separately. Do not automate
   Copy or relabel scripted component timing as the physical <=150 ms row. That
   row remains open until its reviewed definition and direct evidence agree.
4. Run the installed-tuple WezTerm selector/config, endpoint replacement,
   no-focus, literal/control-input, stale/fallback, and separate Reveal rows.
   The headless CLI pathname-replacement check has passed with pinned transport;
   it does not replace GUI-hosted, restart, or agent observations. Any failure
   requires an implementation fix, not a relaxed claim.
5. Observe at least 30 alternating trials per proposed agent/version/binding
   tuple, with zero wrong-target writes and submissions. Unsupported/remapped
   bindings must remain safe. No agent support is claimed before this evidence.
6. Compare at least five complete workflows with five manual screenshot/paste
   workflows, then record repeated dogfooding and outstanding listener/native
   allocation evidence. Release only after all applicable M0/M1 criteria pass.

Use the [macOS operator protocol](docs/acceptance/macos-operator-acceptance.md)
as the procedure, not a separate new plan. Research remains supporting historical
evidence. No Linux, remote/browser integration, history, automatic Send, or broad
settings/native rewrite belongs in this alpha.

# Phase 8 packaged capture and lifecycle results

Research and validation date: 2026-08-21

Status: repeatable packaged production evidence added; Gate A, Gate B, and the
macOS alpha remain open.

## Outcome

ScreenFling now fails closed when macOS or Windows reports a suspend or resume
while a capture is still before its clipboard/destination side-effect boundary.
The same controller cleanup used for capture failures releases the retained
image, closes the overlay, clears operation-scoped destinations, restores the
main surface, and publishes one `capture-failed` result. Lifecycle events after
`target-selected`, `writing-clipboard`, or `staging` do not relabel or interrupt
an in-flight side effect.

The repository also has a packaged production-flow runner. It launches the
hardened application with a renderer-only DevTools connection, waits for the
authoritative main-owned workflow phase, invokes a center selection through the
existing validated overlay bridge, clicks the real Copy control, and verifies
the `copied` result produced after main-process image-clipboard read-back. Its
cancel loop verifies `cancelled`, one remaining application window, idle recovery,
and process-tree working-set samples without forced garbage collection.

Overlay creation/readiness and every overlay bridge action are bounded to five
seconds, and bridge actions are awaited. A rejected action is reported unless the
overlay is already closed. The runner terminates the packaged application instead
of leaving capture UI for an operator to dismiss. These failure semantics are
covered by the normal test gate.

The runner keeps Electron's Node-inspector and `NODE_OPTIONS` fuses disabled. It
does not add an acceptance-only product IPC channel or weaken the production
preload boundary.

## Implementation boundary

- `powerMonitor` `suspend` and `resume` events call the main-owned controller's
  environment-change transition after `app.whenReady()`.
- Snapshotting, selecting, and editing fail safely with no clipboard write.
  Destination side-effect phases remain uninterrupted.
- Playwright 1.61.0 is pinned as a development dependency after its current
  Electron application and CDP APIs were checked through Context7.
- The acceptance runner parses boundary values with Zod and emits no pixels,
  clipboard contents, paths, titles, notes, or screenshots.
- On macOS it reads the exact bundle name, version, and identifier from the
  packaged `Info.plist`, compares all three with the expected ScreenFling
  metadata, requires `app.asar`, verifies the internal `screenfling://`
  application surface, and records requested versus returned capture dimensions.
  Windows package identity is explicitly unverified until it can be read from
  the artifact rather than inferred from the source tree.
- Defaults are three warm Copy workflows, 20 measured Copy workflows, 200
  cancellations, and a 120-second working-set cooldown.
- `npm run acceptance:capture:package` builds and runs the native host artifact;
  smaller counts are available only for harness smoke checks.

## Packaged macOS evidence

Artifact and host:

| Item | Observed value |
| --- | --- |
| Application | ScreenFling 0.0.0 pre-alpha, packaged arm64 directory build |
| Bundle identity | `com.dsandhu.screenfling`, read from packaged `Info.plist` |
| Package boundary | `app.asar` present; main surface uses `screenfling://` |
| Signature | Ad hoc; not Developer ID signed or notarized |
| Electron / Chromium | 43.4.1 / 150.0.7871.224 |
| Host | Apple M4 Pro, arm64 |
| Operating system | macOS 26.5.2 (25F84; Darwin 25.5.0) |
| Observed overlay | 1512 × 982 DIP, scale factor 2, orientation angle 0 |
| Requested / returned capture | 3024 × 1964 / 3024 × 1964 physical pixels |

A pre-hardening 20-sample run completed without operator selection, after three
unmeasured warm Copy workflows, and recorded:

| Phase | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| Capture button action → interactive `selecting` | 375.88 ms | 377.33 ms | 393.10 ms |
| Validated selection completion → review ready | 16.12 ms | 18.24 ms | 19.59 ms |
| Validated selection completion → verified clipboard result | 91.10 ms | 106.51 ms | 110.15 ms |

The observed 106.51 ms p95 was below the runner's 150 ms post-selection component
target. Because this run predates awaited bridge actions and bounded overlay
readiness, it is provisional diagnostic evidence and must be repeated before it
can qualify as acceptance evidence. The 377.33 ms capture-action result is not
compared with Gate A's shortcut target: the runner clicks the product control
through CDP and does not deliver the real operating-system global shortcut.

A separate packaged run completed 200 automated cancellations:

| Check | Result |
| --- | --- |
| `cancelled` result | 200/200 |
| Remaining application windows | Exactly one after every cancel |
| Working set, first / last | 638,112 / 622,608 KiB |
| Working set, minimum / maximum | 574,160 / 692,064 KiB |
| Linear slope | +45.56 KiB per cycle |
| Working set after two-minute cooldown | 546,288 KiB |

The positive fitted slope during churn is not treated as a leak result because
the last sample was below the first and the post-cooldown value was lower again.
This is process-level evidence, not proof that every native allocation was
released. The runner cannot inspect the image clipboard through the hardened
renderer boundary, so the existing no-write controller tests and earlier
prototype fingerprint do not become a new direct production cancel-clipboard
measurement.

## Discarded evidence

An early runner revision synthesized pointer-capture events before and after the
overlay became interactive. Some drags were lost and required operator input to
close the overlay. Every timing run that received manual input was discarded.

A later cancellation smoke exposed a second harness defect: the runner discarded
overlay-bridge rejections, so a failed action could leave the overlay open until
the operator pressed Escape. That smoke is also discarded. The runner now awaits
both cancel and selection-completion results, reports open-page failures, accepts
only a demonstrably closed-page race, and applies a five-second deadline. A
post-fix packaged warm cancellation plus one measured cancellation completed
without input, verified result/idle/window invariants, and left no ScreenFling
process running.

The committed runner does not claim automated pointer-drag coverage; the
deterministic drag tracker tests and the Phase 5 human dogfood remain separate
evidence.

## Automated implementation evidence

Controller tests cover environment changes during pending snapshot, visible
selection, and review. They assert release, overlay cleanup, main-surface
recovery, one failure result, and zero clipboard writes. The existing Stage test
also proves that an environment change cannot interrupt or relabel a dispatch
after destination side effects begin.

A lifecycle registration test drives `display-added`, `display-removed`,
`display-metrics-changed`, `suspend`, and `resume` individually and verifies that
each reaches the main-owned controller. Runner regression tests cover rejected
cancel and selection actions, the closed-page race, overlay readiness and action
deadlines, and exact macOS artifact identity.

The full repository gate includes Prettier, type-aware Oxlint with every vendored
generic anti-slop rule at error severity, strict TypeScript, Vitest, the
production build, and native host packaging.

## What remains open

- A real global-shortcut timing distribution and unattended physical-pointer
  selection timing remain required.
- Real sleep/wake, display reconnect, rotation, negative origins, and mixed-scale
  hardware were not simulated or claimed by the lifecycle unit tests.
- Permission denial, grant, and runtime revocation still require the exact stable
  packaged identity and user-visible recovery flow.
- Cancel clipboard preservation needs a direct production-host fingerprint that
  does not weaken the renderer boundary or log clipboard content.
- The runner records a pre-soak working-set baseline, but direct active-operation
  and listener-count inspection remain outside the hardened renderer boundary.
- The exact macOS Screen Recording status was not observed through the hardened
  runner; bundle identity alone is not TCC acceptance evidence.
- Native Windows capture, mixed-DPI, clipboard, lifecycle, and packaged runner
  evidence remain required.
- WezTerm is not installed on this host. Visible no-focus, trusted-path,
  endpoint-replacement, and 30-trial real-agent acceptance remain Gate B work.

## Decision

Keep the Electron capture path and the current security fuses. The pre-hardening
post-selection component recorded a result below its target on this named host,
and the 200-cancel run shows no monotonic window or cooled working-set growth.
Repeat the timing distribution with the hardened runner before treating it as
acceptance evidence. Do not close Gate A, advertise an alpha, or claim
terminal/agent compatibility until the remaining native rows have direct
evidence.

## Supporting evidence

- [Phase 8 capture acceptance plan](phase-8-capture-acceptance-plan.md)
- [Phase 8 routing acceptance plan](phase-8-routing-acceptance-plan.md)
- [Roadmap](../ROADMAP.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Phase 5 packaged capture dogfood](phase-5-packaged-capture-dogfood.md)
- [Phase 7 joined-flow results](phase-7-joined-flow-results.md)

# Phase 16 native acceptance gap audit

Audit date: 2026-08-24

Branch: `phase/16-operator-acceptance-protocol`

Scope: read-only audit after merged Phase 15 (`fe4a73e`). No ScreenFling
process, packaged runner, permission transition, display change, terminal, or
agent was invoked.

Repository context: ScreenFling `0.0.0`, Electron `43.4.1`, Node `24.13.0`, and
npm `11.19.0`. No WezTerm or agent version was exercised by this audit.

## Decision

Make Phase 16 a canonical native-acceptance protocol and sanitized report
format, not an interactive wizard or runner extension. The remaining release
rows depend on physical input and visible host state that a repository test
cannot own. Automating those actions would blur evidence classes and could
strand the capture overlay.

The canonical procedure is
[`screenfling-macos-operator-acceptance/v1`](../docs/acceptance/macos-operator-acceptance.md).
This report records why it is needed; it does not duplicate or override its
stages, statuses, or schema.

## Gap matrix after Phase 15

Evidence labels mean `repository` for headless code evidence, `runner` for the
packaged bridge-driven subset, and `open-native` for missing direct native or
human evidence.

### Gate A — capture

| Requirement | Existing evidence | Remaining evidence |
| --- | --- | --- |
| Crop geometry and returned dimensions | Repository fixtures and packaged-runner dimensions | Physical fixture checks on each real topology |
| Overlay absent from capture | Snapshot ordering and capture tests | Direct observation on the packaged host |
| Warm shortcut-to-overlay p95 ≤150 ms | Main-owned shortcut and diagnostics; runner uses a button | At least 20 warm physical-shortcut samples on the reference host |
| Selection-release-to-clipboard p95 ≤150 ms | Runner bridge timing | At least 20 warm physical-selection samples on the reference host |
| Cancel/failure preserves clipboard | Controller no-write tests | Non-sensitive clipboard sentinel observation |
| 200 workflows without monotonic growth | 200 runner cancellations and cooled samples | Complete-workflow soak and stated resource limits |
| Mixed scale, negative origin, rotation, reconnect | Synthetic geometry/invalidation tests | One direct row per available topology |
| Sleep/wake | Fail-closed controller and power-monitor tests | Real transition plus recovery observation |
| Permission denial/grant/revocation | Readiness and recovery tests | Exact packaged identity, real capture result, and cleanup |
| Stable packaged identity | Ad-hoc metadata and `app.asar` checks | Signing/notarization recorded without overclaiming |

### Gate B — exact routing

| Requirement | Existing evidence | Remaining evidence |
| --- | --- | --- |
| 100 alternating exact routes | Native primitive and repository adapter tests | Keep distinct from visible real-agent trials |
| No Stage focus theft | Command shape does not request activation | Frontmost and pane-focus observation |
| Endpoint replacement refusal | Generation and final-guard tests | Real endpoint replacement and zero-byte observation |
| Selector policy | macOS owner/mode/type tests | Extended ACL and exact config semantics |
| Literal/control input | Repository validation and exact-byte tests | Protocol row tying the result to the tested tuple |
| Duplicate title/CWD isolation | Exact pane identity tests | Visible two-pane trial with duplicated metadata |
| Real-agent attachment | No authoritative evidence in the tree | At least 30 observations per proposed tuple |
| Reveal foreground behavior | Exact-pane activation result | Visible/minimized/hidden/frontmost observation |
| Unavailable adapter preserves Copy | Repository capability/no-retry tests | Regression observation on the packaged tuple |

### Milestone 1 evidence

The protocol must keep permission recovery, zero wrong targets, cleanup,
complete-workflow soak, and the comparison with screenshot plus manual paste
separate. A green repository check proves none of the human portions. The exact
criteria remain canonical in the [roadmap](../ROADMAP.md).

## Why a protocol is the smallest coherent slice

- The packaged runner already owns unattended bridge-driven Copy and cancel
  measurements; a second launcher would duplicate it.
- Physical shortcut delivery, pointer selection, focus, display topology,
  sleep/wake, and a real agent composer require an operator observation.
- A checklist can require authorization, stop rules, redaction, restoration,
  and independent review without claiming that it observed the desktop.
- Any operator rescue of an unattended run must remain `discarded` evidence.

No product code, general setup system, settings opener, TCC mutator, GUI
automation, or new capture backend is justified by this audit.

## Claims that remain invalid

- A permission status does not prove returned pixels or correct crop geometry.
- A registered shortcut does not prove physical operating-system delivery.
- A runner bridge action does not prove physical pointer input.
- A CLI success does not prove focus, image attachment, or agent idleness.
- An ad-hoc package does not prove signed/notarized distribution.
- One display or OS tuple does not prove cross-platform support.
- The protocol itself does not close Gate A, Gate B, or a milestone.

## Sources

- [Roadmap Gate A and Gate B](../ROADMAP.md)
- [Architecture verification strategy](../docs/ARCHITECTURE.md#verification-strategy)
- [Electron `systemPreferences`](https://www.electronjs.org/docs/latest/api/system-preferences)
- [Electron `globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron `powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor)
- [Electron `screen`](https://www.electronjs.org/docs/latest/api/screen)
- [Apple Screen Recording settings](https://support.apple.com/guide/mac-help/allow-apps-to-use-screen-and-audio-recording-mchl592e5686/mac)
- [WezTerm CLI](https://wezterm.org/cli/cli/index.html)
- [WezTerm `send-text`](https://wezterm.org/cli/cli/send-text.html)
- [WezTerm `activate-pane`](https://wezterm.org/cli/cli/activate-pane.html)

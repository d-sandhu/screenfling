# Phase 20 shortcut latency results

Validation date: **2026-08-24**

Status: the packaged macOS reference host passed the warm physical-shortcut
latency row narrowly; the broader Gate A matrix remains open.

## Outcome

ScreenFling now loads the hidden capture overlay and takes a fresh display
snapshot concurrently after the main window has finished hiding. It waits for
both branches to settle before sending pixels or reporting failure. The overlay
still remains hidden until its operation-scoped JPEG has decoded, and every
capture still retains a fresh full-resolution image for exact cropping.

The first 20-sample physical run of the candidate missed the `<=150 ms` target
at 153.20 ms nearest-rank p95. After two smaller hypotheses failed to show a
causal improvement and were reverted, a second 20-sample run of the unchanged
candidate passed at **149.25 ms p95**. All 40 physical shortcuts across those two
runs reached selecting, all 40 were cancelled and reset, and diagnostics
recorded no delivery failure.

This closes `A.shortcut.latency` on the named reference host under the existing
acceptance rule. It does not establish comfortable performance headroom, a
cross-machine guarantee, or completion of Gate A.

## Exact measured artifact

| Item | Value |
| --- | --- |
| Source commit | `86df1d34d936e0f1b2544ce61df55956345ebee4` |
| Production implementation commit | `9444442a6f0a1d3201837a66a9326e0290a5e14a` |
| Source-tree comparison | No content difference between the two commits |
| Packaged `app.asar` SHA-256 | `f39f74fb9d70ed109ba93089f5eb899aa6409b60e660eff9d44be01863c80e17` |
| Electron | 43.4.1 |
| Evidence class | Physical shortcut with automated cancel cleanup |
| Host scope | The same arm64 macOS reference host used by Phase 19 |

The observer used the packaged production bridge only to read sanitized
aggregate diagnostics and cancel each reached overlay. The operator physically
pressed Command-Shift-9. The observer did not synthesize the shortcut, drag,
copy, Stage, paste, submit, change display settings, or write the clipboard.

## Before-and-after evidence

| Measurement | Samples | Median | Nearest-rank p95 | Maximum | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Phase 19 serial physical shortcut | 20 | 194.69 ms | 206.78 ms | 272.37 ms | Failed |
| Concurrent candidate, physical run 1 | 20 | 135.35 ms | 153.20 ms | 153.39 ms | Failed |
| Concurrent candidate, physical run 2 | 20 | 135.71 ms | **149.25 ms** | 153.61 ms | Passed |

The passing p95 is 57.53 ms lower than the Phase 19 p95. One sample in the
passing run remained above 150 ms; nearest-rank p95 for 20 samples is the 19th
ordered value, so the maximum is reported separately rather than hidden.

The same packaged implementation also passed the unattended main-owned control:

| Measurement | Count | Median | Nearest-rank p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Serial start-to-selecting baseline | 24 | Not retained | 197.95 ms | Not retained |
| Concurrent button-to-selecting | 24 | 119.43 ms | 123.11 ms | 182.10 ms |
| External scripted button observation | 20 | 168.53 ms | 171.37 ms | Not retained |

The external scripted interval includes automation and observation overhead and
is not the product shortcut metric. The internal button stream includes four
warmup samples. These controls establish the shared packaged path, not physical
input acceptance.

## Sanitized component evidence

The passing physical observer ended with 23 component samples: 20 physical
shortcut attempts plus three automated button warmups. Component streams are
trigger-agnostic aggregates and therefore must not be presented as 20
physical-only samples.

| Component | Median | Nearest-rank p95 | Maximum |
| --- | ---: | ---: | ---: |
| Start to main hidden | 19.49 ms | 23.53 ms | 31.17 ms |
| Main hidden to overlay prepared | 103.94 ms | 109.28 ms | 116.28 ms |
| Main hidden to fresh snapshot ready | 107.43 ms | 116.13 ms | 145.78 ms |
| Both branches joined to selecting | 9.21 ms | 17.98 ms | 396.53 ms |

These are separate distributions and are not additive. The 396.53 ms maximum
occurred in the mixed component population, while every physical total in the
passing run was at most 153.61 ms; it therefore cannot be attributed to a
physical shortcut. No operation identifiers or event log were retained by the
bounded diagnostics design.

## Implementation and failure semantics

The production change is intentionally small:

- construct and configure the exact hidden overlay before capture starts;
- run hidden `loadURL()` and fresh `desktopCapturer` capture concurrently;
- use `Promise.allSettled()` so an early branch rejection cannot leave the
  other branch mutating a later operation;
- report the first applicable failure only after both branches settle;
- keep the overlay hidden until the current JPEG reports `load` and ready;
- close a failed overlay by BrowserWindow identity so a late old failure cannot
  destroy a newer operation's window.

Controller tests cover concurrent start, cancellation, and both rejection
orders. A direct native `BrowserWindow` identity test was not added because the
current class has no clean unit seam and the anti-slop policy correctly rejected
module mocking. Adding a production dependency-injection framework for one
private Electron branch would be a larger and less representative change.

## Rejected experiments

Two one-variable experiments were retained in Git history and reverted:

1. Removing the explicit `focus()` after `show()` produced a scripted p95 of
   154.26 ms, so Electron's documented redundancy did not translate into a
   measured improvement here.
2. Replacing Effect-derived Blob URL state with a React 19 callback ref produced
   a green 133.97 ms aggregate run, but its predicted joined-to-selecting p95 was
   25.78 ms versus 25.63 ms before the change. The aggregate pass was therefore
   treated as variance, not causation, and the refactor was reverted.

The second experiment followed React's guidance to avoid cascading derived
state and Vercel's matching render guidance, but measurement—not stylistic
preference—controls this hot path. The composition-pattern guidance did not
justify a component architecture change because no reusable component API or
boolean-prop problem was involved.

## Privacy and limitations

No captured pixels, screenshots, clipboard contents, notes, destinations,
window titles, terminal text, local paths, usernames, operation identifiers, or
raw per-operation trace are committed. The scripted Copy control replaced the
clipboard with the public synthetic grid fixture. The physical observer did not
write the clipboard.

This evidence is limited to one packaged artifact, one reference Mac, one
attached-display arrangement, and two 20-sample physical distributions. Repeat
the protocol on release hardware if the host, Electron version, windowing path,
or capture backend changes. Gate A remains open for the other hardware,
lifecycle, permission, end-to-end clipboard, signing, and Windows rows listed
in the roadmap and operator protocol.

## Decision

Keep Electron 43.4.1 and the concurrent hidden-load/fresh-capture join. Do not
add persistent hidden overlays, stale capture caches, preview degradation, a
native helper, or an unmeasured React rewrite for this row. Treat 149.25 ms as a
narrow reference-host pass and continue collecting release-artifact latency
rather than advertising a broad performance guarantee.

## References

- [Phase 20 shortcut latency research](phase-20-shortcut-latency-research.md)
- [Phase 19 native capture results](phase-19-native-capture-results.md)
- [macOS operator acceptance protocol](../docs/acceptance/macos-operator-acceptance.md)
- [React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)

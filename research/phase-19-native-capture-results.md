# Phase 19 native capture results

Validation date: **2026-08-24**

Status: partial physical-input evidence recorded; one mixed-scale overlay defect
fixed and package-verified; Gate A and the macOS alpha remain open.

## Outcome

An authorized operator session exercised the packaged macOS application with a
physical global shortcut, physical pointer input, and two attached displays at
different scale factors. Twenty warm shortcut attempts all reached the
interactive overlay and cancelled cleanly, but their 206.78 ms nearest-rank p95
missed the 150 ms target. One shortcut delivered exactly one operation while a
different harmless application was frontmost.

The first right-display mixed-scale attempt failed closed before Copy or Stage.
A bounded diagnostic retry then reached review, but exposed a separate,
deterministic placement defect: macOS positioned the 1512 x 982 frameless
overlay at `(1920, 33)` while the selected display began at `(1920, 0)`. That
offset could make display-local selection coordinates refer to the wrong frozen
pixels even when the workflow reached review.

The production fix adds Electron's macOS `enableLargerThanScreen` window option
to the capture overlay. Electron documents that this option removes both size
and position constraints for a frameless macOS window. A rebuilt package then
reported the exact `(1920, 0)` origin at scale factor 2, and one physical
near-full-display drag reached review. The original mixed-scale acceptance row
remains failed; the post-fix observation is a remediation control, not a retry
that silently upgrades the row.

No screenshot, captured pixels, clipboard contents, window title, terminal
text, local username, destination identity, operation identifier, or raw helper
log is retained in the repository.

## Exact artifacts and host

| Item | Initial observation | Fixed-package control |
| --- | --- | --- |
| Source commit | `ddec80138e77a7a78fdf5840becd9ce40e4bb5a3` | `bfef175e3ed912debd29d51fbed20d9bb07c15e2` |
| `app.asar` SHA-256 | `05bb70f9e2af3c0242694fbad8526adcce79f56c983b34786721df931d9f82f8` | `3d82ecfecc4b424ffae1b1cd7d7a140b15d3fcf5ccfb3e0bc51c730647fa8f80` |
| Application | ScreenFling 0.0.0 | ScreenFling 0.0.0 |
| Bundle identifier | `com.dsandhu.screenfling` | `com.dsandhu.screenfling` |
| Signature | ad hoc; no Team identifier; not notarized | ad hoc; no Team identifier; not notarized |
| Electron | 43.4.1 | 43.4.1 |
| Host | macOS Darwin 25.5.0, arm64 | same host |
| Keyboard layout | Canadian | unchanged |

The recorded display topology was:

| Display | DIP bounds | Physical pixels | Scale | Rotation |
| --- | --- | --- | ---: | ---: |
| Left/main | `(0, 0)`, 1920 x 1080 | 1920 x 1080 | 1 | 0 degrees |
| Right/secondary | `(1920, 0)`, 1512 x 982 | 3024 x 1964 | 2 | 0 degrees |

Permission, shortcut, keyboard layout, and display arrangement were not changed
by the session. Temporary fixtures were click-through and contained only a
synthetic grid and target.

## Physical shortcut evidence

| Row | Result | Observation |
| --- | --- | --- |
| `A.shortcut.delivery` | Passed, one sample | With another harmless application frontmost, one physical shortcut produced exactly one left-display overlay; Escape cancelled and Done returned idle. |
| `A.shortcut.latency` | Failed, 20 samples | All 20 physical starts reached selecting and all 20 cancelled with zero recorded failures, but p95 exceeded 150 ms. |

The warm physical shortcut-to-interactive-overlay distribution was:

| Statistic | Milliseconds |
| --- | ---: |
| Minimum | 181.39 |
| Median | 194.69 |
| Nearest-rank p95 | 206.78 |
| Maximum | 272.37 |
| Target | <=150.00 |

This is aggregate phase timing, not component-level profiling. The measured path
includes the deliberate 16 ms main-window hiding boundary, display lookup,
full-resolution `desktopCapturer.getSources`, JPEG preview encoding, overlay
renderer readiness, and window presentation. The credible next optimization
step is sanitized interval instrumentation around those existing boundaries,
followed by measurement; this report does not guess which component dominates
or claim the target is close.

## Mixed-scale defect and remediation control

The original `A.display.mixed-scale` attempt selected the right scale-2 display
and showed the synthetic frozen overlay. Completing the physical selection
produced the generic `capture-failed` result before clipboard or destination
side effects. Cleanup used Done. Because the current diagnostic category does
not retain a safe internal failure reason, that single failure cannot be
attributed to display invalidation, source enumeration, an empty image, or crop
validation after the fact.

A bounded physical-pointer diagnostic then recorded this pre-fix pass:

| Field | Observation |
| --- | --- |
| Overlay screen origin | `(1920, 33)` DIP |
| Overlay viewport | 1512 x 982 DIP |
| Device pixel ratio | 2 |
| Physical drag | `(6.93, 39.25)` to `(1178.62, 806.43)` DIP |
| Pointer ownership | Overlay retained pointer capture through release |
| Workflow outcome | Reached editing |

The pass proved that the scale-2 capture path was not consistently unavailable,
but the 33-DIP origin discrepancy disproved exact display alignment. Electron's
current macOS implementation documents that `enableLargerThanScreen` leaves a
frameless window's frame position and size unconstrained instead of applying the
normal screen constraint. ScreenFling now enables that option only on its
frameless capture window; the main window and workflow are unchanged.

The fixed exact package produced this separate remediation control:

| Field | Observation |
| --- | --- |
| Overlay screen origin | `(1920, 0)` DIP |
| Overlay viewport | 1512 x 982 DIP |
| Device pixel ratio | 2 |
| Physical drag | `(4.52, 38.04)` to `(1511.98, 980.26)` DIP |
| Pointer ownership | Overlay retained pointer capture through release |
| Workflow outcome | Reached editing |

This supports the narrow claim that the fixed packaged overlay aligned with the
recorded right-display bounds and accepted a physical selection. It does not
establish one-physical-pixel crop accuracy because the diagnostic intentionally
stopped at review and did not retain or compare captured pixels.

## Discarded and supporting observations

One broad left-display physical selection reached a 1471 x 841 review crop that
visually contained the expected synthetic grid without overlay controls. It was
discarded because it did not follow the prescribed center-target geometry, the
normal Cancel/Done boundary did not finish before the observer timeout, and the
operator independently changed the clipboard during review. It is visual
support only and supplies no clipboard or exact-edge claim.

One retry was also discarded when returning to the terminal generated a click
that cancelled the overlay. Operator rescue and harness contamination are not
counted as product failures or passes.

## Verification

The fix followed a red-green check at the existing exported window-options
seam. The new assertion failed before the production change and passed after the
single option was added. `npm run check:all` then passed:

- Prettier check;
- type-aware Oxlint with the vendored generic anti-slop rules;
- strict TypeScript;
- 298 Vitest checks;
- 12 packaged-runner checks;
- production build and macOS packaging.

An independent read-only review reported no findings and confirmed the change
was limited to the capture window plus its regression assertion.

## Supported claims and remaining work

This phase supports only these claims for the recorded host and artifact tuples:

- a physical global shortcut delivered exactly one operation while another app
  was frontmost;
- 20 warm physical shortcut attempts reached selecting and cancelled without a
  recorded workflow failure, but missed the 150 ms p95 requirement;
- the fixed package aligned its frameless overlay with the right scale-2
  display's exact DIP origin and accepted one physical selection.

Permission transitions, shortcut persistence and conflict, exact crop-edge
comparison, physical selection-to-clipboard timing, Cancel clipboard
preservation, negative origins, rotation, reconnect, sleep/wake, all Stage and
Reveal rows, and real-agent trials remain open. The initial mixed-scale row also
remains failed until a new protocol-authorized acceptance session records a
complete exact-pixel result with clean cleanup.

## Decision

Keep Electron and the existing capture backend. Retain the minimal macOS window
placement fix. Do not add a native capture helper based on one unclassified
failure, and do not weaken the 150 ms shortcut target. The next native slice
should add sanitized component timing before optimizing and should resume the
operator matrix at the first unclosed row.

## Sources

- [Electron 43.4.1 `BrowserWindow` options](https://github.com/electron/electron/blob/v43.4.1/docs/api/structures/base-window-options.md)
- [Electron 43.4.1 macOS frameless window constraint implementation](https://github.com/electron/electron/blob/v43.4.1/shell/browser/ui/cocoa/electron_ns_window.mm)
- [macOS operator acceptance protocol](../docs/acceptance/macos-operator-acceptance.md)
- [Phase 18 packaged capture results](phase-18-packaged-capture-results.md)

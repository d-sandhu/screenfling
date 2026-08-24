# Phase 18 packaged capture results

Validation date: **2026-08-24**

Status: hardened packaged capture and cancellation evidence recorded; Gate A,
Gate B, and the macOS alpha remain open.

## Outcome

The exact packaged macOS artifact passed the canonical unattended default run
and the separate 200-Copy/200-cancel soak without operator input. The default
run completed 20 measured Copy workflows and 200 cancellations. The larger run
completed 200 measured Copy workflows and 200 cancellations.

Both runs verified the packaged identity, recorded a positive returned image
with matching requested and returned dimensions for the first measured display
sample, verified the `copied` result after clipboard image read-back, and
verified cancellation result, idle recovery, and one remaining application
window after every cancel. The runner completed its bounded application cleanup
after each run; it does not report whether termination was natural or forced.

This is packaged-runner evidence. Selection was invoked through the validated
overlay bridge, not a physical drag, and capture began through the product
button, not the operating-system shortcut. The result does not close physical
input, display hardware, permission-transition, listener-count, native image
allocation, Stage, or real-agent rows.

## Exact artifact and host

| Item | Observed value |
| --- | --- |
| Source commit | `cbb721bd8d17f08764a6af156d88e687c1537b83` |
| Application | ScreenFling 0.0.0 |
| Bundle identifier | `com.dsandhu.screenfling` |
| Package boundary | `app.asar` and `screenfling://` verified |
| `app.asar` SHA-256 | `05bb70f9e2af3c0242694fbad8526adcce79f56c983b34786721df931d9f82f8` |
| Signature | ad hoc; no Team identifier; not notarized |
| Electron / Chromium | 43.4.1 / 150.0.7871.224 |
| Host | macOS Darwin 25.5.0, arm64 |
| Observed display | 1920 × 1080 DIP, scale factor 1, rotation 0 |
| Requested / returned pixels | 1920 × 1080 / 1920 × 1080 |

`npm run check:all` passed before either run: Prettier, type-aware Oxlint with
the vendored anti-slop rules, strict TypeScript, 298 Vitest checks, 12 runner
checks, production build, and macOS packaging.

## Canonical default run

Command: `npm run acceptance:capture`

| Observation | Result |
| --- | ---: |
| Measured Copy workflows | 20/20 |
| Cancellation workflows | 200/200 |
| Capture warmups | 3 |
| Selection completion → review p95 | 15.44 ms |
| Selection completion → verified clipboard p95 | 64.08 ms |
| Verified clipboard target | ≤150 ms, passed |
| Window count after every cancel | 1 |
| Cancel result and idle recovery | verified every cycle |
| Working set, first / last | 645,248 / 593,568 KiB |
| Working set, minimum / maximum | 566,304 / 738,832 KiB |
| Working-set slope | -49.75 KiB per cancel cycle |
| Working set after cooldown | 541,936 KiB |
| Recorded failures | 0 |

The runner's capture-button-to-overlay p95 was 220.81 ms. That value is not
compared with the Gate A shortcut target because CDP clicked the product button;
no physical global shortcut was delivered.

## 200-Copy/200-cancel soak

Command:
`npm run acceptance:capture -- --capture-runs=200 --cancel-runs=200`

| Observation | Result |
| --- | ---: |
| Measured Copy workflows | 200/200 |
| Cancellation workflows | 200/200 |
| Capture warmups | 3 |
| Selection completion → review p95 | 16.47 ms |
| Selection completion → verified clipboard p95 | 66.72 ms |
| Verified clipboard target | ≤150 ms, passed |
| Window count after every cancel | 1 |
| Cancel result and idle recovery | verified every cycle |
| Working set before cancel cycles | 672,736 KiB |
| Working set, first / last | 601,376 / 621,648 KiB |
| Working set, minimum / maximum | 589,136 / 666,976 KiB |
| Working-set slope | +65.63 KiB per cancel cycle |
| Working set after cooldown | 559,296 KiB |
| Recorded failures | 0 |

The positive fitted slope during cancel churn is not treated as a leak because
the samples were not monotonically increasing, their maximum stayed below the
pre-cycle baseline, and the post-cooldown value was lower again. This supports
process working-set stabilization only; it does not prove native image
allocation release. The runner does not expose listener counts, so the broader
resource-growth criterion remains open rather than inferred from memory alone.

## Diagnostics boundary

The larger run recorded 404 button starts: one cancel warmup, three capture
warmups, 200 measured copies, and 200 measured cancellations. It recorded 203
copies and 201 cancellations including warmups, with zero capture, clipboard,
permission, routing, unsupported, or unexpected failures. No shortcut, Stage,
Send, or Reveal operation was invoked.

No screenshot, pixel payload, clipboard content, local path, title, note,
destination identity, terminal transcript, or operation identifier is retained
in this report.

## Supported claims and remaining work

This phase replaces the provisional pre-hardening runner timing with current
hardened evidence and supports these narrow claims for the recorded tuple:

- the packaged bridge-driven selection-to-verified-clipboard component is below
  150 ms at p95 in both a 20-sample run and a 200-sample run;
- 200 completed Copy workflows returned to idle, and 200 cancellations returned
  to idle with one remaining application window and zero recorded workflow
  failures;
- process working-set observations did not show monotonic retained growth and
  cooled below the pre-cancel baseline.

It does not establish physical shortcut or pointer timing, Cancel clipboard
preservation, mixed-scale or negative-origin correctness, rotation, reconnect,
sleep/wake, permission denial or revocation, listener stability, native image
allocation release, Windows behavior, exact Stage, real-agent attachment, or a
productivity improvement over manual paste. Those rows remain governed by the
[macOS operator protocol](../docs/acceptance/macos-operator-acceptance.md).

## Decision

Keep the existing hardened runner and Electron capture path. Do not add another
automation layer for physical-input or visible-agent rows. Continue with the
authorized native operator matrix and record each evidence class separately.

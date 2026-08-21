# Phase 13 sanitized diagnostics results

Result date: 2026-08-21

Scope: repository-testable, main-owned workflow diagnostics. This phase did not
run ScreenFling, open a capture overlay, inspect the clipboard, or perform a
native acceptance row.

## Decision

ScreenFling now keeps one bounded diagnostics aggregate in the Electron main
process. It is meant to make later packaged acceptance and dogfooding comparable
without creating telemetry, durable history, a content log, or a diagnostics
UI.

The earlier [next-slice audit](phase-13-next-slice-audit.md) ranked this ahead of
shortcut configuration and adapter read-back work because it closes a named
Milestone 1 repository seam without inventing native or attachment evidence.

## Implemented contract

- `WorkflowDiagnostics` owns start counters, delivery/failure counters, Reveal
  counters, and phase timing samples behind `begin`, `mark`, `finish`,
  `recordReveal`, and `snapshot`.
- The controller labels renderer starts as `button` and the registered global
  shortcut as `shortcut`. It marks selecting, selection completion, editing,
  and each terminal result at main-owned state boundaries.
- Terminal recording is operation-bound and idempotent. Cancellation while
  capture is pending, duplicate finish, and stale or late completion cannot
  increment a second delivery result.
- Reveal diagnostics record the validated adapter outcome from a current
  destination-bearing result. Forged stale operation IDs and unsupported copied
  results do not create diagnostic events.
- Each timing stream retains at most the newest 200 finite, nonnegative samples
  and reports count, minimum, median, p95, and maximum. Production injects Node
  24's monotonic `performance.now()`; tests inject deterministic clocks.
- Bridge API version 6 adds one sender-authorized, no-payload, read-only
  `getDiagnostics` method. Preload validates the strict versioned snapshot, and
  the packaged acceptance runner can include it in the local JSON report.

## Privacy boundary

The schema has fixed counters and timing summaries only. It rejects extra
fields, and the controller converts delivery results to a smaller diagnostic
outcome before recording them. Snapshots contain no pixels, notes, clipboard
bytes or text, source or terminal content, file paths, window titles,
credentials, raw subprocess output, operation IDs, or destination identities.

The aggregate is process-local and in memory. This phase adds no persistence,
network transport, telemetry, user-facing export, or history.

## Automated evidence

- 28 Vitest files passed with 229 tests.
- 12 headless Node acceptance-helper tests passed, including sanitized snapshot
  readback and unavailable-bridge behavior.
- Focused controller tests cover shortcut timing, Copy, pending-capture
  cancellation, permission failure, unsupported Stage, late Stage completion,
  successful Reveal, and no diagnostic pollution from invalid Reveal
  preconditions.
- The complete generic anti-slop Oxlint rule set passed at error severity.
- Strict TypeScript typechecking passed.
- `npm run check:all` passed, including the production build and ad-hoc macOS
  package. The package is not signed with a Developer ID and was not notarized.

The first full-gate attempt was restricted from creating the temporary Unix
sockets used by existing WezTerm selector tests. The same headless gate passed
after granting that test-only local socket capability; this was an execution
sandbox limitation, not a changed product assertion.

All evidence above is headless. A prior stuck interactive capture session that
required an operator to press Escape is discarded and is not counted as passing
evidence. No Phase 13 verification depends on operator input.

## Remaining acceptance work

This phase does not close Gate A, Gate B, or the macOS alpha milestone. Native
display/lifecycle coverage, stable-identity permission trials, ACL and WezTerm
configuration semantics, visible no-focus and Reveal foreground behavior,
real-agent attachment, the packaged 200-workflow soak, signing, and comparative
dogfooding evidence remain open. The diagnostics snapshot supplies a safer
measurement format for those trials; it does not replace them.

## Documentation source

Context7 verification used the Node.js 24 `perf_hooks` documentation for the
monotonic timing choice:
[Node.js 24 `performance.now()`](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#performancenow).

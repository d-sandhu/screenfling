# Phase 13 next-slice audit

Audit date: 2026-08-21

Scope: repository-testable work after merged Phase 12 (`e4b3757`). This audit
does not run the app or any GUI/native capture test and does not claim signing,
hardware coverage, operator evidence, or an alpha release.

## Recommendation

Make Phase 13 **sanitized local workflow diagnostics**: add one main-owned,
bounded diagnostics module that records phase timings and result categories,
then expose a strict read-only snapshot to the existing local acceptance
harness. Keep the data in memory for this slice; do not add telemetry,
durable history, a diagnostics UI, or a new persistence format.

This is the smallest remaining Milestone 1 contract that has both direct product
value and a complete repository seam. The product explicitly permits local
timings and result categories only when pixels, notes, clipboard contents,
source code, and terminal contents are excluded (`docs/PRODUCT.md:105-113`),
requires those diagnostics in the first useful alpha
(`docs/PRODUCT.md:141-154`), and names timing, failure, stale, unverified, and
fallback rates as success measures (`docs/PRODUCT.md:180-192`). The roadmap
also lists local timing/failure diagnostics in Milestone 1 scope
(`ROADMAP.md:271-286`).

Today those measurements live only in the external acceptance runner: it times
capture and clipboard phases and prints sanitized host data
(`tools/acceptance/capture.cjs:363-430`, `:567-640`). The production main
process has no diagnostics collaborator or bridge channel: controller wiring is
at `src/main/index.ts:86-146`, workflow transitions are in
`src/main/capture-controller.ts:77-291`, and the bridge surface ends at
`src/shared/bridge.ts:10-72`. The runner therefore cannot observe the
authoritative main-process phase boundaries or aggregate product result rates.

## Remaining requirement matrix

| Requirement | Current evidence | Status for this slice |
| --- | --- | --- |
| Capture, clipboard, permission recovery, Stage, and Reveal seams | Phase 10–12 results and current unit suites cover pure policies, exact routing, lease lifetime, and typed outcomes (`research/phase-10-permission-recovery-results.md:40-70`, `research/phase-11-routing-recovery-results.md:48-79`, `research/phase-12-exact-reveal-results.md:50-79`) | Implemented at repository seams; native acceptance remains open |
| Local timing and failure diagnostics | Only the acceptance runner records timings; no product-owned recorder or diagnostics bridge | Missing; recommended Phase 13 |
| Configurable global shortcut | The registered accelerator is a main-process constant (`src/main/index.ts:23-29`, `:118-125`); UI reports registration but has no configuration surface (`src/renderer/src/main.tsx:228-236`, `:257-266`) | M1 gap, but settings/persistence is larger and appears in M2 scope (`ROADMAP.md:310-321`) |
| 200 complete/cancelled workflows and dogfooding | Runner has a 200-cancel loop and provisional process samples (`research/phase-8-capture-lifecycle-results.md:89-106`); its measured capture path uses a product button and bridge-driven selection (`research/phase-8-capture-lifecycle-results.md:73-87`) | Evidence work, explicitly excluded here |
| Crash, display, suspend/resume, TCC, focus, and real-agent acceptance | Unit/controller cleanup exists, but the roadmap and Phase 12 results retain packaged/native rows (`ROADMAP.md:288-301`, `research/phase-12-exact-reveal-results.md:81-94`) | Native/operator work, excluded here |
| Signed development builds | Current evidence records an ad-hoc package, not Developer ID signing (`research/phase-8-capture-lifecycle-results.md:61-67`) | Signing work, explicitly excluded here |

## Ranked repository-testable slices

1. **Sanitized diagnostics (recommended).** Directly satisfies a named M1
   scope item, makes the existing acceptance evidence authoritative at the
   main-process seam, and has low privacy risk when the snapshot contains only
   fixed categories, bounded counts, and bounded durations. It also gives the
   later native rows a stable evidence format without pretending to close them.

2. **Shortcut configuration and conflict contract.** The hard-coded shortcut is
   a real M1 scope gap and registration status already has a narrow bridge
   (`src/shared/bridge.ts:49-56`). A safe slice would validate a main-owned
   accelerator configuration, preserve the default, and test failed
   registration without capture changes. It ranks second because persistence,
   settings UX, conflict recovery, and packaged identity are deliberately M2
   concerns (`ROADMAP.md:303-332`); adding them now risks a shallow settings
   module.

3. **Adapter verification/read-back hardening.** Stronger Stage evidence would
   improve the product's core handoff, but the current WezTerm contract honestly
   reports `dispatched-unverified` and the remaining evidence requires real
   agent/version/keybinding trials (`ROADMAP.md:154-169`,
   `research/phase-6-wezterm-adapter-results.md:80-106`). A repository-only
   change cannot prove attachment and must not manufacture a verified result.

Native acceptance, Windows capture, signing, and a full packaged soak are not
ranked as implementation alternatives: the roadmap identifies them as gates,
not safe substitutes for a TypeScript seam (`ROADMAP.md:484-499`).

## Phase 13 contract

Place a deep `WorkflowDiagnostics` module at a main-process seam. Its interface
should be small enough that the controller does not know how aggregation or
sampling works:

```text
begin(operationId, trigger)
mark(operationId, phase)
finish(operationId, outcome)
recordReveal(status)
snapshot()
```

`trigger` is `shortcut | button`. The main shortcut callback supplies
`shortcut`; the existing no-payload renderer action supplies `button`. `phase`
is the closed set `selecting | selection-complete | editing`. Terminal timing
belongs to `finish`: a copied result is already downstream of clipboard
verification, while a Stage result is downstream of the one adapter attempt.
`outcome` is the existing delivery result category plus its bounded failure
reason; it does not carry a destination, note, image, or adapter payload. Reveal
records only its existing closed status
(`revealed | stale | unavailable | unsupported | failed`).

The `snapshot()` result should be a versioned strict value with:

- fixed outcome counters for `copied`, `dispatched-unverified`,
  `staged-verified`, `sent-verified`, `cancelled`, and each existing failure
  reason;
- fixed Reveal counters for its five statuses;
- timing summaries for `trigger -> selecting`, `selection-complete -> editing`,
  and `selection-complete -> result`, each with `count`, `minimum`, `median`,
  `p95`, and `maximum` in milliseconds;
- a maximum of 200 retained samples per timing stream and no operation IDs in
  the returned snapshot.

Use an injected monotonic clock in tests. Ignore or classify backwards/invalid
durations rather than emitting negative timings. A single active operation is
enough: the workflow already has one immutable operation ID and the controller
fences stale asynchronous work (`CONTEXT.md:10-24`,
`src/main/capture-controller.ts:26-45`, `:175-182`). Finalization must be
idempotent so a late Stage completion after cancellation cannot increment a
second result.

Expose `snapshot()` through one authorized, no-payload `getDiagnostics` main
bridge call, with a Zod schema in `src/shared/diagnostics.ts`. The first slice
should not render it in the product or persist it; the acceptance runner may
include the already-sanitized snapshot in its local JSON report. This keeps the
bridge useful and testable while deferring a diagnostics export to the M2 scope
(`ROADMAP.md:310-321`).

## Documentation verification

Context7 was used against the Node.js 24 API documentation selected by this
repository's engine range. Node documents `performance.now()` as a
high-resolution millisecond timestamp relative to the current Node process,
which makes it appropriate for elapsed phase durations and avoids wall-clock
changes. The production composition root therefore injects
`performance.now()` while tests inject deterministic clocks. Source:
[Node.js 24 Performance measurement APIs](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#performancenow).

## Likely files and red tests

Production seams:

- new `src/main/workflow-diagnostics.ts` and
  `src/shared/diagnostics.ts`;
- inject the recorder in `src/main/index.ts:89-117` and mark/finalize existing
  transitions in `src/main/capture-controller.ts:77-182`, `:207-285`;
- add the authorized `getDiagnostics` channel in
  `src/shared/bridge.ts`, `src/main/ipc.ts`, and `src/preload/index.ts`;
- have `tools/acceptance/capture.cjs` consume only the validated snapshot.

Red tests, in the narrowest order:

1. `src/main/workflow-diagnostics.test.ts`: deterministic timing summaries,
   all outcome/failure counters, 200-sample bound, idempotent finish, stale
   late completion, and absence of IDs/content from the snapshot.
2. `src/main/capture-controller.test.ts`: shortcut/button start, overlay-ready,
   selection/editing, verified clipboard, Copy/Stage failure, cancellation,
   unexpected overlay close, and Reveal status are recorded exactly once; all
   existing clipboard, no-retry, no-Enter, and result-state assertions remain
   unchanged.
3. `src/shared/diagnostics.test.ts` and `src/shared/bridge.test.ts`: strict
   schema, bounded numbers, fixed keys, no extra content fields, and
   operation-free no-payload request.
4. `tools/acceptance/capture.test.cjs`: sanitized diagnostics are included in
   the report and runner failures remain category-only.

## Exit criteria

- `npm run check` passes with the recorder, bridge, and acceptance tests; no GUI
  or native capture command is needed.
- Every controller terminal path produces at most one workflow diagnostic, and
  a stale/late adapter completion cannot relabel or double-count the workflow.
- A diagnostics snapshot contains no pixels, notes, clipboard bytes, paths,
  titles, terminal text, credentials, raw subprocess output, or operation IDs.
- Timing summaries are bounded, deterministic under an injected clock, and
  distinguish shortcut-triggered from button-triggered starts.
- The acceptance report can compare local timing and failure categories across
  runs without claiming shortcut delivery, attachment, foreground behavior,
  hardware coverage, signing, or alpha readiness.
- Existing Phase 12 invariants remain unchanged: exact route only, no Stage
  retry, no Enter, no active-pane fallback, no generic focus, unchanged Stage
  result, and Copy fallback.

## Sources

- [Roadmap](../ROADMAP.md)
- [Product direction](../docs/PRODUCT.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Domain context](../CONTEXT.md)
- [Phase 8 capture/lifecycle results](phase-8-capture-lifecycle-results.md)
- [Phase 10 permission results](phase-10-permission-recovery-results.md)
- [Phase 11 routing results](phase-11-routing-recovery-results.md)
- [Phase 12 Reveal results](phase-12-exact-reveal-results.md)
- `src/main/capture-controller.ts`, `src/main/index.ts`,
  `src/shared/bridge.ts`, and `tools/acceptance/capture.cjs`

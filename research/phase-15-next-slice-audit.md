# Phase 15 next-slice audit

Audit date: 2026-08-24

Scope: read-only repository audit after merged Phase 14 (`b40e3a3`). This report
does not launch ScreenFling, start Electron, run the capture overlay, run the
packaged acceptance runner, or claim native, hardware, signing, or operator
evidence. It ranks implementation work that can be completed and verified at
the repository seam.

## Recommendation

Make Phase 15 a **Screen Recording readiness and recovery surface**: a small,
main-owned permission-status service, a strict read-only bridge, and compact
main-surface guidance with an explicit recheck. Keep the existing capture-time
fail-closed check and result recovery unchanged.

This is the clearest remaining repository-testable slice because the product
promises clear Screen Recording guidance (`docs/PRODUCT.md:141-154`), Milestone
1 explicitly includes Screen Recording onboarding and permission diagnostics
(`ROADMAP.md:295-312`), and the Milestone 1 exit criteria require recoverable,
actionable permission UI (`ROADMAP.md:314-324`). The repository currently
interprets the permission state only inside the capture backend immediately
before/after source enumeration (`src/main/electron-capture-backend.ts:66-70`,
`:81-115`). The only user-facing permission guidance is therefore the failure
copy after a capture attempt (`src/renderer/src/delivery-copy.ts:11-26`).

The slice should be deliberately narrower than a general onboarding wizard. It
can tell the user what ScreenFling knows and how to recover, without pretending
that a status query proves pixels can be captured. Electron exposes
`systemPreferences.getMediaAccessStatus("screen")` as a macOS status query, and
the current architecture intentionally treats `not-determined`, `granted`,
and `unknown` as “attempt capture,” not as proof of capture success
(`docs/ARCHITECTURE.md:489-498`). There is no fake permission-request API or
native helper in this phase.

## Current gap

| Contract | Evidence in the current tree | Gap after Phase 14 |
| --- | --- | --- |
| Explain permission readiness before capture | `screenCapturePermissionPolicy` is pure and tested, but only the Electron backend calls the real status API during capture (`src/main/screen-capture-permission.ts:1-12`; `src/main/electron-capture-backend.ts:66-70`) | The main surface cannot show whether permission is blocked, undecided, available, or not applicable before the user starts a workflow. |
| Recover from denial/restriction | A blocked capture closes the operation safely and emits specific System Settings/restart copy (`src/renderer/src/delivery-copy.ts:18-20`; `ROADMAP.md:126-134`) | Guidance appears only after a failed capture; there is no recheck after the user changes permission. |
| Keep trust boundaries | All existing main operations use exact window/frame/document authorization and strict schemas (`src/main/ipc.ts:34-64`; `src/shared/bridge.ts:56-72`) | A readiness surface must add one no-payload, read-only main bridge; renderer must not receive Electron objects or permission authority. |
| Preserve cross-platform honesty | The policy already returns `allowed` for non-macOS platforms (`src/main/screen-capture-permission.ts:6-11`) | The UI needs an explicit non-macOS “managed by the platform / capture will be checked” state instead of fabricating a macOS TCC result. |
| Preserve privacy | Diagnostics intentionally exclude content, paths, IDs, and raw adapter data (`src/shared/diagnostics.ts:85-105`; `docs/ARCHITECTURE.md:515-527`) | Permission status should be an ephemeral capability status, not diagnostics history, telemetry, or persisted data. |

## Ranked remaining slices

1. **Permission readiness and recovery surface (recommended).** It closes a
   named Milestone 1 contract, builds on an already-tested policy, and has a
   bounded main/preload/renderer seam. It improves the first-run experience
   without requiring a permission request, native helper, or GUI test.

2. **Native Gate A/Gate B acceptance and the 200-workflow soak.** These have
   the highest release-evidence value and are explicitly next in the roadmap
   (`ROADMAP.md:518-528`), but they are not repository implementation slices.
   They require packaged identity, real display and lifecycle transitions,
   Screen Recording changes, physical shortcut delivery, visible no-focus
   trials, and actual agent/terminal observations. Unit fakes must not be
   counted as those results.

3. **Adapter configuration UI.** The current WezTerm route is an opt-in
   developer environment configuration, and stable settings/adapter
   configuration are Milestone 2 scope (`README.md:91-116`, `ROADMAP.md:336-347`).
   A public configuration UI would expand trust-sensitive path, ownership,
   version, and endpoint semantics before native compatibility acceptance.

4. **Diagnostics export or history.** The in-memory diagnostics bridge is
   intentionally complete for Phase 13 (`ROADMAP.md:228-233`). A redacted
   local export is explicitly Milestone 2 scope (`ROADMAP.md:336-347`); adding
   it now would introduce a durable format and privacy/recovery surface without
   closing the more immediate onboarding gap.

5. **Second destination, Windows capture, Linux, or a native helper.** These
   are later, demand-driven, optional, or gated by measured Electron/API
   failure. They would materially widen the product surface and cannot be the
   smallest next phase (`docs/PRODUCT.md:134-139`, `docs/ARCHITECTURE.md:500-513`).

## Phase 15 contract

### Main-owned permission service

Add a narrow service around the platform API, injected in tests:

```text
getScreenCaptureReadiness() -> {
  platform: "macos" | "windows" | "linux" | "other",
  status: "not-determined" | "granted" | "denied" | "restricted" | "unknown" | "not-applicable"
}
```

The production implementation may call Electron's
`systemPreferences.getMediaAccessStatus("screen")` only on macOS. Non-macOS
must return `not-applicable`, not a fabricated `granted` or `denied` result.
The service should not call `desktopCapturer`, write the clipboard, open a
settings application, or change permission state. The existing backend remains
the final preflight and post-enumeration guard because a status value is not
pixel evidence.

The response should be strict, versioned if the repository's existing bridge
contracts require it, bounded to the closed values above, and content-free. Do
not include executable paths, bundle identifiers, raw OS error strings,
timestamps, image data, operation IDs, or a persisted preference.

### Read-only bridge and UI

Add one authorized no-payload main operation, for example
`getScreenCaptureReadiness`, beside `getDiagnostics` and the Phase 14 shortcut
operations. Preload validates the response before exposing it. The main surface
should:

- show a compact “Screen Recording” status before the first capture;
- distinguish blocked/restricted, undecided, available, unknown, and
  not-applicable copy;
- explain the exact macOS Privacy & Security location and restart requirement
  for blocked/restricted state;
- offer a “Check again” action that re-reads status after the user changes
  System Settings;
- preserve the Capture button and existing clipboard fallback behavior;
- avoid claiming that `granted` guarantees a non-empty image or that
  `not-determined` guarantees a system prompt;
- remain keyboard accessible and avoid a modal or second settings subsystem.

The UI does not need to launch System Settings in this slice. A deep-link opener
would be a separate native/operator contract and should be added only after the
exact packaged URL behavior is accepted. Guidance can remain actionable with
the existing documented pane and restart language.

### Explicit exclusions

Do not add a permission request shim, native helper, background polling,
telemetry, diagnostics counters, settings persistence, a broad onboarding
wizard, adapter configuration, a new capture path, or a claim that permission
status proves capture correctness. Do not alter Stage/Reveal, shortcut
transactions, clipboard semantics, or lifecycle fencing.

## Likely implementation files and red tests

Likely production seams:

- `src/main/screen-capture-permission.ts`: extend the pure contract with a
  strict readiness value and platform mapping, or add a focused service module;
- `src/main/electron-capture-backend.ts` or a new injected platform service:
  isolate the Electron `systemPreferences` call without changing the existing
  capture-time policy;
- `src/shared/bridge.ts`, `src/main/ipc.ts`, and `src/preload/index.ts`: add
  one exact, authorized, no-payload request and validated response;
- `src/renderer/src/main.tsx`, `src/renderer/src/delivery-copy.ts`, and
  `src/renderer/src/styles.css`: render status, recovery copy, and recheck
  affordance without changing the capture workflow;
- `README.md`, `ROADMAP.md`, and a Phase 15 results note: document the
  repository seam and keep native evidence explicitly open.

Red tests, in order:

1. Permission policy/service tests: each macOS status maps to the correct
   readiness state; non-macOS never fabricates macOS TCC status; Electron API
   exceptions map to `unknown` without leaking exception text.
2. Shared schema/bridge tests: exact closed status values, no extra keys,
   no-payload request, and strict typed response parsing.
3. Main IPC authorization tests: main renderer succeeds; overlay, wrong frame,
   wrong document, extra payload, and malformed response/request fail before
   the provider is called, matching existing `getDiagnostics` protections.
4. Renderer tests: blocked/restricted guidance names the System Settings pane
   and restart; undecided/available/unknown/not-applicable copy is honest;
   recheck refreshes status; keyboard-visible controls remain accessible; the
   Capture button remains available.
5. Regression tests: existing permission recovery still closes the overlay,
   restores the main surface, and performs no clipboard write; existing Phase
   14 shortcut and diagnostics tests remain unchanged.

## Exit criteria

- `npm run check:all` passes with strict TypeScript, Prettier, the vendored
  generic anti-slop rules, all unit tests, build, and package checks.
- The readiness API has one main-owned implementation and one strict bridge;
  no renderer code imports Electron or calls a platform API.
- macOS blocked/restricted, undecided, granted, and unknown statuses have
  deterministic, content-free UI copy; non-macOS displays `not-applicable`.
- A user can recheck status after changing external settings without restarting
  the renderer or mutating workflow/shortcut state.
- Capture-time permission checks and denial recovery retain their existing
  fail-closed behavior and clipboard invariant.
- No test or report claims physical capture, TCC grant/revocation, packaged
  identity, restart behavior, real shortcut delivery, hardware/lifecycle
  coverage, WezTerm attachment, or alpha readiness.

## Native and operator-only evidence still open

This repository slice cannot establish:

- whether macOS or Windows grants/revokes Screen Recording for a packaged,
  stable-identity build;
- whether System Settings labels ScreenFling correctly or whether a restart is
  required on every supported OS version;
- whether `granted` produces non-empty, correctly dimensioned pixels on Retina,
  mixed-scale, rotated, reconnecting, or sleeping displays;
- physical global shortcut delivery, conflict recovery, or non-QWERTY behavior;
- visible WezTerm/agent target selection, no-focus routing, attachment/read-back,
  signing/notarization, or clean-machine install evidence;
- the 200 complete-workflow soak, comparative manual-paste value, or alpha
  release readiness.

Those rows remain the native/operator work described by Gate A/Gate B and the
Milestone 1 exit criteria (`ROADMAP.md:60-85`, `:147-169`, `:314-327`). The
correct result of Phase 15 is “permission readiness surface implemented at the
repository seam; native permission acceptance remains open.”
## Primary sources

- [Roadmap](../ROADMAP.md), especially Milestone 0, Milestone 1, Milestone 2,
  and the immediate implementation sequence.
- [Product direction](../docs/PRODUCT.md), especially initial scope and local
  success measures.
- [Architecture](../docs/ARCHITECTURE.md), especially platform services,
  permission policy, native-code gate, and privacy boundary.
- [Phase 10 permission recovery results](phase-10-permission-recovery-results.md).
- [Phase 14 configurable shortcut results](phase-14-configurable-shortcut-results.md).
- [Electron `systemPreferences` API](https://www.electronjs.org/docs/latest/api/system-preferences#getmediaaccessstatusmediatype-macos)
  (official API reference for macOS media-access status).
- [Electron `desktopCapturer` API](https://www.electronjs.org/docs/latest/api/desktop-capturer)
  (official capture API reference; capture output remains the evidence boundary).
- [Apple: Change Privacy & Security settings on Mac](https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac)
  (official user guidance referenced by the product's recovery copy).

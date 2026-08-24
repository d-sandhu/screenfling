# Phase 15 product-readiness research

Research date: 2026-08-24
Branch: `phase/15-next-slice`
Scope: compare three possible repository-testable slices after merged Phase 14.

This report does not launch ScreenFling, open a capture overlay, invoke a native
permission prompt, run a terminal/agent, or claim hardware, packaged, signing,
operator, or real-agent evidence. It uses the current repository plus official
Electron, Apple, and WezTerm documentation. Context7 was queried for the
Electron API contracts; the resulting primary-source links are listed below.

## Recommendation

Choose **A, narrowed to a read-only capture-readiness seam**:

> expose the current Screen Recording state through a main-owned, strict,
> content-free bridge and render actionable first-run guidance without trying to
> request permission, open System Settings, or claim that a capture succeeded.

This is a coherent Phase 15 because it addresses a named alpha contract—clear
Screen Recording guidance—and the missing UI layer over an already-tested
permission policy. It can be implemented and verified headlessly by injecting a
permission-status provider and testing the pure status-to-copy model, IPC
authorization, preload schema, and renderer states. The production provider can
call Electron from the main process, while native permission changes remain an
explicit follow-up acceptance task.

Do not call this “full onboarding.” Full onboarding includes packaged identity,
first-run permission prompting, System Settings navigation, restart/revocation
behavior, and a human confirmation that capture works. Those remain native
acceptance rows.

## Current repository evidence

| Area | What exists | Gap relevant to this comparison |
| --- | --- | --- |
| Permission policy | `screenCapturePermissionPolicy()` treats non-macOS as allowed and macOS `denied`/`restricted` as blocked (`src/main/screen-capture-permission.ts:1-12`). | No main-surface readiness status or first-use guidance before capture. |
| Capture enforcement | `ElectronCaptureBackend` checks `systemPreferences.getMediaAccessStatus("screen")` before capture and after source-enumeration/empty-image failures (`src/main/electron-capture-backend.ts:66-70`, `:81-114`). | The renderer sees permission copy only after a failed capture; it cannot distinguish a first-run state in advance. |
| Diagnostics | `WorkflowDiagnostics` is bounded and content-free (`src/main/workflow-diagnostics.ts:117-180`); the strict snapshot has fixed counters/timings (`src/shared/diagnostics.ts:85-105`). | It is intentionally in-memory and not yet a user-facing export. |
| Adapter configuration | WezTerm is enabled only when four experimental environment variables are present, and only on macOS (`src/main/configured-adapters.ts:5-52`). | No user configuration model, persistence, or safe path-selection UX. |
| Product/roadmap | The first useful alpha requires clear Screen Recording guidance (`docs/PRODUCT.md:141-154`) and Milestone 1 names onboarding/permission diagnostics (`ROADMAP.md:295-312`); diagnostics export and stable adapter settings are explicitly Milestone 2 (`ROADMAP.md:329-347`). | A small readiness surface belongs closer to the current alpha path than full settings/export. |

## Option A — Screen Recording readiness/onboarding

### API constraints and facts

Electron documents `systemPreferences.getMediaAccessStatus("screen")` as a
main-process API returning `not-determined`, `granted`, `denied`, `restricted`,
or `unknown`; on macOS 10.15 and later, screen capture requires user consent.
Electron’s `askForMediaAccess()` only accepts `microphone` or `camera`, not
`screen`. Therefore a renderer button must not pretend that Electron exposes a
generic “request screen permission” call. Sources: [Electron
`systemPreferences`](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesgetmediaaccessstatusmediatype),
[Electron `desktopCapturer`](https://www.electronjs.org/docs/latest/api/desktop-capturer#desktopcapturergetsourcesoptions).

Apple’s user-facing instructions put permission changes in System Settings →
Privacy & Security → Screen & System Audio Recording. Apple’s ScreenCaptureKit
documentation also describes requesting permission before capture and declaring
`NSScreenCaptureUsageDescription` for native ScreenCaptureKit clients. ScreenFling
currently uses Electron’s `desktopCapturer`, so it must not infer that a
ScreenCaptureKit native helper is needed or that its native usage-description
path applies unchanged. Sources: [Apple permission
instructions](https://support.apple.com/guide/mac-help/allow-apps-to-use-screen-and-audio-recording-mchl592e5686/mac),
[Apple ScreenCaptureKit overview](https://developer.apple.com/documentation/screencapturekit).

Electron’s `desktopCapturer.getSources({ types: ["screen"] })` documentation
explicitly says screen contents require consent on macOS 10.15+ and that the
status can be detected with `getMediaAccessStatus`. This supports a status
surface, but status alone cannot prove that a source will be returned on a
particular machine, display topology, or packaged identity.

### Recommended narrow contract

Add a shared, strict, content-free readiness value such as:

```text
{ version: 1, platform: "darwin" | "other", status:
  "not-determined" | "granted" | "denied" | "restricted" | "unknown" }
```

The main process owns the provider and exposes one authorized no-payload
`getCaptureReadiness` call. The renderer renders these states:

- `granted`: “Screen Recording permission is granted; capture still validates
  the selected display at runtime.”
- `not-determined`: “Screen Recording permission has not been confirmed yet.
  The first capture may require macOS consent.”
- `denied`/`restricted`: “ScreenFling cannot capture until it is allowed in
  System Settings → Privacy & Security → Screen & System Audio Recording.”
- `unknown`: “Screen Recording status could not be determined. Capture remains
  available to try, and the result will report any failure.”
- non-macOS: “Screen Recording permission status is not a macOS check.” Do not
  fabricate a Windows or Linux grant.

Keep the surface as a small status/guidance panel or disclosure in the existing
main window. Do not add a modal wizard, automatic settings deep link, polling
loop, permission request, image preview, path, or OS error text. A manual
“Refresh status” action is safe and easy to test, but it still does not prove
that capture works.

### Headless test plan

1. Pure shared policy tests cover all five statuses, both platform branches,
   exact copy categories, and strict rejection of extra fields.
2. Main provider tests inject a status reader and assert no renderer or overlay
   can call the provider.
3. IPC/preload tests cover exact sender/document authorization, one no-payload
   request, versioned response parsing, and no path/error leakage.
4. Renderer tests cover loading, granted, first-run, blocked, unknown, and
   non-macOS states plus keyboard focus and accessible status announcements.
5. Existing capture tests remain unchanged; denied/restricted capture still
   cleans up and does not write to the clipboard.

Native follow-up, explicitly not part of Phase 15: run a packaged stable-identity
matrix for first grant, denial, revocation, restart, System Settings labeling,
source enumeration, and real capture. Any “permission granted” claim in this
phase means only that Electron reported `granted` to the injected/provider API.

### Risks

- `granted` is a prerequisite signal, not an end-to-end capture guarantee.
- macOS wording and Settings labels can vary by OS release; keep copy accurate
  and avoid brittle deep-link automation.
- A visible status panel can imply false confidence if it uses green “ready”
  language. Prefer “permission reported granted” and retain runtime failure
  handling.
- Adding a native settings opener would introduce a GUI side effect and require
  operator verification; defer it.

## Option B — safe adapter configuration UX/persistence

### Current boundary

The configured WezTerm adapter accepts an executable, config file, socket, and
image-input bytes only through explicit experimental environment variables. A
partial or malformed configuration returns no adapter (`src/main/configured-
adapters.ts:21-50`). This is a deliberately fail-closed developer experiment,
not a user settings contract.

The official WezTerm CLI documentation says that its CLI connects to a running
GUI/multiplexer instance and that an omitted `--pane-id` can fall back to the
most-recently-interacted focused pane. It also documents `$WEZTERM_UNIX_SOCKET`
and explicit pane targeting. Those rules reinforce that ScreenFling must keep
socket/config/executable selection main-owned and exact; a renderer-selected
path or focused-pane fallback would violate the product’s routing contract.
Source: [WezTerm CLI targeting](https://wezterm.org/cli/cli/index.html#targeting-the-correct-instance).

### What a real safe UX would require

A complete configuration feature would need a versioned settings schema,
main-owned persistence, canonical path/type/owner/mode checks, executable
validation, socket replacement/generation checks, clear “configured but
unavailable” states, and a re-discovery/rollback story. It would also require
native acceptance with real WezTerm versions and agent sessions before exposing
Stage as anything stronger than `dispatched-unverified`.

This is substantially broader than a form. A form that merely saves paths would
create a dangerous appearance of support and make raw filesystem selectors part
of the renderer trust boundary. It also conflicts with the roadmap’s placement
of stable settings and adapter configuration in Milestone 2.

### Headless-testable subset and decision

Pure selector schemas, trusted-path policy, and adapter status-copy tests are
headless-testable and much of the selector policy already exists from prior
phases. They do not produce a complete user outcome without persistence and
real endpoint acceptance. **Defer B** until after packaged/native Gate B rows
identify which selectors and WezTerm/agent versions deserve a stable public UX.

## Option C — local diagnostics viewing/export

### Current boundary and API constraints

The current diagnostics snapshot is already versioned, strict, bounded, and
free of image pixels, notes, clipboard contents, operation IDs, destinations,
paths, and terminal data. It is intentionally process-local and in memory;
that design is recorded in `research/phase-13-sanitized-diagnostics-results.md`.

Electron’s official `dialog.showSaveDialog()` returns a user-selected file path,
and on macOS the asynchronous form is recommended. The dialog is a native user
interaction, so a complete export feature needs a main-owned dialog, explicit
file encoding/writing, cancellation and overwrite behavior, and packaged
permission/path tests. Source: [Electron
`dialog.showSaveDialog`](https://www.electronjs.org/docs/latest/api/dialog#dialogshowsavedialogwindow-options).

### Headless-testable subset and decision

A pure `serializeDiagnostics(snapshot)` function and fake file-writer tests are
straightforward. A useful product slice would also need a UI action and a
native save-dialog path. Adding only serialization would be an internal helper,
not a coherent user outcome; adding the full action is explicitly a Milestone 2
deliverable. **Defer C**. Preserve the existing strict snapshot and add export
only after the permission/readiness and native acceptance work establishes what
diagnostic fields users actually need.

## Ranking and trade-off

| Rank | Slice | Product leverage now | Headless completeness | Native/operator dependency | Decision |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | A: readiness status + guidance | High: fills a named first-run contract and prevents a stuck/opaque first capture | High with injected provider and renderer tests | Still required for actual grant/revoke/capture | **Phase 15** |
| 2 | C: diagnostics export | Medium: useful to contributors, but already scheduled for M2 | Medium: serializer is easy, full UX is native-dialog dependent | Save dialog, filesystem, redaction review | Defer |
| 3 | B: adapter configuration UX | Potentially high later, but risky before Gate B evidence | Low-to-medium for a complete user feature | Real WezTerm/agent/version trials and selector ownership | Defer |

## Proposed Phase 15 exit criteria

- A strict, versioned readiness schema and pure status-copy policy are tested for
  all supported status/platform combinations.
- Main-only Electron status access is injected and tested without importing
  Electron in shared or renderer modules.
- One authorized no-payload bridge call returns only fixed status values; the
  overlay and untrusted documents cannot access it.
- The main UI gives actionable, content-free guidance for not-determined and
  denied/restricted states and does not claim end-to-end capture success.
- Existing permission-blocked cleanup and clipboard invariants remain green.
- `npm run check:all` and the anti-slop Oxlint gate pass without launching the app
  or any native/operator acceptance runner.
- Documentation records the exact evidence boundary and keeps packaged TCC,
  System Settings, hardware, and real-capture acceptance open.

## Sources

- [Electron `systemPreferences.getMediaAccessStatus`](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesgetmediaaccessstatusmediatype)
- [Electron `desktopCapturer.getSources`](https://www.electronjs.org/docs/latest/api/desktop-capturer#desktopcapturergetsourcesoptions)
- [Electron `dialog.showSaveDialog`](https://www.electronjs.org/docs/latest/api/dialog#dialogshowsavedialogwindow-options)
- [Electron `app.getPath`](https://www.electronjs.org/docs/latest/api/app#appgetpathname)
- [Apple: allow apps to use screen and audio recording](https://support.apple.com/guide/mac-help/allow-apps-to-use-screen-and-audio-recording-mchl592e5686/mac)
- [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)
- [WezTerm CLI targeting](https://wezterm.org/cli/cli/index.html#targeting-the-correct-instance)
- Local: [product direction](../docs/PRODUCT.md), [roadmap](../ROADMAP.md),
  [architecture](../docs/ARCHITECTURE.md), [Phase 13 diagnostics results](phase-13-sanitized-diagnostics-results.md),
  and [Phase 14 next-slice audit](phase-14-next-slice-audit.md).

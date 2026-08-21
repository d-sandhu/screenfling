# Phase 8 capture and lifecycle acceptance plan

Research date: 2026-08-21
Target tree: `main` at `9c175fd`; Electron `43.4.1`; electron-builder `26.15.3`
Status: proposed next-PR slice; this report does not close Gate A or approve an alpha

Implementation note: this document records the research recommendation, not a
claim that every row shipped in Phase 8. The implemented lifecycle and hardened
packaged-runner subset is recorded in
[Phase 8 capture and lifecycle results](phase-8-capture-lifecycle-results.md).
Internal phase clocks, a direct clipboard sentinel, listener-count inspection,
TCC status, physical pointer input, and the remaining native matrix stay open.

## Recommendation

The next PR should be one narrow, packaged-capture acceptance slice:

1. add a test-only packaged runner that records sanitized phase timings and drives
   one-display Capture, selection, Copy, and Escape through the existing bridge;
2. add a deterministic 200-cycle Capture/Cancel soak with a clipboard sentinel and
   window/operation/listener counts; and
3. harden the lifecycle boundary so a suspend/resume event cancels an active
   snapshot/selection before it can be reused, with unit coverage for every
   display and power event.

The runner should emit JSON containing only app/Electron/OS versions, display
geometry and scale metadata, returned image dimensions, phase durations, result
codes, overlay/window counts, and resource samples. It must not write image bytes,
notes, clipboard contents, paths, or window titles. Run it against a packaged app;
development-mode results are smoke evidence only.

This is the smallest slice that converts the current prototype measurements into
repeatable production evidence without adding a native helper, a second capture
backend, or product diagnostics UI. It can close the one-display packaged timing
and soak rows on a named host if the measured thresholds pass. It cannot close the
multi-display, permission, or Windows rows by simulation.

## Current evidence and code boundary

The roadmap still leaves Gate A open for end-to-end release-to-clipboard timing,
mixed-scale and negative-origin displays, rotation, reconnect, sleep/wake,
permission denial/revocation, and native Windows capture. Milestone 1 additionally
requires recoverable permission UX, a 200-workflow soak, and crash recovery.

The production tree already contains:

- `ElectronCaptureBackend`, which chooses the display under the pointer, requests
  a physical-pixel-sized thumbnail, matches exactly one `display_id`, rechecks
  geometry, and rejects empty images;
- `CaptureSession`, which retains the lossless image in main, sends a bounded JPEG
  preview, maps measured returned-pixel ratios, crops in main, and verifies the
  image clipboard by pixel read-back;
- `CaptureController`, which handles cancellation, stale operations, display
  invalidation, hidden-overlay failure, and clipboard-safe failure states; and
- `index.ts`, which registers the shortcut after `app.whenReady()`, listens to the
  three Electron display events, and unregisters shortcuts on `will-quit`.

Existing tests cover the pure contracts in
`src/shared/capture-geometry.test.ts`, `src/main/electron-capture-backend.test.ts`,
`src/main/capture-session.test.ts`, `src/main/capture-controller.test.ts`, and
`src/main/window-options.test.ts`. They do not exercise Electron's real compositor,
screen source enumeration, OS clipboard, TCC, display hardware, or packaged
identity.

The Phase 3 packaged prototype recorded 20/20 non-empty single-display captures,
124.73 ms p95 shortcut-to-overlay readiness, and a 200-cycle cancel run with an
unchanged clipboard and no monotonic RSS growth. Phase 5 and Phase 7 explicitly
say those runs did not measure production end-to-end selection timing, invoke the
real shortcut, cover the display/lifecycle matrix, or test permission revocation.
Those numbers must not be copied forward as production acceptance.

## What the platform documentation supports

Context7 was used first, as required:

- resolved **Electron** to `/electron/electron` (high reputation; 4,173 current
  snippets at lookup time);
- queried only three focused topics: desktop capture/display lifecycle,
  packaged permission and shortcut behavior, and overlay/clipboard lifecycle.

The results were checked against first-party documentation/source dated 2026-08-21:

- Electron [`desktopCapturer`](https://www.electronjs.org/docs/latest/api/desktop-capturer)
  documents that `thumbnailSize` is a requested size, not a returned-size
  guarantee, and that macOS screen contents require user consent. The source
  object’s `display_id` corresponds to the matching Screen API display when
  available, but may be empty. This supports the existing exact-ID and measured
  dimensions checks; it does not prove a given monitor topology works.
- Electron [`screen`](https://www.electronjs.org/docs/latest/api/screen) defines
  DIP versus physical screen points, reports cursor positions in DIPs, and emits
  `display-added`, `display-removed`, and `display-metrics-changed` (including
  bounds, scale factor, and rotation). It explicitly requires `app.ready` before
  use. The pinned v43.4.1 source is also available at
  [`screen.md`](https://raw.githubusercontent.com/electron/electron/v43.4.1/docs/api/screen.md).
- Electron [`systemPreferences.getMediaAccessStatus`](https://www.electronjs.org/docs/latest/api/system-preferences)
  exposes `not-determined`, `granted`, `denied`, `restricted`, and `unknown` for
  screen access on macOS. The same documentation says Windows reports screen as
  `granted`; there is no equivalent Electron Windows screen-permission denial
  flow to automate. The permission status alone is not proof that capture pixels
  will be returned.
- Electron [`BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window)
  says a hidden window can paint before `ready-to-show`, and that `closed` means
  references must be removed. `setContentProtection(true)` excludes a window on
  supported Windows versions but newer macOS ScreenCaptureKit applications may
  still capture it. The pinned v43.4.1 window lifecycle source is linked at
  [`browser-window.md`](https://raw.githubusercontent.com/electron/electron/v43.4.1/docs/api/browser-window.md).
- Electron [`clipboard`](https://www.electronjs.org/docs/latest/api/clipboard)
  defines main-process `writeImage`/`readImage`; [`nativeImage`](https://www.electronjs.org/docs/latest/api/native-image)
  defines `getSize()` and pixel-coordinate `crop()`. These APIs establish a
  clipboard write/read-back contract, not that an arbitrary consumer will paste
  the image.
- Electron [`globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut)
  returns a boolean from `register()` and documents unregistering on `will-quit`.
  A true registration result is not evidence that the real keystroke was delivered
  under another app’s focus.
- Electron [`powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor)
  exposes `suspend` and `resume`. Using those events to invalidate an active
  capture is an engineering recommendation, not a claim that every display driver
  emits a matching screen event.
- Apple’s [`ScreenCaptureKit` sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)
  says its first run requests Screen Recording access and that the app must be
  restarted after permission is granted. Apple’s [`SCContentFilter`](https://developer.apple.com/documentation/screencapturekit/sccontentfilter)
  documents display capture with excluded windows/apps. Those are future native
  fallback capabilities; they do not justify adding a helper while the Electron
  path remains unmeasured on the missing rows.
- Microsoft’s [`SetWindowDisplayAffinity`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)
  documents `WDA_EXCLUDEFROMCAPTURE` from Windows 10 version 2004 and warns it is
  not DRM. This confirms that overlay exclusion is not a portable proof technique;
  snapshot-before-overlay remains the required invariant.
- Microsoft’s [`Windows.Graphics.Capture` screen-capture guidance](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture)
  documents a separate native display/window frame path and device-lost/resize
  handling. It is a fallback comparison point only, not evidence for the current
  Electron backend.

## Acceptance row classification

| Gate A / lifecycle row | Automatable in repository now | Requires native host state | Human observation needed |
| --- | --- | --- | --- |
| Crop edges within one physical pixel; fractional/reverse/edge drags | Yes: extend the existing geometry fixture/property cases and fake-image crop assertions. | A real colored grid on each supported display is still needed for release evidence. | No, if the grid and pixel read-back are deterministic. |
| Returned dimensions and exact `display_id` matching | Yes: missing, duplicate, empty-ID, and mismatched-source fixtures; assert actual `getSize()` drives mapping. | Real `desktopCapturer` enumeration on macOS and Windows. | No. |
| Overlay absent from captured result | Unit-test snapshot-before-show ordering now; package runner can compare a transient on-screen test grid and returned pixels. | A real compositor/package run; `setContentProtection` is not sufficient on modern macOS. | Only if the pixel fixture cannot establish the result. |
| Shortcut → interactive overlay p95 ≤150 ms | Add sanitized phase clocks and a package-runner percentile calculation now. | The pass/fail number requires a packaged named host, warm shortcut delivery, and repeated native captures. | No for automation; human smoke should confirm the shortcut while another app is focused. |
| Selection release → clipboard-ready p95 ≤150 ms | Add release/crop/encode/write/read-back timestamps and a package-runner assertion. | Real pointer events, compositor, native image encode, and OS clipboard. | No for timing; one visual smoke run is useful. |
| Cancel/failure leaves prior clipboard unchanged | Existing fake contract tests; package runner can write a sentinel image, cancel, then verify sentinel dimensions/bitmap. | OS clipboard permission/ownership behavior in a packaged app. | No. |
| 200 capture/cancel cycles, no monotonic image/window/listener growth | Add a sanitized package soak with window count, active operation, listener count, and RSS samples; assert no overlay survives and sentinel is unchanged. | Real Electron image allocation and renderer lifecycle; run on each baseline OS. | No, but inspect a captured resource report. |
| Display add/remove/re-metrics cancellation | Existing controller/session injection tests; add a table for all event types and phases. | Actual hot-plug, scale change, and rotation events. | Human should confirm recovery if the display disappears mid-overlay. |
| Mixed-scale displays and negative origins | Geometry is already automatable with synthetic `CaptureDisplay` values. | Actual two-display macOS and Windows layout with one monitor left/above and differing scales. | A visual smoke check of overlay placement is recommended. |
| Rotation | Geometry/invalidation metadata is automatable. | Actual portrait display and source image orientation on macOS/Windows. | Visual placement check recommended. |
| Sleep/wake | Add pure `suspend`/`resume` cancellation tests and a one-shot acceptance command. | Actual OS sleep/wake and compositor/display re-enumeration. | Yes: observe that no stale overlay/clipboard mutation remains after resume. |
| macOS denial, grant, revocation | Add pure status-to-result tests for all documented statuses. | Change Screen Recording in System Settings using the exact packaged bundle identity; grant/revoke may require restart. | Yes: confirm actionable guidance and recovery. |
| Windows permission denial | No meaningful OS denial row: Electron documents screen as always granted. Test capture failure/unsupported hardware instead. | Native Windows packaged capture and clipboard remain required. | Only visual smoke. |
| Stable identity and signed package | Assert package metadata and `app.isPackaged` in the runner. | A stable signed/notarized macOS identity and signed Windows artifact; ad-hoc development identity is not release evidence. | Human must verify the privacy panel names the intended app. |

The “automatable” column means a deterministic test can be added now; it does not
mean the row is release-closed without native packaged evidence.

## Exact next-PR test contract

Keep the implementation small and test-only where possible:

1. **Timing contract.** Record monotonic timestamps for `shortcut-start`,
   `capture-returned`, `overlay-ready`, `selection-release`, `crop-complete`,
   `clipboard-write`, and `clipboard-readback`. Emit p50/p95 and sample count.
   Assert p95 only in a packaged acceptance command, not in ordinary Vitest. The
   command fails if any capture is empty, read-back differs, or the required phase
   is missing.
2. **Packaged one-display run.** Launch the built artifact with a test-only
   acceptance flag, set a clipboard sentinel, perform at least 20 warm captures,
   select a known region by CDP/native pointer events, verify non-empty returned
   dimensions and image read-back, then cancel one run and verify the sentinel is
   unchanged. Record the exact app version, Electron version, OS build, bundle
   identity, display bounds/DIP scale/rotation, and requested versus returned image
   size.
3. **200-cycle soak.** Repeat capture/cancel 200 times with no forced garbage
   collection. At each cycle assert one main window, zero overlay windows after
   cancellation, no active operation, unchanged sentinel, and no listener-count
   increase. Sample RSS before, during, and two minutes after the run. Treat RSS as
   evidence, not a leak proof; reject monotonic image/window/listener growth.
4. **Lifecycle table.** Unit-test `display-added`, `display-removed`,
   `display-metrics-changed`, `suspend`, and `resume` in `snapshotting` and
   `selecting`. The expected result is one safe failure/cancel, overlay closed,
   main surface restored, no clipboard write, and no stale operation. Preserve the
   current rule that side effects already in `writing-clipboard`/`staging` are not
   interrupted by a late display event.
5. **Permission table.** Unit-test `not-determined`, `granted`, `denied`,
   `restricted`, and `unknown` mapping separately from Electron. The packaged
   macOS run must record the observed TCC status and exact identity; it must not
   claim that a mocked status tests TCC.

Do not add a native ScreenCaptureKit or Windows.Graphics.Capture backend in this
PR. Do not store test screenshots or clipboard data. Do not claim mixed-display,
rotation, sleep/wake, permission, or Windows closure from fake tests.

## Blockers and decision points

- No attached multi-display macOS/Windows hardware is available in the repository;
  synthetic geometry cannot prove source enumeration, compositor placement, or
  returned orientation.
- Permission denial/revocation is OS state tied to the packaged application being
  tested (the Phase 5 evidence explicitly distinguishes the packaged bundle from
  the development `com.github.Electron` identity). The current `package:mac`
  command produces an ad-hoc directory build, so it is not release-signing
  evidence. A stable packaged identity is required for repeatable TCC evidence;
  Apple’s sample also requires a restart after grant. Whether notarization itself
  is required must be established by the host run, not assumed here.
- The current code has no production timing recorder or packaged acceptance
  driver. Adding a sanitized test seam is prerequisite work; without it, separate
  crop/clipboard timings cannot establish the roadmap’s end-to-end p95 row.
- Real shortcut delivery, display sleep/wake, and visual recovery benefit from a
  human smoke pass even when the package runner automates the state transitions.
- If the packaged macOS one-display runner fails the p95 or pixel invariant, first
  compare Electron’s still-thumbnail path with a display-media first frame. Only a
  measured failure of both practical Electron paths should reopen the native-helper
  decision.

## Sources and repository evidence

Repository evidence read on 2026-08-21:

- [Roadmap Gate A and Milestone 1](../ROADMAP.md)
- [Phase 3 feasibility results](phase-3-feasibility-results.md)
- [Phase 5 packaged capture dogfood](phase-5-packaged-capture-dogfood.md)
- [Production capture implementation evidence](production-capture-implementation-current-evidence.md)
- [Phase 7 joined-flow results](phase-7-joined-flow-results.md)
- [Capture platform feasibility](capture-platform-feasibility.md)
- [Architecture verification strategy](../docs/ARCHITECTURE.md)

All external claims above are linked to Electron, Apple, or Microsoft first-party
documentation. Context7 was a documentation lookup aid; the linked first-party
pages control where current Context7 output and pinned Electron documentation
could differ.

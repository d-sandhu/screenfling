# Phase 20 shortcut latency research

Research date: **2026-08-24**

Status: primary-source research complete; one measured branch experiment
selected for physical validation.

## Question and evidence boundary

Phase 19 measured 20 warm physical global-shortcut starts on the packaged macOS
application. All reached the interactive overlay, but nearest-rank p95 was
206.78 ms against the <=150 ms target. ScreenFling therefore needs at least
56.78 ms of p95 improvement without moving capture before the main window is
hidden, showing an overlay before its frozen pixels are ready, or weakening the
target.

This note combines Context7 results for `/electron/electron` with Electron
43.4.1 documentation and implementation source pinned to the exact dependency
version. Documented Electron behavior is labelled **Fact**. Conclusions about
ScreenFling or likely latency are labelled **Inference** until component timing
proves them.

## Current hot path

At repository commit `a51108a71ba893f35a31eff40727fbf602591741`, one shortcut
performs these steps serially:

1. hide the main window and wait a deliberate 16 ms boundary;
2. resolve the display under the pointer;
3. construct a new hidden `BrowserWindow` and await `loadURL()`;
4. request full-physical-size screen thumbnails from
   `desktopCapturer.getSources()`;
5. select the matching display and synchronously encode its full image as JPEG;
6. send the JPEG `Uint8Array` to the overlay renderer;
7. create a Blob URL, wait for the `<img>` `load` event, then invoke overlay
   ready;
8. call `show()`, then `focus()`, and mark the workflow selecting.

Sources: [capture controller](../src/main/capture-controller.ts),
[overlay window](../src/main/capture-overlay-window.ts),
[capture backend](../src/main/electron-capture-backend.ts),
[capture session](../src/main/capture-session.ts), and
[capture renderer](../src/renderer/src/main.tsx).

The Phase 19 number is aggregate. It does not identify which step owns the
missing 56.78 ms, and it must not be used to claim that window creation,
capture, encoding, IPC, image decode, or presentation is the bottleneck.

## Measured branch experiment

After the research pass, sanitized main-process marks measured the existing
serial packaged path. Its start-to-selecting p95 was 197.95 ms. The component
p95 values were 24.72 ms from start through main hiding, 85.68 ms from main
hidden through overlay preparation, 80.40 ms from overlay preparation through
snapshot readiness, and 13.45 ms from snapshot readiness through selecting.
These are separate percentile distributions and must not be added together.

The two approximately 80 ms operations were independent after the overlay
window was synchronously constructed with exact hidden bounds. A smaller
experiment than persistent preloading therefore ran its hidden renderer
navigation concurrently with fresh display capture, waited for both branches
to settle, and only then sent or showed the snapshot. The packaged main-owned
start-to-selecting p95 became 134.55 ms. The separate external
scripted-button-to-observed-overlay p95 was 175.25 ms because it includes
automation and observation overhead outside the main-owned product interval.

This result selects concurrent hidden loading as the first production candidate
and leaves persistent preloading unimplemented. It is exact-package scripted
control evidence, not the required 20-sample physical-shortcut result, so
`A.shortcut.latency` remains open.

## BrowserWindow load, paint, and presentation

### What Electron guarantees

- **Fact:** `BrowserWindow.loadURL()` resolves when the page has finished
  loading, the same boundary as `did-finish-load`; that event means navigation
  finished and `onload` was dispatched. Awaiting it on every capture therefore
  places a full navigation boundary in ScreenFling's hot path. Sources:
  [Electron 43.4.1 `webContents.loadURL`](https://github.com/electron/electron/blob/v43.4.1/docs/api/web-contents.md#contentsloadurlurl-options),
  [`did-finish-load`](https://github.com/electron/electron/blob/v43.4.1/docs/api/web-contents.md#event-did-finish-load).
- **Fact:** `ready-to-show` reports the renderer's first rendered page and is
  intended to avoid visual flash. It is usually after `did-finish-load`, but can
  precede it for pages with many remote resources. Electron's implementation
  emits it from `OnFirstNonEmptyLayout` for the primary main frame. It does not
  mean ScreenFling's later JPEG snapshot has crossed IPC and decoded. Sources:
  [Electron 43.4.1 BrowserWindow guidance](https://github.com/electron/electron/blob/v43.4.1/docs/api/browser-window.md#using-the-ready-to-show-event),
  [pinned emission source](https://github.com/electron/electron/blob/v43.4.1/shell/browser/api/electron_api_web_contents.cc#L2247-L2252).
- **Fact:** a window created with `show: false` paints by default.
  `paintWhenInitiallyHidden` defaults to `true`; setting it to `false` prevents
  `ready-to-show`. Electron also says a newly created hidden window initially
  has visible page state. Sources:
  [`paintWhenInitiallyHidden`](https://github.com/electron/electron/blob/v43.4.1/docs/api/structures/browser-window-options.md#browserwindowconstructoroptions-object-extends-basewindowconstructoroptions),
  [page visibility](https://github.com/electron/electron/blob/v43.4.1/docs/api/browser-window.md#page-visibility).
- **Fact:** `backgroundThrottling` defaults to `true` and controls background
  animation/timer throttling. Disabling it makes frames draw and swap for the
  whole window even while backgrounded. Source:
  [Electron 43.4.1 web preferences](https://github.com/electron/electron/blob/v43.4.1/docs/api/structures/web-preferences.md#webpreferences-object).
- **Fact:** `win.show()` already shows and focuses the window;
  `win.showInactive()` shows without focusing. On macOS, Electron 43.4.1's
  `Show()` activates the application and calls `makeKeyAndOrderFront`, while
  `ShowInactive()` orders the window front without activating it. Sources:
  [BrowserWindow methods](https://github.com/electron/electron/blob/v43.4.1/docs/api/browser-window.md#winshow),
  [pinned macOS implementation](https://github.com/electron/electron/blob/v43.4.1/shell/browser/native_window_mac.mm#L468-L505).

### What follows for ScreenFling

- **Inference:** creating and loading the overlay at every shortcut is the
  strongest avoidable fixed-cost candidate. A hidden overlay may be constructed
  and loaded after application startup, outside the measured shortcut path,
  because Electron keeps a newly created hidden renderer active by default.
  Only profiling can establish the saved p95.
- **Inference:** a preloaded **disposable** overlay is safer and simpler than a
  permanently reused operation surface. Prepare one hidden loaded window, use it
  for one capture, destroy it at the existing close boundary, then prepare the
  next hidden window asynchronously. This avoids stale React, pointer-capture,
  operation-ID, and image state across operations while removing creation and
  navigation from the usual hot path. If no prepared window is available, the
  existing on-demand path should remain the fail-safe fallback.
- **Inference:** `ready-to-show` is useful as a profiling mark for initial
  renderer paint, not as ScreenFling's interactive-ready gate. The existing
  snapshot receipt plus `<img onLoad>` plus operation-specific ready IPC is the
  correct semantic gate. A prepared-window implementation should also prove the
  capture bridge is subscribed before advertising the window as available.
- **Inference:** `paintWhenInitiallyHidden: false` works against prewarming and
  should not be added. `backgroundThrottling: false` should also not be added by
  default: it has a continuous energy/rendering cost and there is no measurement
  yet showing that throttling delays ScreenFling. Test it only if reused or
  re-hidden window measurements isolate a scheduling delay.
- **Inference:** the explicit `focus()` after `show()` is semantically redundant
  on Electron 43.4.1. Removing it is a small, testable cleanup, but there is no
  evidence that it can recover a meaningful part of 56.78 ms. `showInactive()`
  is not a substitute because the selection surface needs keyboard and pointer
  interaction and the acceptance contract expects it to become interactive.

## Desktop capture cost and reuse limits

### What Electron guarantees

- **Fact:** `desktopCapturer.getSources()` returns every requested source with a
  `NativeImage` thumbnail. `thumbnailSize` defaults to 150 x 150. Electron
  explicitly says using a zero width or height when thumbnails are unnecessary
  saves the processing required to capture each window and screen. ScreenFling
  requests only `screen` sources, disables window icons, and requests the
  selected display's full physical dimensions. Sources:
  [Electron 43.4.1 desktopCapturer](https://github.com/electron/electron/blob/v43.4.1/docs/api/desktop-capturer.md#desktopcapturergetsourcesoptions),
  [ScreenFling backend](../src/main/electron-capture-backend.ts).
- **Fact:** Electron 43.4.1 internally coalesces only concurrently running
  `getSources()` calls whose options are equal. It removes that entry as soon as
  the request resolves or rejects and creates a capturer for the request. This
  is not a persistent public capture cache. Source:
  [pinned `desktopCapturer` implementation](https://github.com/electron/electron/blob/v43.4.1/lib/browser/api/desktop-capturer.ts#L22-L101).
- **Fact:** on macOS, Electron's same implementation performs special handling
  around every capture because ScreenCaptureKit can modify a non-resizable
  window's style mask on first capture. That is an Electron implementation
  detail, not a public promise that arbitrary capture/window races are safe.
  Source:
  [pinned macOS handling](https://github.com/electron/electron/blob/v43.4.1/lib/browser/api/desktop-capturer.ts#L25-L32).

### What follows for ScreenFling

- **Inference:** `thumbnailSize: { width: 0, height: 0 }` is not an optimization
  available to the current backend; the thumbnail is the captured image retained
  for exact crop and clipboard output. Reducing it would change the capture
  artifact, not merely the preview.
- **Inference:** starting an earlier capture or caching a completed
  `getSources()` result is unsafe and incorrect. It can retain stale/private
  pixels and no longer represents the screen at shortcut time. The captured
  image must remain fresh per operation.
- **Inference:** there is no documented targeted-display or persistent capturer
  option in `getSources()` that ScreenFling can switch on. It already uses the
  narrow public options: screens only, exact output size, no icons. Replacing
  this boundary should be considered only if profiling proves it dominates and
  a separately researched native backend preserves permission, display-ID,
  failure, and pixel invariants.
- **Inference:** if prewarming is not enough, hidden overlay loading and capture
  might be evaluated in parallel only after the overlay window has been created
  and its exact bounds established. That is a second experiment, not the first
  change: renderer startup can contend with capture, and creating or mutating a
  non-resizable macOS window during ScreenCaptureKit enumeration introduces an
  unproven race.

## NativeImage encoding and IPC payload

### What Electron guarantees

- **Fact:** `NativeImage.toJPEG(quality)` returns a JPEG `Buffer`;
  `toPNG()` returns a PNG `Buffer`; and `toBitmap()` returns a **copy** of the raw
  bitmap pixels. These are ordinary return values rather than Promises.
  `NativeImage.resize()` exposes a documented quality/speed tradeoff. Source:
  [Electron 43.4.1 NativeImage](https://github.com/electron/electron/blob/v43.4.1/docs/api/native-image.md#instance-methods).
- **Fact:** `webContents.send()` serializes arguments with the Structured Clone
  Algorithm. Electron objects are not standard cloneable payloads, so sending a
  `NativeImage` itself is not a supported shortcut around encoding or standard
  byte transport. Source:
  [Electron 43.4.1 `webContents.send`](https://github.com/electron/electron/blob/v43.4.1/docs/api/web-contents.md#contentssendchannel-args).

### What follows for ScreenFling

- **Inference:** full-image JPEG encoding is a credible main-thread cost because
  it is called synchronously before IPC. The encoded byte array then crosses a
  structured-clone boundary, and ScreenFling currently creates another typed
  array before constructing the renderer Blob. Timing and byte-count marks are
  required before assigning significance to any of those copies.
- **Inference:** raw bitmap transport is likely worse for this surface because
  `toBitmap()` explicitly copies uncompressed pixels. A Data URL adds a string
  representation and is not a supported zero-copy path. PNG is reserved for
  lossless clipboard output after selection; switching the full-screen preview
  from JPEG to PNG has no documented latency benefit.
- **Inference:** ScreenFling can keep the exact full-resolution `NativeImage` in
  the main process for crop mapping while sending a separately resized JPEG only
  for visual selection. That can reduce encode, structured-clone, Blob, and
  decode work without changing the selected crop. It does trade preview
  sharpness for latency on scale-2 displays, so it belongs after overlay
  prewarming and needs visual mixed-scale checks. Candidate measurements should
  compare current physical-size preview, display-DIP preview, and one
  intermediate scale; do not change clipboard encoding or pixel mapping.

## Safe macOS ordering to preserve

Any experiment should retain this observable order:

1. receive exactly one registered shortcut callback;
2. hide the main window and complete the measured hide/settle boundary;
3. resolve the current display and apply its exact bounds to a hidden prepared
   overlay, verifying the resulting bounds;
4. capture fresh display pixels while every ScreenFling window remains hidden;
5. select the exact source and retain its full-resolution `NativeImage` in the
   main process;
6. encode and send a bounded overlay preview tagged with the current operation;
7. wait for that preview's `<img onLoad>` and ready IPC;
8. call `show()` once, then measure actual presentation/interactivity;
9. on cancel, failure, selection, display change, or unexpected close, clear the
   operation and destroy the consumed overlay; never reveal an old preview.

This ordering is a ScreenFling safety inference grounded in the existing
snapshot-first design. Electron documents window and capture primitives, but it
does not certify that reordering them excludes ScreenFling UI or stale pixels.
The existing synthetic-grid and physical-display checks therefore remain
required after an optimization.

## Required profiling before production optimization

Add sanitized monotonic marks, with no display content or private identifiers,
for:

| Interval | Start | End |
| --- | --- | --- |
| main hide | shortcut callback | 16 ms settle complete |
| display resolution | settle complete | selected display validated |
| overlay construction | constructor start | constructor return |
| overlay navigation | `loadURL` start | resolve / `did-finish-load` |
| first renderer paint | constructor start | `ready-to-show` |
| source capture | `getSources` call | promise resolve |
| preview encode | `toJPEG` start | return, recording byte count only |
| IPC and decode | `webContents.send` | renderer `<img onLoad>` |
| presentation | ready IPC received | `show()` return and next visible renderer frame |
| end-to-end | shortcut callback | physical interactive-overlay observation |

Run the same packaged warm protocol used in Phase 19. Report per-interval
median, nearest-rank p95, and maximum, plus end-to-end p95. Main-process
`show()` return and a renderer frame are diagnostic boundaries, not substitutes
for the physical acceptance endpoint.

## Pre-measurement experiment ranking

1. **Preload a one-use hidden overlay outside the shortcut path.** Keep default
   initial painting, await load completion and bridge readiness, set and verify
   current display bounds before capture, and preserve on-demand fallback.
   Verify cancellation, unexpected close, display change, first drag, mixed
   scale, and no stale preview. This has the clearest chance to remove a serial
   hot-path boundary without touching captured pixels.
2. **Remove the redundant post-`show()` `focus()` call.** Verify Escape, first
   pointer drag, and frontmost-app shortcut delivery on macOS. Treat any timing
   change as measured, not assumed.
3. **Reduce only the renderer preview payload if profiling still requires it.**
   Retain the full captured `NativeImage` for exact cropping and compare bounded
   preview sizes. Re-run visual mixed-scale and exact clipboard crop evidence.
4. **Evaluate hidden load/capture overlap only if the first three are
   insufficient.** Establish the hidden window and bounds before starting
   capture, measure contention, and repeat macOS failure/cleanup tests.
5. **Research a native targeted-display backend only if `getSources()` remains
   the measured dominant interval.** This is an architectural phase, not a
   shortcut optimization disguised as a refactor.

Do not add speculative worker threads, offscreen rendering, permanent
`backgroundThrottling: false`, stale screenshot caches, a zero-size thumbnail,
Data URL transport, `showInactive()`, or a native capture helper in the first
change.

## Decision

Electron 43.4.1 remains an appropriate stack for this target. The first
production candidate is the measured concurrent hidden-load and fresh-capture
join, not a prepared persistent overlay or capture-backend replacement. It
preserves fresh native capture and exact crop state without retaining a hidden
operation surface. Acceptance succeeds only if a rebuilt package records <=150
ms physical shortcut-to-interactive-overlay p95 and all existing safety rows
continue to pass.

## Sources

- [Electron 43.4.1 BrowserWindow](https://github.com/electron/electron/blob/v43.4.1/docs/api/browser-window.md)
- [Electron 43.4.1 BrowserWindow options](https://github.com/electron/electron/blob/v43.4.1/docs/api/structures/browser-window-options.md)
- [Electron 43.4.1 web preferences](https://github.com/electron/electron/blob/v43.4.1/docs/api/structures/web-preferences.md)
- [Electron 43.4.1 WebContents](https://github.com/electron/electron/blob/v43.4.1/docs/api/web-contents.md)
- [Electron 43.4.1 desktopCapturer](https://github.com/electron/electron/blob/v43.4.1/docs/api/desktop-capturer.md)
- [Electron 43.4.1 desktopCapturer implementation](https://github.com/electron/electron/blob/v43.4.1/lib/browser/api/desktop-capturer.ts)
- [Electron 43.4.1 NativeImage](https://github.com/electron/electron/blob/v43.4.1/docs/api/native-image.md)
- [Electron 43.4.1 macOS window implementation](https://github.com/electron/electron/blob/v43.4.1/shell/browser/native_window_mac.mm)
- [Phase 19 native capture results](phase-19-native-capture-results.md)

# Production capture implementation: current evidence

Research date: 2026-08-20  
Target: Electron 43.4.1, macOS-first ScreenFling capture path  
Status: implementation guidance; Gate A remains open

Context7 was queried first against `/electron/electron`. The API facts below were
then checked against the pinned Electron `v43.4.1` documentation and Apple’s
first-party ScreenCaptureKit documentation. Recommendations are engineering
inferences from those facts and the existing packaged prototype evidence.

## Verified API facts

- `desktopCapturer.getSources({ types: ["screen"] })` is a main-process API that
  returns a promise of `DesktopCapturerSource[]`. Its `thumbnailSize` is a
  requested size, not a guarantee: the returned `thumbnail` can have a different
  size based on the display scale. A source’s `display_id` corresponds to the
  Screen API display identifier when available, but may be empty. Electron says
  macOS 10.15+ requires user consent for screen contents; the status is exposed
  by `systemPreferences.getMediaAccessStatus("screen")`.
  ([desktopCapturer](https://github.com/electron/electron/blob/v43.4.1/docs/api/desktop-capturer.md),
  [source fields](https://github.com/electron/electron/blob/v43.4.1/docs/api/structures/desktop-capturer-source.md),
  [media status](https://github.com/electron/electron/blob/v43.4.1/docs/api/system-preferences.md))

- The web display-media path uses `navigator.mediaDevices.getDisplayMedia()`.
  Electron can answer that request with
  `session.defaultSession.setDisplayMediaRequestHandler`, selecting a source
  from `desktopCapturer`; the Electron docs note that `getDisplayMedia` does not
  permit `deviceId` source selection. This path must therefore keep source
  selection and authorization in the expected local frame and must not be
  treated as an arbitrary source-ID API.
  ([desktopCapturer display-media example](https://github.com/electron/electron/blob/v43.4.1/docs/api/desktop-capturer.md))

- `screen.getAllDisplays()` returns currently available `Display` objects.
  Display `bounds` are in DIP points; each display also exposes `scaleFactor` and
  `rotation`. The main process receives `display-added`, `display-removed`, and
  `display-metrics-changed` events; the latter identifies changes such as bounds,
  scale factor, or rotation. Screen APIs require the app’s `ready` event.
  ([screen](https://github.com/electron/electron/blob/v43.4.1/docs/api/screen.md),
  [Display](https://github.com/electron/electron/blob/v43.4.1/docs/api/structures/display.md))

- `BrowserWindow` supports a hidden, frameless, always-on-top, non-taskbar
  overlay. `ready-to-show` means the hidden page has rendered without a visual
  flash. `setBounds` moves/resizes the window; `closed` means references should
  be removed. `setIgnoreMouseEvents` passes mouse events to the window below but
  still allows keyboard events if the overlay has focus, so it is not a substitute
  for a selectable overlay. `setFocusable(false)` on macOS does not remove
  existing focus.
  ([BrowserWindow](https://github.com/electron/electron/blob/v43.4.1/docs/api/browser-window.md),
  [window options](https://github.com/electron/electron/blob/v43.4.1/docs/api/structures/base-window-options.md))

- `clipboard.writeImage(nativeImage)` writes an image to the OS clipboard. A
  `NativeImage` can be decoded from PNG/JPEG bytes with
  `nativeImage.createFromBuffer`; `isEmpty()`, `getSize()`, `toPNG()`, and
  `toJPEG()` provide the relevant sanity-check and encoding operations.
  ([clipboard](https://github.com/electron/electron/blob/v43.4.1/docs/api/clipboard.md),
  [nativeImage](https://github.com/electron/electron/blob/v43.4.1/docs/api/native-image.md))

- `globalShortcut` is main-process-only and cannot be used before `ready`.
  `register()` returns a boolean and can silently fail when another application
  owns the accelerator. Electron’s documented lifecycle unregisters shortcuts on
  `will-quit`.
  ([globalShortcut](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md))

- Electron exposes macOS screen permission state as `not-determined`, `granted`,
  `denied`, `restricted`, or `unknown`. Its `askForMediaAccess()` API accepts
  microphone or camera, not screen; ScreenFling should not invent a programmatic
  screen re-prompt. Apple’s native ScreenCaptureKit guidance requires
  `NSScreenCaptureUsageDescription` and says the app must restart after a user
  grants access in its sample flow. That requirement applies to a future native
  ScreenCaptureKit backend; it is not evidence that the Electron-only path needs
  a native helper or that the current Electron Info.plist should add the key.
  ([Electron permission API](https://github.com/electron/electron/blob/v43.4.1/docs/api/system-preferences.md),
  [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit),
  [Apple macOS capture sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos))

## Recommended production implementation

1. After `app.whenReady()`, enumerate displays and select the display nearest the
   pointer. Capture one display only. Use `display_id` to match the requested
   display, reject an empty/ambiguous match, and record the display’s DIP bounds,
   scale factor, rotation, and the actual returned image size.
2. Keep the current `desktopCapturer` still-image path as the first backend. Request
   a large thumbnail, but treat the returned `NativeImage` size as authoritative;
   reject empty images. If physical-resolution or latency acceptance fails,
   prototype a display-media first-frame backend before considering native
   ScreenCaptureKit. This preserves the accepted snapshot-first architecture and
   its native-code gate: the [architecture decision](../docs/ARCHITECTURE.md)
   defers native capture until Electron paths fail a measured requirement.
3. Capture before showing the overlay. Reuse a hidden, sandboxed, opaque frozen
   scene in a display-local DIP-sized `BrowserWindow` with `frame: false`,
   `alwaysOnTop: true`, `skipTaskbar: true`, and `show: false`. Make it focusable
   while selecting so pointer events and Escape work; do not depend on click-through
   behavior or live desktop transparency.
4. Send only a compressed preview and a generated capture ID to the renderer.
   Return only a validated, display-local selection or cancellation. Main must
   validate the capture ID and geometry, map using independent measured width and
   height ratios, crop and encode in main, and call `clipboard.writeImage` only
   after a successful crop. Cancellation, denial, disconnect, renderer failure,
   and crop/clipboard errors must hide/destroy the overlay and leave the existing
   clipboard untouched.
5. Register the global shortcut after `ready`, treat a false return as an explicit
   conflict result, and unregister all shortcuts on quit. Subscribe to display
   topology/metric events; invalidate an active snapshot when its display is
   removed or its bounds, scale, or rotation changes, rather than silently mapping
   against new geometry.
6. On macOS, surface `getMediaAccessStatus("screen")` before capture. For denied,
   restricted, or failed capture, show actionable System Settings guidance and do
   not open a blank overlay. Test the packaged identity, not only an IDE/terminal
   launch, because permission behavior is identity- and lifecycle-sensitive.

## What the prototype proves, and what it does not

The packaged Electron 43.4.1 prototype on the reference M4 Pro Mac proved 20/20
non-empty single-display captures, a 3024×1964 result from a 1512×982 DIP display
at scale 2, p95 overlay readiness of 124.73 ms, and unchanged clipboard/no
monotonic RSS growth across 200 cancel cycles. It also confirmed the useful
ordering: snapshot first, then show the frozen overlay. These are workload
measurements, not guarantees that every display topology or permission state
behaves identically.

This capture decision is independent of the accepted WezTerm routing choice in
[ADR 0001](../docs/adr/0001-wezterm-first-stage-adapter.md); capture remains an
adapter-neutral product service and Copy remains available without WezTerm.

The following remain hardware or packaged-acceptance checks, not facts derivable
from the API documentation: end-to-end selection-release-to-clipboard p95;
mixed-scale displays and negative origins; rotation; hot-plug and sleep/wake;
runtime permission denial/revocation and any restart requirement; protected or
uncapturable content; native Windows capture and mixed-DPI behavior; clipboard
consumers; stable packaged identity; and the 200-cycle production workflow soak
without prototype-only forced garbage collection. These remain Gate A blockers,
consistent with the [Phase 3 results](phase-3-feasibility-results.md) and
[roadmap](../ROADMAP.md).

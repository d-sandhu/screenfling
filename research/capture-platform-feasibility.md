# ScreenFling capture and platform feasibility

Research date: 2026-08-19

Status: Supporting research snapshot. Canonical decisions live in
[the product direction](../docs/PRODUCT.md),
[architecture](../docs/ARCHITECTURE.md), and [roadmap](../ROADMAP.md).

Scope: the capture-to-image-clipboard layer only: Electron `desktopCapturer`, capture overlays, clipboard/native images, global shortcuts, permissions, displays/DPI, Linux/Wayland, security, packaging, performance, and the point at which native code becomes justified.

## Decision

**Use Electron + TypeScript for the first implementation, but narrow the first supported contract.** It is a sound choice for a high-quality macOS and Windows region-capture-to-clipboard slice, and a conditional choice on Linux/X11. No Rust or other native code is required to prove that slice.

Do **not** promise the same custom region-selection overlay on native Wayland. Electron documents that Wayland prevents applications from obtaining the cursor's global position and from programmatically positioning, moving, focusing, or blurring windows. PipeWire capture also returns only the source selected through the portal. Those are protocol/security constraints, not missing TypeScript wrappers; a native helper cannot portably bypass them.

The recommended first contract is:

```text
macOS + Windows
global shortcut
-> snapshot the display under the pointer
-> show a prewarmed overlay on that display
-> select a region within that one display
-> crop using measured image/DIP ratios
-> write a NativeImage to the system clipboard
```

Linux should initially be capability-based:

- X11: experimental custom-overlay path after it passes the same acceptance suite.
- Wayland: explicit unsupported/custom-overlay state or a separate portal/system-picker fallback. Do not silently launch an experience that looks equivalent but is not.

The largest technical unknown is not whether Electron exposes the necessary APIs; it does. It is whether a full-resolution `desktopCapturer` snapshot plus overlay can meet the warm-latency and pixel-accuracy targets across mixed-DPI displays. Resolve that with a small capture spike before building product UI.

## Context7 trace

The required Context7 lookup was performed first.

- Query: `Electron`
- Resolved library ID: **`/electron/electron`**
- Why selected: exact project match, high source reputation, 4,271 snippets, and upstream Electron docs/source coverage.
- Three scoped queries covered: (1) desktop capture and permission handling, (2) BrowserWindow overlays and display coordinates, and (3) clipboard, shortcuts, security, and native-module packaging.
- Context7's results came from the upstream Electron repository, principally [`desktop-capturer.md`](https://github.com/electron/electron/blob/main/docs/api/desktop-capturer.md), [`session.md`](https://github.com/electron/electron/blob/main/docs/api/session.md), [`screen.md`](https://github.com/electron/electron/blob/main/docs/api/screen.md), and the Electron security/process-model/ASAR documentation.

One material freshness issue was found: Context7 returned the older Wayland advice to enable `GlobalShortcutsPortal` with a Chromium switch. The current Electron documentation says the portal path and related feature flags are enabled by default. The current official documentation should control, and the app must still have a resolvable reverse-DNS desktop identity. This is a reason to pin an Electron version and validate behavior against its matching docs instead of treating `latest` documentation as a permanent contract.

## Verified facts

The following are facts stated by the owning project or platform vendor. Product and architectural conclusions are kept in the next section.

### Capture

- Electron's main-process [`desktopCapturer.getSources`](https://www.electronjs.org/docs/latest/api/desktop-capturer) enumerates `screen` and/or `window` sources and returns a `NativeImage` thumbnail for each source.
- Requesting a zero width or height avoids thumbnail capture and saves processing time. ScreenFling needs pixels, so it cannot use that optimization on the capture path.
- Electron explicitly does **not** guarantee that a returned thumbnail has exactly the requested `thumbnailSize`; actual size depends on the source's scale. Pixel mapping must use the returned image's measured dimensions, not assumptions.
- A [`DesktopCapturerSource`](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source) has a `display_id` corresponding to the matching Electron `Display.id` when the platform supplies one. It may be an empty string.
- `navigator.mediaDevices.getDisplayMedia` does not allow selecting a source via `deviceId`. Electron instead offers [`session.setDisplayMediaRequestHandler`](https://www.electronjs.org/docs/latest/api/session), which can grant a source returned by `desktopCapturer`. Its native system-picker option is experimental and, in current Electron docs, available only on macOS 15+.
- Under PipeWire, Electron says `getSources` returns only one source on Linux; requesting both window and screen types still produces the single user-selected PipeWire source.
- Apple's [ScreenCaptureKit documentation](https://developer.apple.com/documentation/screencapturekit) describes fine-grained high-performance display/window capture and application/window exclusion, but the Electron API does not expose all of those native filter controls directly.

### Overlay windows

- `BrowserWindow` supports frameless, transparent, always-on-top, focusable, and taskbar-skipping windows. On Windows, transparency requires a frameless window. Electron also documents several transparent-window limitations. See [`BaseWindow` options](https://www.electronjs.org/docs/latest/api/base-window) and [custom window styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles).
- Electron's [`BrowserWindow` platform notices](https://www.electronjs.org/docs/latest/api/browser-window) say native Wayland generally prevents programmatic resize, position, move, focus, and blur without user input. Electron suggests Xwayland when an application requires those capabilities.
- `show: false` plus `ready-to-show` can avoid visually incomplete window rendering, although a hidden renderer can still paint. Electron recommends pausing expensive hidden work.
- `setContentProtection(true)` can exclude a window from capture on supported Windows versions. Electron explicitly warns that newer macOS applications using ScreenCaptureKit can capture the window despite this setting. It is therefore not a portable solution to keeping ScreenFling's overlay out of its own screenshot.

### Displays and coordinates

- Electron's [`screen`](https://www.electronjs.org/docs/latest/api/screen) module distinguishes physical pixels from device-independent pixels (DIPs). `Display.bounds` is in DIPs and `Display.scaleFactor` is the output device's pixel scale.
- Electron exposes display add/remove and metrics-changed events; metric changes include bounds, work area, scale factor, and rotation.
- `screen.dipToScreenPoint` and `screen.screenToDipPoint` exist on Windows and Linux, but they are not supported on Wayland. Rectangle conversion helpers are Windows-only.
- `screen.getCursorScreenPoint()` returns DIPs and is not supported on Wayland.
- Display origins can be negative in multi-monitor arrangements. A `Display` can also be virtual, remote, invalid, or a unified desktop; code must not assume a primary display at `(0, 0)` uniquely identifies every layout.

### Clipboard and image processing

- Electron's [`clipboard.writeImage`](https://www.electronjs.org/docs/latest/api/clipboard) writes a `NativeImage` to the normal system clipboard on macOS, Windows, and Linux.
- [`NativeImage`](https://www.electronjs.org/docs/latest/api/native-image) supports PNG encoding, inspecting representations/scale factors, resizing, and rectangular cropping.
- Linux additionally has a selection clipboard, but the normal `clipboard` target is the relevant cross-platform behavior for ScreenFling.
- A successful clipboard write establishes that image data was placed on the OS clipboard; it does not establish that every terminal or application will accept or interpret the image paste. Destination compatibility remains a separate integration test.

### Shortcuts

- Electron's [`globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut) works from the main process after `app.ready`. Registration returns `false` when it fails, including when another application owns the accelerator; the OS may fail silently beyond that boolean.
- Current Electron docs say X11 grabs shortcuts directly. On Wayland, Electron uses `org.freedesktop.portal.GlobalShortcuts`.
- On Wayland, the installed application needs a valid portal identity: a reverse-DNS `desktopName` matching the installed `.desktop` file. GNOME may show first-use consent; bindings persist by portal identity. Current docs say the portal feature is enabled by default.

### Permissions

- Electron reports that macOS 10.15+ requires user consent for screen capture. [`systemPreferences.getMediaAccessStatus('screen')`](https://www.electronjs.org/docs/latest/api/system-preferences) can return `not-determined`, `granted`, `denied`, `restricted`, or `unknown`.
- Electron's `askForMediaAccess` supports microphone and camera, **not screen**. Screen capture itself must cause the macOS consent flow; a denied/restricted state needs user guidance rather than a programmatic re-prompt.
- Apple's [capture sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos) says the first capture prompts for Screen Recording permission and the app must be restarted after permission is granted.
- Electron says Windows' media-access status always reports `granted` for screen capture. ScreenFling must still handle capture API failure and uncapturable/protected content without claiming that status means every pixel is capturable.
- If a renderer uses the web Screen Capture API, Electron's session permission request/check handlers include `display-capture`; complete permission handling requires both check and request handlers. `setDisplayMediaRequestHandler` receives the requesting frame and security origin and controls which stream is granted.
- The XDG [ScreenCast portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html) normally presents user selection UI and returns PipeWire streams. Portal persistence/restore-token behavior exists at the protocol level but should not be assumed to be fully controllable through Electron's higher-level API.

### Security, packaging, and performance

- Electron's [security checklist](https://www.electronjs.org/docs/latest/tutorial/security) recommends current Electron, no Node integration for remote content, context isolation, renderer sandboxing, restrictive permission handlers and CSP, navigation/window-open restrictions, sender validation for IPC, and a narrow API surface.
- Context isolation has been the default since Electron 12 and renderer sandboxing since Electron 20, but ScreenFling should set/test these explicitly rather than relying on changing defaults.
- Electron recommends [Electron Forge for packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution) and recommends signing distributed applications. macOS distribution additionally requires notarization for a normal Developer ID release. See [code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).
- Native Node modules use Electron's ABI and must be rebuilt for it; ASAR archives have native-module caveats. A standalone Rust process avoids the Node ABI issue, but it still needs per-platform/per-architecture builds, placement outside the archive where executable, signing, and lifecycle/IPC hardening. See [native Node modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) and [ASAR archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives).
- Electron's [performance guide](https://www.electronjs.org/docs/latest/tutorial/performance) recommends measurement/profiling, deferring nonessential startup work, bundling, careful dependency selection, and never blocking the main process with CPU-heavy work, synchronous IPC, or blocking I/O.

## Engineering conclusions (inferences)

These are recommendations inferred from the verified behavior above; they are not claims made verbatim by Electron or the OS vendors.

### 1. Snapshot before showing the overlay

The robust order is capture first, overlay second. Hiding an overlay and immediately taking a screenshot creates a compositor timing race, and `setContentProtection` cannot reliably exclude the overlay on modern macOS.

For the prototype, try `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: ... })` first because it directly returns a still `NativeImage`. Request a size large enough for the largest physical display, match the selected display via `display_id`, and measure the returned image. Never trust requested dimensions.

If full-resolution thumbnails are degraded, inconsistently sized, or too slow, compare a second backend that takes the first frame from a display-media stream, draws it to a canvas/`OffscreenCanvas`, stops all tracks immediately, and retains only the still image. Keep the custom overlay; do not opt into the macOS system picker for this flow.

Do not keep a screen stream running while idle merely to win latency. That conflicts with local-first trust, may show OS recording indicators, and consumes resources.

### 2. Use an opaque frozen-scene overlay, not desktop transparency

Create one prewarmed `BrowserWindow` for the display under the cursor. Size it to that display's DIP bounds with `frame: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `show: false`, and a secure sandboxed renderer. Show a frozen snapshot as its background, then draw the dimming mask and selection rectangle in CSS/canvas.

This avoids transparent-window edge cases and prevents the apparent scene from changing between snapshot and selection. Use manual display bounds rather than OS “fullscreen,” which has separate spaces/transitions on macOS. The overlay must be focusable while selecting so it can receive pointer input and `Esc`.

Preload the renderer and its CSS at app startup, but keep it hidden and idle. Reuse it between captures, reset all selection state after every terminal path, and destroy/recreate it only after renderer failure or a display topology change it cannot absorb.

### 3. Keep selection in one display for Milestone 1

Cross-display dragging combines negative origins, different scale factors, rotation, and possibly different color spaces. It does not prove the routing thesis and substantially expands the capture test matrix.

Represent overlay selection in display-local DIPs. Convert to image pixels using measured ratios:

```text
pixelX = floor(selectionDip.x * capturedPixelWidth / displayBoundsDip.width)
pixelY = floor(selectionDip.y * capturedPixelHeight / displayBoundsDip.height)
pixelRight = ceil((selectionDip.x + selectionDip.width) * capturedPixelWidth / displayBoundsDip.width)
pixelBottom = ceil((selectionDip.y + selectionDip.height) * capturedPixelHeight / displayBoundsDip.height)
```

Clamp the result to actual image bounds. This is safer than multiplying blindly by `scaleFactor`, and it handles capture backends whose returned size differs from the requested size. Store both coordinate spaces in capture diagnostics.

### 4. Make capture a state machine, not window event soup

Use a single main-process coordinator with explicit terminal paths:

```text
idle
-> snapshotting
-> selecting
-> cropping
-> writingClipboard
-> idle

any active state -> cancelled | permissionBlocked | failed -> idle
```

Reject or coalesce a second shortcut while active. Associate every renderer message with a generated `captureId`; validate sender, state, display, finite coordinates, positive dimensions, and bounds before cropping. This prevents stale renderer events from writing the wrong capture.

A minimal interface is enough:

```ts
type DisplaySnapshot = {
  displayId: string;
  boundsDip: { x: number; y: number; width: number; height: number };
  pixelSize: { width: number; height: number };
  png: Uint8Array;
};

type SelectionDip = { x: number; y: number; width: number; height: number };

interface CaptureBackend {
  snapshotDisplay(displayId: string): Promise<DisplaySnapshot>;
}
```

Do not introduce destination adapters, a plugin interface, persistence, or Rust into this module.

### 5. Keep privileged work out of the overlay renderer

The renderer should receive only the snapshot/preview and capture identity; it should return only a selection or cancel event. Main owns display enumeration, source selection, crop, clipboard write, permissions, shortcut registration, and future subprocesses.

Use local bundled content, `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, a restrictive CSP, a narrow `contextBridge` API, and explicit IPC sender/state validation. Deny all unrelated session permissions. If the streaming backend is selected, grant display capture only to the expected local frame/origin and only while the coordinator is in `snapshotting`.

### 6. Keep the clipboard behavior simple and honest

On success, write the capture image and leave it there; that is the feature. On cancel/failure, perform no clipboard write. Do not attempt “restore previous clipboard” in Milestone 1: faithfully round-tripping every platform-specific/custom format is a separate trust problem and can destroy clipboard content.

After `writeImage`, a same-process `readImage().isEmpty()` check can catch obvious write failures, but it is not destination verification. Report “copied,” never “delivered.”

## Platform support decision

| Platform | Custom region overlay | Image clipboard | Main blocker | Initial status |
| --- | --- | --- | --- | --- |
| macOS | Feasible in Electron | API available | Screen Recording consent/restart; Retina and multiple-display mapping | Tier 1, first reference implementation |
| Windows | Feasible in Electron | API available | Mixed per-monitor DPI; capture failures/protected content | Tier 1, after macOS validation |
| Linux/X11 | Likely feasible in Electron | API available | Desktop/WM variability; packaging test breadth | Optional experiment |
| Linux/Wayland | Not a portable equivalent | API available | No global cursor coordinates/window positioning; portal-selected PipeWire source | Uncommitted fallback only |

Wayland global shortcut support does **not** remove the overlay blocker. Conversely, a native Rust process would still be subject to Wayland/compositor and portal policy. The honest future choices are:

1. portal/system-picker capture as a separate lower-capability mode;
2. Xwayland with clearly documented tradeoffs;
3. compositor-specific integrations, knowingly abandoning universality; or
4. waiting for suitable standardized portal/protocol support.

## Where native code is actually justified

**Not justified for Milestone 1:** global shortcut, display enumeration, macOS/Windows/X11 overlay, still capture, crop, PNG conversion, and image clipboard all have Electron APIs.

Consider native code only after a measured failure:

- macOS ScreenCaptureKit helper: if Electron cannot meet one-shot latency/pixel/color correctness, or if excluding ScreenFling windows without snapshot-first behavior becomes necessary.
- Windows Graphics Capture helper: if Electron's still capture cannot meet accuracy/latency requirements on supported Windows versions.
- macOS Accessibility / Windows UI Automation helper: later, for identifying/focusing a specific external composer and invoking a verified staging action. This is routing, not capture.
- Linux: only for a named compositor/desktop integration. Do not label it a portable Wayland fix.

If Rust arrives, keep it a standalone, capability-scoped executable with versioned request/response messages, strict input validation, timeouts, output limits, crash recovery, and no product state. Bundle one binary per target architecture outside ASAR, sign it with the application, and make the TypeScript coordinator tolerate “helper unavailable.”

## Recommended Milestone 1 acceptance criteria

Run these against packaged builds, not only `electron .`. Permission and portal identity behavior depends on application identity.

### Functional correctness

1. A configurable global shortcut either registers or produces a visible, actionable conflict error; it unregisters on quit.
2. On macOS and Windows, the shortcut captures the display under the pointer and opens selection on that display. A second shortcut while active cannot create a second overlay or replace capture state.
3. Selection is limited to one display. All drag directions normalize correctly; zero-size/tiny selections cancel or follow one documented minimum-size rule.
4. The clipboard image is the selected pixels within a one-physical-pixel edge tolerance using a test grid, including Retina/HiDPI and mixed-scale monitor arrangements.
5. Test display layouts include primary at nonzero logical origin, a monitor left/above primary (negative origin), portrait rotation, display hot-plug, sleep/wake, and scale-factor change.
6. `Esc`, overlay close, renderer crash, capture failure, and permission denial all return to `idle`, remove the overlay, stop every media track if used, and do not write the clipboard.
7. No screenshot or temporary image file is created by the normal capture path.
8. The resulting clipboard image pastes into one OS-native image consumer and the specifically supported Codex/Claude CLI versions. Record the app versions and shortcut used; this is a compatibility matrix, not an assumption.

### Permission and failure UX

9. macOS `not-determined`, `denied`, `restricted`, and `granted` states each have a tested path. First-run copy explains why Screen Recording access is needed; post-grant copy explains the restart requirement. Denial never opens a blank overlay.
10. Shortcut conflict, missing `display_id`, empty image, portal cancellation, display disconnect during capture, and clipboard write/readback failure produce distinct diagnostic codes and safe user-facing messages.
11. Protected/uncapturable content may appear blank; document that limitation and never claim capture success based only on permission status.

### Performance and resource safety

12. Measure cold launch separately. After app ready, target shortcut-to-interactive-overlay at **p95 <= 150 ms** and release-to-clipboard-ready at **p95 <= 150 ms** on each named baseline host. These targets now match the canonical roadmap and remain provisional until the feasibility harness records real distributions.
13. Idle CPU is <= 0.5% averaged over five minutes on baseline machines, no display stream remains active, and hidden renderers do not continuously repaint.
14. After 200 capture/cancel cycles, there is still exactly the intended number of overlay windows/renderers/listeners. Two minutes after the run, RSS is within 15% of the post-warm baseline or any retained memory has a measured explanation. No monotonic image-buffer growth is allowed.
15. Record per-stage timings (`sourceEnumeration`, `snapshot`, `overlayShow`, `selection`, `crop`, `encode`, `clipboardWrite`) locally in a debug build with no screenshot contents, paths, window titles, or telemetry upload.

### Security and distribution

16. Automated checks assert `nodeIntegration: false`, `contextIsolation: true`, and renderer sandboxing; IPC tests reject wrong sender, stale capture ID, NaN/infinite/out-of-bounds selection, and calls in the wrong state.
17. Renderers load only bundled local assets under a restrictive CSP, cannot navigate, cannot create arbitrary windows, and cannot invoke arbitrary main-process channels.
18. A signed/notarized macOS alpha and a signed Windows alpha can launch, register shortcuts, request/use capture permission, and retain the correct identity across upgrades. X11/Wayland claims are withheld until packaged Linux tests pass.

## Risk register

| Priority | Risk | Consequence | Mitigation / kill criterion |
| --- | --- | --- | --- |
| P0 | Full-resolution Electron snapshot misses latency budget | Capture feels worse than OS tools | Benchmark thumbnail and first-frame backends in a spike; if both miss badly, test a macOS/Windows native capture helper before building more UI |
| P0 | Returned thumbnail scale/size differs by platform | Blurry or wrong-region output | Measure actual image dimensions; ratio-map and pixel-grid test every backend/display combination |
| P0 | Wayland is treated as equivalent | Broken overlays and misleading cross-platform claim | Capability gate; separate portal fallback; do not add native code under the assumption it bypasses compositor policy |
| P1 | Overlay appears in captured pixels | Wrong screenshot | Snapshot before overlay; never rely on `setContentProtection` on macOS |
| P1 | macOS permissions tested only in dev | Repeated prompts, wrong identity, alpha failure | Test packaged signed app early; explicit denied/granted/restart QA |
| P1 | Mixed-DPI/negative origins are assumed away | Off-by-scale/monitor capture bugs | Display-local DIPs, measured pixel ratios, one-display selection, topology event tests |
| P1 | Large PNG/data-URL copies stall UI or inflate memory | Latency/leaks | Profile the transfer; keep high-resolution image in main where possible; send only what renderer needs; move encode/crop off main if profiling shows blocking |
| P1 | Shortcut already owned | Feature appears dead | Check boolean, expose configuration, provide tested defaults/fallbacks |
| P2 | Electron update changes capture/portal behavior | Regression after upgrades | Pin versions, use matching docs, run packaged smoke suite before dependency upgrades |
| P2 | Rust helper is introduced too early | Packaging/signing/IPC complexity without user value | Require a failed benchmark or missing platform API and a written capability boundary first |

## Immediate implementation sequence

1. Build a disposable spike that records full-resolution snapshots on one macOS Retina display and mixed-scale macOS displays. Preserve the same fixture contract for the later Windows mixed-DPI acceptance run. Compare `getSources` thumbnails with a first-frame stream only if needed.
2. Prove returned pixel dimensions and crop mapping with a generated on-screen grid. Save images only in this explicit developer test fixture, never in the product path.
3. Add one prewarmed single-display overlay and exercise the state machine, cancel paths, shortcut collision, permission denial, and display disconnect.
4. Package early and rerun permission/shortcut tests under stable application identities.
5. Apply the acceptance suite to the macOS reference implementation. Reuse it for the Tier 1 Windows port only after the macOS workflow is validated. Treat every Linux path as a separate, optional product decision.

## Incorporated roadmap implications

The canonical roadmap now incorporates these conclusions:

- macOS is the first reference implementation, Windows is the next Tier 1 platform, and Linux is optional with no Wayland parity claim.
- Region selection is constrained to one display initially.
- The capture backend is selected by benchmark; Electron remains the default, with native helpers requiring measured justification.
- Permission UX, packaged-build testing, pixel accuracy, and safe failure behavior are milestone requirements, not later polish.

With those qualifications, the roadmap's TypeScript-first direction and measured native-code gate are technically sound.

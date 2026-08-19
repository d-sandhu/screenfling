# Capture Gate A prototype record

Research date: 2026-08-19

Branch: `prototype/capture-gate-a`

This is a reproducibility record for throwaway prototype code. It is not a
claim that capture is validated on every supported display or operating system.
Only validated decisions and permanent tests should move to `main`.

## Question

Can packaged Electron capture the display under the cursor, show a frozen
selection overlay quickly, map a DIP selection back to physical pixels, place a
non-empty crop on the clipboard, and cancel repeatedly without changing the
clipboard or accumulating native-image memory?

## Reference environment

- macOS on Apple silicon
- Electron 43.4.1
- packaged, ad-hoc-signed `ScreenFling.app`
- screen-capture permission granted
- one 1512 x 982 DIP display at scale factor 2, rotation 0
- requested and returned image size: 3024 x 1964 pixels

No private screenshot or captured screen content is stored in the repository.

## Method

The prototype uses `desktopCapturer.getSources`, matches the cursor display to
`display_id`, requests that display's physical-pixel dimensions, and measures
the returned image rather than assuming the request was honored. A hidden,
sandboxed overlay is preloaded before capture begins. It receives a JPEG preview
for display while the main process retains the lossless `NativeImage` for the
final crop.

Selection mapping uses the measured width and height ratios independently. The
left and top edges round down; the right and bottom edges round up. The tested
fractional selection was 756 x 435.5 DIP at (378, 217.75), which mapped to a
1512 x 872 crop at (756, 435).

The automatic overlay trial follows the same capture, preview, renderer-ready,
crop, and clipboard path as the interactive overlay. It chooses a deterministic
center rectangle after the preview has rendered. A separate manual drag trial
confirmed that the visible overlay is a frozen pre-overlay snapshot.

## Results

Twenty fresh packaged automatic-overlay trials all returned a non-empty
clipboard image. Nearest-rank p95 results were:

| Measure | p95 |
| --- | ---: |
| Capture | 101.28 ms |
| JPEG preview encoding | 14.47 ms |
| Overlay ready | 124.73 ms |
| Crop | 0.0571 ms |
| Clipboard write | 23.63 ms |

The overlay-readiness target of at most 200 ms passed on the reference display.

The final 200-cycle cancel run encoded the same JPEG preview used by the real
overlay and forced garbage collection after every cycle as a diagnostic:

- clipboard unchanged: yes
- capture p95: 69.31 ms
- RSS first/last: 138,559,488 / 136,347,648 bytes
- RSS maximum: 140,132,352 bytes
- fitted RSS slope: -21,421.60 bytes per cycle
- post-run cooldown RSS: 136,265,728 bytes

This shows that the observed native-image allocations are reclaimable under the
tested workload; it does not prove the absence of every production leak.

## Packaging finding

The first packaged interactive run exposed a real boundary defect: the
sandboxed preload could not resolve externalized `zod`. The current
electron-vite configuration bundles `zod` into the preload through
`build.externalizeDeps.exclude`. The prototype did not work in the packaged app
until that change was made.

## Decision

Electron capture is viable for the macOS alpha on this reference configuration.
Keep the snapshot-before-overlay design, preload the overlay, retain a lossless
main-process image for cropping, use a compressed renderer preview, and map DIP
coordinates using the measured returned image dimensions.

Do not merge the prototype implementation. Carry the preload packaging fix and
pure coordinate-mapping logic into permanent, narrowly tested modules.

## Evidence still required

- mixed-scale and negative-origin multi-display hardware
- rotated displays
- display disconnect/reconnect and sleep/wake
- permission denied and permission changed while running
- Windows capture and clipboard behavior
- sustained production workflow without forced garbage collection

Those gaps must remain visible in the roadmap and release gates. Linux is
optional and is not part of this prototype's claim.

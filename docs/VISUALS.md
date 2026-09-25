# Visual design and verification

The crop is the main content. Review has one primary action, **Copy image**, and an optional **Paste back to [terminal]** action. The destination label explains where input will go. Settings contains only the capture shortcut.

`src/app_view.rs` owns the existing egui palette, spacing and typography. It performs no capture, clipboard or input operations. There are no decorative animations or extra UI libraries. Actions remain outside the scrolling content at both the normal 1000 × 740 and compact 640 × 480 sizes. Fit and 1:1 affect only the preview, never the delivered pixels.

Keyboard behavior is tested: Escape dismisses a menu before cancelling a capture, returning from Settings preserves the crop, and copy/capture shortcuts do not fire while editing Settings. Native text input follows the focused editor. Unit tests also check palette contrast and non-overlapping content/action regions.

## Rendered evidence

```sh
cargo build --release --locked
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' \
  python3 scripts/check-visuals.py --isolated-xvfb
```

Run with ImageMagick, DejaVu Sans and the other [fixture dependencies](DEVELOPMENT.md#desktop-and-paste-fixtures). The script refuses a non-Xvfb display. It captures the actual executable with disposable settings and a synthetic deployment-error image. Navigation, resizing and preview changes preserve the existing clipboard; explicit Copy must produce every pixel of the independently read crop.

Screens and reports are saved under `dist/visuals/`. Inspect idle, settings, selection, review, 1:1 scrolling, compact layouts and result. Screenshot dimensions alone do not prove usability. The README preview is copied from this actual-app evidence, not a separately drawn mockup.

The current README preview comes from [CI run 36170817173](https://github.com/d-sandhu/screenfling/actions/runs/36170817173) at `cc7280a`. That run also records the optional Paste back action in `paste-back-review.png` and its delivery results in `smoke-send.json`.

## Manual acceptance

Windows/macOS rendering, native DPI changes, input methods, assistive technology and physical multi-display behavior still need desktop acceptance. Xvfb evidence does not establish those results. Agent attachment must be verified in the receiving agent, separately from UI or transport tests.

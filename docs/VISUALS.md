# Visual design and verification

ScreenFling is a desktop handoff utility. The interface should make three things obvious: what will be copied, where a Stage request will go, and what has actually been verified. Decoration must not compete with those decisions.

## Design decisions

**One visual system.** `src/app_view.rs` owns the palette, typography, spacing, cards and screen layouts. It does not capture, write a clipboard or dispatch terminal input. The existing action layer retains those responsibilities. The same capture-corner mark appears in the application and repository identity; no icon font, web runtime or new application dependency is needed.

**Readable hierarchy.** Body text is 14 logical pixels, supporting text 12 or 14, section headings 22, and the idle introduction 32. Text is left-aligned and wraps within its region. Pane labels include separate identity metadata and an explicit Selected label; a blue fill alone is not the selection indicator. Path inputs scroll within their field instead of widening the application.

**The image has priority.** The normal 1000 × 740 window places the preview beside destination/note controls. Below a 720-point content width, review stacks into one scrollable column. The footer does not scroll, so Copy, Stage and Cancel stay reachable. The 640 × 480 minimum is exercised separately.

**Preview is not delivery.** Fit preserves aspect ratio and affects only display. 1:1 pixels accounts for egui's pixels-per-point and provides scrollbars for larger images. Neither setting resamples the stored crop. The frozen-selection overlay has a crosshair, a light/dark outline, actual crop dimensions and a width-aware instruction panel.

**States explain themselves.** Empty destination lists offer connection setup. Disabled Stage has both visible guidance and a tooltip. Copy remains usable without a connection. Pending delivery disables navigation that could obscure the result. A generic Operation result heading does not imply success when a transport result is uncertain or unsuccessful.

**Settings are a separate page.** F10 opens settings; Escape or Back returns to the current capture without cancelling it. Each section still saves explicitly. Local F6/F8 shortcuts do not silently act while the settings page is open. A new global capture returns to the capture workflow.

## Research behind the changes

References reviewed September 22, 2026:

- [Microsoft: Typography in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography) — clear type hierarchy, sentence case, readable sizes and left alignment.
- [Fluent 2: Buttons](https://fluent2.microsoft.design/components/web/react/core/button/usage) — one visually dominant action, quieter secondary actions, useful disabled-state explanations and explicit save feedback.
- [W3C: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) — text and meaningful control boundaries are measured, not judged by appearance alone.
- [GitHub: About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) — explain the project, why it matters, how to start and where to find help; keep detailed material in linked documentation.

The contrast ratios are useful design benchmarks for this native UI, not a claim of complete WCAG or assistive-technology conformance. Keyboard focus, screen-reader integration, platform scaling and real desktop behavior require their own acceptance testing.

## Reproduce the visual evidence

Ordinary Rust tests have no desktop/clipboard side effects. They check palette contrast, reserved action geometry and settings/Escape behavior in an in-memory egui context.

For actual rendered screens, build the release application, then run on Linux:

```sh
sudo apt-get install xvfb xdotool xclip x11-xserver-utils imagemagick fonts-dejavu-core
cargo build --release --locked
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' \
  python3 scripts/check-visuals.py --isolated-xvfb
```

The script refuses a non-Xvfb display. It uses temporary preferences and a synthetic deployment-error image, takes screenshots of the actual executable, and checks that settings navigation, selection, review and resizing leave a sentinel clipboard unchanged. Only explicit Copy writes an image. It records normal/compact screens, dimensions, nonblank-frame checks and source identity under `dist/visuals/`.

Inspect the screenshots as well as the report: a nonblank image is not proof that all text fits or that every state looks correct. Review idle, selection, crop review, settings, the scrolled compact layout and result. Inspect long labels, note validation, disabled actions, keyboard focus and 1:1 scrolling when changing the layout. Do not replace screenshots with a separately implemented mock interface.

The README preview is produced from the actual review screenshot. It contains a synthetic deployment error, not private screen content or a claimed agent attachment. Only development evidence is written to `dist`; production captures are not saved by this script or by the application without an explicit developer fixture run.

## Remaining physical acceptance

Inspect Windows and macOS rendering, native DPI/Retina changes, different Linux compositors, multiple displays, keyboard focus and OS theme/accessibility preferences on real desktops. Synthetic Xvfb evidence cannot establish those results. Existing capture, clipboard, WezTerm and packaging checks remain in the same three-job workflow.

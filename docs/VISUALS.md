# Visual design and verification

ScreenFling is a desktop handoff utility. The interface should make three things obvious: what will be copied, where a Send request will go, and what has actually been verified. Decoration must not compete with those decisions.

## Design decisions

**One visual system.** `src/app_view.rs` owns the palette, typography, spacing, cards and screen layouts. It does not capture, write a clipboard or dispatch terminal input. The existing action layer retains those responsibilities. The same capture-corner mark appears in the application and repository identity; no icon font, web runtime or new application dependency is needed.

**Readable hierarchy.** Body text is 14 logical pixels, supporting text 12 or 14, section headings 22, and the idle introduction 32. Text is left-aligned and wraps within its region. Pane labels include separate identity metadata and an explicit Selected label; a blue fill alone is not the selection indicator. Path inputs scroll within padded fields instead of widening the application. Cards align to their column edges. Scrollbars reserve visible space instead of floating over content.

**The image has priority.** The normal 1000 × 740 window starts with the preview; Send to… opens destination/note controls beside it. Below a 720-point content width, review stacks into one scrollable column. The footer does not scroll, so Send, Copy and Cancel stay reachable. The 640 × 480 minimum is exercised separately. The default preview budget leaves the crop dimensions visible above the action area; this was corrected after inspecting the first rendered screenshots.

**Preview is not delivery.** Fit preserves aspect ratio and affects only display. 1:1 pixels accounts for egui's pixels-per-point and provides scrollbars for larger images. Neither setting resamples the stored crop. The frozen-selection overlay has a crosshair, a light/dark outline, actual crop dimensions and a width-aware instruction panel.

**States explain themselves.** Empty window lists offer refresh and explain platform permissions; WezTerm setup is confined to an optional advanced mode. Disabled Stage has visible guidance and a tooltip. Copy remains usable without a connection. Pending delivery disables navigation that could obscure the result. A generic Operation result heading does not imply success when a transport result is uncertain or unsuccessful.

**Navigation and typing must actually work.** F10 opens settings; Escape or Back returns to the current capture without cancelling it. Each section saves explicitly. Local F6/F8 shortcuts do not act while Settings is open. The More menu consumes Escape before the underlying page can hide or cancel. SDL3 native text input is enabled only while egui reports a focused text editor, and stopped when editing ends. The real-window fixture types a shortcut, saves it and checks the exact persisted value; focus styling alone is not proof of working text entry.

## Research behind the changes

References reviewed September 22, 2026:

- [Microsoft: Typography in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography) — clear type hierarchy, sentence case, readable sizes and left alignment.
- [Fluent 2: Buttons](https://fluent2.microsoft.design/components/web/react/core/button/usage) — one visually dominant action, quieter secondary actions, useful disabled-state explanations and explicit save feedback.
- [W3C: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) — measure text and meaningful control boundaries rather than judging by appearance alone.
- [GitHub: About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) — explain the project, why it matters, how to start and where to find help; keep detailed material in linked documentation.
- [SDL3: SDL_StartTextInput](https://wiki.libsdl.org/SDL3/SDL_StartTextInput) — text-input events are not enabled by default; start/stop native text entry when an editable field gains/loses focus.

The contrast ratios are design benchmarks for this native UI, not a claim of complete WCAG or assistive-technology conformance. Screen-reader integration, input-method composition, platform scaling and real desktop behavior require their own acceptance testing.

## Reproduce the visual evidence

Ordinary Rust tests have no desktop/clipboard side effects. They check palette contrast, reserved action geometry, settings/Escape behavior and menu dismissal in an in-memory egui context.

For actual rendered screens, build the release application, then run on Linux:

```sh
sudo apt-get install xvfb xdotool xclip x11-xserver-utils imagemagick fonts-dejavu-core
cargo build --release --locked
xvfb-run -a -s '-screen 0 1280x800x24 -noreset' \
  python3 scripts/check-visuals.py --isolated-xvfb
```

The script refuses a non-Xvfb display. It uses temporary preferences and a synthetic deployment-error image and captures the actual executable. Menu dismissal, settings entry/navigation, selection, review, preview modes, window discovery and resizing must preserve a sentinel clipboard. Only explicit Copy writes an image. Every decoded clipboard pixel must equal an independently read crop of the rendered synthetic desktop. This reference is captured before launching the application, rather than assuming the wallpaper file survives display conversion unchanged.

Screens, source identity, dimensions, nonblank-frame checks and the comparison result are recorded under `dist/visuals/`. Synthetic reference/copied PNGs remain available to diagnose a mismatch. Existing asymmetric every-pixel X11 and Wayland capture tests are separate and unchanged.

Inspect the screenshots as well as the report: a nonblank image is not proof that all text fits or that every state looks correct. Review idle, menu, selection, crop review, 1:1 scrolling, note entry, connection errors, settings, the scrolled compact layout and result. Inspect long pane labels, note validation, disabled actions and keyboard focus when changing the layout. Do not substitute a separately implemented mock interface.

The README preview comes from the real review screenshot. It contains a synthetic deployment error, not private screen content or a claimed agent attachment. Only the opt-in developer fixture writes these synthetic screenshots; the production application saves a PNG only after explicit Send or Copy file path.

## Remaining physical acceptance

Inspect Windows and macOS rendering, native DPI/Retina changes, different Linux compositors, multiple displays, keyboard focus, input methods and OS theme/accessibility preferences on real desktops. Synthetic Xvfb evidence cannot establish those results. Existing capture, clipboard, WezTerm and packaging checks remain in the same three-job workflow.

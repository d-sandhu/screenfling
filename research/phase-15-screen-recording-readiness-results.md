# Phase 15 Screen Recording readiness results

Result date: 2026-08-24
Branch: `phase/15-next-slice`
Scope: repository implementation and headless evidence only

## Outcome

Phase 15 adds an honest Screen Recording readiness and recovery surface before
capture. The main process reads Electron's closed macOS permission status,
maps non-macOS platforms to `not-applicable`, and exposes only a strict,
versioned, content-free snapshot through preload bridge version 8.

The idle main surface displays the reported state and lets the user check it
again. Capture remains available in every state because the readiness value is
guidance, not pixel evidence; the existing capture backend remains the final
preflight and post-enumeration guard.

This phase does not establish that a packaged build can receive, lose, or
recover Screen Recording permission. It does not launch System Settings,
request permission, start ScreenFling, show the capture overlay, or run any
operator-assisted acceptance path.

## Contract and trust boundary

The shared snapshot is a strict discriminated union:

- macOS: `not-determined`, `granted`, `denied`, `restricted`, or `unknown`;
- Windows, Linux, or another platform: `not-applicable` only;
- version: exactly `1`, with extra fields rejected.

Only the main process imports Electron. It avoids the macOS API entirely on
other platforms and converts a thrown status read to `unknown` without exposing
raw error text. The main renderer invokes one authorized no-payload channel;
preload validates the response before returning it. The capture overlay receives
neither this bridge method nor permission authority.

The startup readiness request is independent from the workflow and shortcut
requests. A supplementary status transport failure therefore cannot prevent the
core application state from loading.

## Interface decision

The existing idle workspace gains one compact instrument-style status rail,
not a modal onboarding wizard or another settings area. It distinguishes:

- permission reported granted, while stating that capture still validates the
  display and pixels;
- permission not confirmed, while saying only that the first capture *may* ask
  macOS;
- denied or restricted status with the exact Privacy & Security pane and restart
  guidance;
- unknown status with Capture still available;
- non-macOS status without a fabricated macOS result.

The native button uses the explicit label **Check again**, retains visible
keyboard focus through the existing control system, and becomes **Checking…**
while its single request is pending. There is no polling, persistence, telemetry,
native deep link, or new motion.

## React review

The readiness copy is derived directly from the strict snapshot during render;
there is no mirrored copy state or effect. The manual recheck performs its IPC
request in the button handler. The one startup effect is retained because it
synchronizes the rendered surface with an external main-process API, and its
workflow/shortcut and readiness request groups begin concurrently while failing
independently. The component uses one explicit `checking | idle` request-state
prop instead of accumulating boolean display variants.

## Automated evidence

`npm run check:all` passed on the macOS arm64 development host:

- Prettier check: passed;
- type-aware Oxlint, including all vendored generic anti-slop rules at error
  severity: passed with no findings;
- TypeScript: passed;
- Vitest: 35 files, 298 tests passed;
- acceptance-helper Node tests: 12 passed;
- electron-vite main, preload, and renderer production builds: passed;
- unpacked Electron 43.4.1 macOS arm64 package with production fuses: passed.

Verification is headless by design. No application launch, capture overlay,
physical shortcut, native permission change, or operator-assisted run belongs in
this evidence.

## Native acceptance still open

- first grant, denial, restriction, revocation, and restart with the stable
  packaged identity;
- the actual Screen & System Audio Recording label and pane behavior across the
  supported macOS range;
- a non-empty, correctly dimensioned capture after a reported grant;
- physical shortcut delivery and the display/lifecycle matrix;
- visible WezTerm routing, focus, real-agent attachment, and ACL/config semantics;
- the complete 200-workflow soak, signed/notarized distribution, and alpha
  readiness.

These remain Gate A, Gate B, and Milestone 1 acceptance rows. Unit fakes, CI,
schema checks, and the Electron-reported status cannot close them.

## Research basis

- [Phase 15 next-slice audit](phase-15-next-slice-audit.md)
- [Phase 15 product-readiness research](phase-15-product-readiness-research.md)
- [React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [Electron `systemPreferences.getMediaAccessStatus`](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesgetmediaaccessstatusmediatype)
- [Electron `desktopCapturer.getSources`](https://www.electronjs.org/docs/latest/api/desktop-capturer#desktopcapturergetsourcesoptions)
- [Apple Screen Recording guidance](https://support.apple.com/guide/mac-help/allow-apps-to-use-screen-and-audio-recording-mchl592e5686/mac)

# Phase 10 Screen Recording permission recovery results

Research and validation date: 2026-08-21

Status: repository policy and recovery contract implemented; Gate A and the
macOS alpha remain open.

## Outcome

ScreenFling now has one pure policy for interpreting Electron's screen-capture
permission status. On macOS, `denied` and `restricted` block capture;
`not-determined`, `granted`, and `unknown` continue to the real source and pixel
checks. On other platforms the policy returns `allowed` and does not invent a
macOS permission failure.

The renderer's `permission-blocked` result now says:

> Screen Recording access is off for ScreenFling. Enable it in System Settings
> → Privacy & Security → Screen & System Audio Recording, then restart
> ScreenFling.

The result offers the existing Done recovery action. It does not claim to open
Settings, request permission, or observe a grant. Capture denial occurs before
clipboard output, and the main-owned failure path closes the prepared overlay,
releases capture state, restores the main surface, and writes no clipboard data.

## Context7 decision check

Context7 was queried with `/electron/electron` for the current Electron API.
Electron documents `getMediaAccessStatus("screen")` as a status query. Its
`askForMediaAccess` request API accepts camera or microphone on macOS, not
screen. Electron's Windows implementation reports screen capture as allowed
rather than exposing a corresponding Screen Recording consent prompt. These
facts support a pure status-to-policy seam and reject a fake request flow.

The exact macOS Settings path and restart instruction remain backed by the
first-party Apple sources recorded in the
[permission acceptance plan](screen-recording-permission-acceptance-plan.md).

## Automated evidence

- A table test covers all five documented statuses on macOS.
- The same statuses return `allowed` on Windows and Linux policy inputs.
- The Electron backend delegates its existing macOS checks to the pure policy;
  real enumeration and empty-image validation remain unchanged.
- Pure renderer-copy coverage locks the actionable Settings and restart text.
- Controller coverage proves a permission failure never shows the prepared
  overlay, closes it, releases capture state, restores the main surface, and
  performs zero clipboard writes.
- Type-aware Oxlint continues to run every vendored generic anti-slop rule at
  error severity.

No native capture surface or System Settings UI is launched by these tests.
The Phase 10 branch passed `npm run check:all` with 183 Vitest tests, ten
headless acceptance-runner tests, strict TypeScript, the production build, and
an ad-hoc signed macOS arm64 directory package.

## Remaining acceptance

- Deny Screen Recording for the exact packaged `com.dsandhu.screenfling`
  artifact, relaunch it, and observe the result and cleanup.
- Grant access in System Settings, fully quit, relaunch, and prove a non-empty
  capture from the same artifact identity.
- Revoke while idle and verify the next capture fails safely.
- Record `restricted` only on a host policy that can actually produce it;
  otherwise mark the row unavailable rather than passed.
- Verify the application label and System Settings path on the supported macOS
  version without logging the TCC database or captured content.
- Complete the remaining shortcut, pointer, display, clipboard-preservation,
  soak, signing, and Windows Gate A rows.

## Sources

- [Electron `systemPreferences`](https://www.electronjs.org/docs/latest/api/system-preferences)
- [Apple Screen Recording settings](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac)
- [Apple ScreenCaptureKit sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)
- [Permission acceptance plan](screen-recording-permission-acceptance-plan.md)
- [Roadmap](../ROADMAP.md)
- [Architecture](../docs/ARCHITECTURE.md)

# Phase 14 configurable shortcut results

Result date: 2026-08-21  
Branch: `phase/14-configurable-shortcut`  
Scope: repository implementation and headless evidence only

## Outcome

Phase 14 replaces ScreenFling's fixed capture accelerator with one complete,
bounded configuration seam. The main process owns validation, Electron
registration, persistence, callback wiring, and cleanup. The renderer receives
only a strict status plus set/reset operations through preload bridge version 7.

This phase does not establish that macOS or Windows delivered a physical global
shortcut, that a real conflicting application preserved the old binding, or
that the preference survived a packaged restart. Those remain native/operator
acceptance rows.

## Product decision

The UI offers three portable modifier sets—Command/Control with Shift, Alt, or
Alt plus Shift—and one A–Z or 0–9 key. That produces 108 bounded choices while
keeping the default `CommandOrControl+Shift+9`.

This structured picker was selected over raw accelerator text and a “Press
keys” recorder. It does not teach Electron syntax, accept platform-only values,
capture arbitrary key events, or require the main process to suspend every
global shortcut while renderer state is responsible for resuming them.

## Main-owned transaction

`ShortcutManager` uses the following order for a changed candidate:

1. receive one already schema-validated structured configuration;
2. register the candidate while the current shortcut remains active;
3. require Electron's app-owned `isRegistered` postcondition;
4. persist the candidate through the versioned preference store;
5. unregister and verify release of the previous accelerator;
6. publish the new main-owned status.

A false/throwing registration rejects the candidate without a write. A failed
write unregisters the candidate and retains the previous status. Concurrent
changes are rejected as busy rather than queued behind a stale choice. If final
cleanup cannot be verified, status reports `cleanupRequired` and disposal
retries every accelerator the manager may still own.

The capture callback is never renderer-selected. It remains the existing
main-owned `controller.startCapture("shortcut")` entry point.

## Persistence and recovery

The only durable shape is strict and versioned:

```json
{
  "version": 1,
  "configuration": {
    "modifiers": "CommandOrControl+Shift",
    "key": "9"
  }
}
```

The path is derived only in main below Electron's application-specific
`userData` directory. A save creates the directory, writes a private unique
sibling with exclusive creation and `flush: true`, then renames the complete
file over `shortcut.json`. Failure removes only that exact temporary file.

A missing preference is first-run default state. Malformed JSON, an unknown
version, or an expanded/invalid value is not executed or silently overwritten;
the default is used with an actionable invalid state. An unreadable file also
falls back without crashing startup and remains distinguishable from first run.

## Bridge and interface

Bridge API version 7 adds three authorized channels:

- `getShortcutStatus()` with no payload;
- `setShortcut({ modifiers, key })` with one strict payload;
- `resetShortcut()` with no payload.

Main authorizes the exact window, frame, and renderer URL before parsing. Preload
validates request and response schemas and exposes no Electron module,
`ipcRenderer`, filesystem API, callback, or path.

The existing header shortcut becomes a native `<details>` settings affordance
with labeled selects, a 40-pixel summary hit area, explicit Save and Reset
buttons, focus-visible styling, platform-neutral Command/Control labels, and
honest unavailable/persistence/busy feedback. The Capture button remains usable
when shortcut registration is unavailable.

## Automated evidence

`npm run check:all` passed on the macOS arm64 development host:

- Prettier check: passed;
- type-aware Oxlint, including all vendored generic anti-slop rules at error
  severity: passed with no findings;
- TypeScript: passed;
- Vitest: 32 files, 260 tests passed;
- acceptance-helper Node tests: 12 passed;
- electron-vite main, preload, and renderer production builds: passed;
- unpacked Electron 43.4.1 macOS arm64 package with production fuses: passed.

Verification is headless by design. No app launch, capture overlay, physical
shortcut, native conflict, or operator-assisted acceptance run belongs in this
evidence. CI results are recorded on the pull request rather than being inferred
from the local package.

## Native acceptance still open

- physical shortcut delivery while another application is focused;
- a real occupied accelerator with the previous binding still working;
- packaged restart persistence and normal-quit cleanup;
- macOS non-QWERTY behavior and any relevant accessibility caveat;
- Windows global delivery, display label, conflict, restart, and cleanup;
- X11 or Wayland behavior only if optional Linux work is later authorized.

These rows stay in Gate A/Milestone 1 and the later Windows milestone. Unit fakes,
CI builds, and schema tests cannot close them.

## Research basis

- [Phase 14 next-slice audit](phase-14-next-slice-audit.md)
- [Phase 14 shortcut configuration research](phase-14-shortcut-configuration-research.md)
- [Electron v43.4.1 `globalShortcut`](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md)
- [Electron v43.4.1 keyboard shortcuts](https://github.com/electron/electron/blob/v43.4.1/docs/tutorial/keyboard-shortcuts.md)
- [Electron v43.4.1 `app.getPath`](https://github.com/electron/electron/blob/v43.4.1/docs/api/app.md#appgetpathname)
- [Node.js 24 filesystem promises](https://nodejs.org/docs/latest-v24.x/api/fs.html)

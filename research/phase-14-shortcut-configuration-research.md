# Phase 14 configurable global-shortcut research

Research date: 2026-08-21  
Target: ScreenFling, Electron `43.4.1`, Node.js `>=24 <25`  
Scope: one configurable capture shortcut, its conflict contract, persistence,
IPC boundary, and repository-testable design. No app launch, `npm start`,
`acceptance:capture`, or GUI/native test was run.

## Decision summary

Implement one main-process `ShortcutService`, not a general settings framework.
It owns a canonical accelerator, registration lifecycle, persistence, and a
typed status/result contract. Keep the current default
`CommandOrControl+Shift+9`; accept a replacement only after validation,
successful registration, and a successful atomic-config commit. A failed
replacement leaves the old registration and persisted value unchanged. The
renderer gets only status and explicit set/reset operations through the
existing trusted preload bridge; it never gets `globalShortcut`, `app.getPath`,
Node `fs`, or a file path.

This is a focused implementation slice. It does not add environment-only
configuration, profiles, sync, telemetry, shortcut discovery, or an inferred
owner for a conflicting accelerator. The roadmap currently places stable
settings and shortcut-conflict handling in Milestone 2; this report describes
the smallest coherent seam if Phase 14 is intentionally pulled forward
(`ROADMAP.md:303-332`).

### Adopted scope refinement

The implemented contract deliberately chooses a strict structured subset of the
broader parser envelope researched below: `CommandOrControl` with Shift and/or
Alt, plus one A–Z or 0–9 key. The renderer uses native selects rather than raw
accelerator text or a “Press keys” recorder. This removes renderer-owned global
shortcut suspension/recovery from the design and keeps all 108 choices portable
between the planned macOS and Windows implementations. The persisted versioned
shape stores `{ modifiers, key }`; main derives the canonical Electron
accelerator.

The adopted result contract likewise reflects what the APIs can prove. It uses
`unavailable` for a false/throwing registration because Electron does not expose
a conflict owner or distinguish ownership from every platform failure. Startup
configuration validity is a separate `default`/`saved`/`invalid`/`unreadable`
state, while an unverified rollback sets `cleanupRequired`. Malformed or
expanded IPC is rejected as a trust-boundary violation before it reaches the
manager rather than being presented as a selectable invalid chord.

## Current repository evidence

- `package.json` pins Electron `43.4.1` and Node `>=24 <25` (`package.json:27-31,
  72-76`).
- `src/main/index.ts` hard-codes `captureShortcut` as
  `CommandOrControl+Shift+9`, registers it inside `app.whenReady()`, catches a
  registration exception, and exposes only `{ accelerator, registered }`
  (`src/main/index.ts:31-32,85-90,118-132`).
- The only shortcut IPC is the authorized, no-payload
  `workflow:get-shortcut-status`; preload validates its return value and does
  not expose raw Electron or Node APIs (`src/shared/bridge.ts:13-22,49-69`,
  `src/main/ipc.ts:46-51`, `src/preload/index.ts:70-73,106-117`).
- `will-quit` calls `globalShortcut.unregisterAll()`; there is no persisted
  shortcut file or set/reset operation (`src/main/index.ts:158-160`). The
  renderer currently shows either the accelerator or “Shortcut unavailable”
  (`src/renderer/src/main.tsx:228-236`).
- The existing sender policy requires the expected `WebContents`, its main
  frame, and the exact renderer URL before handlers run (`src/main/ipc-sender.ts:8-46`).
  The existing strict no-payload and schema helpers are the right seam for
  set/reset operations (`src/main/validated-operation-handler.ts:22-65`).

## Electron 43 global-shortcut contract

Electron documents `globalShortcut` as a main-process module. It works without
application focus and cannot be used before the app `ready` event. Therefore
the current `app.whenReady()` ordering is correct; loading persisted data and
registering the chosen accelerator belong in the main process after readiness
(`global-shortcut` v43.4.1 docs:
  [API reference](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md);
  [app `ready`/`whenReady`](https://github.com/electron/electron/blob/v43.4.1/docs/api/app.md#event-ready)).

`globalShortcut.register(accelerator, callback)` returns a boolean indicating
registration success. Electron explicitly says that an accelerator already
taken by another application fails silently, so `false` is the conflict or
platform-unavailable signal; it is not an exception-based owner lookup
(`globalShortcut` v43.4.1
  [register](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutregisteraccelerator-callback)).
The service should still catch an exception around the call so malformed or
platform-specific native failures cannot tear down startup; that catch is an
engineering safety policy, not a documented promise that Electron throws.

`globalShortcut.isRegistered(accelerator)` reports whether this application has
registered the accelerator. It returns `false` when another application owns
it as well as when this app has not registered it, so it is a postcondition
check, not a way to discover the conflicting process
([isRegistered](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutisregisteredaccelerator)).
`unregister(accelerator)` removes one binding and `unregisterAll()` removes all
bindings; use the former during a swap and the latter for final cleanup
([unregister](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutunregisteraccelerator),
  [unregisterAll](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutunregisterall)).

Electron's `app.quit()` path emits `will-quit`, while `app.exit()` exits
immediately without `before-quit` or `will-quit` (`app` v43.4.1
  [quit/exit](https://github.com/electron/electron/blob/v43.4.1/docs/api/app.md#appquit),
  [exit](https://github.com/electron/electron/blob/v43.4.1/docs/api/app.md#appexit)).
Normal shutdown should retain the existing `will-quit` cleanup. The service
should also expose an idempotent `dispose()` for tests and explicit lifecycle
owners, rather than relying on an event that an immediate exit skips.

## Accelerator syntax and validation

Electron defines an accelerator as one or more modifier tokens plus one key
code, joined with `+`; accelerator names are case-insensitive. The documented
modifiers are `Command`/`Cmd`, `Control`/`Ctrl`, `CommandOrControl`/`CmdOrCtrl`,
`Alt`, `Option`, `AltGr`, `Shift`, `Super`, and `Meta`. Key codes include
`0`–`9`, `A`–`Z`, `F1`–`F24`, punctuation, `Space`, navigation/editing keys,
media keys, `PrintScreen`, and numpad keys
([pinned keyboard-shortcuts guide](https://github.com/electron/electron/blob/v43.4.1/docs/tutorial/keyboard-shortcuts.md#accelerators)).

The documented grammar does **not** specify a maximum string length, a
duplicate-token policy, or an application-friendly minimum modifier set. Those
must therefore be ScreenFling policy, not claims about Electron validation.
Use a pure parser with an explicit token allowlist:

1. trim only at the input boundary, reject empty strings and whitespace inside
   tokens;
2. split on `+`, canonicalize aliases and case, require exactly one key token;
3. reject unknown tokens, duplicate modifiers, duplicate keys, and a
   modifier-only or key-only shortcut;
4. retain a bounded input (the existing status schema uses 64 characters) and
   require at least one non-`Shift` modifier for a global capture shortcut;
5. serialize the canonical Electron spelling, not the platform display label.

The last two limits are deliberately product safety limits. They should be
documented in the schema/tests, not presented as Electron limitations. Do not
accept arbitrary strings and defer all validation to `register()`; Electron's
documented boolean result cannot distinguish syntax rejection from ownership or
platform failure.

Cross-platform mapping is part of the canonicalization contract:
`CommandOrControl` means Command on macOS and Control on Windows/Linux;
`Command` has no effect on Windows/Linux; and `Alt` should be used instead of
macOS-only `Option` for a portable binding
([cross-platform modifiers](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts#cross-platform-modifiers)).
The persisted value should remain `CommandOrControl+Shift+9`; the UI may render
`⌘⇧9` or `Ctrl+Shift+9` from `process.platform`, but must not persist those
labels.

Two documented caveats belong in acceptance, not hidden fallback logic:
macOS media-key accelerators can require trusted accessibility authorization on
older macOS versions ([Electron globalShortcut caveat](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutregisteraccelerator-callback)),
and Electron's keyboard-shortcut guide calls out a long-standing macOS
non-QWERTY `globalShortcut` issue ([keyboard-shortcuts warning](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts#global-shortcuts)).
Do not silently substitute a different key when either condition occurs.

## Safe registration swap and rollback

Keep two values in the service: `active` (the last known in-process binding)
and `saved` (the last committed config). Serialize set/reset requests so only
one transaction can alter them. For a candidate different from `active`:

1. Parse and canonicalize it. If invalid, return `invalid-accelerator` without
   touching registration or disk.
2. Call `register(candidate, callback)` while the old binding remains active.
   If it returns `false` or throws, call `unregister(candidate)` defensively,
   verify that the old binding remains registered, and return
   `conflict`/`registration-failed`. Do not change `active`, `saved`, or the
   file. Electron's silent conflict behavior makes this ordering essential
   ([register](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutregisteraccelerator-callback)).
3. Require `isRegistered(candidate)` to be true before committing. This is a
   defensive postcondition check; Electron documents the method as a boolean
   owned-by-this-app check ([isRegistered](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutisregisteredaccelerator)).
4. Commit the candidate config with the write protocol below. If the write
   fails, unregister the candidate, verify the old binding, and retain the old
   values. Return `persistence-failed`, not success.
5. After the commit, unregister the old accelerator and verify it is no longer
   registered. Only then update `active` and `saved` and return success.

If the final old-unregister or rollback verification cannot establish a safe
state, do not claim success. Return an explicit `reconciliation-required`
status containing only the canonical accelerator(s) and booleans; keep capture
through the binding that `isRegistered()` confirms and leave the UI actionable.
This is a rare defensive branch because Electron does not provide an
unregister result, but it prevents a stale status from being presented as a
clean swap. Never auto-try a list of fallback accelerators: that can seize an
unexpected user shortcut.

For reset, use the same transaction with the fixed default. A reset is an
explicit user action, not an automatic response to a conflict. If the default
also conflicts, preserve the current working binding and report the conflict.

## Persistence location and atomic read/write

Electron defines `app.getPath('userData')` as the application-specific directory
for configuration files
([Electron app paths](https://github.com/electron/electron/blob/v43.4.1/docs/api/app.md#appgetpathname)).
Use one fixed path derived in main after readiness, for example:

```text
path.join(app.getPath('userData'), 'shortcut.json')
```

The only durable schema needed for this slice is strict and versioned:

```json
{"version":1,"configuration":{"modifiers":"CommandOrControl+Shift","key":"9"}}
```

Read behavior:

- missing file (`ENOENT`) means first run: use the default and attempt to
  register it;
- read, UTF-8 decode, JSON-parse, and strict-schema-parse the file in main;
- malformed JSON, an unknown version, or an invalid accelerator is a
  `config-invalid` diagnostic: do not execute it, do not overwrite it
  automatically, and start with the default for this run;
- a valid value that cannot register remains the saved value but reports
  `registered: false` and `conflict` so the user can choose another one;
- never read configuration from `process.env`, command-line fragments, or a
  renderer-supplied path.

Node documents `fsPromises.readFile()` as reading the entire file and returning
its contents (a string when an encoding is specified)
([readFile](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesreadfilepath-options)).
Use `JSON.parse` plus the strict Zod schema; an incomplete or corrupt file must
fail closed to the default rather than being partially interpreted.

Write behavior should be a small, serialized helper:

1. `mkdir(configDirectory, { recursive: true })`.
2. Serialize the validated value with deterministic JSON and a trailing newline.
3. Write a uniquely named sibling temp file with `writeFile(..., { encoding:
   'utf8', flag: 'wx', flush: true })`; Node documents `writeFile` as replacing
   an existing target and warns that concurrent writes to the same file are
   unsafe, while Node 24 documents `flush` support
   ([writeFile](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromiseswritefilefile-data-options)).
4. Rename the completed temp file to `shortcut.json` with
   `fsPromises.rename()` and remove the temp file on failure
   ([rename](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath)).

The temp-write/rename sequence is the engineering atomic-replacement protocol:
the target is never written incrementally, and a crash before rename leaves the
previous target in place. Node documents the write, flush, and rename
primitives, but does not promise one universal crash-atomic replacement
semantic for every filesystem/platform. Treat “old complete file or new
complete file” as a tested ScreenFling invariant on macOS and Windows, retain
the previous value on any write error, and do not describe it as a Node
guarantee. `flush: true` requests a flush before close; Node notes that the
underlying implementation is OS/device-specific
([file-handle sync semantics](https://nodejs.org/docs/latest-v24.x/api/fs.html#filehandlesync)).

Do not use direct `writeFile(target, ...)` for replacement: the Node docs say it
replaces the existing file, so an interrupted write can expose a partial or
empty config to the next read. Do not run concurrent writes; the service's
serialized transaction is part of the contract.

## IPC and trust boundary

The main process remains the sole authority for accelerator parsing,
registration, persistence, and callback wiring. Add narrowly typed channels,
for example:

```text
getShortcutStatus() -> ShortcutStatus
setShortcut({ modifiers, key }) -> ShortcutChangeResult
resetShortcut() -> ShortcutChangeResult
```

`setShortcut` accepts exactly one strict object with one modifier enum and one
key enum. The main handler must authorize the sender before parsing, require the
exact main window/main frame/renderer URL already used by ScreenFling, and reject extra
keys, extra positional arguments, paths, callbacks, and arbitrary serialized
objects. `resetShortcut` is a no-payload authorized action. Return a closed
schema such as:

```text
{ accelerator, registered, saved, outcome:
  "unchanged" | "applied" | "invalid-accelerator" | "conflict" |
  "registration-failed" | "persistence-failed" | "config-invalid" |
  "reconciliation-required" }
```

Electron's security guide requires validating IPC senders and warns against
exposing raw Electron APIs or the whole `ipcRenderer`; the contextBridge guide
recommends one safe wrapper per operation
([security checklist](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages),
  [contextBridge IPC guidance](https://www.electronjs.org/docs/latest/api/context-bridge#exposing-ipcrenderer),
  [context isolation IPC guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations)).
That matches ScreenFling's existing exact-sender and strict-schema policy. A
renderer compromise must not be able to register an arbitrary global key,
write a file, select a path, or replace the callback.

## User-facing conflict recovery

The UI should make the boolean limitation understandable:

- startup registration failure: show “Shortcut unavailable — it may already be
  in use,” keep the Capture button fully usable, and offer “Choose another” and
  “Restore default” actions;
- candidate conflict: say “That shortcut is already in use. Choose another.”
  Keep the old shortcut and old saved value; do not clear a working shortcut;
- invalid syntax: show an inline example and the allowed modifier/key format;
  do not call Electron or write a file;
- persistence failure: report “Shortcut changed for this run but was not
  saved” only if the service can verify the candidate is active; otherwise
  report the old binding and retry/reset action;
- config-invalid on startup: use the default for the session and provide an
  explicit reset action; do not silently destroy the invalid file;
- conflict owner: never claim to know which application owns it. Electron's
  documented API only gives success/false and `isRegistered()` status
  ([register conflict behavior](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutregisteraccelerator-callback)).

The status display should distinguish canonical accelerator from platform label,
and should reflect `registered` from the main service rather than assuming a
successful write means a successful OS binding. There is no automatic fallback
key or retry loop.

## Cross-platform implications

| Platform | Contract and caveat | Test/acceptance implication |
| --- | --- | --- |
| macOS | `CommandOrControl` displays and binds as Command. `Option` is macOS-only; use `Alt` for portable values. Electron documents media-key accessibility caveats and a non-QWERTY global-shortcut warning ([modifiers](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts#cross-platform-modifiers), [global caveat](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md#globalshortcutregisteraccelerator-callback)). | Test a packaged identity, another app owning the candidate, default/reset, and at least one non-QWERTY layout observation. |
| Windows | `CommandOrControl` binds as Control; `Command` is not a portable Windows binding ([cross-platform modifiers](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts#cross-platform-modifiers)). | Test physical delivery outside the app, conflict preservation, restart persistence, and normal quit cleanup. Do not infer success from unit fakes. |
| Linux X11 | Electron's current guide says X11 shortcuts are grabbed directly from the X server ([Linux global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut#usage-on-linux)). | Keep registration boolean and ownership conflicts in the common contract; add an X11 packaged check if Linux becomes supported. |
| Linux Wayland | Electron's current guide says Wayland uses `org.freedesktop.portal.GlobalShortcuts`, with desktop identity and compositor consent affecting binding ([Linux global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut#usage-on-linux), [app `setDesktopName`](https://www.electronjs.org/docs/latest/api/app#appsetdesktopnamename-linux)). The current guide is not a substitute for a version-43 packaged check. | Do not add hidden feature flags or pretend the macOS/Windows result proves Wayland. If Linux support is enabled, package a matching reverse-DNS desktop identity and test consent/relaunch behavior. |

Electron's v43 API contract is therefore the common boolean lifecycle; native
delivery, layout behavior, compositor policy, and packaging identity remain
platform acceptance work. A failed platform bind uses the same safe UI as a
conflict, with a platform-specific diagnostic category only if the main process
has reliable evidence.

## Test-first design

Build the pure seams before changing `index.ts` or the renderer:

1. **Accelerator parser/schema (red first).** Test canonical default, aliases
   (`CmdOrCtrl`, `Ctrl`, `Esc`, `Enter`), case normalization, exactly one key,
   unknown token rejection, duplicate modifiers, whitespace, key-only and
   modifier-only rejection, 64-character bound, and canonical serialization.
   Test that platform labels such as `⌘⇧9` are not accepted as persisted
   accelerators.
2. **Config store.** Inject `readFile`, `writeFile`, `rename`, `mkdir`, and a
   temp-name provider. Test missing file/default, valid read, malformed JSON,
   unknown version, invalid accelerator, deterministic serialized output,
   unique temp creation, awaited write-before-rename, cleanup on failure, and
   serialized concurrent saves. Assert that a failed save leaves the previous
   target untouched.
3. **Shortcut service with a fake Electron registrar.** Test startup success,
   startup conflict, startup throw, `isRegistered` postcondition failure,
   successful new-first swap, candidate conflict preserving old registration,
   candidate throw preserving old registration, persistence failure rollback,
   old-unregister reconciliation, reset, same-value no-op, and idempotent
   dispose. Assert callback invocation always starts the existing controller
   with `"shortcut"` only after the service reports an active registration.
4. **IPC/preload contract.** Test exact sender/main-frame/URL authorization,
   no payload for reset, one strict object for set, extra-key rejection,
   oversized/unknown values, and that unauthorized input cannot invoke the
   registrar or config store. Test preload return-schema validation and the
   absence of raw `ipcRenderer`, `fs`, `app`, or path fields in the exposed API.
5. **Renderer behavior.** Test inline invalid input, conflict preserving old
   displayed status, startup unavailable state, reset/default action, and
   button capture availability in every failure result. This can stay a React
   unit test; it must not simulate OS key delivery.
6. **Packaged/manual boundary.** Keep native rows separate: real shortcut from
   another app's focus, conflict with a known owner, restart persistence,
   macOS non-QWERTY/media-key observations, Windows delivery, and X11/Wayland
   identity/consent if Linux is claimed. No headless test can establish those
   OS facts, and no fake registrar should be counted as acceptance evidence.

The minimum exit criteria are: invalid input never touches registration; a
registration conflict never removes the old binding; a failed save never
claims persistence; startup always has a usable button path; every status is
derived from main-owned state; and the unit suite proves no renderer can reach
filesystem or global-shortcut primitives.

## Sources and evidence boundary

Primary external sources used above:

- [Electron v43.4.1 `globalShortcut` API](https://github.com/electron/electron/blob/v43.4.1/docs/api/global-shortcut.md)
- [Electron v43.4.1 `app` API](https://github.com/electron/electron/blob/v43.4.1/docs/api/app.md)
- [Electron v43.4.1 keyboard shortcuts guide](https://github.com/electron/electron/blob/v43.4.1/docs/tutorial/keyboard-shortcuts.md)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Node.js v24 file system API](https://nodejs.org/docs/latest-v24.x/api/fs.html)

The repository facts and proposed transaction/test behavior are engineering
findings, not claims that Electron or Node provide stronger guarantees than
their documentation states. In particular, Electron exposes no conflict-owner
identity, and Node documents the filesystem primitives but not a universal
cross-platform crash-atomic rename contract.

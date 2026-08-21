# Phase 14 next-slice audit

Audit date: 2026-08-21

Scope: repository-testable work after merged Phase 13 (`abfd233`) on
`phase/14-configurable-shortcut`. This audit is read-only apart from this
report. It does not launch ScreenFling, run `npm start`, run
`acceptance:capture`, or claim GUI, native, hardware, signing, or operator
evidence.

## Recommendation

Make Phase 14 **one complete user-facing configurable global shortcut slice**:
main-owned validation and registration, persisted committed settings, strict
IPC, and a small accessible structured shortcut picker. The transaction must preserve the
last known-good shortcut when a candidate conflicts or persistence fails. This
is now the smallest coherent repository-testable product slice, with an
important qualification: it closes the application seam, not the native
acceptance row. The actual operating system may still reject the chosen
accelerator, and a human must verify delivery from another application in a
packaged build.

The recommendation supersedes Phase 13's ranking. Phase 13's diagnostics seam
is implemented: the main process owns bounded timing/result aggregation and a
strict read-only snapshot (`research/phase-13-sanitized-diagnostics-results.md:20-50`),
and the Phase 13 audit's proposed shortcut work was intentionally deferred
because persistence and settings were then outside that slice
(`research/phase-13-next-slice-audit.md:41-62`). The remaining hard-coded
accelerator is now the clearest user-visible contract gap.

After deeper Electron lifecycle review, the implementation deliberately narrows
the UI recommendation below: it uses modifier and A–Z/0–9 selects instead of a
“Press keys” recorder. That avoids raw Electron syntax and avoids suspending
global shortcuts while renderer state is responsible for resuming them.

## Current evidence and gap

| Contract | Current repository evidence | Gap |
| --- | --- | --- |
| Configurable shortcut is a product promise | The experience contract says capture begins from a configurable global shortcut (`docs/PRODUCT.md:59-81`), and configurable global shortcut is in Milestone 1 scope (`ROADMAP.md:281-298`). | The user cannot configure it. |
| Main-owned registration | `captureShortcut` is a module constant and registration happens once after `app.whenReady()` (`src/main/index.ts:25-32`, `:89-131`). Shutdown calls `unregisterAll()` (`src/main/index.ts:158-160`). | No rebind service, candidate transaction, or committed-setting state exists. |
| Conflict observation | Registration's boolean is exposed as `{ accelerator, registered }` (`src/main/index.ts:85-87`, `src/shared/bridge.ts:51-58`). The UI only renders the keys or “Shortcut unavailable” (`src/renderer/src/main.tsx:228-240`). | There is no user action, conflict reason, rollback, or recovery path. |
| IPC boundary | `getShortcutStatus` is a sender-authorized no-payload call (`src/main/ipc.ts:45-52`); preload validates its strict response (`src/preload/index.ts:67-73`). | There is no strict set/rebind request or response channel. |
| Persistence | No application settings store or shortcut persistence module exists; source search finds no `app.getPath`, settings file, or app-owned preferences path. | The accelerator resets to the constant on every process start. |
| Diagnostics/privacy | The bounded diagnostics snapshot is in memory only and deliberately excludes content, paths, operation IDs, and destination identities (`research/phase-13-sanitized-diagnostics-results.md:41-50`; `src/shared/diagnostics.ts:85-105`). | Shortcut changes should use the same no-content boundary; do not turn this into history or telemetry. |

Electron's official `globalShortcut` contract supports main-process
registration after `ready`, returns a boolean, and can silently fail when an
accelerator is already owned by another application. It also documents
unregistration at quit. Those facts explain why a status indicator alone is
not a conflict UX and why the candidate must be registered before it is
committed: [Electron `globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut).

## Phase 14 contract

### Main-owned settings and shortcut service

Add a small `ShortcutManager` (or equivalent) in the main process and inject
two collaborators in tests:

1. a global-shortcut registrar exposing `register`, `unregister`, and the
   stable capture callback; and
2. a settings store exposing strict load/save of a versioned value.

The persisted value should be the minimum content-free shape:

```text
{ version: 1, accelerator: <validated Electron accelerator> }
```

The production store may use a file below Electron's main-process
`app.getPath("userData")`; the renderer must never choose that path. Writes
should be atomic (temporary file in the same directory followed by rename),
and malformed, missing, or unsupported settings should fail closed to the
documented default without crashing startup. Do not add a general settings
framework, history, telemetry, or adapter configuration UI in this phase.

The accelerator domain must be validated before registration. A strict schema
alone that accepts any non-empty string is insufficient: reject control
characters, empty/modifier-only chords, duplicate or unknown tokens, and
overlong values, then canonicalize modifier/key order. Keep the accepted
token table small and test it; use Electron's documented accelerator syntax as
the reference rather than accepting shell, OS path, or arbitrary renderer
data.

The committed state is the last known-good setting. Rebinding is one bounded
transaction:

1. Parse the strict request and return a typed invalid result without touching
   the current registration or settings file.
2. If the candidate equals the committed accelerator, return the current
   status without changing anything.
3. Register the candidate with the existing capture callback while the old
   binding remains active. A `false` return or thrown registrar error is a
   conflict/unavailable result; leave the old registration and persisted value
   unchanged.
4. Persist the candidate atomically. If persistence fails, unregister the
   candidate, retain the old setting, and restore the old registration if
   necessary. Report a persistence/rollback failure category if restoration
   itself cannot be proven.
5. After the candidate is persisted, unregister the old accelerator and commit
   the candidate in memory. On any registrar exception, perform the same
   best-effort rollback and never report the candidate as committed unless the
   resulting status is explicit.

At startup, load and validate the committed setting, then attempt registration.
If the OS rejects it, keep the setting visible as unregistered with an
actionable conflict status; do not silently substitute an unrelated shortcut.
The default is used only when stored data is absent or invalid. On quit,
unregister the manager's known binding; it should not erase the user's setting.

The status/result vocabulary should distinguish at least `none`, `conflict`,
`invalid`, `persistence-failed`, and `rollback-failed`. Keep the existing
accelerator and registered fields, but extend the strict status schema so the
UI can explain why a candidate was not committed. A set response should include
whether the request was accepted and the committed status; it must not echo
paths, exception text, keylogger data, or raw OS output.

### Strict IPC

Extend the existing bridge with one authorized request channel, for example:

```text
setShortcut({ accelerator }) -> { accepted, status }
getShortcutStatus()        -> status
```

`setShortcut` is app-scoped and therefore has no operation ID, but it must use
the same exact sender/frame/document authorization as the current read-only
status handler (`src/main/ipc.ts:34-52`). Use a strict Zod request and strict
versioned response; reject extra keys, malformed accelerators, duplicate
payloads, and calls from the overlay or an untrusted document. Preload parses
both request and result before exposing them through the frozen bridge object,
matching the existing pattern (`src/preload/index.ts:67-73`, `:104-118`).

The shortcut callback remains main-owned and continues to call
`controller.startCapture("shortcut")`; the renderer never receives a callback,
Electron API, filesystem handle, or registration authority.

### User-facing UI

Add a compact settings affordance to the existing main surface, not a second
settings subsystem. It should:

- show the committed shortcut and registration/problem state;
- choose one portable modifier set and one A–Z/0–9 key through native form
  controls;
- send only the strict structured configuration through `setShortcut`;
- keep the old binding visibly active when a conflict or persistence error is
  rejected;
- show actionable, content-free error copy and return focus predictably;
- remain keyboard navigable and not rely on a global key logger.

Put configuration-to-accelerator conversion in a pure shared helper so the
canonical portable spelling has unit tests without a GUI. The UI should not
require users to type Electron's internal accelerator spelling. A conflict test
can use an injected registrar; real OS ownership remains a native row below.

## Repository tests and exit criteria

The phase is complete at the repository seam when the following tests pass
without launching Electron or any GUI/native process:

- `src/main/shortcut-manager.test.ts`: default load, valid startup load,
  malformed/version-mismatched settings fallback, candidate success, same-value
  no-op, registrar false/throw conflict, atomic-save failure, unregister/restore
  rollback, startup conflict, quit cleanup, and no capture callback until a
  registered binding is pressed;
- `src/shared/shortcut.test.ts` (or equivalent): strict accelerator grammar,
  canonicalization, bounded length, modifier/key requirements, control/unknown
  token rejection, and strict settings/status/update schemas;
- `src/main/ipc.test.ts` / bridge tests: exact sender authorization, no overlay
  access, one-payload requirement, no extra request fields, and typed result
  parsing;
- renderer helper tests: key chord conversion, Save/Cancel, conflict rollback
  display, current status refresh, and keyboard focus behavior where the
  existing headless test style permits;
- regression coverage: diagnostics still labels shortcut starts, capture flow
  and operation fencing are unchanged, and `will-quit` leaves no registered
  shortcut.

Run the existing headless repository gate (`npm run check`) after implementation.
The report for this phase should include only schema/status categories and
test outcomes; it must not include the persisted user path, raw accelerator
events, notes, images, clipboard data, terminal text, or OS error text.

## Alternatives considered

1. **Configurable shortcut (recommended).** It closes an explicit Product and
   Milestone 1 promise, is isolated behind the existing main/preload boundary,
   and has deterministic tests for safe registration, conflict rollback, and
   persistence. It also improves the daily workflow without expanding capture,
   routing, or destination claims.

2. **Run native Gate A/B acceptance now.** This has higher release evidence
   value, but it is not a repository implementation slice. It needs a packaged
   app, another application owning or not owning the chord, real global key
   delivery, display/permission state, WezTerm/agent versions, visible focus
   observation, and operator/hardware access. The roadmap explicitly leaves
   those rows open (`ROADMAP.md:500-510`), so synthetic tests must not be used
   as a substitute.

3. **Repeat the packaged 200-workflow/timing soak.** The diagnostics snapshot
   now makes this evidence easier to compare, but the run remains acceptance
   work and cannot establish that an arbitrary user can rebind a shortcut or
   that a real global key arrives while ScreenFling is unfocused. It should
   follow the repository slice, not replace it.

4. **Improve WezTerm read-back or add another adapter.** This would strengthen
   the differentiated handoff, but current adapter evidence still requires
   real terminal/agent/version trials, and the product says no adapter may
   claim attachment without read-back (`docs/PRODUCT.md:156-161`,
   `ROADMAP.md:312-313`). A repository-only adapter change cannot close that
   acceptance row.

5. **Diagnostics UI/export/history or broad settings.** Phase 13 deliberately
   deferred telemetry, durable history, and a diagnostics UI
   (`research/phase-13-sanitized-diagnostics-results.md:11-14`, `:49-50`).
   A full settings framework or export would be larger than the shortcut
   contract and would conflict with the roadmap's later Milestone 2 scope for
   stable settings, conflict handling, and diagnostics export
   (`ROADMAP.md:315-333`). Keep Phase 14 to one persisted setting and one
   interaction.

6. **Windows capture or native helper work.** Windows is a later Tier 1
   milestone and native code is gated on measured Electron/API failure
   (`ROADMAP.md:346-364`; `docs/ARCHITECTURE.md:470-485`). Neither is the
   smallest next repository seam.

## Native and operator gates that remain open

This phase must not claim any of the following from unit tests or a mocked
registrar:

- the chosen shortcut is delivered by macOS or Windows while ScreenFling is
  unfocused, backgrounded, minimized, or after restart;
- a real conflicting application owns the candidate and the user sees the
  expected conflict/recovery behavior;
- packaged identity, `userData` permissions, atomic rename behavior, upgrade
  preservation, or clean-machine persistence across signed/notarized installs;
- OS-specific reserved/media-key/accessibility restrictions, Linux portal
  consent/identity behavior, or security-product interference;
- shortcut-to-overlay p95, physical-pointer timing, display topology,
  Screen Recording denial/revocation, suspend/resume, or 200-cycle native
  resource behavior;
- zero wrong-target routing, no-focus Stage, real WezTerm endpoint replacement,
  or image attachment/read-back in an actual agent session;
- macOS alpha readiness, signing/notarization, or Windows support.

Those rows remain the packaged/native/operator work described in the roadmap:
Milestone 0 Gate A/Gate B (`ROADMAP.md:60-85`, `:143-169`), Milestone 1 exit
criteria (`ROADMAP.md:300-313`), and the Immediate Implementation Sequence
(`ROADMAP.md:500-512`). Phase 14 should report “repository contract complete;
native acceptance open,” not “shortcut support proven.”

## Sources

- [Roadmap](../ROADMAP.md), especially Milestone 1, Milestone 2, and Immediate
  Implementation Sequence.
- [Product direction](../docs/PRODUCT.md), especially the experience contract,
  initial scope, and success measures.
- [Architecture](../docs/ARCHITECTURE.md), especially process/bridge trust
  boundaries, workflow diagnostics, platform services, and the native-code gate.
- [Domain context](../CONTEXT.md), especially operation ownership and workflow
  diagnostics.
- [Phase 13 next-slice audit](phase-13-next-slice-audit.md).
- [Phase 13 sanitized diagnostics results](phase-13-sanitized-diagnostics-results.md).
- `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/bridge.ts`, `src/shared/diagnostics.ts`, and
  `src/renderer/src/main.tsx`.
- [Electron `globalShortcut` API](https://www.electronjs.org/docs/latest/api/global-shortcut)
  (official documentation only).

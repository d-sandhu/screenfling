# Phase 12 exact-destination Reveal plan

Research date: 2026-08-21  
Scope: the first user-triggered Reveal transaction for the pinned WezTerm
adapter. This report is repository research only: no production code, app
launch, GUI test, or native acceptance was performed.

## Decision

Implement one adapter-specific, no-data **Reveal** operation. A Reveal request
must carry the current operation ID and an opaque result/route lease retained
from the completed Stage. The main process consumes the lease only after a
fresh exact-target check; it invokes no `send-text`, writes no stdin, and never
chooses a focused or similarly labelled pane.

For WezTerm, the minimal transaction is:

1. Require a result that names a destination and an unexpired Reveal lease.
2. Re-run the pinned, explicit-instance `cli list --format json`; require the
   same endpoint generation and exactly one matching `pane_id`.
3. Immediately before process creation, re-read the selector generation. If it
   changed, return `stale` and spawn nothing.
4. Spawn the configured executable with the explicit config selector, explicit
   socket selector, explicit `cli activate-pane --pane-id <id>`, and the
   environment with `WEZTERM_PANE` removed. Do not pass note/image bytes.
5. Map only process-level evidence to a typed outcome. A successful CLI return
   means the request was accepted by the selected WezTerm endpoint; it does not
   prove that an OS window became frontmost or that a human can see the pane.

The smallest safe result type is separate from `DeliveryResult` so Reveal does
not rewrite the original Stage evidence:

```text
revealed                  exact endpoint accepted activation request
stale                     operation/lease/generation/pane no longer matches
unavailable               binary, config/socket, or endpoint could not be used
unsupported               pinned binary does not expose the required command
failed                    bounded process failure or malformed result
```

`revealed` must be described as “activation requested” until packaged native
evidence establishes foreground/visibility behavior. `stale` and
`unavailable` preserve the original clipboard fallback. No outcome implies
attachment, submission, window raising, or agent readiness.

## Native facts and limits

WezTerm’s first-party CLI reference says `activate-pane` activates/focuses the
current pane or the explicitly supplied `--pane-id`; it was introduced in
`20230326-111934-3666303c`, so the repository’s pinned
`20240203-110809-5046fc22` is new enough by the documented version gate. The
command has no documented window ID, restore, foreground, or visibility option
and no documented response body. See [activate-pane](https://wezterm.org/cli/cli/activate-pane.html).

The same CLI reference says that omitting `--pane-id` falls back first to
`WEZTERM_PANE`, then to the focused pane from the most recently interacted
session. Omitting the ID is therefore unsafe for ScreenFling; every Reveal,
Stage, and discovery operation must supply it. The reference also says the
instance is selected by `--prefer-mux`, then `WEZTERM_UNIX_SOCKET`, then a
running GUI (optionally filtered by `--class`). See [CLI instance and pane
targeting](https://wezterm.org/cli/cli/index.html).

The documented Lua equivalent is even more explicit about the boundary:
`pane:activate()` activates/focuses the pane and containing tab, but returns no
value. That is mux/tab state, not a promise that the host OS raised a GUI
window. See [pane:activate](https://wezterm.org/config/lua/pane/activate.html).

`--config-file` is a global WezTerm option that overrides normal config-file
resolution. The official config documentation says that if the selected file
cannot be loaded, WezTerm uses its built-in default configuration. Therefore a
path existing on disk is not proof that the intended socket/domain selection
was applied; preflight must treat config-load errors/fallback as unavailable
unless the pinned fixture proves the selected endpoint. See [CLI options](https://wezterm.org/cli/general.html)
and [configuration-file resolution](https://wezterm.org/config/files.html).

The current official CLI docs do not list or define `--no-auto-start` for
`wezterm cli`. The production adapter currently passes it, but its semantics
must be treated as an implementation/version compatibility question: run the
pinned binary’s `cli --help`/command help in a native fixture, reject an
unknown option, and do not claim that it prevents GUI or mux auto-start until
that fixture proves it. The documented CLI targeting rules alone do not prove
that behavior. The pinned release is [20240203-110809-5046fc22](https://github.com/wezterm/wezterm/releases/tag/20240203-110809-5046fc22).

WezTerm’s first-party docs do not specify exit codes for `activate-pane` or a
semantic distinction between “pane selected,” “GUI raised,” and “activation
blocked.” Treat a bounded child-process success as endpoint acceptance only;
non-zero exit, signal, timeout, spawn failure, or malformed output maps to a
non-success typed result. This is an inference from the absence of a documented
semantic response, not a claim about every platform’s native process status.

Electron independently documents that `BrowserWindow.show()` shows and gives
focus, `showInactive()` shows without focus, `focus()` focuses, and
`restore()` returns a minimized window to its previous state. Those APIs apply
to ScreenFling’s own BrowserWindow, not to a foreign WezTerm window, and cannot
establish what WezTerm’s CLI does to the host window. See the [Electron
BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window).

## Current repository lifetime and seam

The current `DestinationRegistry` binds discovery to an operation ID, consumes
the discovery before Stage, and calls the adapter’s one-shot
`stageIfCurrent`. `CaptureController.stageCapture` copies/verifies first,
stages once, releases the in-memory capture, clears the registry, and finishes a
`result` snapshot. The shared `DestinationReceipt` retains only `id`, adapter,
and surface; it does not retain endpoint generation or the configured selector.
See [destination registry](../src/main/destination-registry.ts),
[capture controller](../src/main/capture-controller.ts),
[workflow](../src/shared/workflow.ts), and [domain receipt](../src/shared/domain.ts).

The renderer currently exposes only `Done` after a result, and the bridge has
no Reveal channel. `dismissResult` resets the workflow to `idle`; after that,
the operation ID is stale. A Reveal implementation must therefore retain a
short-lived main-process lease that contains the exact route/generation and is
invalidated on Done, a new operation, or a stale/consumed Reveal. A receipt or
destination ID reconstructed in the renderer is insufficient. See [bridge](../src/shared/bridge.ts),
[preload](../src/preload/index.ts), and [result UI](../src/renderer/src/main.tsx).

The adapter already hashes configured executable/config/socket evidence into a
generation, removes inherited `WEZTERM_PANE`, and checks generation and pane
existence before Stage. Reveal should reuse the same selector and generation
guard, but end with `activate-pane --pane-id` and no input payload. See [WezTerm
adapter](../src/main/wezterm-adapter.ts) and its [exact-route tests](../src/main/wezterm-adapter.test.ts).

## Exact repository tests

Add tests around the smallest seam:

- command shape: explicit `--config-file`, `cli`, pinned no-auto-start policy
  (accepted or typed unsupported), `activate-pane`, explicit pane ID, explicit
  socket environment, and no inherited `WEZTERM_PANE`;
- no-data guarantee: Reveal request has no stdin, never calls `send-text`, and
  does not reuse image or note bytes;
- exact revalidation: missing pane, duplicate/ambiguous pane, changed
  generation before list, changed generation at the final pre-spawn guard, and
  selector replacement all return `stale` with zero activation processes;
- lifetime: wrong operation ID, no Reveal-capable result, consumed lease,
  dismissed result, and a new workflow all fail closed without rediscovery or
  fallback to the active pane;
- typed process outcomes: successful bounded process → `revealed`; missing
  executable/socket/config or connection refusal → `unavailable`; unsupported
  command/help or pinned-version mismatch → `unsupported`; timeout, signal,
  non-zero exit, malformed output, and spawn failure → `failed` (or a
  separately named `uncertain` only if the implementation can prove that
  activation may have been accepted);
- regression: existing 100 alternating Stage routes, literal payload bytes,
  no Enter, no Stage focus/activation, stale endpoint replacement, and no
  automatic retry remain unchanged.

Tests should assert sanitized argument categories and statuses only. Do not
record user notes, image bytes, terminal text, credentials, or real paths.

## Native rows docs cannot prove

- On packaged macOS and Windows, does `activate-pane --pane-id` bring the
  containing WezTerm GUI window to the foreground when another app is active?
- What happens for a minimized, hidden, occluded, full-screen, or multi-window
  WezTerm GUI? Does the selected pane become visibly reachable, and does it
  restore the window or only change mux state?
- Does the pinned binary accept the repository’s `--no-auto-start` placement,
  and does it prevent starting a GUI/mux endpoint? Verify with `cli --help`, an
  absent endpoint, and a no-autostart fixture; current docs do not answer this.
- Does successful activation return zero for the target pane, and what exit
  status/error is returned for a closed pane, wrong socket, denied socket, or
  stale endpoint? Capture only status/category, never terminal output.
- During the final generation-check/activation race, can a replacement endpoint
  receive activation, and does the guard reliably reject it? WezTerm documents
  no atomic compare-and-activate operation.
- Does an explicitly selected socket refer to a GUI-attached mux or a headless
  mux whose activation cannot raise any window? Test both only with sanitized
  fixture metadata.
- Preserve the existing Stage no-focus guarantee and verify that Reveal alone
  changes frontmost/focus state, exactly once, for the selected pane.

## Recommendation

Make Phase 12 one issue: **add a main-owned, lease-bound WezTerm Reveal
transaction with typed endpoint-level outcomes**. Keep Stage untouched and
no-focus; do not infer OS window raising from CLI success; do not retain a
renderer-supplied route; and do not add a generic Electron window-focus API.
Close the repository portion after the tests above pass. Keep the packaged
macOS/Windows foreground, pinned-flag, exit-status, minimized-window, and
endpoint-race rows as explicit native acceptance work.

## Sources

- [WezTerm `activate-pane`](https://wezterm.org/cli/cli/activate-pane.html)
- [WezTerm CLI instance/pane targeting](https://wezterm.org/cli/cli/index.html)
- [WezTerm `list`](https://wezterm.org/cli/cli/list.html)
- [WezTerm `pane:activate`](https://wezterm.org/config/lua/pane/activate.html)
- [WezTerm CLI global options](https://wezterm.org/cli/general.html)
- [WezTerm config-file resolution](https://wezterm.org/config/files.html)
- [Pinned WezTerm release](https://github.com/wezterm/wezterm/releases/tag/20240203-110809-5046fc22)
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)
- [ScreenFling WezTerm adapter](../src/main/wezterm-adapter.ts)
- [ScreenFling workflow/bridge/registry](../src/shared/workflow.ts)


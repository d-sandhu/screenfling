# Phase 11 routing-recovery plan

Research date: 2026-08-21  
Scope: stale targets, unavailable/unsupported adapters, clipboard fallback, and
user-triggered Reveal. This is a repository contract proposal; it is not native
acceptance evidence.

## Finding

The smallest useful Phase 11 slice is one recovery contract at the result
boundary:

1. A selected route is single-use and must be revalidated immediately before
   the adapter side effect. If the operation ID, route, endpoint generation, or
   surface no longer matches, return `failed/target-stale`; do not rediscover,
   retry, or substitute the focused/recent surface.
2. If discovery or preflight cannot establish a supported adapter (missing
   binary/instance, malformed output, or unsupported version), expose no Stage
   target. Copy remains available and is the normal fallback.
3. Stage writes and verifies the image clipboard before dispatch. Every failed,
   stale, unsupported, or uncertain result leaves that capture available for
   manual paste; it does not claim attachment or submission.
4. A future explicit **Reveal** action must be user-triggered and
   adapter-specific: it may activate/show the selected live target only after a
   fresh exact-target check, and must report stale/unavailable rather than
   guessing. Reveal is not automatic focus theft, Enter, Send, or retry of the
   Stage side effect.

The issue-sized Phase 11 slice preserves the existing adapter/registry interface,
adds an `unsupported` failure category, applies one shared Stage-capability
decision in main and renderer code, and makes clipboard fallback explicit. It
does not add a shallow Reveal interface before its result lifetime and exact
revalidation contract are designed. The current bridge/workflow has no Reveal
channel or result action. See
[delivery copy](../src/renderer/src/delivery-copy.ts),
[workflow contract](../src/shared/workflow.ts),
[destination registry](../src/main/destination-registry.ts), and
[stage boundary](../src/main/stage-destination.ts).

## Repository behavior versus native acceptance

### Already established in code/tests

- `DestinationRegistry` consumes discovery before Stage, binds it to one
  operation ID, and fails closed for a missing destination or adapter.
- `stageDestination` requires an exact address, `stage` capability, live-target
  verification, and compatible note input. Adapter `stale` maps to
  `target-stale`; malformed/unknown results map to `dispatch-failed`.
- The WezTerm adapter binds the route to adapter, local endpoint generation,
  and pane ID; it rechecks generation and pane existence before sending. Its
  `--no-auto-start` invocation and final generation guard prevent dispatch to a
  replaced instance. A successful `send-text` is intentionally
  `dispatched-unverified`; there is no read-back of composer or attachment
  state.
- `CaptureController.stageCapture` copies first, stages once, releases the
  in-memory capture, and preserves the clipboard on Stage failure. Existing
  tests cover stale operation IDs, duplicate Stage, disappearing panes,
  generation changes, literal input, no Enter, and no automatic retry.
- Configured adapters are currently macOS-only and require all experimental
  WezTerm selectors. Unsupported/missing configuration therefore yields an
  empty destination list; Copy remains usable.

These behaviors follow the accepted product and architecture promises:
[PRODUCT.md](../docs/PRODUCT.md), [ARCHITECTURE.md](../docs/ARCHITECTURE.md),
and [CONTEXT.md](../CONTEXT.md). They should remain the contract even if a
future adapter has different native capabilities.

### Native facts and limits

Electron documents `BrowserWindow.show()` as showing and focusing a window,
and separately documents `focus()`, `hide()`, `restore()`, `isMinimized()`, and
visibility/focus events. Therefore a Reveal implementation can be an explicit
main-process operation, but repository mocks cannot establish desktop focus or
frontmost-app behavior. See the [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window).

WezTerm documents `wezterm cli list --format json` as enumerating window/tab/
pane IDs and `wezterm cli send-text --pane-id` as targeted input. Its CLI also
documents `activate-pane --pane-id` as activation/focus. The separation matters:
the current Stage path can remain no-focus, while Reveal may deliberately
activate only after a user click and exact revalidation. These facts do not
prove that an agent composer accepted the image. See the first-party
[list](https://wezterm.org/cli/cli/list.html),
[send-text](https://wezterm.org/cli/cli/send-text.html),
[activate-pane](https://wezterm.org/cli/cli/activate-pane.html), and
[CLI targeting](https://wezterm.org/cli/cli/index.html) docs.

## Minimal test contract

Repository tests should cover:

- stale operation ID, consumed/duplicate Stage, missing destination, removed
  pane, changed endpoint generation, and replaced selector: all fail closed,
  spawn no Stage retry, and preserve the clipboard;
- unavailable binary/instance and unsupported WezTerm version: discovery is
  empty, Stage is unavailable/failed with Copy still offered, and no send
  process starts;
- uncertain dispatch and malformed adapter result: result is not upgraded to
  verified and no automatic retry occurs;
- unsupported capabilities: Stage is not offered by the renderer, a forged or
  stale request invokes no adapter transaction, and verified clipboard fallback
  remains available;
- existing exact-route regression suite: alternating targets, literal note
  bytes, no Enter, no focus/activation call during Stage, duplicate request,
  timeout, and generation guard.

No GUI/native test, app launch, or production code change is part of this
report.

## Open native rows

Keep these explicit and unresolved until a packaged app and real desktop state
are available:

- Reveal on macOS: selected WezTerm pane is the one activated; a closed or
  replaced pane is rejected; no other app/window is activated by Stage; the
  user sees the intended pane after Reveal.
- Reveal on Windows: equivalent foreground/window behavior and packaged
  identity, including minimized/hidden WezTerm cases.
- Real pinned WezTerm + agent/keybinding trials: image attachment is observed,
  no submission occurs, and `dispatched-unverified` remains honest when the
  composer cannot be read back.
- Endpoint/socket replacement during discovery, Stage, and Reveal; binary,
  config, and socket permissions/ownership on supported hosts.
- Clipboard sentinel preservation across real packaged failures and uncertain
  dispatches; no pixels, notes, terminal contents, or credentials in evidence.

The current Phase 9 audit already identifies native focus, replacement, and
real-agent attachment as blockers; Phase 11 should not relabel them as passed.
See [phase-9-next-slice-audit](phase-9-next-slice-audit.md) and the roadmap’s
Milestone 1 acceptance rows in [ROADMAP.md](../ROADMAP.md).

## Recommendation

Implement Phase 11 as **typed routing recovery with Copy as the universal
fallback**. Keep all target identity and revalidation in the main process and
keep Stage no-focus and no-retry. Design exact user-triggered Reveal as the next
adapter-specific slice; do not implement it with generic window focus. Record
packaged macOS/Windows and real-agent rows separately as native evidence.

# Phase 11 routing-recovery results

Validation date: 2026-08-21

Status: repository recovery contract implemented; exact Reveal and native
acceptance remain open.

## Outcome

ScreenFling now distinguishes an unsupported Stage request from a runtime
dispatch failure. One shared `supportsStage(destination, includesNote)` policy
requires an exact route, an advertised Stage action, live-target evidence, and
text input when a note is present. The main-process Stage seam enforces that
policy before invoking an adapter, and the renderer uses the same policy before
enabling its Stage action.

A Copy-only destination is labeled `Copy only`; it cannot enable Stage. Empty or
unsupported discovery says that no supported exact destination is available and
keeps the explicit Copy-only path visible. A forged request that reaches the
main process still writes and verifies the clipboard once, invokes the adapter
zero times, releases the in-memory capture, and returns
`failed/unsupported`.

Unsupported, stale, failed, and uncertain post-copy results state that the image
remains on the clipboard for manual paste. Clipboard verification failure does
not make that claim. No result claims attachment, delivery, or submission beyond
the evidence in the existing result vocabulary.

## Context7 and interface decision

Context7 was queried for current Electron window behavior and WezTerm exact-pane
activation. Electron separates `BrowserWindow.show()` (show and focus) from
`showInactive()`. WezTerm documents `activate-pane --pane-id` separately from
targeted `send-text --pane-id`. These APIs make an explicit adapter-specific
Reveal plausible, but documentation does not replace native foreground/window
acceptance.

Phase 11 therefore did not add a generic focus action or expand the preload
bridge. Reveal needs its own result-lifetime, exact-target revalidation, typed
outcome, and native focus evidence. Keeping it separate avoids a shallow
interface and preserves the no-focus Stage contract.

Sources: [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window),
[WezTerm activate-pane](https://wezterm.org/cli/cli/activate-pane.html),
[WezTerm send-text](https://wezterm.org/cli/cli/send-text.html), and the
[Phase 11 plan](phase-11-routing-recovery-plan.md).

## Automated evidence

- Destination-contract tests cover Stage capability with and without a note and
  reject Copy-only Stage.
- Stage orchestration maps an unsupported request distinctly and starts zero
  adapter transactions.
- Controller coverage proves verified clipboard output occurs once before the
  unsupported result, the adapter is not invoked, and capture state is released.
- Headless renderer tests prove empty discovery and Copy-only labels.
- Pure delivery-copy tests cover stale, unsupported, failed, uncertain, and
  clipboard-verification outcomes.
- Existing exact-route, no-Enter, no-focus, stale-generation, replacement,
  no-retry, strict TypeScript, and anti-slop checks remain part of the full gate.

The Phase 11 branch passed `npm run check:all` with 192 Vitest tests, ten
headless acceptance-runner tests, type-aware Oxlint with all 15 generic
anti-slop rules at error severity, strict TypeScript, the production build, and
an ad-hoc signed macOS arm64 directory package.

No application window, capture overlay, native capture, or foreground action is
launched by this evidence.

## Remaining acceptance

- Design and implement an explicit adapter-specific Reveal transaction with a
  fresh exact-target check and no Stage retry.
- Observe Reveal against the selected pane on packaged macOS and Windows builds,
  including closed, replaced, minimized, and hidden targets.
- Run the pinned real-WezTerm/agent attachment matrix and visible no-focus Stage
  trials.
- Complete the native Screen Recording, display/lifecycle, full-workflow soak,
  signing, and packaged dogfooding rows in the roadmap.

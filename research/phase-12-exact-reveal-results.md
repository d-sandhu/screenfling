# Phase 12 exact-destination Reveal results

Validation date: 2026-08-21

Status: repository exact-Reveal contract implemented; native foreground and
visibility acceptance remain open.

## Outcome

ScreenFling now offers one user-triggered Reveal action after a successful,
destination-bearing Stage result when the selected exact destination advertised
Reveal. Reveal is separate from delivery: it returns its own `revealed`,
`stale`, `unavailable`, `unsupported`, or `failed` outcome and never rewrites or
republishes the original Stage result.

The renderer sends only the current operation ID. The main controller derives
the destination receipt from the current result, and the destination registry
resolves the full route from a short-lived main-owned lease. The first Reveal
attempt consumes that lease. Result dismissal and new discovery invalidate it,
and dismissal is rejected while the exact operation's Reveal transaction is in
flight.

The WezTerm adapter reuses the trusted executable, config, socket, endpoint
generation, and exact-pane checks from Stage. It refreshes the pane list,
requires one matching pane, rechecks selector generation immediately before the
side effect, and invokes one explicit
`activate-pane --pane-id <selected-pane>` process. The request has null stdin,
removes inherited `WEZTERM_PANE`, never calls `send-text`, never sends image or
note bytes, never presses Enter, and never falls back to an active pane or a
generic Electron window-focus operation.

## Evidence boundary

Context7 and first-party WezTerm documentation establish that an explicit
`activate-pane --pane-id` selects the named pane and containing tab. They do not
establish operating-system foreground, visibility, restore-from-minimized
behavior, or semantic exit-code guarantees. Electron's window-focus APIs apply
to ScreenFling's own windows, not a foreign WezTerm window.

The UI therefore reports a successful process as **Reveal requested** and says
that OS foreground and visibility are unverified. A failed Reveal keeps the
Stage result unchanged and does not claim attachment, submission, or focus.

Sources: [WezTerm activate-pane](https://wezterm.org/cli/cli/activate-pane.html),
[WezTerm CLI targeting](https://wezterm.org/cli/cli/index.html),
[WezTerm pane:activate](https://wezterm.org/config/lua/pane/activate.html),
[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window),
and the [Phase 12 plan](phase-12-exact-reveal-plan.md).

## Automated evidence

- Destination-contract tests require exact addressing, advertised Reveal, and
  live-target evidence.
- Strict Reveal-result tests cover all five bounded outcomes and reject expanded
  evidence claims.
- Registry tests cover the retained route, wrong operation, unsupported
  capability or adapter, consumed lease, dismissal/clear, and new-discovery
  invalidation.
- Controller tests prove Reveal performs no clipboard write, no Stage retry, no
  workflow publication, and no Stage-result mutation. They also fence the
  Reveal/dismiss race.
- WezTerm tests prove the exact command, selected pane ID, explicit selector
  environment, null stdin, no `send-text`, final generation guard, stale-pane
  refusal, failure mapping, and no retry.
- Renderer tests prove Reveal availability requires the exact retained result
  receipt and advertised capability. Result copy avoids foreground, attachment,
  and submission claims.
- Existing 100-alternating-pane Stage coverage, stale-generation refusal,
  literal input, no Enter, and no-retry behavior remain green.

The Phase 12 branch passed `npm run check:all` with 218 Vitest tests across 26
files, ten headless acceptance-runner helper tests, type-aware Oxlint with all 15
generic anti-slop rules at error severity, strict TypeScript, the production
build, and an ad-hoc signed macOS arm64 directory package.

That gate did not launch ScreenFling, native capture, or a capture overlay. A
separate GUI runner attempt required the operator to press Escape and is
discarded evidence; no claim in this report depends on it.

## Remaining native acceptance

- On packaged macOS and Windows, observe whether exact-pane activation makes the
  containing WezTerm window visible and frontmost when another application is
  active.
- Cover minimized, hidden, occluded, full-screen, multi-window, GUI-attached mux,
  and headless-mux cases without inferring behavior from CLI success.
- Verify the pinned binary's `--no-auto-start` support and behavior, plus
  sanitized exit categories for closed panes, wrong sockets, denied sockets,
  timeout, and endpoint replacement.
- Preserve and observe the existing Stage no-focus guarantee while proving that
  only explicit Reveal requests activation.
- Complete the native Screen Recording, display/lifecycle, real-agent Stage,
  full-workflow soak, signing, and packaged dogfooding rows in the roadmap.

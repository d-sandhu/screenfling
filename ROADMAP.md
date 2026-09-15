# Roadmap

The goal is a screenshot handoff worth using every day, not a larger feature list.
The [README](README.md) describes what is implemented. This file records next
priorities; it is not a release announcement.

## Immediate implementation sequence

1. **Finish one real-agent handoff.** Complete the isolated Codex attachment
   work in [PR #52](https://github.com/d-sandhu/screenfling/pull/52), then verify the
   installed WezTerm/agent combination. A byte receiver is not an image attachment.
2. **Validate daily macOS use.** Complete the permission, physical capture,
   display, shortcut, recovery, performance, and routing checks in the
   [operator checklist](docs/acceptance/macos-operator-acceptance.md).
   [Issue #32](https://github.com/d-sandhu/screenfling/issues/32) tracks results.
   Retain failures and unavailable cases; do not weaken checks to declare success.
3. **Prove the benefit.** Compare at least five complete handoffs with five manual
   screenshot/paste workflows. Use the app across several working days and fix
   the friction found. Record a short real capture-to-destination demo with
   synthetic content once that path works; a UI preview is not that demo.
4. **Prepare public macOS distribution.** Use the existing
   [signing and notarization process](docs/releasing.md), verify the final
   artifact, and publish only after the applicable checks pass.

## After the macOS workflow is useful

Windows is the next platform: validate native capture, scaling, clipboard,
shortcuts, and an exact destination before claiming parity. Add another terminal
only for a demonstrated workflow the existing integration cannot serve.

There are no dates or support promises for Linux, remote/SSH/WSL transfer,
browser extensions, multiple captures, or additional agents.

## Not planned for this core

No ScreenFling accounts, cloud image hosting, screenshot database, plugin
marketplace, built-in model calls, or generic automatic submission. Keep one app
and the existing stack unless measured constraints justify a change.

Historical plans and measurements remain in
[the pre-cleanup research snapshot](https://github.com/d-sandhu/screenfling/tree/b7e321217faf94ee2016217405f3c39e1e872cb6/research).
They describe their recorded commits, not the current release status.

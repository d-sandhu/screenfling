---
status: accepted
---

# Use WezTerm for the first surface Stage adapter

ScreenFling will implement its first exact surface Stage adapter against
WezTerm's CLI, using an instance-generation boundary plus pane ID and the latest
official stable release (`20240203-110809-5046fc22`) as the reproducible baseline.
WezTerm is the only evaluated surface with exact targeted input and screen-text
read-back on both native Tier 1 platforms, and its two-pane routing primitive
passed 100 alternating dispatches on macOS and Windows with zero wrong-target or
Enter events. The adapter is an optional integration rather than a ScreenFling
runtime dependency; Copy remains the safe fallback.

## Implementation status

The production-tree primitive now implements pinned-version preflight, bounded
JSON discovery, explicit absolute executable/config/socket selection,
stable-within-generation pane routes, one combined stdin dispatch, and
conservative no-retry outcomes. This satisfies the implementation decision, not the release gate:
visible no-focus and real-agent attachment trials remain open, and the adapter is
not yet wired into the application picker.

## Consequences

- Every dispatch pins the WezTerm instance and pane, revalidates immediately,
  and refuses stale identity without active-pane fallback or retry.
- The old stable release and active nightly channel require explicit version
  preflight, a pinned stable compatibility fixture, and a non-gating nightly
  canary.
- CLI transport and screen text alone do not prove an agent attached an image.
  The adapter cannot claim support or verified Stage until its configured agent
  and keybinding pass the roadmap's observed trials.
- tmux remains the Unix exactness reference. Ghostty remains an optional macOS
  adapter, not a fallback selected because it is installed locally.
- Codex app-server and Claude Agent SDK remain separate managed Send candidates;
  they do not solve passive Stage into an existing terminal composer.

# PROTOTYPE — WezTerm exact-routing Gate B

This throwaway harness asks whether a ScreenFling surface adapter can address two identical-looking
terminal panes exactly, stage literal paste/note bytes without Enter, and refuse a closed target
instead of falling back to the active pane.

Run it from the repository root:

```sh
npm run prototype:routing
```

The command downloads the pinned official WezTerm stable ZIP for native macOS or Windows, verifies
its SHA-256 digest, starts an owned headless mux server, and prints redacted JSONL state after each
of 100 alternating dispatches. It does not read or write the clipboard, activate a pane, or use OS
focus.

This is transport evidence, not a production adapter. A passing headless run does not prove visible
focus behavior, agent-specific image insertion, or the other Tier 1 platform. The validated decision
belongs in the Phase 3 research and architecture documents; this code remains on its prototype
branch.

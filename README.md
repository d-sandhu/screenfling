# ScreenFling

**Capture what you see. Send it to the right coding agent. Keep working.**

ScreenFling is an open-source, cross-platform desktop tool for capturing visual context and routing it to the right AI coding agent or chat session.

## Status

Pre-alpha. The repository is being initialized before implementation starts.

## Product direction

ScreenFling is intended to make this workflow fast and predictable:

1. Capture a screen region, window, or display.
2. Optionally add a short note.
3. Choose the exact destination.
4. Stage the image and note in that destination.

The initial focus is local Claude Code and Codex CLI workflows. Browser, desktop-app, remote-session, and richer browser-context adapters can follow after the core handoff is proven useful.

## Principles

- **Clipboard-first.** Use native image paste when the destination supports it.
- **Local-first.** No cloud backend is required for the core workflow.
- **Cross-platform.** macOS, Windows, and Linux are first-class targets, with capability differences handled honestly.
- **Stage by default.** Automatic submission should only be available when a destination can be targeted and verified reliably.
- **Keep the core simple.** Add native code only where the operating system requires it.

## Planned stack

- TypeScript
- Electron
- React
- Node.js
- A small Rust native helper only for OS automation that Electron cannot provide reliably

## First milestone

Prove the shortest useful workflow:

`global shortcut -> region capture -> image clipboard -> choose local agent target -> stage`

No automatic submit and no cloud services in the first implementation slice.

## License

MIT

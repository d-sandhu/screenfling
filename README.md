# ScreenFling

**Capture visual context. Route it to the right coding session. Keep working.**

ScreenFling is a local-first desktop tool for moving screenshots and short notes
into an explicitly chosen AI coding session. It is not intended to replace the
operating system's screenshot utility. Its value is the handoff after capture:
choosing the right destination, using that destination's supported input method,
and never submitting work unexpectedly.

## Status

ScreenFling is **pre-alpha**. The product direction and technical feasibility
have been researched, and the application scaffold plus automated quality gates
are in place. Capture and destination routing are not implemented yet.

The first reference implementation will be built on macOS, followed by Windows.
Both are Tier 1 product targets. Linux is optional and may be explored later
without a promise of feature parity.

## Intended workflow

```text
global shortcut
-> select one screen region
-> optionally add a short note
-> choose an exact destination
-> copy or stage
-> review in the destination
```

ScreenFling distinguishes three actions:

- **Copy** puts the capture on the image clipboard.
- **Stage** places the capture and note in a selected destination without
  submitting.
- **Send** submits only through a versioned adapter that can verify the target
  and submission behavior. It is not part of the first release.

If routing fails or cannot be verified, the capture remains available on the
clipboard.

## First release boundary

The first useful alpha will provide:

- fast, one-display region capture;
- image clipboard output;
- an optional single-line note;
- explicit selection of one addressable local coding-agent destination;
- Stage without Enter, submission, or focus theft;
- honest delivery status and a manual clipboard fallback;
- local processing with no ScreenFling account or hosted backend.

The first release will not include Linux support, remote transfer, browser
extensions, screenshot history, cloud storage, a plugin marketplace, or generic
automation of arbitrary applications.

## Technical direction

- Electron
- strict TypeScript
- React for visible application surfaces
- Node.js in the Electron main process
- electron-vite for the build pipeline
- electron-builder for packaging
- native helpers only after a measured Electron or operating-system API failure

Electron provides the capture, display, clipboard, shortcut, and window
primitives required by the core workflow. The architecture keeps capture and
destination adapters behind narrow contracts so an implementation can be
replaced without rewriting the application.

## Project documents

- [Product direction](docs/PRODUCT.md) — users, problem, scope, and principles
- [Architecture](docs/ARCHITECTURE.md) — system boundaries and technical decisions
- [Roadmap](ROADMAP.md) — ordered milestones and acceptance gates
- [Contributing](CONTRIBUTING.md) — how to participate while the project is pre-alpha
- [Security policy](SECURITY.md) — reporting and security invariants
- [Research index](research/README.md) — supporting evidence and feasibility reports

Canonical decisions live in the product, architecture, and roadmap documents.
Research reports explain the evidence behind those decisions but do not override
them.

## License

[MIT](LICENSE)

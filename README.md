# ScreenFling

**Capture visual context. Route it to the right coding session. Keep working.**

ScreenFling is a local-first desktop tool for moving screenshots and short notes
into an explicitly chosen AI coding session. It is not intended to replace the
operating system's screenshot utility. Its value is the handoff after capture:
choosing the right destination, using that destination's supported input method,
and never submitting work unexpectedly.

## Status

ScreenFling is **pre-alpha**, not a supported macOS alpha yet. The joined
capture → selection → review → explicit destination → Copy/Stage → optional
Reveal flow is implemented. Copy verifies the image clipboard; Stage is a
single exact-pane attempt without Enter or automatic focus. Uncertain results
ask the user to inspect the selected destination before pasting again.

The application has a single-instance lifecycle, configurable shortcuts,
Screen Recording readiness and recovery guidance, bounded capture startup,
one presentation-only renderer recovery, and content-free in-memory diagnostics.
Images and notes are not persisted or sent to a ScreenFling service.

WezTerm remains an opt-in macOS developer experiment. Its native selector checks
reject unsafe ownership, modes, extended ACL grants, and unreadable ACLs. No
agent compatibility or verified attachment is claimed. Stage and Reveal use a
one-command pinned local connection, with native CLI pathname-replacement
coverage recorded in [ADR 0003](docs/adr/0003-pinned-wezterm-transport.md). Hardware,
permissions, installed-tuple routing, visible focus, real-agent trials, and
comparative dogfood acceptance still gate the release.

The [roadmap](ROADMAP.md#immediate-implementation-sequence) is the current release
checklist. The [macOS operator protocol](docs/acceptance/macos-operator-acceptance.md)
defines physical evidence. [Contributing](CONTRIBUTING.md) gives build, fixture,
and packaged smoke commands. Historical research supports these documents; it
does not override their current status. macOS is first; Windows remains the next
Tier 1 target. Linux is outside this alpha.

## Intended workflow

```text
global shortcut
-> select one screen region
-> optionally add a short note
-> choose an exact destination
-> copy or stage
-> optionally reveal the staged destination
-> review in the destination
```

ScreenFling distinguishes these actions:

- **Copy** puts the capture on the image clipboard.
- **Stage** places the capture and note in a selected destination without
  submitting.
- **Reveal** asks a capable adapter to activate the exact destination from the
  completed Stage without changing its delivery result.
- **Send** submits only through a versioned adapter that can verify the target
  and submission behavior. It is not part of the first release.

After a verified Copy, routing failure or uncertainty keeps the image available
for manual paste. Inspect the destination first to avoid a duplicate attachment.
A clipboard-write verification failure cannot make that same fallback claim.

## First release boundary

The first useful alpha will provide:

- fast, one-display region capture;
- image clipboard output;
- an optional single-line note;
- explicit selection of one addressable local coding-agent destination;
- Stage without Enter, submission, or focus theft;
- one explicit, exact-target Reveal after Stage, with no foreground claim;
- honest delivery status and a manual clipboard fallback;
- local, content-free workflow timing and result diagnostics;
- local processing with no ScreenFling account or hosted backend.

The first release will not include Linux support, remote transfer, browser
extensions, screenshot history, cloud storage, a plugin marketplace, or generic
automation of arbitrary applications.

## Technical direction

- Electron
- strict TypeScript
- React for visible application surfaces
- Node.js in the Electron main process
- Zod at untrusted IPC and adapter-data boundaries
- electron-vite for the build pipeline
- electron-builder for packaging
- native helpers only after a measured Electron or operating-system API failure

Electron provides the capture, display, clipboard, shortcut, and window
primitives required by the core workflow. The architecture keeps capture and
destination adapters behind narrow contracts so an implementation can be
replaced without rewriting the application.

The first exact surface-adapter implementation targets WezTerm because its
instance-and-pane routing primitive passed on native macOS and Windows. WezTerm
is an optional integration, not the identity or runtime foundation of
ScreenFling. Copy remains available without it; real-agent support is not claimed
until the roadmap's observed trials pass.

## Experimental WezTerm developer configuration

The joined picker can load the compiled WezTerm adapter on macOS only when all
four environment variables below are present. This path exists for controlled
acceptance work; it is not yet a supported user setup.

| Variable | Value |
| --- | --- |
| `SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE` | Absolute path to the pinned WezTerm executable |
| `SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE` | Absolute path to the exact configuration under test |
| `SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET` | Absolute path to the selected mux socket |
| `SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX` | One to 64 raw input bytes as hexadecimal, with no CR or LF |

The input bytes must match a tested agent binding that stages an image without
submission. A partial, malformed, unsafe, unsupported-version, or non-macOS
configuration exposes no destination and leaves Copy available. Do not treat
this environment-variable path as a secret store. On macOS, the executable must
be a current-user- or root-owned executable file, the config must be a readable
current-user-owned file, and the socket must be a current-user-owned Unix socket
inside a private directory. Group/other-writable selector leaves or lexical and
canonical ancestors are rejected. Selector identity is checked before version,
discovery, and send subprocesses. The bundled read-only ACL gate permits no extended grants and fails closed on
inspection errors. Actual selector/config semantics, visible focus behavior, and
real-agent attachment still require native acceptance; repository tests are not
support claims.

## macOS test candidate

A successful macOS Check job retains a `screenfling-macos-ARM64-...` artifact for
seven days. It contains `ScreenFling-macos-arm64.zip`, `SHA256SUMS`, and
`candidate.json`. Use the latest successful **main push** run after merging,
not an older PR run. The manifest distinguishes the source commit from the
commit actually tested, and records the architecture, ad-hoc signature, and
archive hash. Packaging verifies identity and signatures again after extraction.

This is a controlled pre-alpha candidate, not a notarized public release or an
agent compatibility promise. Verify its checksum before extracting the app:

```bash
shasum -a 256 -c SHA256SUMS
```

Use the [operator protocol](docs/acceptance/macos-operator-acceptance.md) with
synthetic content. Do not disable Gatekeeper or change permissions just to turn
a failed acceptance row into a pass. Local build commands remain in
[Contributing](CONTRIBUTING.md).

## Project documents

- [Product direction](docs/PRODUCT.md) — users, problem, scope, and principles
- [Architecture](docs/ARCHITECTURE.md) — system boundaries and technical decisions
- [Domain context](CONTEXT.md) — canonical product and routing vocabulary
- [Roadmap](ROADMAP.md) — ordered milestones and acceptance gates
- [macOS operator acceptance](docs/acceptance/macos-operator-acceptance.md) — safe native Gate A and Gate B procedure
- [Contributing](CONTRIBUTING.md) — how to participate while the project is pre-alpha
- [Security policy](SECURITY.md) — reporting and security invariants
- [Research index](research/README.md) — supporting evidence and feasibility reports

Canonical decisions live in the product, architecture, and roadmap documents.
Research reports explain the evidence behind those decisions but do not override
them.

## License

[MIT](LICENSE)

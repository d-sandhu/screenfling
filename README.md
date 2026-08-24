# ScreenFling

**Capture visual context. Route it to the right coding session. Keep working.**

ScreenFling is a local-first desktop tool for moving screenshots and short notes
into an explicitly chosen AI coding session. It is not intended to replace the
operating system's screenshot utility. Its value is the handoff after capture:
choosing the right destination, using that destination's supported input method,
and never submitting work unexpectedly.

## Status

ScreenFling is **pre-alpha**. The application scaffold, automated quality gates,
main-owned workflow state machine, runtime-validated destination contract,
narrow preload bridge, measured capture geometry, fail-closed Stage orchestration,
and the first joined capture-to-Stage workflow are in place. The application
hides its main window, captures the exact display under the pointer, presents a
frozen region overlay, reviews the crop, and writes and verifies the image
clipboard only after an explicit Copy or Stage action. Stage requires an explicit
destination choice, accepts an optional one-line note, never sends Enter, and
reports unverified dispatch honestly. The global shortcut plus display, suspend,
and resume invalidation are wired through the main-owned controller. The capture
shortcut can be changed through a bounded cross-platform picker. The main process
validates, registers, and atomically persists the choice; an unavailable choice
or failed save retains the previous working shortcut. A packaged acceptance
runner can repeat the production selection-completion, verified Copy,
cancellation, window-cleanup, and working-set checks without logging captured
pixels or clipboard content.

The main process also maintains a bounded, in-memory diagnostics snapshot for
button and shortcut starts, fixed delivery and Reveal result categories, and
phase timing summaries. The snapshot is available to the local acceptance
runner through a strict read-only bridge. It contains no operation or destination
identities and no pixels, notes, clipboard content, paths, titles, terminal
text, credentials, or raw adapter output. It is neither persisted nor sent as
telemetry.

On macOS, documented Screen Recording denial or restriction stops before source
enumeration and produces recoverable guidance for the exact Privacy & Security
pane plus the required application restart. An unknown or not-yet-determined
status still attempts real capture instead of pretending permission is granted
or denied. The main window also shows the current Electron-reported status and
can check it again without starting capture. That readout is guidance, not proof
that pixels can be captured. Native grant, denial, revocation, and restart
evidence remains a packaged human-operated acceptance row.

The WezTerm integration remains an opt-in macOS developer experiment. Discovery
and one-shot exact-pane staging fail closed on unsupported versions, malformed
data, ambiguous identities, unsafe selector ownership or mode, and stale
generations. Missing hardware/lifecycle coverage, macOS ACL and configuration-
semantics acceptance, visible no-focus trials, and real-agent attachment trials
still block any alpha or compatibility claim.

Destination capabilities now control the visible action: a Copy-only target is
labeled as such and cannot enable Stage. An empty or unsupported discovery keeps
Copy only available. If an already-selected Stage request becomes unsupported,
stale, failed, or uncertain after verified clipboard output, the result states
that the image remains available for manual paste without retrying or guessing a
different target.

After a destination-bearing Stage result, a Reveal-capable target offers one
explicit **Reveal destination** action. The renderer sends only the current
operation ID; the main process resolves and consumes the retained exact route,
revalidates its endpoint generation and pane, and requests activation without
image, note, clipboard, Enter, active-pane fallback, or a Stage retry. A
successful CLI response is reported as an activation request, not proof that
the operating system made the WezTerm window visible or frontmost. Native macOS
and Windows foreground behavior remains an acceptance row.

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
-> optionally reveal the staged destination
-> review in the destination
```

ScreenFling distinguishes three actions:

- **Copy** puts the capture on the image clipboard.
- **Stage** places the capture and note in a selected destination without
  submitting.
- **Reveal** asks a capable adapter to activate the exact destination from the
  completed Stage without changing its delivery result.
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
discovery, and send subprocesses. macOS ACL inspection, config semantic
validation, visible focus behavior, and real-agent attachment remain acceptance
work rather than support claims.

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

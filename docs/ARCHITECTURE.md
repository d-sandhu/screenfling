# Architecture

Status: Accepted pre-alpha direction

Last reviewed: 2026-08-19

## Decision

ScreenFling will begin as one Electron application using strict TypeScript,
React, Node.js, electron-vite, and electron-builder. macOS and Windows are Tier
1 product targets delivered in sequence. Linux is optional. Native code is
introduced only when a measured requirement cannot be met through Electron or a
documented operating-system API.

Zod schemas validate data as it crosses untrusted IPC and adapter boundaries.
TypeScript types describe trusted code; they are not treated as runtime input
validation.

This decision is supported by the
[tech-stack validation](../research/tech-stack-validation.md) and
[capture feasibility](../research/capture-platform-feasibility.md) research.

## Why this stack

Electron already exposes the shared primitives ScreenFling needs most:

- display and window capture;
- display geometry and scale information;
- image cropping and clipboard output;
- global shortcuts;
- transparent or frameless application windows;
- mature packaging, signing, and update paths.

Tauri remains a credible fallback if packaged size or idle memory blocks
adoption. It is not the starting choice because screen capture would require
platform-specific or third-party native work at the center of the first release.
Fully native macOS and Windows applications would maximize platform control but
duplicate the product and contributor surface too early.

## Repository shape

Begin with one application package. Use modules for responsibility boundaries;
do not create a monorepo or multiple packages until real independent release or
dependency boundaries exist.

A likely source layout is:

```text
src/
  main/
    capture/
    clipboard/
    destinations/
    permissions/
    diagnostics/
  preload/
  renderer/
    capture-overlay/
    destination-picker/
    settings/
  shared/
    contracts/
    state/
```

This is directional, not a requirement to create empty folders before code
needs them.

## Process and trust boundaries

### Electron main process

The main process owns all privileged work:

- capture-source enumeration and image creation;
- display-coordinate mapping;
- clipboard writes;
- global-shortcut registration;
- destination discovery and revalidation;
- subprocess invocation;
- permission state;
- workflow state and local diagnostic events.

### Preload bridge

The preload exposes a small, typed API for user actions and state updates. It
does not expose raw Electron, Node.js, filesystem, shell, clipboard, or process
APIs.

Every request includes an operation ID. The main process validates the sender,
payload, operation, and allowed state transition.

The preload exposes one function per allowed message and never exposes raw
`ipcRenderer`. Each main-process handler accepts only the current main window's
exact `WebContents`, its main frame, and the configured renderer document URL.
Payload schemas are strict, so extra keys fail validation instead of being
silently accepted.

### Renderers

Renderers are presentation surfaces only. They load bundled local content and
run with:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- `sandbox: true`;
- a restrictive Content Security Policy;
- navigation and unrequested window creation denied.

Packaged renderer assets are served from a standard, secure `screenfling://`
scheme whose handler is restricted to the bundled renderer directory. Path
traversal is rejected, and Electron's legacy elevated `file://` privileges are
disabled at package time.

The region overlay receives only the frozen image and display-local data needed
to draw a selection. Destination automation never runs in a renderer.

## Core modules

```text
CaptureCoordinator
  owns the workflow state machine and cancellation

CaptureBackend
  captures displays and returns measured image geometry

DisplayMapper
  converts display-local DIP coordinates to returned-image pixels

ClipboardService
  writes and sanity-checks image clipboard content

DestinationRegistry
  discovers live endpoints and presents confidence-bearing labels

DestinationAdapter
  revalidates one endpoint and exposes supported actions/evidence

PermissionService
  reports and explains platform permissions

Diagnostics
  records local timings and result categories, never user content
```

## Capture pipeline

The capture sequence is intentionally snapshot-first:

```text
shortcut
-> identify display under pointer
-> capture that display at physical resolution
-> record actual returned image dimensions
-> show frozen snapshot in overlay
-> select in display-local coordinates
-> map selection using measured width/height ratios
-> crop in main process
-> encode PNG in memory
-> write image clipboard
```

The overlay is not transparent over the live desktop. It displays the frozen
snapshot captured before the overlay exists. This avoids capturing ScreenFling's
own UI and reduces dependence on platform-specific click-through behavior.

The first implementation allows selection within one display. Cross-display
selection is deferred because mixed scaling, rotation, and coordinate origins
make it a separate correctness problem.

## Workflow state

The main process owns an explicit state machine:

```text
idle
-> snapshotting
-> selecting
-> editing
-> target-selected
-> revalidating
-> writing-clipboard
-> staging-image
-> staging-note
-> result
-> idle

any active state
-> result(cancelled | failed)
-> idle
```

Permission denial is a bounded `failed` reason (`permission-blocked`), not a
separate state. This keeps every terminal outcome visible until the matching
operation explicitly dismisses it.

A second shortcut while an operation is active is rejected. Cancellation is a
separate operation-ID-scoped action. Stale renderer events, invalid coordinates,
dead targets, and invalid transitions never advance the operation.

Successful Copy can be reported only after the clipboard-write phase. Stage can
be reported only after image staging begins. Although `sent-verified` is part of
the durable result vocabulary, the current state machine cannot produce it; a
future verified Send implementation must add its own explicit phase and evidence
gate.

## Destination model

Routing identity and descriptive context are separate:

```ts
type Destination = {
  id: string;
  adapter: string;
  endpoint: {
    scope: "local" | "ssh" | "wsl" | "container";
    instanceId: string;
  };
  surface: {
    kind: "terminal" | "pane" | "agent-thread";
    locator: string;
  };
  context?: {
    cwd?: string;
    repoRoot?: string;
    worktree?: string;
    revision?: string;
    observedAt: string;
  };
  capabilities: {
    address: "exact" | "best-effort";
    imageInput: "clipboard-key" | "local-file" | "remote-file" | "structured" | "none";
    textInput: "paste" | "structured" | "none";
    readBack: "structured" | "screen-text" | "none";
    verification: Array<
      "target-live" | "composer-ready" | "image-attached" | "turn-completed"
    >;
    actions: Array<"copy" | "stage" | "send">;
  };
};
```

The endpoint and surface locator determine where input goes. Working directory,
repository, worktree, revision, process, and inferred agent type may help the
user choose, but they never replace an exact routing locator.

Destinations are rediscovered and revalidated immediately before dispatch. An
adapter must never fall back to the active window, active pane, or similarly
named target after its selected endpoint disappears.

## Adapter contract

An adapter has four jobs:

1. discover live destinations;
2. describe each destination and its evidence;
3. revalidate the selected routing identity;
4. perform only an action listed in its capabilities.

Adapters are compiled into ScreenFling initially. A public plugin ABI is deferred
until several adapters demonstrate which contracts are stable.

Terminal or application automation uses argument-array subprocess APIs, not
shell-concatenated commands. Notes are data, never code. The first note format is
at most 500 Unicode code points on one line; Unicode controls and line separators
are rejected. Destination identifiers reject those characters as well.
Subprocesses have timeouts, capped output, and explicit error mapping.

## Result semantics

Runtime status must describe evidence, not optimism:

| Result | Meaning |
| --- | --- |
| `copied` | The image was written to the local clipboard. |
| `dispatched-unverified` | A live exact endpoint accepted the adapter operation, but attachment or composer state could not be read back. |
| `staged-verified` | The adapter verified the intended composer and staged attachment or input. |
| `sent-verified` | A versioned adapter submitted to an exact target and verified the expected completion evidence. |
| `failed` | The operation did not reach its promised result; the clipboard fallback remains available when possible. |
| `cancelled` | The user cancelled without destination changes. |

The UI never describes `dispatched-unverified` as delivered or verified.
Automatic retries are disabled for uncertain operations because they can create
duplicate attachments.

## Platform services

Shared product behavior sits above platform-specific services:

```text
Product workflow and UI
  CaptureBackend
  ClipboardService
  GlobalShortcutService
  PermissionService
  DestinationAdapter(s)

Platform implementations
  macOS first
  Windows second
  Linux optional
```

macOS and Windows can differ internally while satisfying the same observable
contract. Platform parity is defined by the release acceptance criteria, not by
using identical APIs.

## Native-code gate

Do not add Rust, Swift, C++, or another native helper because it may be useful.
Open a narrow architecture decision only when evidence shows one of these:

- both practical Electron capture paths miss the agreed latency or pixel-quality
  target;
- a required operating-system capability has no reliable Electron or Node path;
- destination automation cannot meet its safety contract without a native API;
- packaged resource use materially blocks adoption;
- distribution requirements cannot be met through the existing toolchain.

Any native helper remains a separate, least-privileged process with a small,
versioned request/response protocol. Product logic stays in TypeScript.

## Data and privacy

Captures are in memory and on the clipboard by default. Permanent saving requires
an explicit user action. Temporary local or remote files are introduced only by
an adapter that needs them and must have owner-only permissions, bounded lifetime,
and visible cleanup behavior.

There is no hosted ScreenFling service in the core architecture. Diagnostic
events are local and exclude pixels, notes, clipboard data, file contents,
terminal contents, and credentials.

## Verification strategy

The project tests behavior at three levels:

- unit tests for state transitions, validation, coordinate mapping, and adapter
  contracts;
- integration harnesses for clipboard and destination dispatch;
- packaged-application acceptance runs on native macOS and Windows hosts.

Capture acceptance includes scaled displays, negative display origins, rotation,
sleep/wake, display reconnect, cancellation, permissions, and repeated-cycle leak
checks. Routing acceptance includes duplicate labels, stale targets, special note
characters, permission denial, remapped bindings, no focus theft, and zero
wrong-target tolerance.

Development-mode success does not qualify a release. Permissions, signing,
notarization, paths, and desktop identity must be tested in packaged builds.

## Type-safety and lint policy

The application scaffold will use strict TypeScript and Oxlint. It will vendor
the generic anti-slop plugin under `tools/oxlint/anti-slop/` and enable its full
generic rule set at error severity. This is intended to prevent assertion chains,
unknown-heavy owner contracts, unsafe dictionary shapes, runtime type guessing,
module mocking, and similar patterns that weaken architectural boundaries.

The plugin must be installed through the repository's chosen package manager in
the same change that creates the JavaScript package and lockfile. Pin compatible
current versions of `oxlint` and `@oxlint/plugins`; do not create a package or
select a package manager solely to install lint tooling before the application
scaffold exists.

Generated agent configuration and the vendored plugin source are excluded from
application linting. Owned source is not ignored or weakened to make checks pass.
Effect-specific rules remain disabled unless Effect becomes a direct dependency
or the project makes a separate explicit decision to adopt them.

## Distribution direction

electron-vite is the initial development and build tool, paired with
electron-builder for packaged applications. This uses the current stable,
mutually compatible releases rather than Forge 7's advisory-bearing build graph
or the pre-release Forge 8 line. The decision and reproduced audit evidence are
recorded in the [build-toolchain report](../research/forge-version-decision.md).
CI runs shared checks on every change and native packaging checks on macOS and
Windows.

Release artifacts must eventually be signed, with macOS notarization and Windows
code signing treated as product work rather than release-day cleanup.

## Deferred decisions

The following remain intentionally undecided until product evidence exists:

- the public adapter/plugin API;
- update-channel and auto-update policy;
- the first Windows destination adapter;
- browser integration architecture;
- remote file-transfer and cleanup protocol;
- history persistence format;
- any Linux support tier;
- any native helper language.

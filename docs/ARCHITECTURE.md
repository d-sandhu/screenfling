# Architecture

ScreenFling is one Electron application, not a web service. React presents the
workflow; the Node.js main process performs OS and terminal operations. Zod
validates data crossing those boundaries. One package and one build are enough
for the current product.

## Process boundaries

```text
React: capture selection / review / destination picker
                         |
             separate, narrow preload bridges
                         |
Electron main: workflow state, capture, clipboard, settings
                         |
        Electron OS APIs / bounded WezTerm CLI calls
                         |
          one explicitly configured local mux pane
```

| Location | Responsibility |
| --- | --- |
| [`src/main`](../src/main) | Capture, clipboard, shortcuts, permissions, settings, routing, and process lifetime. |
| [`src/preload`](../src/preload) | Expose named operations, not raw Electron, filesystem, or shell access. |
| [`src/renderer/src`](../src/renderer/src) | Selection UI, preview, note, destination choice, and recovery messages. |
| [`src/shared`](../src/shared) | Runtime schemas, workflow states, and coordinate calculations. |
| [`tools/acceptance`](../tools/acceptance) | Browser fixtures and separate packaged-app checks. |
| [`tools/native/selector-acl.c`](../tools/native/selector-acl.c) | Read-only macOS ACL inspection for terminal selectors. |

Main and capture renderers have different bridges and authorized senders.
Handlers validate the current WebContents, frame, document URL, payload, and
operation/state. A renderer cannot acquire another window's authority by naming
its IPC channel.

Packaged renderers load bundled assets through `screenfling://`, reject
navigation and unexpected windows, and run with sandboxing and context isolation,
without Node integration. Packaged builds ignore development-server overrides.
Both renderers use a cache-disabled, nonpersistent browser session.

## One capture, one owner

The [workflow rules](../src/shared/workflow.ts) and
[capture controller](../src/main/capture-controller.ts) keep side effects in main.
A main-generated operation ID belongs to one capture. Stale async completions
cannot advance a newer operation.

The normal path is snapshot, select, review, then explicit Copy or Stage. The
backend captures the pointer's display before showing the frozen-image overlay.
[Coordinate mapping](../src/shared/capture-geometry.ts) uses the actual image to
display ratio, not an assumed scale factor. Each capture stays on one display.

Before delivery, the UI must load the crop preview successfully. Copy writes the
image and verifies it by pixel read-back. Stage first uses that verified clipboard
image, then attempts terminal input. Cancel before this boundary leaves the
clipboard and destination unchanged. Once delivery starts, cancellation is not
offered. A failed write cannot promise that the old clipboard survived.

Startup deadlines, display changes, and sleep/wake stop pre-delivery work.
Renderer recovery rebuilds presentation from main-owned state; it never replays
Copy, Stage, or Reveal. A renderer-local note or selection may need to be entered
again. The single-instance lifecycle prevents a second launch from becoming a
second shortcut or capture owner.

## Exact routing, limited proof

A destination is an endpoint generation plus pane identity. Titles and working
directories are labels for a person, never addresses. Main retains the discovered
route; the renderer selects its ID rather than supplying a command or replacement
endpoint.

The [WezTerm adapter](../src/main/wezterm-adapter.ts) uses an explicit executable,
config, and Unix socket. It checks the pinned version, selector ownership,
permissions and ACLs, live generation, and selected pane. Failure does not fall
back to the current terminal.

The CLI receives one combined image-key-and-note payload on stdin, without a
shell. The image key must be a locally verified, non-submitting binding. Notes
are single-line input with unsafe controls rejected. The exact schemas and
limits live in [`domain.ts`](../src/shared/domain.ts) and
[`wezterm-setup.ts`](../src/shared/wezterm-setup.ts), not a copied type listing here.

A pathname check alone left a race: the CLI could connect after the socket was
replaced. The [transport](../src/main/wezterm-process.ts) now establishes the
chosen connection before authorizing dispatch, then exposes it to one CLI client
through a private temporary Unix socket. It never reconnects to the original
path. [ADR 0003](adr/0003-pinned-wezterm-transport.md) records the reproduced
failure, bounded transport, and residual trust limits.

There is no agent attachment acknowledgment in this adapter. The product returns
`dispatched-unverified`, even when transport succeeds. A post-launch failure is
also uncertain: input might already have arrived, so there is no automatic retry.
Reveal is a separate, one-shot request for the retained pane. CLI acceptance does
not establish OS visibility or foreground focus.

## Why these choices

**Electron rather than a native rewrite.** It already supplies capture, display,
clipboard, shortcut, and window APIs, while React and TypeScript are shared.
The cost is package size and runtime memory. Measure those costs; do not add a
second platform implementation merely to make the stack more impressive.

**Local processing rather than a backend.** There is no product need for an
account, database, queue, or upload service. The destination agent owns its model
connection; ScreenFling owns the local handoff.

**One optional integration rather than a plugin framework.** Copy is useful
without a terminal integration. The existing
[adapter contract](../src/main/destination-adapter.ts) separates routing from
capture, but is not a public extension API.
[ADR 0001](adr/0001-wezterm-first-stage-adapter.md) explains the initial choice.

## Native-code gate

One small C helper fills a measured API gap: Node's file metadata does not expose
macOS extended ACLs. It checks only selector paths, is unprivileged, and returns
a fixed success token without paths or ACL text. It is not a capture backend or
a resident service. [ADR 0002](adr/0002-macos-selector-acl.md) explains the strict
policy and its usability tradeoff.

## Stored data

Captures and notes live in memory; delivery places the image on the OS clipboard.
There is no screenshot history or ScreenFling network service. The clipboard and
the chosen agent are outside this storage guarantee.

Shortcut and WezTerm settings are explicit local preferences. Connection changes
apply after restart. Private files, bounded reads, and temporary-write/rename
avoid accepting unsafe preference files or exposing partially written settings.
Shortcut changes register the candidate before replacing the previous binding.

Diagnostics are bounded in-memory counts and timings. They exclude images,
notes, terminal output, local paths, operation IDs, and destination identities.
They disappear at application exit.

## Verification

Tests target state transitions, IPC validation, pixel geometry, cancellation,
stale destinations, and native transport races. Browser fixtures test the built
React UI. Packaged checks test the real application and OS APIs where stated.
They are not interchangeable evidence.

[Testing](testing.md) owns commands and recorded evidence;
[the operator checklist](acceptance/macos-operator-acceptance.md) owns physical
checks. [The roadmap](../ROADMAP.md) owns remaining work. Historical experiments
are linked there and in the test guide, not maintained as parallel specifications.

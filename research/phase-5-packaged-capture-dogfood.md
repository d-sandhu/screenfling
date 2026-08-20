# Phase 5 packaged capture dogfood

Date: 2026-08-20

Status: local implementation evidence, not release acceptance

## Purpose

This run checked the first production Capture-to-Copy vertical slice in the
packaged macOS application. It records only application behavior and sanitized
environment metadata. Captured pixels, terminal contents, clipboard contents,
and private screenshots are intentionally excluded.

## Test artifact and host

| Item | Value |
|---|---|
| Branch | `phase/5-capture-overlay` based on `d471035` |
| Application version | `0.0.0` pre-alpha |
| Bundle identifier | `com.dsandhu.screenfling` |
| Electron | `43.4.1` |
| Package | arm64 directory build, ad-hoc signed, not notarized |
| Host | Apple M4 Pro, arm64 |
| Operating system | macOS 26.5.2 (25F84) |
| Capture permission | already granted to the packaged bundle identity |

The development `com.github.Electron` identity was not treated as release
evidence because macOS Screen Recording permission is identity-scoped. The
observed production flow used the packaged ScreenFling bundle.

## Automated gate

After the dogfood fix, the repository passed:

- Prettier check;
- type-aware Oxlint with every installed generic anti-slop rule enabled at error
  severity;
- strict TypeScript compilation;
- 119 Vitest tests across 16 files;
- the macOS directory-package build.

The tests include workflow transitions, stale-operation rejection, capture
geometry, display revalidation, clipboard pixel evidence, secure IPC sender
checks, hidden-overlay recovery, and synchronous fast-drag tracking.

## Observed packaged workflows

| Workflow | Result |
|---|---|
| Launch packaged application | Passed; main surface loaded from the secure `screenfling://` scheme. |
| Shortcut registration status | Passed; `CommandOrControl+Shift+9` registered. The global keystroke itself was not invoked in this run. |
| Start Capture | Passed; main window hid before capture and the overlay appeared only after the frozen image loaded. |
| Escape during selection | Passed; returned `cancelled`, restored the main surface, and did not copy or send. |
| Fast region drag | Initially failed with a zero-area selection; fixed and repeated successfully with precise CDP pointer events. |
| Review crop | Passed; the observed selection produced a 1060 × 660 physical-pixel preview. |
| Explicit Copy | Passed; the image clipboard write was followed by main-process pixel evidence read-back and reported `copied`. |
| Renderer diagnostics | Passed; no page errors or console exceptions were reported during the fixed review and Copy flow. |

## Defect found and fixed

The first automated fast drag delivered pointer events before React committed
the pointer-down state. Later handlers observed stale state and left a 0 × 0
selection. The renderer now uses a synchronous `CaptureDragTracker` at the event
boundary. Regression tests cover immediate event progress, reverse drags, and
cancellation. Repeating the same fast drag advanced to review.

A separate recovery review found that JPEG decode or overlay-ready failure could
leave both application surfaces hidden. The overlay now reports an authorized
`capture-overlay:failed` action; the main controller releases the capture,
destroys the overlay, restores the main window, and reports `capture-failed`.

## What this run does not prove

This run does not close Gate A. It did not measure shortcut-to-overlay or
selection-to-clipboard latency distributions, repeat the 200-cycle resource
soak, invoke the registered global keystroke, or cover mixed-scale displays,
negative origins, rotation, reconnect, sleep/wake, permission denial or
revocation, Intel macOS, or Windows. It also does not exercise destination
discovery or Stage.

The evidence supports continuing to the production destination adapter while
the remaining native acceptance rows stay release-blocking.

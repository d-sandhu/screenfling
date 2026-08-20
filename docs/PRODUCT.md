# Product direction

Status: Accepted direction for the pre-alpha

Last reviewed: 2026-08-20

## Product statement

ScreenFling is a local-first desktop tool that captures visual context and
stages it in an explicitly selected AI coding session.

The product is built around one observation: taking a screenshot is already
easy, but getting that screenshot into the correct agent, project, worktree, or
conversation is repetitive and error-prone.

ScreenFling should make the complete handoff faster than this baseline:

```text
take an operating-system screenshot
-> switch applications
-> find the correct session
-> paste the image
-> type context
-> verify the destination
```

## Who it is for

The initial user is a developer who:

- works with one or more terminal-based AI coding agents;
- regularly explains visual bugs, UI states, or design references;
- has multiple projects, worktrees, or sessions open at the same time;
- values keyboard-driven workflows and predictable automation;
- does not want screenshots uploaded to another ScreenFling service.

The initial product is not a general screenshot manager or a universal desktop
automation tool.

## Core job

> When I see something an agent needs to understand, help me capture only the
> relevant area and put it in the correct session without disrupting my work or
> risking an unintended submission.

## Product vocabulary

ScreenFling uses three delivery levels consistently:

| Action | Product promise |
| --- | --- |
| **Copy** | The capture is available on the operating-system clipboard. |
| **Stage** | ScreenFling addresses a selected destination and places input there without submitting it. Verification may be limited and must be reported honestly. |
| **Send** | ScreenFling submits through a destination-specific adapter that can verify the target and submission behavior. |

Stage is the default automated action. Send is earned per adapter; there will be
no generic “activate a window and press Enter” implementation.

## Experience contract

The main interaction should remain small:

```text
capture -> describe -> choose -> stage -> review
```

The user should be able to rely on the following:

1. Capture begins from a configurable global shortcut.
2. The selection surface appears over a frozen snapshot, so it is not included
   in the captured pixels.
3. The first version limits each capture to one display and communicates that
   boundary before selection.
4. The user chooses a destination explicitly. ScreenFling never silently falls
   back to the focused or most recently used terminal.
5. Stage does not submit, press Enter, or steal focus.
6. The result names the selected destination and states the strongest result the
   adapter can prove.
7. The image remains on the clipboard when staging is unsupported, uncertain, or
   unsuccessful.
8. Cancel leaves the clipboard and destinations unchanged.

## Product principles

### Routing is the product

Capture quality is foundational, but capture alone is not differentiated. The
first product milestone must prove one complete capture-to-destination flow.

### Exact target over convenient guess

A destination is an addressable endpoint, not a window title or working
directory. Repository, worktree, branch, agent type, and working directory are
useful labels and evidence. They are not sufficient routing identities.

When ScreenFling cannot identify a target exactly, it falls back to Copy rather
than guessing.

### Stage before Send

The user reviews staged content before submission. An adapter may expose Send
only after it can prove the intended session, input surface, attachment behavior,
and submit action for a supported version.

### Local-first and private by default

The core product requires no ScreenFling account, cloud image service, hosted
backend, or telemetry. Images and notes remain local until the destination chosen
by the user handles them.

Diagnostics may record timings and result categories locally. They must not
record image pixels, note text, clipboard contents, source code, or terminal
contents.

### Capabilities, not false parity

Platforms and destinations expose different control and verification surfaces.
The UI should present Copy, Stage, and Send according to the selected adapter's
real capabilities rather than pretending every combination is equivalent.

### Generalize after evidence

The first implementation should contain real seams for capture and destination
adapters, but it should not ship a public plugin API, marketplace, universal
discovery system, or native helper framework before multiple implementations
justify them.

## Platform commitment

ScreenFling is a cross-platform product delivered sequentially:

| Platform | Commitment | Direction |
| --- | --- | --- |
| macOS | Tier 1, first reference implementation | Capture, clipboard, permissions, packaging, and at least one exact local destination adapter |
| Windows | Tier 1, next platform | Equivalent core workflow with Windows-specific capture, scaling, signing, and destination validation |
| Linux | Optional | No release commitment; X11 or portal-based experiments may be accepted when maintainable, without Wayland parity claims |

Cross-platform architecture means shared product behavior and replaceable
platform services. It does not require simultaneous platform releases.

## Initial scope

The first useful alpha includes:

- global-shortcut region capture on one display;
- correct physical pixels on scaled displays;
- in-memory PNG and image clipboard output;
- optional sanitized single-line note;
- explicit selection of one live, exactly addressable local destination;
- destination-specific image and text staging without submission;
- a user-triggered Reveal action when staging cannot be verified;
- clear Screen Recording and automation-permission guidance;
- packaged-build testing, not development-mode testing alone;
- local diagnostic timings and failure categories.

The first surface-adapter implementation targets WezTerm because its exact-pane
CLI primitive passed the cross-platform routing harness on native macOS and
Windows. This makes WezTerm the first integration selected for implementation,
not a dependency of ScreenFling itself: Copy remains available without it.
Support remains gated by real-agent acceptance trials. tmux is the
exactness/read-back reference; Ghostty remains an optional macOS adapter.

## Deliberate non-goals

The following are outside the initial product:

- automatic submission to arbitrary applications;
- automatic conversation discovery from a process name or working directory;
- arbitrary active-window paste;
- remote SSH, WSL, or container transfer;
- browser extensions and DOM capture;
- web-chat or desktop-chat automation;
- multi-capture task boards;
- permanent screenshot management or a screenshot database;
- cloud accounts, synchronization, image hosting, or collaboration;
- built-in AI analysis, OCR, or an MCP server without a demonstrated need;
- a terminal emulator, PTY implementation, or plugin marketplace;
- a broad Rust rewrite or speculative native helper.

## Success measures

Technical correctness is necessary but does not prove product value. The alpha
must be compared with the operating-system screenshot plus manual-paste baseline.

Measure locally, without capturing content:

- time from shortcut to a reviewable destination;
- capture and permission failure rates;
- stale, failed, and unverified Stage rates;
- clipboard-fallback rate;
- wrong-target count, which must remain zero;
- repeated voluntary use across several working days.

The project should not expand into remote, browser, or multi-capture workflows
until the local handoff is measurably faster or more dependable than the manual
baseline.

## Decision rule

When scope is disputed, prefer the change that strengthens this sequence:

```text
capture accurately
-> identify exactly
-> stage safely
-> report honestly
```

If a feature does not improve that sequence for a demonstrated user workflow,
it belongs later or outside ScreenFling.

# Phase 16 operator acceptance protocol research

Research date: 2026-08-24

Scope: safe, repeatable macOS human-operated evidence for the remaining
ScreenFling Gate A and Gate B rows. Context7 was used first for current Electron
API documentation, followed by current primary Apple, Electron, and WezTerm
pages. No GUI or native acceptance action was performed.

Repository context: ScreenFling `0.0.0`, Electron `43.4.1`, Node `24.13.0`, and
npm `11.19.0`. No WezTerm or agent version was exercised by this research.

## Decision

Use a versioned Markdown checklist. Do not add a Bash wizard or extend the
packaged capture runner in this phase.

The checklist preserves operator confirmation, direct observation, discarded
runs, and cleanup incidents without pretending that a script observed the
desktop. The runner remains useful as a separate evidence class. A future
report-merging tool is justified only after the procedure has been exercised.

The resulting procedure and report schema are canonical in the
[macOS operator acceptance protocol](../docs/acceptance/macos-operator-acceptance.md).
This research report intentionally does not restate them.

## Evidence boundary

| Evidence | Supports | Does not support |
| --- | --- | --- |
| Unit/integration test | State, validation, geometry, adapter contracts | Native permission, physical delivery, visible focus |
| Packaged runner | Exact artifact and bridge-driven workflow measurements | Physical shortcut, pointer drag, real-agent attachment |
| Human shortcut | Physical key delivery and visible operation count | Pointer accuracy or agent read-back |
| Human pointer | Real display selection and clipboard timing | Shortcut delivery |
| Human observation | Visible focus, attachment indicator, cleanup | Claims beyond the recorded tuple |

An evidence row must retain one class. Permission readiness is not capture
success; CLI acceptance is not foreground behavior; transport success is not
verified attachment; operator intervention is not unattended success.

## Primary-source findings

### Package identity and Screen Recording

Electron packaging requires the application name and bundle identifier to be
carried by the macOS bundle. Signing is a separate distribution property. The
existing runner verifies the repository's `Info.plist` identity and
`app.asar`, but an ad-hoc package is not notarized release evidence.

Electron exposes `getMediaAccessStatus("screen")`, while its generic
`askForMediaAccess` request path does not support screen capture. Apple places
the user-controlled setting under Privacy & Security and requires the exact
application identity to be observed across state changes. Engineering
consequence: record status, real capture outcome, clipboard effect, cleanup,
and restart as separate fields. Include denied, granted, revoked, restricted,
not-determined, and unknown without fabricating unavailable states.

Sources: [Electron system preferences](https://www.electronjs.org/docs/latest/api/system-preferences),
[Electron distribution](https://www.electronjs.org/docs/latest/tutorial/application-distribution),
[Electron signing](https://www.electronjs.org/docs/latest/tutorial/code-signing),
[Apple Screen Recording settings](https://support.apple.com/guide/mac-help/allow-apps-to-use-screen-and-audio-recording-mchl592e5686/mac).

### Shortcut and lifecycle

Electron requires main-process shortcut registration after readiness and exposes
registration success only for the application-owned registration attempt. That
does not prove a physical key event reached the app. `powerMonitor` reports
suspend and resume events but does not guarantee survival of an in-progress
capture. Engineering consequence: measure real delivery after restart and a
real conflict separately; observe fail-closed recovery across sleep/wake.

Sources: [Electron `globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut),
[Electron `powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor).

### Display topology

Electron's `screen` events report bounds, work area, scale factor, and rotation
changes. Repository fixtures can validate mapping math but cannot establish
which physical display the pointer selected or how a real reconfiguration
behaved. Engineering consequence: keep mixed-scale, negative-origin, rotation,
reconnect, and sleep/wake as distinct direct rows, using `unavailable` when the
host lacks the required hardware.

Source: [Electron `screen`](https://www.electronjs.org/docs/latest/api/screen).

### Focus, Reveal, and exact WezTerm routing

WezTerm exposes exact pane IDs and targeted `send-text`; omitting explicit pane
identity can invoke focused/default targeting. `activate-pane` is an explicit
focus action and must remain outside Stage, while Reveal is tested separately.
CLI success alone cannot prove OS foreground state or that a real agent composer
accepted an image.

The tuple must also exercise duplicate titles/working directories, literal
quotes/backslashes/Unicode/key-like words, and newline/control handling because
the roadmap names these exact identity and data boundaries.

Sources: [WezTerm CLI](https://wezterm.org/cli/cli/index.html),
[WezTerm `list`](https://wezterm.org/cli/cli/list.html),
[WezTerm `send-text`](https://wezterm.org/cli/cli/send-text.html),
[WezTerm `activate-pane`](https://wezterm.org/cli/cli/activate-pane.html).

## Safety and evidence requirements

- Use only synthetic fixtures and disposable destinations.
- Record versions, hashes, dimensions, counts, categories, and factual outcomes;
  exclude pixels, clipboard data, note content, terminal content, paths,
  credentials, titles, and raw adapter output.
- Confirm before permission, shortcut-conflict, display, or lifecycle changes.
- Run packaged automation unattended. Any manual drag, click, or Escape makes
  the result `discarded`.
- Stop an unexpected row instead of trying more interaction. Restore permission,
  shortcut, display, clipboard, and destination state before closeout.
- Use an independent reviewer before a direct observation becomes a pass.

## Static verification boundary

Repository checks may validate links, terminology, the unchanged test suite,
anti-slop lint, strict types, build, and packaging. They must not launch the app,
change permissions, drive an overlay, alter display state, or claim native
evidence. The canonical protocol is ready only when its row inventory and report
shape match the roadmap; the gates remain open until an authorized session.

## Explicit exclusions

- executable wizard or GUI automation;
- automatic settings or TCC mutation;
- additional capture backends or native helpers;
- embedded screenshots, recordings, or private logs;
- Windows or Linux acceptance claims from this macOS protocol;
- signing, notarization, or release claims from an ad-hoc directory package.

## Repository evidence

- [Roadmap](../ROADMAP.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Phase 15 next-slice audit](phase-15-next-slice-audit.md)
- [Phase 8 capture lifecycle results](phase-8-capture-lifecycle-results.md)
- [Phase 8 routing acceptance plan](phase-8-routing-acceptance-plan.md)

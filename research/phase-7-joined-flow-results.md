# Phase 7 joined capture-to-Stage results

Research and validation date: 2026-08-20

Status: joined developer workflow implemented; native and real-agent release
acceptance remain open.

## Outcome

ScreenFling now joins region capture, crop review, explicit exact-destination
choice, an optional one-line note, verified clipboard fallback, and one-shot
Stage through the main-owned workflow. Copy remains independent of every
destination adapter. Stage never sends Enter, never selects an active fallback,
and never claims that a terminal accepted an image attachment when only input
dispatch is observable.

The compiled WezTerm adapter is wired into the product on macOS only through a
complete opt-in developer environment configuration. This makes the joined path
available for controlled acceptance work without presenting it as a supported
integration.

## Implemented boundary

- A `DestinationRegistry` owns compiled adapters and an operation-scoped
  discovery snapshot. Duplicate adapter IDs, malformed results, duplicate or
  ambiguous destination IDs, and aggregate over-limit results fail closed.
- Discovery is bound to the editing operation. A newer discovery, cancellation,
  Copy, display invalidation, or Stage consumes or clears the prior snapshot so
  late asynchronous results cannot restore stale routes.
- The renderer submits only an operation ID, one selected destination ID, and a
  runtime-validated optional note. Executable paths, config paths, sockets,
  destination objects, and subprocess arguments never cross from the renderer.
- Stage advances through `target-selected`, `writing-clipboard`, and `staging`.
  It writes and verifies the image clipboard before invoking one adapter
  transaction, preserving the manual fallback after stale or failed dispatch.
- Cancellation is disabled after target selection begins. Display changes no
  longer race an in-flight dispatch into an incorrect capture-failure result.
- A discovery snapshot is consumed before dispatch. A duplicate Stage request
  cannot retry a possibly accepted side effect.
- The picker requires explicit radio selection and shows the strongest available
  evidence for each route. No destination is selected by default.
- The optional note is limited to 500 Unicode code points on one line. Pressing
  Enter in the note field is inert and does not trigger Stage.
- Results distinguish copied, stale/failed, verified Stage, and
  `dispatched-unverified`. Successful destination results retain and name only
  the exact adapter/surface receipt, not mutable context labels. Uncertain
  WezTerm dispatch explicitly says the attachment could not be verified and that
  the image remains on the clipboard.
- A complete macOS-only experimental configuration requires absolute executable,
  config, and socket paths plus one to 64 hexadecimal input bytes without CR or
  LF. Partial, malformed, unsupported-platform, or unsafe configuration exposes
  no adapter.

## Automated evidence

The phase suite covers:

- operation-bound discovery, cross-operation stale refusal, one-shot snapshot
  consumption, and preservation of only the newest asynchronous discovery;
- malformed adapter output, duplicate adapter IDs, duplicate destination IDs,
  ambiguous identities, and aggregate destination bounds;
- a joined Stage transaction with explicit workflow phases, selected route,
  optional note, verified clipboard write before dispatch, and final evidence;
- refusal of cancellation, display invalidation, and duplicate Stage while a
  dispatch is in progress;
- strict bridge parsing for the Stage request and destination discovery result;
- complete, partial, unsafe, and platform-gated experimental adapter
  configuration; and
- workflow transition and cancellation guards around side effects.

The full repository gate passed Prettier, type-aware Oxlint with every vendored
generic anti-slop rule at error severity, strict TypeScript, 156 tests across 20
files, the production build, and an ad-hoc-signed macOS arm64 directory package
on Electron 43.4.1.

## Visual validation

The renderer was inspected at the production window size of 920 by 720 pixels
with a local, renderer-only mock of the narrow bridge. The fixture exercised two
exact WezTerm pane choices, no default selection, the disabled and enabled Stage
states, a 34-character note, Enter-key suppression, Copy availability, and the
final `Staged — unverified` result. One Refresh-control alignment issue found in
that pass was corrected and rechecked. A follow-up interaction confirmed that
the result names `WezTerm · pane 7` and moves keyboard focus to the new Done
action after the initiating Stage control unmounts.

The rebuilt ad-hoc application did not retain the previously granted macOS
Screen Recording permission for its current identity, so this phase did not
alter privacy settings or relabel the mocked renderer pass as native end-to-end
evidence. No fixture or private screenshot is stored in the repository.

## What this evidence does not prove

- The experimental configuration does not yet validate ownership, Unix mode,
  Windows ACLs, trusted parent directories, or every replacement interval for
  the executable, configuration, and socket paths.
- The current product wiring is intentionally macOS-only. The Phase 3 routing
  harness provides Windows primitive evidence, but the joined application has
  not passed native Windows packaging or destination acceptance.
- The renderer fixture does not prove that WezTerm preserved focus, that a real
  agent binding was active, that a composer accepted the image key, or that an
  image attachment appeared.
- Gate A still lacks its mixed-display, lifecycle, permission-revocation, and
  full timing matrix. Gate B still lacks visible no-focus runs and 30 observed
  trials for every terminal/agent/version combination proposed for support.
- The joined workflow does not provide Reveal, settings, onboarding, signed
  identity, notarization, diagnostic export, or automatic Send.

## Decision

Keep the joined flow and use it as the acceptance surface for the remaining Gate
A and Gate B work. Preserve Copy as the default safe fallback and keep the
WezTerm picker behind explicit developer configuration until trusted-path,
visible-native, and real-agent gates pass. Do not advertise terminal or agent
compatibility from this phase alone.

## Supporting evidence

- [Architecture](../docs/ARCHITECTURE.md)
- [Roadmap](../ROADMAP.md)
- [Phase 6 WezTerm adapter results](phase-6-wezterm-adapter-results.md)
- [Production WezTerm adapter evidence](production-wezterm-adapter-current-evidence.md)
- [Phase 5 packaged capture dogfood](phase-5-packaged-capture-dogfood.md)

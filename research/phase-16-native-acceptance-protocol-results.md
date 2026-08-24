# Phase 16 native acceptance protocol results

Result date: 2026-08-24

Branch: `phase/16-operator-acceptance-protocol`

Repository context: ScreenFling `0.0.0`, Electron `43.4.1`, Node `24.13.0`, and
npm `11.19.0`. No WezTerm or agent version was exercised in this
documentation-only phase.

## Outcome

Phase 16 adds the versioned
[`screenfling-macos-operator-acceptance/v1`](../docs/acceptance/macos-operator-acceptance.md)
protocol for the native Gate A and Gate B evidence that repository tests cannot
produce. This is a documentation and evidence-boundary change. It does not
launch ScreenFling, run a packaged acceptance session, change host settings, or
claim that any native row passed.

The protocol provides:

- one recorded package, host, display, WezTerm, and agent tuple per session;
- distinct unit, packaged-runner, human-shortcut, human-pointer, and
  human-observed evidence classes;
- ordered static, runner, permission, capture, routing, real-agent, and cleanup
  stages;
- explicit `failed`, `unavailable`, `not-run`, `discarded`, `open-native`, and
  `dispatched-unverified` outcomes instead of inferred passes;
- stop and emergency-recovery rules for an unexpected retained overlay;
- a redacted YAML report schema that excludes pixels and private content.

## Why this is not a wizard

A Bash or GUI-driving wizard cannot observe whether the operating system
delivered a physical shortcut, whether the pointer selected the intended
display, whether focus visibly changed, or whether a real agent composer
accepted an image. It could also blur operator intervention with unattended
runner evidence. The versioned checklist is smaller and preserves the human
observations without automating host mutations or capture UI.

The existing packaged runner remains the only automated native evidence path in
this phase. Its bridge-driven selection and button-driven timing stay separate
from physical input claims. Any operator rescue makes that run `discarded`.

## Verification boundary

Repository verification checks the protocol, its links, and the unchanged
headless build/test/package gate. A future authorized operator session must
produce the direct evidence. Until then, the following remain open:

- Screen Recording not-determined, denied, granted, revoked, restricted, and
  unknown behavior;
- physical shortcut delivery, persistence, and a real conflict;
- single-display geometry plus mixed-scale, negative-origin, rotated, and
  reconnected displays;
- physical cancellation, clipboard preservation, sleep/wake, and timing;
- extended ACL and exact WezTerm config semantics;
- duplicate-metadata isolation plus literal and control-input handling on the
  recorded tuple;
- visible no-focus Stage, endpoint replacement, Reveal foreground behavior,
  and fallback behavior;
- at least 30 real-agent Stage trials, the full soak, and comparative product
  value evidence;
- release signing and notarization.

## Supporting evidence

- [Native acceptance gap audit](phase-16-native-acceptance-gap-audit.md)
- [Operator protocol research](phase-16-operator-protocol-research.md)
- [Roadmap](../ROADMAP.md)
- [Architecture verification strategy](../docs/ARCHITECTURE.md#verification-strategy)

The protocol was derived from current primary Electron, Apple, and WezTerm
documentation linked from the research report and the canonical procedure.

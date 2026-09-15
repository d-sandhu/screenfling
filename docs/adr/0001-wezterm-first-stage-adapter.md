# ADR 0001: WezTerm as the first staging integration

Status: implemented, experimental. Agent compatibility remains unverified.

## Decision

Use WezTerm's CLI to address one explicitly configured local instance and pane.
The adapter currently checks version `20240203-110809-5046fc22`. This is the
reproducible integration baseline, not a claim that it is the newest release.
Copy works without WezTerm.

## Why

The initial [routing experiments](https://github.com/d-sandhu/screenfling/blob/b7e321217faf94ee2016217405f3c39e1e872cb6/research/phase-3-feasibility-results.md)
exercised exact two-pane routing on macOS and Windows. A pane ID inside a known
instance is a better address than a window title or working directory.

The production integration is macOS-only. It is now configurable through the
saved connection form as well as explicit environment overrides; see
[usage](../usage.md#connect-wezterm-experimental). The
[adapter](../../src/main/wezterm-adapter.ts) and
[pinned transport](0003-pinned-wezterm-transport.md) enforce the current boundary.

## Tradeoffs

Users need a specific terminal version, trusted selectors, and a manually checked
image key. This is setup cost, and it limits the audience. No automatic discovery
or active-window fallback hides that cost.

Terminal input success does not prove agent image attachment. Stage remains
`dispatched-unverified`; support needs observed trials for the actual
agent/version/binding. Creating a separate managed agent session is not the
workflow this adapter is designed to support.

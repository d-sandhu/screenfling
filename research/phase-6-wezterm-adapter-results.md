# Phase 6 WezTerm adapter results

Research and validation date: 2026-08-20

Status: production primitive implemented; product integration and release
acceptance remain open.

## Outcome

ScreenFling now has a compiled WezTerm surface adapter behind the existing
`DestinationAdapter` contract. It discovers exact panes from one explicitly
configured mux instance, binds every route to an observed instance generation,
revalidates the generation and pane before dispatch, and sends the image-paste
binding plus optional note in one bounded subprocess operation.

This phase does not claim that WezTerm or an agent attached the image. A
successful or uncertain post-spawn operation reports `dispatched-unverified`.
Copy remains the safe product fallback.

## Implemented boundary

- Absolute executable, config-file, and socket paths are owned by the Electron
  main-process adapter configuration. Relative paths fail validation rather than
  depending on `PATH` or the process working directory. Timeout and output caps
  are fixed in the main-process implementation.
- Preflight accepts the pinned official stable fixture
  `20240203-110809-5046fc22`; unknown versions fail closed.
- Every mux CLI operation supplies the explicit config and socket selector plus
  `--no-auto-start`. Pane writes always include `--pane-id`.
- Inherited `WEZTERM_PANE` is removed, so the CLI cannot select a focused or
  recently active pane as a fallback.
- `list --format json` output is UTF-8 decoded, size-capped, runtime-validated,
  pane-count-capped, and rejected for duplicate IDs or malformed required fields.
  Additive fields are tolerated and discarded.
- Route IDs are deterministic for one generation and pane, so a harmless picker
  refresh preserves the same selection. A new generation produces a new route.
  Pane ID is routing identity; title, workspace, and CWD are untrusted descriptive
  observations only.
- The generation fingerprint covers canonical executable, config, and socket
  paths plus file identity/timestamps and the supported WezTerm version.
- Final dispatch repeats pinned discovery, requires the same exact pane and
  generation, then runs another generation guard immediately before process
  creation.
- The configured image-paste bytes and validated one-line note are joined into
  one stdin payload. There is no shell, string interpolation, implicit Enter,
  activation, focus command, partial second note process, or automatic retry.
- Missing-process failures are reported as failed. Timeout, bounded-output,
  input, or non-zero-exit outcomes after process creation are conservatively
  reported as dispatched but unverified because bytes may have arrived.

## Automated evidence

The phase suite covers:

- exact version, config, socket, and pane arguments;
- additive pane fields plus malformed JSON, duplicate IDs, unsafe labels,
  invalid dimensions, and oversized pane arrays;
- one literal Unicode and shell-metacharacter note payload with no CR/LF;
- 100 alternating routes across two same-context pane fixtures with the expected
  pane ID on every single write;
- pane disappearance, generation change, selection preservation across harmless
  rediscovery, and endpoint replacement at the final pre-spawn guard;
- zero send processes on stale routes;
- no retry after an uncertain timeout;
- explicit distinction between pre-spawn failure and uncertain post-spawn
  failure;
- generation fingerprint change after replacement of the selected socket path;
  and
- subprocess stdin fidelity, output cap, timeout termination, final guard, and
  synchronous spawn-failure mapping.

The full repository check passed formatting, type-aware Oxlint with every vendored
generic anti-slop rule at error severity, strict TypeScript, and 139 tests across
18 files. The production build and ad-hoc-signed macOS arm64 directory package
also completed successfully with Electron 43.4.1.

## What this evidence does not prove

- The 100-route production-tree test uses a deterministic command-runner fixture.
  Native macOS and Windows transport evidence remains in the Phase 3 report; this
  phase does not relabel unit evidence as a native run.
- WezTerm has no documented atomic revalidate-and-send operation. The final
  generation guard narrows but cannot mathematically eliminate the last
  time-of-check/time-of-use interval.
- The external-mux generation fingerprint uses filesystem identity because the
  documented CLI does not expose mux PID and process-start identity. An owned mux
  should add those fields; native external-GUI acceptance must test restart and
  socket replacement before Stage is exposed as supported.
- CLI process success does not prove no focus theft in a visible packaged run,
  that a configured agent binding is active, that a composer accepted the key,
  or that an image chip appeared.
- External-GUI packaged runs, 30 human-observed trials for each claimed
  terminal/agent/version combination, remapped and unbound key behavior, and
  native Windows packaging remain release-blocking.
- Absolute-path validation does not prove that the selected executable, config,
  socket, or parent directory is trusted. Platform ownership, Unix mode,
  Windows ACL, symlink/replacement, and executable-discovery policy must pass
  native security acceptance before the adapter is exposed in the picker.
- The adapter is not yet exposed through the renderer destination picker or
  joined to the capture/clipboard workflow.

## Decision

Proceed to the joined capture, optional-note, destination-choice, Copy, and Stage
workflow. Do not advertise WezTerm agent support or close Roadmap Gate B until the
visible packaged and real-agent acceptance rows have direct evidence.

## Supporting evidence

- [Production WezTerm adapter evidence](production-wezterm-adapter-current-evidence.md)
- [Routing-surface evidence](routing-surface-current-evidence.md)
- [Phase 3 feasibility results](phase-3-feasibility-results.md)
- [ADR 0001](../docs/adr/0001-wezterm-first-stage-adapter.md)

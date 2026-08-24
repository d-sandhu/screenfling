# Research index

These reports record the evidence behind ScreenFling's current direction. They
include documentation findings, feasibility analysis, risks, acceptance tests,
and dated validation results.

Research is supporting material, not the live product plan. Current decisions
are controlled by:

- [Product direction](../docs/PRODUCT.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Roadmap](../ROADMAP.md)

If a report conflicts with those documents, treat the report as historical
evidence and open a proposal to update the canonical decision.

## Reports

### [Tech-stack validation](tech-stack-validation.md)

Compares Electron, Tauri, and fully native implementations using Context7,
current vendor documentation, and lower-confidence field evidence from X. It
supports Electron, strict TypeScript, React, and Node.js, with native helpers
behind measured gates.

### [Capture and platform feasibility](capture-platform-feasibility.md)

Examines Electron capture, physical-pixel mapping, frozen overlays, permissions,
platform differences, packaging, performance, security, and the conditions that
would justify native capture code.

### [Routing and staging feasibility](routing-and-staging-feasibility.md)

Examines exact terminal addressing, target identity, Stage semantics, Ghostty,
tmux, WezTerm, Codex managed sessions, remote staging, and verification limits.
Tool availability on a research machine is evidence about testability, not a
project-level platform or adapter decision.

### [Feasibility and execution synthesis](feasibility-and-execution-plan.md)

Combines the original capture and routing findings into an early execution
proposal. Its machine-specific recommendation has been superseded by the
roadmap's adapter-selection gate; its capture, safety, and acceptance findings
remain useful.

### [Phase 1 scaffold and toolchain validation](scaffold-toolchain-validation.md)

Records the original Electron Forge TypeScript/Webpack validation, React
integration, packaging lifecycle, CI constraints, and where the anti-slop
installation belongs. Its Forge recommendation is superseded by the measured
build-toolchain decision below; the underlying Forge facts remain historical
evidence.

### [Electron build-toolchain decision](forge-version-decision.md)

Reproduces clean-install audits across Forge 7/Webpack, Forge 8 alpha, Forge
7/Vite, and stable electron-vite/electron-builder. It supersedes the original
Forge scaffold recommendation after the stable Forge graph exposed development
and packaging advisories and failed against TypeScript 7.

### [Current routing-surface evidence](routing-surface-current-evidence.md)

Compares exact terminal control surfaces on native macOS and Windows. It selects
WezTerm for the cross-platform routing prototype, tmux as the Unix exactness
reference, and Ghostty as an optional macOS adapter rather than a project target.

### [Managed-agent routing evidence](managed-agent-routing-current-evidence.md)

Separates passive Stage into an existing user-owned surface from managed Send
through Codex or Claude session APIs. Managed APIs are later adapter candidates;
they do not substitute for Gate B.

### [Phase 3 feasibility results](phase-3-feasibility-results.md)

Records the packaged capture measurements, native macOS/Windows routing results,
permanent decisions, explicit remaining acceptance gaps, and the conditional
go/no-go decision for alpha implementation.

### [Production capture implementation evidence](production-capture-implementation-current-evidence.md)

Documents current Electron 43 capture, display, overlay, clipboard, shortcut,
and macOS permission APIs plus implementation guidance for the production path.
It separates those API facts from the packaged hardware checks that remain
release-blocking.

### [Phase 5 packaged capture dogfood](phase-5-packaged-capture-dogfood.md)

Records the sanitized local packaged-app run for the production Capture-to-Copy
vertical slice, the fast-drag defect found and fixed during dogfooding, the
verified Copy result, and the native acceptance rows that remain open. Captured
pixels and private QA screenshots are not stored in the repository.

### [Production WezTerm adapter evidence](production-wezterm-adapter-current-evidence.md)

Checks the current WezTerm CLI, JSON discovery, instance selection, subprocess,
versioning, and stale-generation boundaries against Context7 and primary sources.
It defines what the adapter can prove and the native acceptance work it cannot
replace.

### [Phase 6 WezTerm adapter results](phase-6-wezterm-adapter-results.md)

Records the production-tree adapter boundary, automated conformance results,
fail-closed behavior, and the security, visible native, and real-agent rows that
remain open.

### [Phase 7 joined-flow results](phase-7-joined-flow-results.md)

Records the operation-scoped destination registry, narrow Stage IPC boundary,
joined Capture/Copy/Stage UI, automated and visual validation, experimental
configuration boundary, and acceptance work that remains release-blocking.

### [Phase 8 capture acceptance plan](phase-8-capture-acceptance-plan.md)

Uses Context7 and first-party Electron, Apple, and Microsoft documentation to
separate automatable production-capture evidence from native hardware,
permission, signing, and human-observation rows.

### [Phase 8 routing acceptance plan](phase-8-routing-acceptance-plan.md)

Uses Context7 and first-party WezTerm documentation/source to define the pinned
visible no-focus, real-agent, endpoint-replacement, and trusted-path work still
required before the experimental adapter can claim compatibility.

### [Phase 8 capture and lifecycle results](phase-8-capture-lifecycle-results.md)

Records the packaged production runner, suspend/resume fail-closed behavior,
sanitized timing and 200-cancel evidence, discarded flaky pointer automation,
and every native Gate A/Gate B row that remains open.

### [Phase 9 next-slice audit](phase-9-next-slice-audit.md)

Compares the remaining Gate A and Gate B evidence, identifies the trusted
WezTerm selector policy as the smallest repository-testable safety gap, and
keeps native hardware, focus, and real-agent rows explicitly blocked.

### [Screen Recording permission acceptance plan](screen-recording-permission-acceptance-plan.md)

Uses Context7 plus Electron and Apple documentation to define a future pure
Screen Recording permission-policy seam and the human-operated packaged checks
that cannot be replaced by mocked permission state.

### [Phase 10 permission recovery results](phase-10-permission-recovery-results.md)

Records the pure cross-platform status policy, macOS denied/restricted recovery
copy and cleanup contract, Context7 verification, automated evidence, and the
packaged TCC rows that remain human-operated.

### [Phase 11 routing-recovery plan](phase-11-routing-recovery-plan.md)

Uses Context7 and first-party Electron and WezTerm documentation to separate
typed repository recovery behavior from exact Reveal and native desktop
acceptance.

### [Phase 11 routing-recovery results](phase-11-routing-recovery-results.md)

Records capability-gated Stage, the unsupported result contract, explicit
manual clipboard fallback, automated evidence, and the exact Reveal/native rows
that remain open.

### [Phase 12 exact-destination Reveal plan](phase-12-exact-reveal-plan.md)

Uses Context7 and first-party WezTerm and Electron documentation to define a
main-owned, no-data exact-pane activation transaction, its honest evidence
boundary, and the native foreground checks documentation cannot replace.

### [Phase 12 exact-destination Reveal results](phase-12-exact-reveal-results.md)

Records the main-owned result lease, operation-only bridge, no-data exact-pane
activation, typed evidence boundary, headless verification, discarded
operator-assisted GUI run, and native acceptance rows that remain open.

### [Phase 13 next-slice audit](phase-13-next-slice-audit.md)

Ranks the remaining repository-testable Milestone 1 gaps and selects bounded,
main-owned workflow diagnostics ahead of shortcut settings or unverifiable
adapter read-back work.

### [Phase 13 sanitized diagnostics results](phase-13-sanitized-diagnostics-results.md)

Records the strict content-free schema, monotonic bounded aggregation,
controller lifecycle wiring, read-only bridge, acceptance-report integration,
headless verification, and native evidence that remains open.

### [Phase 14 next-slice audit](phase-14-next-slice-audit.md)

Compares the remaining repository-testable gaps after Phase 13 and selects one
complete configurable-shortcut seam while keeping native shortcut delivery and
conflict evidence explicitly open.

### [Phase 14 shortcut configuration research](phase-14-shortcut-configuration-research.md)

Uses Context7 and pinned Electron 43/Node 24 primary documentation to define the
main-process registration lifecycle, persistence transaction, strict IPC
boundary, cross-platform caveats, and safe failure behavior.

### [Phase 14 configurable shortcut results](phase-14-configurable-shortcut-results.md)

Records the bounded portable picker, candidate-first registration and rollback,
versioned private preference, bridge v7, headless verification, and native rows
that remain unclaimed.

### [Phase 9 trusted selector results](phase-9-trusted-selector-results.md)

Records the macOS executable/config/socket ownership, mode, type, ancestor,
access, fingerprint, and before-spawn guards; the acceptance-overlay cleanup
regression; and the ACL, config-semantic, native, and real-agent evidence that
remains open.

## Research standard

New reports should:

- include the research date;
- distinguish documented facts from engineering inference;
- prefer current first-party documentation and primary sources;
- record relevant product and tool versions;
- link claims to their sources;
- explain conflicting evidence and uncertainty;
- state what decision the evidence supports and what would reverse it;
- avoid placing credentials, private screenshots, or user content in the repo.

Research based on an installed application or local environment must label that
scope explicitly. Local availability may determine how a spike is executed, but
it must not silently define the public product direction.

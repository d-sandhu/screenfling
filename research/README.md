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

# Research index

These reports record the evidence behind ScreenFling's current direction. They
include documentation findings, feasibility analysis, risks, and proposed
acceptance tests as of 2026-08-19.

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

Validates the stable Electron Forge TypeScript/Webpack scaffold, React
integration, package metadata, packaging lifecycle, CI constraints, and where
the anti-slop installation belongs. It records Forge 7.x as the current stable
line and keeps the Vite plugin out of the initial scaffold while it remains
experimental.

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

# Contributing to ScreenFling

ScreenFling is pre-alpha. Contributions are welcome, but the current priority is
proving the core capture-to-destination workflow before expanding its scope.

## Start with the project direction

Read these documents before proposing implementation work:

- [Product direction](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)

The [research reports](research/README.md) contain supporting evidence. They are
useful context, but the canonical documents above control current decisions.

## Good early contributions

The most useful pre-alpha contributions are:

- reproducible capture and coordinate-mapping fixtures;
- packaged-build measurements on different display configurations;
- exact-target routing harnesses for documented terminal control surfaces;
- security review of Electron IPC and subprocess boundaries;
- accessibility review of the capture and picker workflows;
- corrections backed by current first-party documentation;
- concise issue proposals for a roadmap exit criterion.

Features in the roadmap's demand-driven or optional sections should begin with a
problem statement and evidence, not a large implementation.

## Before a large change

Open an issue before work that:

- adds a dependency or platform permission;
- introduces native code;
- changes a product-level contract;
- creates a new package or process;
- adds a destination adapter;
- expands the supported platform or version matrix;
- persists captures, notes, terminal contents, or diagnostics.

Describe the user problem, proposed boundary, alternatives considered, security
impact, and how the change will be tested.

## Implementation expectations

- Keep each change small enough to review as one coherent outcome.
- Prefer a vertical slice or executable proof over speculative abstractions.
- Use strict TypeScript, pass the configured Oxlint and anti-slop rules, and
  validate all IPC and adapter input at runtime.
- Keep privileged behavior in the main process or a documented least-privileged
  helper.
- Never use working directory, window title, or process name as routing identity.
- Never fall back to the active destination after a selected target becomes
  stale.
- Never synthesize Enter or automatic submission through a generic adapter.
- Preserve clipboard fallback when staging is unavailable or uncertain.
- Keep images, notes, clipboard contents, and terminal contents out of logs and
  diagnostics.

## Testing expectations

A pull request should include the narrowest tests that prove its behavior.
Depending on the change, that may include:

- unit tests for contracts, validation, state transitions, and coordinate math;
- integration tests for clipboard or adapter dispatch;
- packaged-application testing for permissions and desktop identity;
- native macOS or Windows acceptance notes;
- before/after performance measurements;
- cancellation, stale-target, and permission-denial cases.

Wrong-target tolerance is zero. An uncertain dispatch must not automatically
retry because that may duplicate input.

The exact development commands will be added after the application scaffold is
created. The scaffold change must install and document the anti-slop plugin with
the chosen package manager. Do not invent setup instructions before they can be
tested from a clean checkout.

## Documentation

Update the canonical document affected by a behavior change:

- product promise or scope: `docs/PRODUCT.md`;
- technical boundary or contract: `docs/ARCHITECTURE.md`;
- sequence, status, or acceptance gate: `ROADMAP.md`;
- supporting evidence: `research/`.

Avoid copying the same plan into several documents. Link to the canonical source
instead.

## Pull requests

A useful pull request description explains:

1. the user-visible or engineering problem;
2. why the chosen boundary is appropriate now;
3. the evidence or tests that demonstrate correctness;
4. permissions, privacy, and failure behavior;
5. work intentionally left for a later change.

Do not include credentials, screenshots containing private information, or logs
with clipboard, note, source-code, or terminal content.

## License

By contributing, you agree that your contribution may be distributed under the
project's [MIT License](LICENSE).

# Contributing

Start with the [README](README.md) to run the app. Read the relevant part of the
[architecture](docs/ARCHITECTURE.md) when changing a process boundary; you do not
need to read the project's research history first.

## Development

Use the exact Node version in `.node-version` and npm version in
`package.json`. Run `npm ci` from a clean checkout. On macOS, install Apple's
Command Line Tools for the small ACL helper. `npm start` builds that helper,
installs the pinned Electron development binary when needed, and starts
`electron-vite`.

| Command | Purpose |
| --- | --- |
| `npm start` | Run the development app. |
| `npm run check` | Lint, TypeScript, and unit/helper tests. |
| `npm run build` | Build main, preload, renderer, and the macOS helper. |
| `npm run package` | Build a local directory package for the current supported host. |
| `npm run check:all` | Run `check`, then build and package. |
| `npm run format:check` | Check configured source/config formatting; Markdown is not included. |

`check:all` does not run formatting, browser fixtures, or physical desktop
acceptance. [Testing](docs/testing.md) has the separate commands and their side
effects. [Releasing](docs/releasing.md) covers distribution, not everyday changes.

## Changes worth making

Fix a reproducible daily-use problem first: a confusing setting, a failed
capture, a wrong crop, inaccessible controls, or an unreliable handoff. Keep a
pull request focused on that problem. Do not add a backend, database, framework,
platform abstraction, or integration just to increase the stack.

Discuss new permissions, native code, storage, or adapters in an issue before
implementation. A short explanation of the need and alternatives is enough.

Keep these existing boundaries:

- Privileged work stays in main; validate data at IPC and subprocess boundaries.
- Use exact endpoint/pane identity, not a title, working directory, or active pane.
- Never retry an uncertain Stage, submit automatically, or turn a failed
  clipboard write into a successful fallback message.
- Keep screenshots, note text, clipboard contents, terminal output, and local
  paths out of logs and public reports.

Use the existing TypeScript, Oxlint, and formatter settings. Add the smallest
regression test that catches the bug; a documentation change does not need a new
test framework. Do not remove a regression test just to reduce a count.

## Dependencies

Pin direct dependencies and toolchain versions. Update the lockfile with the
pinned npm, and run the audit and affected tests. A newer major version is not a
reason to ignore a build tool's peer requirements.

## Pull requests and docs

Explain what changed, why, how you tested it, and any known limits. Separate
scripted tests from physical observations. Mention checks you did not run.

Update the document that owns the information:

| Information | Document |
| --- | --- |
| First look and source setup | [README](README.md) |
| Daily use and connection help | [Usage](docs/usage.md) |
| Implementation and durable decisions | [Architecture](docs/ARCHITECTURE.md) and linked ADRs |
| Test commands and evidence | [Testing](docs/testing.md) |
| Release preparation | [Releasing](docs/releasing.md) |
| Next priorities | [Roadmap](ROADMAP.md) |

Link instead of repeating. Keep temporary plans, run-by-run updates, and review
notes in the relevant issue or PR. Remove superseded instructions in the same
change as their replacement. Do not put job-search claims, generated marketing
copy, or unsupported performance numbers in product documentation.

Contributions are distributed under the [MIT license](LICENSE).

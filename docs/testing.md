# Testing

Run the smallest checks relevant to a change. Record what they exercised instead
of treating every green test as proof of desktop or agent compatibility.

## Code and built UI

From a checkout using the [pinned toolchain](../CONTRIBUTING.md#development):

```bash
npm run check
npm run build
npx --no-install playwright install chromium --only-shell
node --test tools/acceptance/ui.test.cjs
npm audit --audit-level=high
```

`check` runs Oxlint, TypeScript, Vitest, and the Node helper tests. Browser fixtures
run the production-built renderer with synthetic bridges. They cover selection,
review, explicit destination choice, pending results, and recovery; they do not
capture the screen or access the OS clipboard.

Formatting is separate: `npm run format:check`. Its configured patterns do not
include Markdown. Review Markdown rendering and relative links when editing docs.

## Native transport and lifecycle

On macOS, the WezTerm native test is enabled only when the test executable and mux
server paths are supplied. [prepare-wezterm.cjs](../tools/acceptance/prepare-wezterm.cjs)
provides the checksum-pinned disposable fixture used in CI. It does not install
WezTerm or open an agent. The test routes distinct payloads between two receivers
and tests endpoint replacement. Without those inputs it is skipped, not a native
pass.

After packaging on macOS:

```bash
npm run package:mac
node tools/acceptance/lifecycle.cjs
```

This launches the actual package and checks its bridge, native ACL helper,
duplicate-launch behavior, and renderer recovery. The full saved-connection
restart checks require the WezTerm fixture; a local run without it reports that
limitation. The `--capture-workflow` option also exercises native screenshot,
scripted pointer selection, Stage to a byte receiver, and separate Reveal. That
option requires existing Screen Recording permission and the fixture, and
replaces the image clipboard. Neither mode proves a real agent attached an image.

## Capture and resource measurements

These commands need a macOS desktop and existing Screen Recording permission.
**They replace the clipboard.** Quit other ScreenFling builds and use synthetic
content. Do not interact with the unattended run.

```bash
npm run acceptance:capture:package
```

The default runner warms up, measures 20 Copy workflows, performs 200
cancellations, and takes resource samples after a cooldown. For the separate
200-completed-capture soak, use the same package:

```bash
npm run acceptance:capture -- --capture-runs=200 --cancel-runs=200
```

The report contains sanitized counts, timings, geometry, and resource samples.
It cannot establish metrics it does not measure, such as complete native image
allocation or listener stability. Manual rescue invalidates unattended evidence.
Physical shortcuts, pointer input, permission changes, display hardware, and
agent behavior belong in the [operator checklist](acceptance/macos-operator-acceptance.md).

## Timing means two different things

The 150 ms software target combines selection-release-to-visible-review and
explicit-Copy-to-verified-clipboard. Report review dwell and total elapsed time
separately. Physical shortcut-to-interactive-overlay has its own 150 ms p95 target.
Use at least 20 warm samples and nearest-rank p95 for physical measurements.

The normal capture command enforces its timing target. Hosted CI uses
`--observe-timing`: functional failures still fail the job, but a timing miss is
retained in JSON and reported as a warning. **A green hosted job is not a
performance acceptance pass.** Do not omit slow samples or rename scripted input
as physical interaction.

## What CI runs

[check.yml](../.github/workflows/check.yml) is the executable source of truth.
Both macOS and Windows run the code checks, audit, build, and built-UI fixtures.
The macOS job also prepares the native WezTerm fixture.

Main pushes and PR branches prefixed `release/` additionally run native packaging;
macOS adds signature checks, packaged lifecycle/capture, and a retained candidate.
Other PRs do not run those package steps. The PR workflow has read-only repository
permissions and no signing credentials. Windows packaging is not Windows native
capture or routing acceptance.

## Recorded evidence, not a rolling scorecard

For application commit `b7e321217faf94ee2016217405f3c39e1e872cb6`,
[main run 34994356800](https://github.com/d-sandhu/screenfling/actions/runs/34994356800)
passed functional checks. Its retained capture report recorded **184.5 ms software
p95**, above the **150 ms** target. This remains a miss; documentation cleanup does
not change it. Check current runs for later commits instead of copying old test
counts into the README.

The real-Codex attachment work in
[PR #52](https://github.com/d-sandhu/screenfling/pull/52) is separate from that main
commit. It is not a supported-agent claim.

Useful historical records remain at their immutable pre-cleanup paths:

- [Packaged soak](https://github.com/d-sandhu/screenfling/blob/b7e321217faf94ee2016217405f3c39e1e872cb6/research/phase-18-packaged-capture-results.md): 200 Copy and 200 cancel runs on the recorded artifact.
- [Physical shortcut measurements](https://github.com/d-sandhu/screenfling/blob/b7e321217faf94ee2016217405f3c39e1e872cb6/research/phase-20-shortcut-latency-results.md): both the initial miss and later pass, not a cross-machine guarantee.
- [Pinned transport decision](adr/0003-pinned-wezterm-transport.md): a reproduced endpoint race and its regression coverage.
- [Full research snapshot](https://github.com/d-sandhu/screenfling/tree/b7e321217faf94ee2016217405f3c39e1e872cb6/research): the original plans, sources, and results, including failures and unfinished work.

Do not transfer historical passes to a rebuilt artifact. Put new sanitized
observations in the relevant PR or issue, linked to the exact commit and artifact.

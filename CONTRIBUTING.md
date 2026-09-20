# Contributing

[Run the app](README.md#run-from-source), reproduce a concrete problem, and keep
the fix small. Discuss a new permission, native component, or integration before
adding it. No extra framework, backend, or test job is needed for ordinary fixes.

## Development

[`.node-version`](.node-version) and [`package.json`](package.json) own the toolchain
versions and commands. Use the pinned npm for `npm ci` and lockfile updates.

Use `npm start` for development and `npm run package` for a local directory
package on a supported host. `npm run format:check` checks source/config
formatting, not Markdown.

## Checks

Run the checks affected by the change:

```bash
npm run check
npm run build
npx --no-install playwright install chromium --only-shell
node --test tools/acceptance/ui.test.cjs
npm audit --audit-level=high
```

`check` runs lint, TypeScript, unit tests, and helper tests. The browser suite uses
the built renderer with synthetic bridges; it does not capture the desktop or
use the OS clipboard. `npm run check:all` adds packaging, not every acceptance
check. The [workflow](.github/workflows/check.yml) defines which checks run in CI.

On macOS, [prepare-wezterm.cjs](tools/acceptance/prepare-wezterm.cjs) supplies the
checksum-pinned disposable fixture for native transport tests. Missing fixture
inputs mean those tests are skipped, not passed. After `npm run package:mac`,
`node tools/acceptance/lifecycle.cjs` checks the packaged app. Full saved-connection
restart checks need the fixture. Its `--capture-workflow` option additionally
needs Screen Recording permission and replaces the clipboard.

**Capture and agent runners have side effects.** They need a desktop, existing
permissions, and disposable destinations. Quit other builds and use only
synthetic content. `npm run acceptance:capture -- --capture-runs=200 --cancel-runs=200`
measures an existing package and replaces the clipboard. Do not interact with an
unattended run. [The release checklist](docs/acceptance/macos-operator-acceptance.md)
owns physical measurement rules and required observations.

Hosted timing observation does not establish reference-Mac performance. Keep
misses and unavailable cases; never lower a limit or retry uncertain delivery to
make a result green. [Issue #32](https://github.com/d-sandhu/screenfling/issues/32)
tracks release acceptance. [Historical results](https://github.com/d-sandhu/screenfling/blob/68baf5f74597284921dfb866dd256b4debff7add/docs/testing.md#recorded-evidence-not-a-rolling-scorecard)
remain tied to their original artifacts, not the next build.

## Pull requests

Explain the problem, the change, the checks run, and anything not checked. Add a
focused regression for a bug; do not remove a useful test just to reduce a count.

Keep privileged effects in main and validate boundary inputs. Route by exact
instance/pane identity. Preserve no automatic submission, no uncertain retry,
and separate Reveal. Never include private images, notes, local paths, terminal
output, or credentials in tests or public reports. See [Security](SECURITY.md).

## Documentation

Keep setup in [Usage](docs/usage.md), development here, and distribution in
[Releasing](docs/releasing.md). Put changing plans, check results, and compatibility
observations in issues or PRs. Link to implementation instead of maintaining
parallel architecture inventories, dependency lists, roadmaps, or test counts.
Check relative links and the rendered README after edits.

Keep UI previews labelled as fixtures until a real capture-to-agent demo exists.
Previous design records remain in [Git history](https://github.com/d-sandhu/screenfling/tree/68baf5f74597284921dfb866dd256b4debff7add/docs/adr).

Contributions use the [MIT license](LICENSE).

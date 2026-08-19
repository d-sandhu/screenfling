# ScreenFling Phase 1 scaffold/toolchain validation

Research date: 2026-08-19. Scope: Electron Forge stable, TypeScript/Webpack,
React, package metadata, tests, packaging, and CI. No scaffold was run and no
dependencies were changed.

Status: Superseded by the measured
[build-toolchain decision](forge-version-decision.md). The Forge facts remain
useful research, but the application scaffold now uses stable electron-vite and
electron-builder because the compatible graph supports TypeScript 7 and audits
cleanly.

## Verified facts

- Electron's current tutorial recommends `create-electron-app` when a
  one-command boilerplate is preferred. It recommends the latest Node.js LTS
  for development; Node is bundled in Electron for end users.
  [Electron prerequisites](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites)
- Forge's first-party stable template command for TypeScript + Webpack is:
  `npx create-electron-app@latest screenfling --template=webpack-typescript`.
  The template uses `@electron-forge/plugin-webpack` and TypeScript defaults.
  [Webpack + TypeScript template](https://www.electronforge.io/templates/typescript-%2B-webpack-template)
- React is not a separate stable Forge template. Forge's official React guide
  starts from the TypeScript + Webpack template, adds `jsx: "react-jsx"`,
  installs `react`/`react-dom` and their type packages, and wires a renderer
  entry with `createRoot`.
  [React with TypeScript](https://www.electronforge.io/guides/framework-integration/react-with-typescript)
- Forge supports `forge.config.ts` directly (without extra configuration) from
  Forge 7.8.1 onward, using `ForgeConfig`; the TypeScript config is otherwise
  equivalent to `forge.config.js`.
  [TypeScript configuration](https://www.electronforge.io/config/typescript-configuration)
- The Webpack plugin requires a main config and renderer config/entry points;
  the package `main` points to `./.webpack/main`, and TypeScript projects must
  declare the plugin's generated magic globals. The plugin provides renderer
  HMR and multiple-renderer support.
  [Webpack plugin](https://www.electronforge.io/config/plugins/webpack)
- Forge's lifecycle is `package` → `make` → optional `publish`; later commands
  cascade into earlier ones. `package` creates a platform executable bundle;
  `make` creates distributables in `out/make/`; makers determine installer or
  archive formats. Forge normally builds only the host platform/architecture.
  [Build lifecycle](https://www.electronforge.io/core-concepts/build-lifecycle)
  · [CLI](https://www.electronforge.io/cli)
- The npm `latest` channel is currently `create-electron-app` 7.11.2; the 8.x
  line is alpha (the npm page lists 8.0.0-alpha.10 separately). Forge's source
  README says the next major is being developed on `next` and alpha packages
  require the `@alpha` tag. Therefore Phase 1 should use stable 7.x, not alpha.
  [create-electron-app npm metadata](https://www.npmjs.com/package/create-electron-app?activeTab=versions)
  · [Forge source README](https://github.com/electron/forge)
- The Vite plugin is still explicitly experimental in the current Forge
  development line: the Forge release notes record a change to mark it
  experimental, and the current alpha line is where Vite 7/8 and ESM work is
  being developed. This confirms the Phase 1 choice of Webpack; do not migrate
  to `--template=vite-typescript` for the stable scaffold without a new
  decision.
  [Forge releases](https://github.com/electron/forge/releases)
- Forge does not prescribe a project test runner. Electron's testing guidance
  requires a virtual display (for example Xvfb) for GUI tests on headless Linux;
  macOS and Windows do not need that Linux workaround. Forge recommends a
  cross-platform CI service such as GitHub Actions when the required build
  hosts are unavailable locally.
  [Electron headless CI testing](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci)
  · [Forge build lifecycle/CI](https://www.electronforge.io/core-concepts/build-lifecycle)
- GitHub publishing is a separate Forge publisher package and requires a token
  with repository contents write permission; GitHub Actions supplies
  `GITHUB_TOKEN`, but the workflow must declare the permission.
  [GitHub Publisher](https://www.electronforge.io/config/publishers/github)

## Recommendations for the scaffold

1. Scaffold with the stable `webpack-typescript` template, then add React using
   the official guide's `react-jsx` setup. Keep Forge's generated Webpack
   structure initially so the capture/routing harness can be packaged early.
2. Pin the resolved stable Forge/Electron/tool versions in the first scaffold
   commit and record Node LTS in contributor documentation. Use `npm` unless a
   package-manager decision is made first; Forge documents special hoisting
   requirements for pnpm and Yarn Berry.
3. Keep `package`, `make`, and `start` scripts from the template. Add a
   `test` script only after selecting the runner and defining the split between
   pure unit tests, Electron integration tests, and packaged smoke tests. Make
   the packaged smoke path a required Phase 1 check because permissions and
   desktop identity are part of the roadmap gates.
4. Begin with host-platform packaging in local development. Produce application
   artifacts only on native macOS and Windows runners, matching the Tier 1
   platform commitment. A Linux runner may host platform-neutral lint, type, and
   unit checks when useful, but Phase 1 must not publish or imply support for a
   Linux artifact. Keep platform-permission acceptance tests on native runners.
   Defer publishing/signing secrets and release workflows until the alpha
   release milestone.
5. Treat metadata as release-facing: use the product name `ScreenFling`, a
   stable reverse-DNS application identifier when the first packaged identity
   is chosen, an explicit license/repository/homepage, and `private: true`
   while the project is pre-release. Confirm the exact generated fields and
   Forge version in the scaffold PR rather than hand-copying a template's
   transient values.
6. The repository's roadmap requires strict TypeScript, formatter, tests, and
   Oxlint with the vendored generic anti-slop rules at error severity. The
   scaffold change should install and document that plugin from a clean
   checkout; this report intentionally does not copy or configure it.
   [Roadmap](../ROADMAP.md) · [Contributing](../CONTRIBUTING.md)

## Open decisions / validation gates

- Exact Electron version and Node LTS baseline must be selected and pinned;
  `@latest` is appropriate for discovery, not a reproducible lockfile policy.
- Choose the test runner and browser/Electron harness. The minimum contract is
  unit coverage for coordinate math/state/validation, integration coverage for
  clipboard and adapters, and packaged smoke tests for permissions and stable
  identity. Decide whether the runner is Node's built-in test API, Vitest, or
  another maintained option before adding dependencies.
- Choose the initial makers (macOS zip/dmg, Windows installer, Linux archive or
  package) and signing strategy. Maker choice is platform/release policy, not a
  requirement of the Webpack template.
- Decide whether CI should produce unsigned development artifacts in Phase 1 or
  only run package/make smoke checks. Do not enable Forge publishing until a
  release owner, repository permissions, signing identities, and secret-handling
  policy exist.
- Re-check Forge stable versus alpha status immediately before scaffolding; the
  evidence above is current on 2026-08-19, while the Vite/ESM work is explicitly
  moving in the alpha/`next` line.

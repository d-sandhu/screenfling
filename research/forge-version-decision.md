# Electron build-toolchain decision

Research date: 2026-08-19
Scope: the four options requested after the existing Forge/Webpack install reported 30 npm audit
advisories. All installs and audits below were run in temporary directories under `/private/tmp`;
the repository's dependencies and source were not changed.

## Decision

Do not move the application to Forge 8 alpha merely to make `npm audit` green. For the next scaffold
checkpoint, prefer **D: stable `electron-vite` plus `electron-builder`**, provided the team accepts
the packaging/configuration migration and first proves packaged macOS and Windows builds. Its
official documentation covers both the Vite build and electron-builder distribution path, and its
clean audit removes the known Forge 7 rebuild chain.

If keeping the already-written Forge configuration is more important than the audit result, **A
remains usable only as development tooling** after documenting the risk and isolating CI/build
machines. **B is a viable experiment, not the production default**: it is an alpha release with ESM
and Vite-8 migration work. **C is not recommended**: it keeps Forge 7's vulnerable dependency chain
and the Forge Vite plugin is still documented as experimental.

This recommendation is a decision gate, not permission to rewrite the current branch. Before
changing the scaffold, run the packaged capture and routing smokes on both Tier-1 platforms with the
candidate toolchain.

## Reproduced versions and audit results

The baseline uses the current branch's exact `package-lock.json`. Other rows keep the branch's
React, Electron, TypeScript, Vitest, Oxlint, and type-package choices where applicable, and replace
only the build/distribution stack.

| Option                                    | Exact build versions resolved                                                                                                   | npm audit: info / low / moderate / high / critical |  Total | Result                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------: | -----: | ----------------------------------------------- |
| **A. Forge stable + Webpack**             | `@electron-forge/*` `7.11.2`; `@electron/fuses` `1.8.0`; `webpack` `5.109.2`; `electron` `43.4.1`                               |                                 0 / 3 / 3 / 23 / 1 | **30** | Fails audit; existing baseline                  |
| **B. Forge 8 alpha + current Vite**       | `@electron-forge/*` `8.0.0-alpha.10`; `@electron/fuses` `2.1.3`; `vite` `8.2.1`; `electron` `43.4.1`                            |                                  0 / 0 / 0 / 0 / 0 |  **0** | Clean, but pre-release                          |
| **C. Forge 7 + experimental Vite plugin** | Forge `7.11.2`; `@electron/fuses` `1.8.0`; official Forge 7 Vite template pair resolved to `vite` `5.4.21`; `electron` `43.4.1` |                                 0 / 3 / 1 / 24 / 1 | **29** | Fails audit; plugin remains experimental        |
| **D. Stable non-Forge Electron Vite**     | `electron-vite` `5.0.0`; `vite` `7.3.6`; `@vitejs/plugin-react` `5.2.0`; `electron-builder` `26.15.3`; `electron` `43.4.1`      |                                  0 / 0 / 0 / 0 / 0 |  **0** | Clean, stable, but requires packaging migration |

Every row also passed `npm audit --omit=dev`: 0 advisories. The vulnerable packages in A and C are
development/build dependencies, not application runtime dependencies. In A, the critical `tar@6.2.1`
path is:

```text
@electron-forge/core@7.11.2
  -> @electron/rebuild@3.7.2
  -> @electron/node-gyp@10.2.0-electron.1
  -> tar@6.2.1
```

That means the advisory does not ship as ScreenFling runtime code in this dependency layout, but it
still affects developer and CI machines during install/rebuild/package operations. It is not
appropriate to suppress the critical finding or force a tar override without checking Forge
compatibility.

A clean install of D audits at zero advisories but currently emits upstream deprecation warnings for
`inflight`, `glob@7`, `rimraf@2`, and `boolean`. All four arrive through the latest stable
`electron-builder@26.15.3` graph (`@electron/asar`, `@electron/get`, or the bundled Windows packager),
not direct ScreenFling choices. Track them through electron-builder updates; do not force transitive
overrides without the packager owner's compatibility guarantees.

The stable Forge 7 Vite comparison used the version range from the official Forge 7 Vite-TypeScript
template. For context, replacing only that row's Vite with current `vite@8.2.1` produced 27
advisories, but that is not the documented Forge 7 template pairing and is not evidence that Forge 7
supports Vite 8.

## Verified first-party facts

- npm metadata reports `@electron-forge/cli` latest as `7.11.2` and its `alpha` tag as
  `8.0.0-alpha.10` ([npm package metadata](https://www.npmjs.com/package/@electron-forge/cli)).
- Forge's own release list labels `v8.0.0-alpha.10` **Pre-release** and lists `v7.11.2` as the
  latest stable release ([Forge releases](https://github.com/electron/forge/releases)).
- Forge's Vite TypeScript documentation explicitly classifies Vite support as experimental and warns
  that minor updates may contain breaking changes
  ([Vite + TypeScript template](https://www.electronforge.io/templates/vite-%2B-typescript),
  [Vite plugin](https://www.electronforge.io/config/plugins/vite)).
- Forge alpha release notes say the Vite plugin moved to Vite 8 and the alpha line includes
  ESM-related fixes; that is useful migration evidence, not a stability guarantee
  ([alpha release notes](https://github.com/electron/forge/releases/tag/v8.0.0-alpha.10)).
- `electron-vite`'s official guide documents its current stable `5.0.0` build tool, requires Vite 5
  or newer, and provides a separate electron-builder distribution recipe
  ([Getting Started](https://electron-vite.org/guide/),
  [Distribution](https://electron-vite.org/guide/distribution)). The valid D comparison therefore
  uses Vite 7, because `electron-vite@5.0.0` rejects Vite 8 via its peer range.
- npm's audit command obtains advisory data from the registry's audit service; the reproduction used
  `npm audit --json` after clean lockfile resolution
  ([npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit)). The critical A/C finding is the
  `tar` archive path-traversal/DoS advisory family, including
  [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw).

## Reversal triggers

Revisit this decision when any of the following becomes true:

1. Forge publishes a stable 8.x release and its Vite plugin is no longer experimental; repeat the
   same clean-install audit and packaged smoke tests.
2. Forge 7 publishes compatible fixes for the `@electron/rebuild`/`tar` chain, or npm audit changes
   severity/range after the owning packages release a supported remediation.
3. D fails a required macOS or Windows packaging, signing, update, capture, or routing smoke test
   that Forge passes without a product compromise.
4. The migration cost of D demonstrably exceeds the value of eliminating the build-machine risk,
   measured in the scaffold PR rather than assumed.

## Reproduction notes

Commands used for each temporary graph were equivalent to:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
npm audit --json
npm audit --omit=dev --json
```

No `--force`, `--legacy-peer-deps`, audit suppression, or dependency override was used. The
attempted D graph with `electron-vite@5.0.0` + Vite 8 was correctly rejected by npm's peer
resolution; it was not counted as a valid option.

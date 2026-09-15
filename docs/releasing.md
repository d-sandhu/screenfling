# macOS release preparation

There is no supported public release yet. Local test packages and notarized
distributions are different artifacts. Neither a successful build nor a valid
signature proves the capture-to-agent workflow works.

## Local test package

```bash
npm run package:mac
```

The result is under `release/mac-arm64/ScreenFling.app` on Apple Silicon
(`release/mac/ScreenFling.app` on Intel). It has an ad-hoc signature and is not
notarized. Use it for local testing, not as a trusted public download.
[CI candidates](usage.md#macos-test-builds) include checksums and commit metadata.

## Signed distribution

The existing [`release-macos.cjs`](../tools/release-macos.cjs) command requires an
Apple Silicon Mac, clean committed checkout, the exact Node/npm toolchain, Apple
Command Line Tools, an installed Developer ID certificate with its private key,
and an existing `notarytool` Keychain profile.

Set these in your local environment; do not commit credentials or private keys:

| Variable | Value |
| --- | --- |
| `SCREENFLING_SIGNING_IDENTITY` | Installed Developer ID certificate's 40-character SHA-1. |
| `SCREENFLING_APPLE_TEAM_ID` | Certificate's ten-character team ID. |
| `SCREENFLING_NOTARY_PROFILE` | Existing notarytool Keychain profile name. |

Inspect the command before running it:

```bash
npm run release:mac -- --help
npm run release:mac
```

The second command runs the audit, source/build/UI checks, and full packaged
restart checks with a temporary pinned WezTerm fixture. It signs with hardened
runtime and JIT-only entitlements, **uploads the signed app to Apple for
notarization**, requires an Accepted response, staples the ticket, and verifies
Gatekeeper and the extracted archive. It does not upload screenshots or publish
a GitHub release.

Successful output goes to
`release/distribution/<alpha-version>-<commit-prefix>/`, with the app ZIP,
`SHA256SUMS`, and `distribution.json`. Existing output and concurrent preparation
are refused. Inspect an interrupted `release/.release-preparing` state before
retrying; do not remove another run's lock.

Application versions are configured in `package.json`: `build.extraMetadata.version`
for the alpha version, and `build.mac.bundleShortVersion` / `bundleVersion` for
macOS identity. The root package version is not a release-readiness signal.

## Before publishing

Complete the applicable [operator checks](acceptance/macos-operator-acceptance.md)
on the final artifact, including the proposed agent/version/binding combination.
Keep the checksums, exact commit, signing state, and sanitized observations with
release notes. A credentialed signing/notarization run is still required; unit
tests of this script are not that evidence.

Publishing is a separate maintainer action after acceptance. Do not add signing
secrets or publication to pull-request CI, advertise a test build as notarized,
or bypass Gatekeeper to turn a failed check into a pass.

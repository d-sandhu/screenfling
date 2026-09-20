# Release preparation

There is no supported public release yet. Local test packages and notarized
distributions are different artifacts. Neither a successful build nor a valid
signature proves the capture-to-agent workflow works.

## Local macOS test package

```bash
npm run package:mac
```

The result is under `release/mac-arm64/ScreenFling.app` on Apple Silicon
(`release/mac/ScreenFling.app` on Intel). It has an ad-hoc signature and is not
notarized. Use it for local testing, not as a trusted public download.
[CI candidates](usage.md#macos-test-builds) include checksums and commit metadata.

## Signed macOS distribution

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

After its host, toolchain, source, and signing-identity checks, the second command
reinstalls dependencies from the committed lockfile, including build tools. An
installation failure stops preparation before building or signing. It then runs
the audit, source/build/UI checks, and full packaged restart checks with a
temporary pinned WezTerm fixture. It signs with hardened
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

## Windows test installer

On Windows, after completing the [source setup](../README.md#run-from-source):

```bash
npm run make -- --win --x64
```

This uses the existing NSIS target to produce `release/ScreenFling Setup <version>.exe`
and the complete `release/win-unpacked/` app folder. No custom installation script
or publication is involved. A local build without a signing identity is unsigned.

For a successful main run, the [Check workflow](../.github/workflows/check.yml)
retains both in its Windows `build-only` artifact, with the installer's `SHA256SUMS`.
The artifact identifies the tested commit and expires according to the workflow's
retention setting. Extract the entire artifact and compare the installer hash
before opening it:

```powershell
Get-ChildItem -File '* Setup *.exe' | Get-FileHash -Algorithm SHA256
Get-Content SHA256SUMS
```

Do not launch a mismatched file. For unpacked testing, open
`win-unpacked/ScreenFling.exe` and keep its other files beside it. The installer
and unpacked app are alternative ways to run the same build, not two apps to run
at once. CI builds the installer but does not install, launch, or uninstall it.
These unsigned candidates do not establish Windows native support. Do not disable
Windows security protections to make an installation pass.

## Before publishing

Complete the applicable [operator checks](acceptance/macos-operator-acceptance.md)
on the final artifact, including the proposed agent/version/binding combination.
Keep the checksums, exact commit, signing state, and sanitized observations with
release notes. A credentialed Apple signing/notarization run is still required
for trusted macOS distribution; unit tests of the script are not that evidence.
Windows installation, removal, and native behavior need separate acceptance.

Publishing is a separate maintainer action after acceptance. Do not add signing
secrets or publication to pull-request CI, advertise a test build as notarized,
or bypass Gatekeeper to turn a failed check into a pass.

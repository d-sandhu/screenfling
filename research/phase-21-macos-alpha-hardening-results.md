# Phase 21 — macOS alpha hardening results

Date: 2026-09-13

Status: repository checks passed; macOS alpha release acceptance remains open

This is dated engineering evidence, not a second roadmap. Current release gates
remain in [ROADMAP.md](../ROADMAP.md#immediate-implementation-sequence); the
[operator protocol](../docs/acceptance/macos-operator-acceptance.md) defines native
procedures and evidence classes.

## Source state and execution boundary

Work continued on `alpha/macos-hardening-2026-09-13` in
[PR #31](https://github.com/d-sandhu/screenfling/pull/31), based on verified main
`4c703f59382b483183b44679d8e578548ebbca44`. The existing branch was recovered at
`ce88e23e98360d543a914e45a1bcfe94aa20adb1`, 17 commits ahead of that main. Existing
commits were preserved. Non-fast-forward and content-SHA conflicts were inspected
instead of force-pushing or overwriting newer work. Nothing was merged into main.

The local execution environment was Linux without direct GitHub/npm network
access. Source changes used the authorized GitHub connector. Actual checks ran
in GitHub-hosted macOS arm64 and Windows jobs, not on the reference operator Mac.
No local test success, physical interaction, Screen Recording change, or
real-agent behavior is inferred from that environment.

## Observed verification

Implementation head: `e64328da839e05c1b193f26f7d0a87fd8ae4fdc6`.

[Check run 34790939621](https://github.com/d-sandhu/screenfling/actions/runs/34790939621)
completed successfully on both platforms. The PR test checkout was GitHub's
synthetic merge `2aae13747c2a4ddad2f5bac9e7648ad6971131de` into the unchanged main.
That test ref is not a repository merge or release.

| Check | Observed result |
| --- | --- |
| Clean dependency install and `npm audit --audit-level=high` | Passed on both platforms; macOS reported zero vulnerabilities. |
| Prettier, type-aware Oxlint, TypeScript | Passed on both platforms. macOS lint reported zero warnings and errors. |
| Vitest | macOS: 350 passed in 39 files, including real disposable native ACL fixtures. Windows check also passed; platform-specific skips are not native Windows acceptance. |
| Capture-runner helper tests | macOS: 12/12 passed. These test runner behavior, not physical screen capture. |
| Built production renderer fixtures | macOS: 14/14 passed. Windows fixture step also passed. Synthetic bridges, real browser DOM/pointer/keyboard interaction; no OS clipboard or agent dispatch. |
| Production build and directory package | Passed on macOS arm64 and Windows x64. Electron 43.4.1, electron-builder 26.15.3. |
| macOS ad-hoc signatures | `codesign --verify --deep --strict` passed for the application, separate strict verification passed for the bundled ACL executable, and bundle metadata reported `Signature=adhoc`. |
| Packaged macOS lifecycle smoke | Passed startup/secure bridge, bundled ACL gate, duplicate-launch rejection, one crashed idle renderer replacement, closed-window reopening, and unchanged workflow diagnostics. |

The runner used Node 24.13.0 and npm 11.19.0. The macOS runner image identified
itself as `macos-26-arm64`; the lifecycle report recorded `darwin`, `arm64`, and
OS release `25.6.0`. The packaged identity was `com.dsandhu.screenfling`,
`ScreenFling`, version `0.0.0`. This is still a pre-alpha candidate, not a versioned
compatibility release.

### Signature evidence is narrower than distribution acceptance

Earlier successful directory-package runs skipped signing because electron-builder
suppresses signing for pull requests. A built or launchable package was not
accepted as proof of its signature. The Check workflow now enables signing only
for the existing `package:mac` step, whose command fixes the identity to `-`, with
automatic identity discovery disabled. No certificate, signing secret, publishing
flag, or notarization credential is supplied.

The resulting bundle and helper passed signature verification. This does not
prove Developer ID trust, Gatekeeper acceptance, notarization, or stable TCC
permission behavior across rebuilt artifacts. Those are separate native or public
release concerns.

## Material changes and regressions fixed

### Capture and application recovery

Capture startup and overlay readiness are bounded. Cancellation settles without
waiting for stalled native work. A late completion from an abandoned capture may
release only that operation; it cannot close a newer overlay. Startup failure
recovers the main surface without a clipboard write.

The application has a single-instance boundary, background/reopen behavior, and
one bounded presentation-only renderer recovery. It does not replay capture,
Copy, Stage, or Reveal after a renderer failure. Repository lifecycle tests cover
workflow-sensitive activation and repeated failure. The packaged smoke proves
only idle renderer recovery; active capture or in-flight Stage recovery remains
an operator row.

### Trusted selector security

The small read-only macOS helper extends existing owner/mode/type and generation
checks to extended ACLs. It permits no ACL or deny-only ACLs and rejects grants,
read failures, malformed evidence, changed identity, timeout, and missing helper.
It emits only a fixed versioned success token. Its exact boundary is
[ADR 0002](../docs/adr/0002-macos-selector-acl.md).

A first full native test run exposed an important defect: `acl_get_link_np`
returns NULL for both an absent ACL and a failed read. Rejecting all NULL results
also rejected clean selectors. The fix requires a successful `lstatx_np` security
read and an explicit `filesec_query_property` presence check before interpreting
absence. Tests cover clean files, deny-only ACLs, extended grants despite mode
0600, file/socket/ancestor grants, and denied security reads. The denied-read
fixture changes only its own disposable file's ownership in hosted CI. It does
not alter a user's selectors or require elevated product runtime.

### Visible workflow and recovery

Built-renderer fixtures cover bootstrap failure, shortcut-status failure without
blocking button capture, late response/event ordering, scripted selection,
Escape cancellation, Copy without a destination, capability-gated Stage, an
explicit target with literal note, separate one-shot Reveal, stale-target manual
fallback, and refreshed selection invalidation without selecting a replacement.

An added regression test first failed on both platforms: a result event could
mount a disabled Done button before the Copy invocation settled, causing its
initial focus request to be lost. The result now receives keyboard focus once
per operation after the action settles. The test uses actual keyboard Enter,
not locator-assisted focus, to return to idle.

Invalid notes now show actionable validation, prevent Stage before invocation,
and permit correction. Copy remains image-only and usable even with an invalid
note. Copy-only text is explicit, Unicode note counts are consistent, and
uncertain-result guidance tells the user to inspect the destination before
manually pasting again. These changes do not add submission or target guessing.

### Verification hygiene

Removed the temporary self-mutating `.github/workflows/alpha-maintenance.yml`
and `tools/alpha-refresh.py`. CI no longer rewrites the working branch to format
or refresh dependencies. Check uses read-only repository permissions and does
not retain checkout credentials. The previous mutating failure-diagnostics step
was also removed.

Fixed the malformed parameterized ACL test input that initially blocked strict
TypeScript checking. Regressions were not hidden by loosening checks or removing
the failing cases. Earlier failed and action-required CI runs remain historical
records, not passing evidence.

## Documentation changes

README, PRODUCT, ARCHITECTURE, CONTRIBUTING, and the operator protocol were
corrected during this hardening branch to reflect the current implementation,
Copy/Stage cancellation boundary, uncertain-result handling, bounded recovery,
and native evidence limits. ADR 0002 records the measured native security need
and the corrected absence-versus-read-failure behavior.

The roadmap's accumulated phase-by-phase status prose was consolidated into
current capture/routing summaries and links to the original evidence. Completed
Reveal, ACL implementation, the Phase 18 soak, and the Phase 20 shortcut result
are no longer presented as unimplemented tasks. The roadmap still preserves
open native gates, the unresolved timing definition, and the original release
criteria. No historical research or acceptance record was deleted or archived.

## Pull-request review at this point

PR #31 had no submitted reviews or review comments when inspected. Other open
PRs were kept separate and were not merged:

| PR | Change | Observed Check result and disposition |
| --- | --- | --- |
| [#26](https://github.com/d-sandhu/screenfling/pull/26) | Zod 4.5.4 | Green; separate dependency review. |
| [#27](https://github.com/d-sandhu/screenfling/pull/27) | Oxlint 1.80.0 | Green; separate dependency review. |
| [#28](https://github.com/d-sandhu/screenfling/pull/28) | Node types 26.4.0 | Green does not resolve the documented Node 24 runtime mismatch; hold. |
| [#29](https://github.com/d-sandhu/screenfling/pull/29) | React Vite plugin 6.1.1 | Both platforms fail at `npm ci`; do not bypass the documented toolchain hold. |
| [#30](https://github.com/d-sandhu/screenfling/pull/30) | Vite 8.2.2 | Both platforms fail at `npm ci`; do not mix this major upgrade into alpha hardening. |

The corresponding observed Check runs were 33635587119, 33635609179,
33635664352, 33635715363, and 33635735940. These are dated results, not a promise
that subsequent dependency heads remain green.

## Release decision

**Not yet a supported macOS alpha.** Repository-level implementation, hardening,
and available automated checks have been completed for the recorded candidate.
The remaining evidence requires an operator Mac, physical/native interaction,
actual terminal/agent configurations, or a maintainer acceptance decision. Such
testing can still expose defects that require code changes.

No fresh physical capture, display matrix, TCC cycle, clipboard-preservation
observation, shortcut latency run, listener/native-allocation soak, native endpoint
replacement trial, visible no-focus/Reveal observation, real-agent attachment
trial, or repeated productivity comparison was performed in this CI session.
The existing Phase 18 and Phase 20 evidence remains valid for its exact recorded
artifacts, without being reclassified as acceptance of this changed candidate.

Use the canonical [remaining sequence](../ROADMAP.md#immediate-implementation-sequence)
for those gates. Windows native acceptance and public Developer ID/notarization
remain later release work, not reasons to expand the macOS alpha's scope.

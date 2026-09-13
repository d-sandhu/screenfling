from pathlib import Path
import re


def edit(name, old, new):
    path = Path(name)
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f'Expected one patch anchor in {name}: {old[:80]}')
    path.write_text(text.replace(old, new))


def section(name, start, end, replacement):
    text = Path(name).read_text()
    left = text.index(start)
    right = text.index(end, left)
    Path(name).write_text(text[:left] + replacement + text[right:])


# Recovery messages must not invite duplicate attachments or claim an outcome
# that the process cannot prove. Update production strings and exact tests.
replacements = {
    'ScreenFling could not verify the image on the clipboard, so Stage stopped.':
    'ScreenFling could not verify the image on the clipboard. No Stage was attempted. Check the clipboard before trying again.',
    'ScreenFling could not confirm the destination operation. The image remains on your clipboard for manual paste.':
    'ScreenFling could not confirm the destination operation. Check the chosen destination before pasting again. The image remains on your clipboard for manual paste.',
    'Input was dispatched to ': 'Stage was attempted once for ',
    ' without submission. Attachment could not be verified; the image remains on your clipboard for manual paste.':
    ' without Enter. Attachment could not be verified. Check that destination before pasting again. The image was verified on your clipboard.',
}
for name in ['src/renderer/src/delivery-copy.ts', 'src/renderer/src/delivery-copy.test.ts']:
    for old, new in replacements.items():
        edit(name, old, new)
edit('src/renderer/src/delivery-copy.ts',
     'The display changed or ScreenFling could not read its pixels.',
     'Capture could not become ready, or the display changed. Choose Done and try again. Nothing was copied or staged.')
edit('src/renderer/src/delivery-copy.ts',
     'ScreenFling stopped safely before delivering anything.',
     'ScreenFling could not confirm the outcome. Check the clipboard and chosen destination before trying again.')
with Path('src/renderer/src/delivery-copy.test.ts').open('a') as file:
    file.write('''\nit("does not claim that an unexpected outcome had no side effects", () => {
  const copy = deliveryCopy({ status: "failed", reason: "unexpected" });
  expect(copy.detail).toContain("Check the clipboard and chosen destination");
  expect(copy.detail).not.toContain("before delivering anything");
});\n''')

# Test the extraResource that is actually shipped, not only out/native.
lifecycle = 'tools/acceptance/lifecycle.cjs'
edit(lifecycle, 'const { spawn } = require("node:child_process");', 'const { execFile, spawn } = require("node:child_process");')
edit(lifecycle, 'const net = require("node:net");', 'const { mkdtemp, rm, writeFile } = require("node:fs/promises");\nconst { promisify } = require("node:util");\nconst net = require("node:net");')
edit(lifecycle, 'const children = [];', 'const children = [];\nlet checkpoint = "package-identity";')
edit(lifecycle, 'async function main() {', '''async function verifyPackagedAcl(executable) {
  const execute = promisify(execFile);
  const helper = path.resolve(path.dirname(executable), "../Resources/screenfling-selector-acl");
  const directory = await mkdtemp(path.join(os.tmpdir(), "sf-package-acl-"));
  const file = path.join(directory, "selector");
  const options = { timeout: 3_000, maxBuffer: 256, env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" } };
  try {
    await writeFile(file, "synthetic", { mode: 0o600 });
    await execute("/bin/chmod", ["-N", file]);
    const accepted = await execute(helper, [file], options);
    assert.equal(accepted.stdout, "screenfling-acl-v1:trusted\\n");
    assert.equal(accepted.stderr, "");
    await execute("/bin/chmod", ["+a", "everyone allow write", file]);
    await assert.rejects(execute(helper, [file], options), (error) => error.code === 1 && error.stdout === "" && error.stderr === "");
  } finally {
    await execute("/bin/chmod", ["-N", file]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {''')
edit(lifecycle, '  const port = await reservePort();', '  checkpoint = "packaged-acl";\n  await verifyPackagedAcl(executable);\n  checkpoint = "application-startup";\n  const port = await reservePort();')
edit(lifecycle, '    const duplicate = launch(executable);', '    checkpoint = "single-instance";\n    const duplicate = launch(executable);')
edit(lifecycle, '    const replacementPromise = context.waitForEvent', '    checkpoint = "renderer-recovery";\n    const replacementPromise = context.waitForEvent')
edit(lifecycle, '    await replacement.close();', '    checkpoint = "closed-window-reopen";\n    await replacement.close();')
edit(lifecycle, '          startupAndHardenedBridge: true,', '          packagedAclGate: true,\n          startupAndHardenedBridge: true,')
edit(lifecycle, '''process.stderr.write('{"acceptance":"packaged-lifecycle","status":"failed","reason":"lifecycle-check-failed"}\\n');''', '''process.stderr.write(`${JSON.stringify({ acceptance: "packaged-lifecycle", status: "failed", reason: checkpoint })}\\n`);''')

# README is an entry point, not a second phase-by-phase roadmap.
section('README.md', '## Status\n', '## Intended workflow\n', '''## Status

ScreenFling is **pre-alpha**, not a supported macOS alpha yet. The joined
capture → selection → review → explicit destination → Copy/Stage → optional
Reveal flow is implemented. Copy verifies the image clipboard; Stage is a
single exact-pane attempt without Enter or automatic focus. Uncertain results
ask the user to inspect the selected destination before pasting again.

The application has a single-instance lifecycle, configurable shortcuts,
Screen Recording readiness and recovery guidance, bounded capture startup,
one presentation-only renderer recovery, and content-free in-memory diagnostics.
Images and notes are not persisted or sent to a ScreenFling service.

WezTerm remains an opt-in macOS developer experiment. Its native selector checks
reject unsafe ownership, modes, extended ACL grants, and unreadable ACLs. No
agent compatibility or verified attachment is claimed. Hardware, permissions,
endpoint replacement, visible focus, real-agent trials, and comparative dogfood
acceptance still gate the release.

The [roadmap](ROADMAP.md#immediate-implementation-sequence) is the current release
checklist. The [macOS operator protocol](docs/acceptance/macos-operator-acceptance.md)
defines physical evidence. [Contributing](CONTRIBUTING.md) gives build, fixture,
and packaged smoke commands. Historical research supports these documents; it
does not override their current status. macOS is first; Windows remains the next
Tier 1 target. Linux is outside this alpha.

''')
edit('README.md', 'ScreenFling distinguishes three actions:', 'ScreenFling distinguishes these actions:')
edit('README.md', 'If routing fails or cannot be verified, the capture remains available on the\nclipboard.', 'After a verified Copy, routing failure or uncertainty keeps the image available\nfor manual paste. Inspect the destination first to avoid a duplicate attachment.\nA clipboard-write verification failure cannot make that same fallback claim.')
edit('README.md', 'macOS ACL inspection, config semantic\nvalidation, visible focus behavior, and real-agent attachment remain acceptance\nwork rather than support claims.', 'The bundled read-only ACL gate permits no extended grants and fails closed on\ninspection errors. Actual selector/config semantics, visible focus behavior, and\nreal-agent attachment still require native acceptance; repository tests are not\nsupport claims.')

# Current architecture, without introducing speculative directory structure.
edit('docs/ARCHITECTURE.md', 'Last reviewed: 2026-08-24', 'Last reviewed: 2026-09-13')
edit('docs/ARCHITECTURE.md', 'ScreenFling will begin as one Electron application using strict TypeScript,', 'ScreenFling is one Electron application using strict TypeScript,')
section('docs/ARCHITECTURE.md', '## Repository shape\n', '## Process and trust boundaries\n', '''## Repository shape

One application package contains `src/main` for privileged modules, `src/preload`
for the narrow bridges, `src/renderer/src` for visible surfaces, and `src/shared`
for validated contracts and pure workflow rules. `tools/acceptance` contains
separate fixture and packaged runners. `tools/native/selector-acl.c` is a small
read-only macOS ACL inspector, not a capture rewrite or helper framework.

''')
section('docs/ARCHITECTURE.md', '## Core modules\n', '## Capture pipeline\n', '''## Core modules

- `CaptureController` and `WorkflowStore`: operation state, side-effect boundaries,
  cancellation, startup deadline, and capture environment recovery.
- `CaptureSession`, `ElectronCaptureBackend`, and `ElectronImageClipboard`:
  retained native pixels, measured geometry, and verified clipboard output.
- `CaptureOverlayWindow`: hidden preparation and selection surface lifetime.
- `DestinationRegistry` and `WezTermAdapter`: explicit routes, one-shot Stage,
  retained Reveal lease, and generation revalidation.
- `ShortcutManager`: bounded preference and registration transaction.
- `ApplicationLifecycle`: explicit activation, single presentation recovery,
  and no action replay. The main entry point acquires the single-instance lock.
- `WorkflowDiagnostics`: bounded content-free timing and outcome summaries.

''')
section('docs/ARCHITECTURE.md', 'The capture sequence is intentionally snapshot-first:\n', 'The first implementation allows selection within one display.', '''The capture sequence is intentionally snapshot-first:

```text
shortcut or explicit Capture action
-> hide the main window
-> identify the display under the pointer
-> prepare the hidden overlay and capture the display concurrently
-> join both preparations and load the frozen image
-> show the overlay only after the image is ready
-> select in display-local coordinates
-> crop in main using measured returned-image dimensions
-> review and optionally add a note
-> explicit Copy or Stage verifies the image clipboard
-> Stage alone attempts one selected exact destination
-> result, then optional separate Reveal
```

The overlay displays a frozen snapshot, not the live desktop. Both ScreenFling
surfaces remain hidden while pixels are captured. Hidden navigation overlaps a
fresh capture; no cached screen frame or native capture helper is used.

A 30-second operation-scoped deadline bounds startup, including missing renderer
readiness. Failure releases logical capture state, closes the overlay, and
restores the main surface without writing the clipboard. Cancellation settles
without waiting for a stalled backend. Late results cannot close a newer overlay
or reuse its operation. This does not forcibly abort an operating-system API.
The deadline is removed when selection is ready; it does not time out a user's
selection or review.

''')
edit('docs/ARCHITECTURE.md', 'A second shortcut while an operation is active is rejected.', 'A second shortcut never starts another active operation. It restores the existing\nready overlay or main surface; snapshot preparation remains hidden.')
edit('docs/ARCHITECTURE.md', 'invalidation, cancellation, and main-window recovery.', 'invalidation, cancellation, and capture-failure recovery.')
edit('docs/ARCHITECTURE.md', 'to its side effect or return `stale`; this avoids a check/use gap.', 'to its side effect or return `stale`; this narrows the check/use gap but does not\nmake an external CLI transaction atomic.')
edit('docs/ARCHITECTURE.md', 'not a compatibility claim; extended ACL inspection, exact-config semantics,\nvisible native trials, and real-agent trials remain release gates.', 'not a compatibility claim. A bundled, unprivileged ACL inspector rejects all\nextended grants and any ACL-read failure on lexical and canonical selector\npaths. The default deny-only ACL is allowed. The helper has bounded time/output\nand returns only a fixed versioned token. It is built and packaged on macOS only;\nsee [ADR 0002](adr/0002-macos-selector-acl.md). Exact installed selector/config\nsemantics, visible native trials, and real-agent trials remain release gates.')
edit('docs/ARCHITECTURE.md', '| `copied` | The image was written to the local clipboard. |', '| `copied` | The image was written to the local clipboard and pixel read-back was verified. |')
edit('docs/ARCHITECTURE.md', '| `dispatched-unverified` | Names the exact destination that accepted the adapter operation, but attachment or composer state could not be read back. |', '| `dispatched-unverified` | Names the exact selected destination of the single attempted dispatch. Attachment/composer state is unverified; a post-spawn error can leave acceptance uncertain. |')
edit('docs/ARCHITECTURE.md', '## Workflow diagnostics\n', '''## Application recovery

The single-instance lock is acquired before shortcut or workflow initialization.
A second launch activates only the existing surface. A crashed main renderer can
be replaced once without resetting the main-owned workflow, copying again,
replaying Stage, or consuming another Reveal. The old sender loses IPC authority.
Repeated crashes or a failed replacement stop the app rather than loop.
Renderer-only note text and a not-yet-staged destination selection are not
persisted; after a recovery the user must review and choose them again. Capture
pixels and an in-flight delivery result remain main-owned. Quit suppresses all
window recovery and disposes the shortcut.

## Workflow diagnostics
''')
edit('docs/ARCHITECTURE.md', 'The project tests behavior at three levels:', 'The project separates these evidence classes:')
edit('docs/ARCHITECTURE.md', '- integration harnesses for clipboard and destination dispatch;', '- built-renderer browser fixtures with synthetic bridges (not native capture);\n- integration harnesses for clipboard and destination dispatch;\n- disposable native ACL fixtures and packaged idle-lifecycle smoke checks;')

Path('docs/adr/0002-macos-selector-acl.md').write_text('''# ADR 0002 — read-only macOS selector ACL inspection

Status: accepted narrow security boundary; native tuple acceptance remains open

Date: 2026-09-13

## Problem

The configured WezTerm executable, config, socket, and their ancestors must not
be mutable through an extended ACL grant that Unix owner/mode checks miss.
Node's stat metadata does not expose macOS ACL entries. Parsing `ls -le` is not
an adequate substitute: Apple's implementation treats `acl_get_link_np` failure
as an absent ACL. A security check must distinguish that failure from no grants.

## Decision

Use one small unprivileged C executable calling the documented Darwin ACL APIs.
It accepts only a bounded list of absolute paths. It validates ACLs and permits
only deny entries; all allow entries, including owner-only grants, fail closed.
An unreadable/malformed ACL, changed identity during inspection, missing helper,
nonzero exit, timeout, or unexpected response disables this destination. Copy
remains available. The helper prints one fixed versioned success token and no
paths, principal identities, ACL text, screenshots, or notes.

Main continues to enforce owner, mode, type, canonical/lexical ancestors, private
socket parent, and generation checks. No permanent file, elevated runtime,
network service, new IPC authority, capture rewrite, or helper framework is added.
The executable is compiled by macOS Command Line Tools and included as a native
package resource. Windows does not build or run it.

## Evidence and limits

`macos-selector-acl.test.ts` contains real disposable-file checks for an extended
grant with unchanged private mode bits, default deny-only ACLs, missing paths,
and an ACL-read failure hidden by `ls`. The last fixture is CI-only and changes
ownership of its own disposable file, not a user's selector or host settings.
`trusted-wezterm-acl.test.ts` exercises grants on actual file/socket/ancestor
fixtures through the production selector reader. The packaged lifecycle runner
also executes the shipped helper against a disposable grant fixture.

These tests must pass in macOS CI. They do not approve a real WezTerm config,
agent binding, final endpoint race, or signed distribution identity. The strict
no-grant policy can reject otherwise safe custom ACLs; this is preferable to
interpreting an unproven effective-access policy for the experimental alpha.

## Sources

- [Apple ACL and BSD permission model](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemDetails/FileSystemDetails.html)
- [Apple ls ACL-read implementation](https://github.com/apple-oss-distributions/file_cmds/blob/main/ls/ls.c)
- [Architecture native-code gate](../ARCHITECTURE.md#native-code-gate)
''')

# Keep historical records, but give the current roadmap one unambiguous checklist.
edit('ROADMAP.md', 'Last reviewed: 2026-08-24', 'Last reviewed: 2026-09-13')
edit('ROADMAP.md', '## Milestone 0 — feasibility gates\n', '''For Milestone 1, Gate A and Gate B apply to the macOS tuple proposed for release.
Windows native rows remain required for the later Windows milestone; they do not
block the macOS alpha. Public signing/notarization remains distinct from a local
ad-hoc dogfood package.

## Milestone 0 — feasibility gates
''')
edit('ROADMAP.md', '- cancel and failure leave the previous clipboard unchanged;', '- cancellation and failures before clipboard writes leave the previous clipboard\n  unchanged; failed write verification must not claim the old clipboard survived;')
edit('ROADMAP.md', 'Exact user-triggered Reveal remains a separate adapter-specific slice\nand native acceptance row.', 'Exact user-triggered Reveal was implemented in Phase 12 below; its native\nactivation/visibility acceptance remains separate and open.')
edit('ROADMAP.md', 'A remains open for end-to-end selection-release timing, mixed-scale/negative', 'A remains open for end-to-end selection-release timing, mixed-scale/negative')
# Keep all phase evidence in place; label its chronology rather than deleting it.
edit('ROADMAP.md', '**Current evidence:** the packaged macOS prototype passed', '**Historical prototype evidence:** the packaged macOS prototype passed')
edit('ROADMAP.md', 'Those timings are provisional until repeated with the hardened\nrunner.', 'Those timings are historical and superseded by the hardened Phase 18\nrunner results below; they are not current production acceptance.')
text = Path('ROADMAP.md').read_text()
start = text.index('## Immediate implementation sequence\n')
Path('ROADMAP.md').write_text(text[:start] + '''## Immediate implementation sequence

The repository implements capture/review, explicit Copy/Stage, separate exact
Reveal, permission/readiness guidance, configurable shortcuts, sanitized local
diagnostics, bounded startup, single-instance behavior, and presentation-only
renderer recovery. Built-renderer fixtures cover the visible workflow. The macOS
selector gate now checks extended ACLs as well as owner/mode/type. Tests and a
packaged idle-lifecycle runner do not close the native rows below.

The Phase 18 **200-complete/200-cancel packaged soak already ran**. Do not reopen
that completed component measurement as if it never happened. Its working-set
and window evidence does not prove listener or native image-allocation stability,
and does not transfer automatically to a changed release candidate. Phase 20's
149.25 ms reference-host physical shortcut pass is also historical evidence for
its exact candidate, not a promise for every host or this new package.

Remaining macOS alpha gates, in execution order:

1. Run the static checks, browser fixtures, dependency audit, package build, and
   packaged lifecycle smoke on the exact candidate. Record actual CI results.
2. Run the operator protocol's Screen Recording grant/denial/revocation/restart
   rows on a stable package identity. Record managed/unknown states as unavailable
   when the host cannot produce them. Developer signing credentials and public
   notarization are not supplied by an ad-hoc CI signature.
3. Finish physical crop-pixel, mixed-scale, negative-origin, rotation when
   available, reconnect, sleep/wake, cancel-clipboard, shortcut conflict and
   persistence, and renderer-recovery observations. Repeat candidate performance
   and resource checks as affected by changes. Retain unavailable hardware rows.
4. Resolve the physical selection-release-to-clipboard measurement boundary:
   review and explicit Copy are intentional user steps. Report release-to-review,
   human review dwell, and Copy-to-verified-clipboard separately. Do not automate
   Copy or relabel scripted component timing as the physical <=150 ms row. That
   row remains open until its reviewed definition and direct evidence agree.
5. Run exact WezTerm selector/config, final endpoint replacement, no-focus,
   literal/control-input, stale/fallback, and separate Reveal visibility rows.
   The CLI has no atomic compare-and-send primitive; native race conformance is
   a release blocker, not something the pre-spawn guard alone proves.
6. Observe at least 30 alternating trials per proposed agent/version/binding
   tuple, with zero wrong-target writes and submissions. Unsupported/remapped
   bindings must remain safe. No agent support is claimed before this evidence.
7. Compare at least five complete workflows with five manual screenshot/paste
   workflows, then record repeated dogfooding and outstanding listener/native
   allocation evidence. Release only after all applicable M0/M1 criteria pass.

Use the [macOS operator protocol](docs/acceptance/macos-operator-acceptance.md)
as the procedure, not a separate new plan. Research remains supporting historical
evidence. No Linux, remote/browser integration, history, automatic Send, or broad
settings/native rewrite belongs in this alpha.
''')

edit('docs/PRODUCT.md', 'Last reviewed: 2026-08-20', 'Last reviewed: 2026-09-13')
edit('docs/PRODUCT.md', 'capture -> describe -> choose -> stage -> review', 'capture -> select -> review -> optional note -> choose -> Copy/Stage -> optional Reveal')
edit('docs/PRODUCT.md', '7. The image remains on the clipboard when staging is unsupported, uncertain, or\n   unsuccessful.\n8. Cancel leaves the clipboard and destinations unchanged.', '7. After a verified clipboard write, unsupported, uncertain, or unsuccessful\n   staging keeps a manual-paste fallback. A failed clipboard verification cannot\n   claim the same guarantee. Inspect uncertain destinations before pasting again.\n8. Cancel leaves the clipboard and destinations unchanged before the side-effect\n   boundary; cancellation is unavailable once clipboard or Stage work starts.')
edit('docs/PRODUCT.md', '- clear Screen Recording and automation-permission guidance;', '- clear Screen Recording and adapter-availability guidance; the current WezTerm\n  CLI adapter does not require macOS Automation permission;')

# Add runnable commands to the existing contribution guide, without another guide.
edit('CONTRIBUTING.md', '### Packaged capture acceptance\n', '''### Browser fixtures and packaged lifecycle smoke

On macOS, install Apple's Command Line Tools before building. `build:native`
compiles the small read-only ACL inspector; `start`, `build`, and `test` invoke it.
The helper is packaged on macOS only. It does not replace Electron capture.

After `npm run build`, run the built production renderer against synthetic bridges:

```bash
npx playwright install chromium
node --test tools/acceptance/ui.test.cjs
npm audit --audit-level=high
```

These tests cover selection, review, explicit target choice, Copy/Stage, separate
Reveal, stale results, and recovery. They do not touch the OS clipboard or prove
native capture, focus, permissions, or agent attachment.

After `npm run package:mac`, quit every other ScreenFling build and run:

```bash
node tools/acceptance/lifecycle.cjs
```

This launches the real package, checks its secure bridge and bundled ACL helper,
rejects a duplicate launch, replaces one crashed idle renderer, and reopens a
closed main window. It uses only disposable ACL fixtures; it does not capture
pixels or change Screen Recording. The diagnostics must remain unchanged.
Native tests and package smoke run in CI; only the disposable ACL-read-failure
fixture uses the hosted runner's non-interactive ownership-change capability.
Never perform that fixture on a user's real selectors.

### Packaged capture acceptance
''')

protocol = 'docs/acceptance/macos-operator-acceptance.md'
edit(protocol, 'Every row also names one evidence class: `unit`, `packaged-runner`,', 'Every row also names one evidence class: `unit`, `browser-fixture`, `packaged-runner`,')
edit(protocol, '## Stage 3 — Screen Recording matrix\n', '''### Non-capture automated checks

Separately run the built-renderer fixtures and packaged lifecycle smoke from
[Contributing](../../CONTRIBUTING.md#browser-fixtures-and-packaged-lifecycle-smoke).
Browser fixtures use synthetic bridges; packaged lifecycle checks the real idle
app, duplicate launch, one renderer crash, window reopen, and shipped ACL helper.
Neither is a capture, physical-input, permission, focus, or agent acceptance pass.
The v1 protocol's earlier rows do not inherit these new observations or transfer
a historical pass to a different artifact.

## Stage 3 — Screen Recording matrix
''')
edit(protocol, '| `A.lifecycle.sleep-wake` | Sleep/wake during snapshotting or selection; observe safe termination, no stale overlay or clipboard mutation, then a clean fresh workflow. |', '''| `A.lifecycle.sleep-wake` | Sleep/wake during snapshotting or selection; observe safe termination, no stale overlay or clipboard mutation, then a clean fresh workflow. |
| `A.lifecycle.second-instance` | Launch the exact app again during review and selection; it restores only the existing surface and creates no new capture, write, or shortcut owner. |
| `A.lifecycle.renderer-recovery` | In a controlled synthetic session, crash the main renderer during review and an in-flight Stage. The main-owned operation/result survives, no delivery replays, and the old renderer cannot act. Re-enter renderer-only note/selection before a new Stage. |''')
edit(protocol, 'Record the exact topology for each display row.', '''The selection-release-to-clipboard row predates explicit review. Keep it open
rather than skipping user review to meet a stopwatch target. Report physical
release-to-review, human dwell, and explicit Copy-to-verified-clipboard separately
until the reviewed acceptance definition resolves this boundary. A scripted
bridge-to-clipboard sample is not physical-selection evidence.

Record the exact topology for each display row.''')
edit(protocol, '| `B.selector.acl` | Record owner/mode/type plus extended ACL behavior on the actual selectors. Repository owner/mode tests are supporting evidence only. |', '| `B.selector.acl` | Record the actual selector policy, including the bundled helper and extended ACL inspection. An allow grant or inspection error must expose no route; use disposable fixtures, never modify real selectors merely to force a test. Native CI fixtures are supporting evidence, not approval of the installed tuple. |')
phase18 = next(Path('research').glob('phase-18-*results.md'))
edit(protocol, '- [Packaged runner result](../../research/phase-8-capture-lifecycle-results.md)', f'- [Hardened packaged runner result](../../{phase18.as_posix()})\n- [Historical, superseded provisional runner evidence](../../research/phase-8-capture-lifecycle-results.md)')

# Check local document paths touched here without fetching or following external URLs.
for name in ['README.md', 'ROADMAP.md', 'CONTRIBUTING.md', 'docs/PRODUCT.md', 'docs/ARCHITECTURE.md', protocol, 'docs/adr/0002-macos-selector-acl.md']:
    path = Path(name)
    for target in re.findall(r'\]\(([^)]+)\)', path.read_text()):
        if '://' in target or target.startswith('#'):
            continue
        if not (path.parent / target.split('#', 1)[0]).exists():
            raise RuntimeError(f'Broken local document target: {name}: {target}')

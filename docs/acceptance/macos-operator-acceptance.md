# macOS release checklist

Protocol: `screenfling-macos-operator-acceptance/v2`

Use this checklist before claiming support for a specific Mac, display setup,
terminal, and agent. It covers observations that automated tests cannot replace.
The [development guide](../../CONTRIBUTING.md#checks) owns automated check commands;
[issue #32](https://github.com/d-sandhu/screenfling/issues/32) tracks completion.
Existing row IDs are retained so older reports remain traceable.

## Before starting

Use only synthetic images and notes in disposable destinations. Get the
operator's agreement before changing permissions, shortcuts, displays, or agent
bindings, and restore those settings afterward. Quit other ScreenFling builds.
Do not use a production workspace or publish local paths, screenshots, terminal
transcripts, credentials, or real conversations.

Record the source commit, package SHA-256, application version and bundle ID,
signing state, Electron version, macOS version/build, CPU architecture, keyboard
layout, and each display's scale, bounds, and rotation. For routing tests, also
record the WezTerm and agent versions, configuration hash, and image binding.
Stop if the artifact or configuration changes during the test.

Use a known visual fixture for crop checks. Prepare two disposable agent panes
with the same title and working directory but different pane IDs. Keep an
unrelated application available to check focus behavior.

## Recording results

Every row needs a status and evidence class. Statuses are `passed`, `failed`,
`unavailable`, `not-run`, `discarded`, `open-native`, or `dispatched-unverified`.
Evidence classes are `unit`, `browser-fixture`, `packaged-runner`,
`human-shortcut`, `human-pointer`, or `human-observed`.

A missing monitor or policy state is `unavailable`, not a pass. No attempt is
`not-run`. Manual rescue, harness contamination, or uncertain cleanup invalidates
an unattended run. Keep failures and slow samples. An independent review of the
redacted results is required before using them as release acceptance.

Permission status does not prove captured pixels. Shortcut registration does not
prove physical delivery. Terminal write success does not prove image attachment
or foreground visibility. Ad-hoc signing does not prove notarization. Keep these
observations separate, including when several appear in the same CI job.

## Build and automated checks

Confirm the package matches the recorded source and identity
(`com.dsandhu.screenfling`), contains `Contents/Resources/app.asar`, and passes the
relevant [code, built-UI, and packaged checks](../../CONTRIBUTING.md#checks). Record signing and
notarization separately. `npm run check:all` runs code checks and packaging, not
all native acceptance rows.

Package once and identify that artifact before measurements. Running
`acceptance:capture:package` rebuilds it; use `acceptance:capture` to measure an
existing package. Automated capture replaces the clipboard and needs existing
Screen Recording permission. Do not touch the pointer or keyboard during it.

| Row | Required result |
| --- | --- |
| `A.capture.soak-complete` | 200 completed Copy workflows and 200 cancellations on the recorded package, clean cleanup, and no monotonic window, listener, or working-set growth. Supply evidence for each metric; the runner cannot prove metrics it does not expose. Native image-allocation stability needs separate evidence. |

The default runner's 20 completed captures do not satisfy that soak. Browser
fixtures and scripted native capture are useful checks, not physical input.
Packaged lifecycle can exercise scripted capture/Stage/Reveal when its explicit
capture option and fixture are supplied; a byte receiver is still not an agent.

## Screen Recording

Change only the recorded application's Screen Recording entry. Fully quit and
reopen it after grant, denial, or revocation. Record the observed permission
status, capture outcome, clipboard change, overlay cleanup, main-window state,
and restart boundary for each row.

| Row | Required result |
| --- | --- |
| `A.permission.not-determined` | With no previous decision for this package, attempt one capture and record the prompt or failure without inferring a grant. Otherwise mark unavailable. |
| `A.permission.denied` | Disable permission and restart. Capture gives useful guidance, leaves the clipboard unchanged, closes overlays, and recovers the main window. |
| `A.permission.granted` | Enable permission and restart. A physical capture returns a non-empty crop with correct dimensions through the verified clipboard path. |
| `A.permission.revoked` | Revoke a previous grant and restart. The next capture fails safely with the denial cleanup guarantees. |
| `A.permission.restricted` | On a host that can produce this policy state, check guidance and safe cleanup. Otherwise mark unavailable. |
| `A.permission.unknown` | Run only when Electron actually reports unknown. Record the outcome without renaming the state. Otherwise mark unavailable. |

## Capture, displays, and recovery

| Row | Required result |
| --- | --- |
| `A.shortcut.delivery` | A physical shortcut from another application starts exactly one capture. |
| `A.shortcut.latency` | At least 20 warm physical shortcut-to-interactive-overlay samples; nearest-rank p95 at or below 150 ms. Keep raw samples and any miss. |
| `A.shortcut.persistence` | After quit/relaunch, the saved shortcut still starts capture. |
| `A.shortcut.conflict` | A harmless, reversible conflict rejects the proposed binding and leaves the previous one usable. Restore the other shortcut owner. |
| `A.capture.single-display` | Physical center and edge drags crop the known fixture within one physical pixel. The overlay does not appear in the crop. |
| `A.capture.selection-timing` | At least 20 warm physical selections; combined release-to-visible-review and explicit-Copy-to-verified-clipboard software time has nearest-rank p95 at or below 150 ms. Retain each component, review dwell, and total elapsed time. |
| `A.capture.cancel-clipboard` | Cancel before side effects. A non-sensitive image sentinel on the clipboard remains unchanged when checked in a disposable image consumer. |
| `A.display.mixed-scale` | With two different display scales, the pointer-selected display and crop are correct. |
| `A.display.negative-origin` | A display placed left of or above the primary still produces the correct crop. |
| `A.display.rotation` | Crop orientation and bounds are correct on a rotated display; otherwise mark unavailable. |
| `A.display.reconnect` | Disconnect or change a display before a side effect. Capture stops safely with no stale overlay or write; a fresh capture then works. |
| `A.lifecycle.sleep-wake` | Sleep/wake during snapshotting or selection ends the old workflow safely, with no stale overlay or clipboard mutation; a fresh capture works. |
| `A.lifecycle.second-instance` | Launch the same app during selection and review. It restores the existing surface without another capture, write, or shortcut owner. |
| `A.lifecycle.renderer-recovery` | In a controlled synthetic session, crash the renderer during review and in-flight Stage. Main-owned state survives without replay; the old renderer cannot act. Re-enter renderer-only fields when needed. |

The v2 selection-timing row applies the
[reviewed timing decision](https://github.com/d-sandhu/screenfling/issues/32#issuecomment-5668974223).
It measures software separately from the human review dwell; it does not remove
review or convert old failed samples into passes. Scripted selection is not
physical-selection evidence. Record unavailable hardware rather than substituting
synthetic geometry tests.

## Exact Stage and separate Reveal

Use explicit pane IDs, never title, working directory, active-pane, or
most-recent fallbacks. Observe the selected and unselected destinations.

| Row | Required result |
| --- | --- |
| `B.stage.no-focus` | Stage to the selected pane while an unrelated application is frontmost. Neither terminal focus nor the unselected pane changes; nothing submits. |
| `B.stage.duplicate-metadata` | Alternate between panes sharing a title and working directory. Only the explicitly selected pane receives input. |
| `B.stage.literal-input` | Quotes, backslashes, Unicode, and key-like words appear once as literal note text, without submission. |
| `B.stage.control-input` | Newlines and representative control characters are rejected at the normal product boundary, with no unsafe dispatch or submission. |
| `B.stage.endpoint-replacement` | Restart or replace the selected endpoint before dispatch. The stale route is refused and the replacement receives zero bytes. Keep final-boundary native race tests as separate supporting evidence. |
| `B.selector.acl` | Record the installed selector/configuration policy. Extended allow grants and inspection failures expose no route. Use disposable fixtures; do not weaken real path permissions. |
| `B.selector.config-semantics` | Discovery and dispatch use the exact configuration and socket, not an implicit default. |
| `B.reveal.foreground` | Invoke Reveal separately with the terminal visible, minimized, hidden, and behind another app. Record CLI acceptance separately from actual visibility and focus. |
| `B.stage.fallback` | An unavailable route does not cause a retry or GUI fallback. Manual image paste remains available only after a verified clipboard copy. |

Stop immediately on a wrong-target write, unintended submission, unexpected
Stage focus change, retry, or unrequested fallback. Mark the row failed.

## Real agents and daily usefulness

For **each proposed agent/version/binding combination**, complete at least
30 alternating Stage trials across two idle disposable composers. Each trial
must show exactly one added image and one literal note in the selected composer,
no submitted turn, no change to the unselected composer, and an available
clipboard fallback. Record counts, including wrong-target writes and submissions.

When attachment cannot be directly observed or authoritatively read back, record
`dispatched-unverified`, not passed attachment acceptance. Even a passing human
observation does not change the application's unverified delivery label. Check
remapped and unbound bindings separately; do not guess a key or retry input.

Compare at least five complete ScreenFling workflows with five manual
screenshot/paste workflows using the same task. Record elapsed time and failures,
not a general productivity claim. Then repeat normal use across several working
days and record the friction that remains. A demo should show actual capture and
handoff; a rendered UI fixture must be labelled as such.

## Cleanup and report

Use normal Cancel or Done after each row, then quit at the end. For a stuck
overlay, press Escape once and allow bounded recovery. If it remains, stop the
row; a second Escape is emergency cleanup and makes the attempt discarded.
Normal quit comes next; Force Quit is a last resort, not a passing result.

Confirm no overlay, process, or registered shortcut remains. Restore changed
permissions, display layout, shortcut, clipboard sentinel, and agent binding.
Close disposable agents and remove only this session's fixtures. Uncertain
cleanup makes the affected row failed or discarded.

Keep raw working notes outside the repository. After redaction, put the summary
in the relevant issue or PR rather than adding another phase report. Use one
entry per row:

```yaml
protocol: screenfling-macos-operator-acceptance/v2
artifact:
  commit: <40-character source SHA>
  packageSha256: <SHA-256, or not-applicable-directory>
  version: <observed application version>
  bundleIdentifier: com.dsandhu.screenfling
  signing: <adhoc, signed, notarized, or unknown>
  electronVersion: <version>
host:
  macOS: <version and build>
  architecture: <arm64 or x64>
  keyboardLayout: <public name>
  displays: <dimensions, scale, bounds, rotation>
destination:
  weztermVersion: <version or not-run>
  configSha256: <hash or not-run>
  agentAndBinding: <product, version, binding or not-run>
rows:
  - id: A.permission.denied
    status: not-run
    evidenceClass: human-observed
    sampleCount: 0
    observation: pending
    cleanup: not-run
incidents: []
restoration: pending
redactionReviewed: false
independentReview: pending
```

Record start/end times and operator consent with the report. Add the detailed
permission outcomes and raw numeric timing/resource samples where applicable.
No unchecked row becomes a pass. The
[original v1 protocol](https://github.com/d-sandhu/screenfling/blob/b7e321217faf94ee2016217405f3c39e1e872cb6/docs/acceptance/macos-operator-acceptance.md)
and [historical results](https://github.com/d-sandhu/screenfling/blob/68baf5f74597284921dfb866dd256b4debff7add/docs/testing.md#recorded-evidence-not-a-rolling-scorecard)
remain available for comparison.

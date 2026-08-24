# macOS operator acceptance protocol

Protocol: `screenfling-macos-operator-acceptance/v1`

This is the canonical procedure for the native macOS evidence that repository
tests and the packaged runner cannot produce. It records one exact ScreenFling,
macOS, display, WezTerm, and agent tuple at a time. Completing this document does
not itself pass Gate A, Gate B, or the macOS alpha milestone; only direct evidence
for each applicable row does.

Do not use this protocol with private screenshots, source code, credentials,
terminal transcripts, real agent conversations, or a production workspace. Raw
screenshots and recordings stay outside the repository. Commit only a redacted
report containing public versions, hashes, dimensions, counts, categories, and
factual observations.

## Evidence rules

Use only these row statuses:

| Status | Meaning |
| --- | --- |
| `passed` | The exact required observation was made on the recorded tuple. |
| `failed` | The row ran and contradicted its pass condition. |
| `unavailable` | The host cannot provide the required state or hardware. |
| `not-run` | No valid attempt was made. |
| `discarded` | Intervention, harness failure, or uncertain cleanup invalidated the attempt. |
| `open-native` | The row has repository support but still lacks direct native evidence. |
| `dispatched-unverified` | Exact dispatch was observed, but image attachment could not be verified authoritatively. |

Every row also names one evidence class: `unit`, `packaged-runner`,
`human-shortcut`, `human-pointer`, or `human-observed`. Never merge different
classes into one pass. In particular:

- an Electron permission status does not prove pixels were returned;
- shortcut registration does not prove physical delivery;
- the packaged runner's button and bridge-driven selection do not prove a real
  shortcut or physical drag;
- a WezTerm CLI success does not prove visible focus or agent attachment;
- a fake receiver does not prove a real agent composer accepted an image;
- an ad-hoc package does not prove signing or notarization.

If ScreenFling behaves unexpectedly, stop the row. Do not keep clicking or
dragging in an attempt to rescue evidence.

## Stage 0 — authorize and record the tuple

Before changing permissions, shortcuts, displays, or destination fixtures,
confirm:

> I authorize this acceptance session, will use only synthetic content, and will
> restore every changed host setting when the session ends.

Record:

- commit SHA and, for a file artifact, package SHA-256;
- product name, version, bundle identifier, package type, and signing state;
- macOS version/build, architecture, keyboard layout, and display topology;
- Electron version;
- when Gate B is in scope, the exact WezTerm version, config hash, adapter
  availability, agent product/version, and image binding description;
- the initial Screen Recording, shortcut, display, clipboard-sentinel, and
  destination-fixture states as categories, never contents or local paths.

Use a fixed public or locally generated visual fixture and a harmless synthetic
note containing quotes, backslashes, Unicode, and a key-like word. Prepare two
disposable test destinations with deliberately duplicated titles and working
directories but distinct exact pane identities. Quit every other ScreenFling
build so the package identity and permission row are not ambiguous.

Stop if the package tuple differs from the tuple recorded in the report.

## Stage 1 — static package preflight

Confirm that this is the Stage 0 artifact, then run the repository's headless
gate and package inspection. Static success is preflight, not native evidence.

Required observations:

- `Info.plist` name, version, and `com.dsandhu.screenfling` identifier match;
- `Contents/Resources/app.asar` exists;
- signing and notarization are recorded separately as `adhoc`, `signed`,
  `notarized`, or `unknown`;
- `npm run check:all` passes for the exact commit.

Do not run `npm start`, `acceptance:capture`, or any GUI command as part of this
static stage.

## Stage 2 — unattended packaged runner

The packaged runner is a separate evidence class. Confirm that no one will
touch the keyboard or pointer while it runs, then invoke the documented default:

```bash
npm run acceptance:capture:package
```

It performs its own bridge-driven selection; the operator must not drag, click,
or press Escape. Preserve only the sanitized JSON report. Record its exact
capture/cancel counts, timing summaries, diagnostics, cleanup result, and stated
limitations.

The documented default is 20 completed captures and 200 cancellations. It does
not close the separate 200-complete-workflow soak. For that row, first use the
same packaged artifact, then run the existing CLI with explicit counts:

```bash
npm run acceptance:capture -- --capture-runs=200 --cancel-runs=200
```

Record `A.capture.soak-complete` separately from the default result and require
200 completed captures, 200 cancellations, clean cleanup, and no monotonic
window, listener, or working-set growth before it can pass. Resource samples
support only the metrics they actually expose; they do not prove native image
allocation release.

If an overlay remains or the runner fails, let its bounded cleanup terminate the
application. Any manual intervention makes the attempt `discarded`. Do not call
its button timing a physical-shortcut measurement or its bridge selection a
physical-drag measurement.

## Stage 3 — Screen Recording matrix

Confirm before every permission change:

> I am changing Screen Recording for the exact packaged identity and will restore
> its original state.

Use System Settings → Privacy & Security → Screen & System Audio Recording.
Fully quit and relaunch ScreenFling after a grant, denial, or revocation before
recording the next row.

| Row | Required action and observation | Pass condition |
| --- | --- | --- |
| `A.permission.not-determined` | Run only when the exact package has no prior decision; relaunch and attempt one real capture. | Record the prompt or failure, capture outcome, clipboard state, overlay cleanup, main state, and restart boundary without inferring a grant. Otherwise `unavailable`. |
| `A.permission.denied` | Disable the exact package, relaunch, check the readiness readout, and attempt one real capture. | Actionable guidance; no clipboard mutation; no retained overlay; main surface recovers. |
| `A.permission.granted` | Enable the exact package, relaunch, and physically capture the synthetic fixture. | A non-empty, correctly dimensioned result reaches the verified clipboard path. The readout alone is insufficient. |
| `A.permission.revoked` | Revoke the previously granted package, relaunch, and attempt capture. | The next capture fails safely with the same cleanup guarantees as denial. |
| `A.permission.restricted` | Run only if managed host policy can produce the state. | Restricted guidance and safe cleanup; otherwise `unavailable`. |
| `A.permission.unknown` | Run only if Electron returns `unknown`; attempt one real capture. | Record the same structured observations without relabelling the status. Otherwise `unavailable`. |

Restore the Stage 0 permission state before continuing. If restoration fails,
stop the session and mark cleanup failed.

## Stage 4 — physical shortcut and capture matrix

Confirm the previous shortcut and display configuration are recorded and
reversible.

| Row | Required direct observation |
| --- | --- |
| `A.shortcut.delivery` | With another harmless app frontmost, press the configured shortcut physically and observe exactly one operation. |
| `A.shortcut.latency` | On the recorded reference host, collect at least 20 valid warm physical shortcut-to-interactive-overlay samples and report nearest-rank p95. Pass at ≤150 ms; otherwise record the profiling evidence and credible path separately without claiming the target passed. |
| `A.shortcut.persistence` | Quit/relaunch and repeat physical delivery with the saved shortcut. |
| `A.shortcut.conflict` | Create one harmless reversible conflict; the candidate is rejected and the previous binding remains usable. Restore the conflict owner. |
| `A.capture.single-display` | Perform center and edge drags on a known fixture; crop edges are correct within one physical pixel and the overlay is absent from the result. |
| `A.capture.selection-timing` | On the recorded reference host, collect at least 20 valid warm physical selection-release-to-verified-clipboard samples separately from runner timing and report nearest-rank p95. Pass at ≤150 ms. |
| `A.capture.cancel-clipboard` | Place a non-sensitive image sentinel on the clipboard, cancel before side effects, and verify the same sentinel remains through a disposable image consumer. Record only unchanged/changed. |
| `A.display.mixed-scale` | Use two displays with different scale factors; the pointer-selected display and crop are correct. |
| `A.display.negative-origin` | Place a display left of or above the primary; the selected display and crop remain correct. |
| `A.display.rotation` | On an available rotated display, orientation and crop are correct. Otherwise `unavailable`. |
| `A.display.reconnect` | Change or reconnect a display during a pre-side-effect capture; it fails closed, leaves no stale overlay/write, and a fresh capture works after settling. |
| `A.lifecycle.sleep-wake` | Sleep/wake during snapshotting or selection; observe safe termination, no stale overlay or clipboard mutation, then a clean fresh workflow. |

Record the exact topology for each display row. Synthetic geometry tests or a
different monitor cannot substitute for unavailable hardware.

## Stage 5 — exact Stage and Reveal matrix

Confirm that two disposable WezTerm destinations and one unrelated frontmost
application are ready. Use exact pane identity. Do not use a focused-pane,
active-pane, title, working-directory, or most-recent fallback.

| Row | Required direct observation |
| --- | --- |
| `B.stage.no-focus` | Stage to the explicitly selected pane while another app is frontmost; the unselected pane and terminal focus do not change, and nothing submits. |
| `B.stage.duplicate-metadata` | Alternate exact routes between the two panes that share a title and working directory; metadata never changes routing identity. |
| `B.stage.literal-input` | Stage the synthetic quotes, backslashes, Unicode, and key-like word note; it remains literal and appears once without submission. |
| `B.stage.control-input` | Attempt notes containing newlines and representative control characters through the normal product boundary; each is rejected or normalized exactly as documented, with no unsafe dispatch or submission. |
| `B.stage.endpoint-replacement` | Replace/restart the selected endpoint before dispatch; ScreenFling refuses the stale route and sends zero bytes to the replacement. |
| `B.selector.acl` | Record owner/mode/type plus extended ACL behavior on the actual selectors. Repository owner/mode tests are supporting evidence only. |
| `B.selector.config-semantics` | Confirm the exact config and socket tuple used by discovery and dispatch; no implicit/default config participates. |
| `B.reveal.foreground` | Invoke Reveal separately across visible, minimized, hidden, and other-app-frontmost states. Record CLI/result acceptance separately from observed OS visibility/frontmost behavior. |
| `B.stage.fallback` | Make the CLI/route unavailable; no retry or GUI fallback occurs and Copy remains usable. |

Any unexpected focus change, Enter/submission, wrong-target write, fallback, or
retry is an immediate `failed` row and stop condition.

## Stage 6 — real-agent trials and product value

Confirm for each agent tuple:

> Both idle composers, the agent version, image binding, WezTerm version, and
> synthetic fixture are exactly the tuple under test.

Run at least 30 alternating Stage trials across the two disposable agent panes.
For every trial, record only booleans/counts for:

- selected composer showed exactly one image indicator;
- literal synthetic note appeared once;
- selected composer remained idle with no submitted turn;
- unselected composer received no image, note, or submission;
- clipboard fallback remained available;
- wrong-target count and submission count.

If image attachment cannot be observed or authoritatively read back, record
`dispatched-unverified`; do not upgrade it to verified Stage or `passed`. Run remapped and
unbound binding cases separately and preserve Copy rather than guessing a key or
retrying.

Separately record the elapsed time and success/failure count for at least five
complete ScreenFling workflows and five screenshot-plus-manual-paste workflows
using the same synthetic task. This is local comparative evidence, not a general
productivity claim.

## Stage 7 — cleanup and emergency recovery

After every row, prefer its prescribed Cancel or Done path. If an overlay is
waiting for physical selection, press Escape once and wait for the normal
bounded recovery. If it remains:

1. stop the row;
2. press Escape once more only as an emergency cleanup attempt;
3. record an incident and mark the row `discarded`;
4. use normal application quit next; Force Quit is the last resort and never a
   passing result.

Do not continue dragging or clicking a stuck overlay. At session end, confirm:

- ScreenFling exited and no overlay remains;
- its shortcut is no longer active after quit;
- permission, shortcut, display, clipboard sentinel, and agent binding are
  restored or explicitly reported otherwise;
- disposable panes, agents, sockets, and configs are closed or removed;
- no private artifact is staged for commit.

Any uncertain cleanup changes the affected row to `failed` or `discarded`.

## Redacted report template

Copy this section to a dated file outside the repository while running the
session. After review and redaction, a summary may be committed under
`research/acceptance/`.

```yaml
protocol: screenfling-macos-operator-acceptance/v1
run:
  startedAtUtc: YYYY-MM-DDThh:mm:ssZ
  endedAtUtc: YYYY-MM-DDThh:mm:ssZ
  operatorConfirmed: false
  independentReviewer: pending
artifact:
  commit: 40-hex-sha
  packageSha256: sha256|not-applicable-directory
  product: ScreenFling
  version: 0.0.0
  bundleIdentifier: com.dsandhu.screenfling
  packageType: directory|zip|dmg
  signing: adhoc|signed|notarized|unknown
  electronVersion: version
host:
  os: macOS
  osVersion: version
  architecture: arm64|x64
  keyboardLayout: public-name|unknown
  displayTopology: single|mixed-scale|negative-origin|rotated|other
destination:
  adapter: wezterm|not-run
  weztermVersion: version|not-run
  configSha256: sha256|not-run
  agent: product-and-version|not-run
rows:
  - id: A.permission.denied
    status: open-native
    evidenceClass: human-observed
    sampleCount: 0
    observation: pending
    observedPermissionStatus: not-applicable
    captureOutcome: not-applicable
    clipboardChanged: not-applicable
    overlayClosed: not-applicable
    mainIdle: not-applicable
    restartPerformed: not-applicable
    cleanup: not-run
    supportedClaim: none
incidents: []
restoration:
  permission: not-changed|restored|not-restored
  shortcut: not-changed|restored|not-restored
  display: not-changed|restored|not-restored
  clipboard: not-changed|restored|not-restored
  destinationFixtures: not-started|stopped|not-stopped
review:
  redactionPassed: false
  rowClaimsNoBroaderThanObservations: false
  noPrivateArtifactsCommitted: false
```

For each applicable row above, add one `rows` entry. The observation is a short
fact, not a conclusion or raw log. A `passed` row requires clean cleanup and an
independent review. Missing hardware is `unavailable`; no attempt is `not-run`;
operator rescue or harness contamination is `discarded`.

## Sources

- [Roadmap Gate A and Gate B](../../ROADMAP.md)
- [Architecture verification strategy](../ARCHITECTURE.md#verification-strategy)
- [Packaged runner result](../../research/phase-8-capture-lifecycle-results.md)
- [Electron `systemPreferences`](https://www.electronjs.org/docs/latest/api/system-preferences)
- [Electron `globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron `powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor)
- [Electron `screen`](https://www.electronjs.org/docs/latest/api/screen)
- [Apple Screen Recording settings](https://support.apple.com/guide/mac-help/allow-apps-to-use-screen-and-audio-recording-mchl592e5686/mac)
- [WezTerm CLI targeting](https://wezterm.org/cli/cli/index.html)
- [WezTerm `send-text`](https://wezterm.org/cli/cli/send-text.html)
- [WezTerm `activate-pane`](https://wezterm.org/cli/cli/activate-pane.html)

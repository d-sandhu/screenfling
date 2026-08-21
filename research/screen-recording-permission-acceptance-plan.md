# macOS Screen Recording permission acceptance plan

Research date: 2026-08-21

Target tree: `main`; Electron `43.4.1`; electron-builder `26.15.3`

Status: repository policy and recovery copy implemented in Phase 10; native TCC
acceptance remains open and Gate A is not closed.

## Implementation status

Phase 10 implemented the pure status policy, wired it into the existing
pre-enumeration and post-failure checks, and added tested denied/restricted copy
with the exact System Settings path and restart instruction. The existing
main-owned controller proves prepared-overlay cleanup, image release,
main-surface recovery, and zero clipboard writes. The acceptance runner still
does not expose Screen Recording status through a weakened renderer boundary;
the exact packaged denial, grant, revocation, Settings label, and restart rows
below remain human-operated.

## Decision

Implement one small permission-policy seam and one recoverable failure contract.
Do not add a native helper, ScreenCaptureKit backend, or an in-app attempt to
request Screen Recording permission.

Electron's `systemPreferences.getMediaAccessStatus("screen")` is a status query,
not a grant. It returns `not-determined`, `granted`, `denied`, `restricted`, or
`unknown` on macOS; Screen Recording consent is required on macOS 10.15 and
later. Electron's `askForMediaAccess()` accepts only `microphone` and `camera`,
so it cannot prompt for `screen`. ([Electron systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences),
[pinned Electron 43.4.1 source](https://github.com/electron/electron/tree/v43.4.1))

The current `ElectronCaptureBackend` checks `screen` status before source
enumeration and after an enumeration failure or empty image. Keep that behavior,
but move the pure status-to-policy decision out of Electron so it can be tested
without mocking the OS. `denied` and `restricted` should produce the existing
`permission-blocked` result. `not-determined`, `granted`, and `unknown` should
continue to the real capture attempt; status alone is not pixel evidence.

The UI contract for `permission-blocked` should say: “Screen Recording access is
off for ScreenFling. Enable it in System Settings → Privacy & Security → Screen
& System Audio Recording, then restart ScreenFling.” A pre-capture denial must
offer Done recovery and retain no image or clipboard data; Copy remains available
only when a capture exists. Do not claim that a status query opened Settings or
that permission was granted. Apple documents the user-managed toggle location,
and its ScreenCaptureKit sample explicitly requires an app restart after granting
access. ([Apple Support](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac),
[Apple ScreenCaptureKit sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos))

## Stable identity and lifecycle acceptance

TCC privacy state belongs to the packaged application identity. ScreenFling's
`appId` is `com.dsandhu.screenfling`, and the Phase 8 artifact observed that
identifier in `Info.plist`; a development Electron identity or a changed bundle
identifier is a different permission subject. Apple defines `CFBundleIdentifier`
as the unique bundle identifier used by the operating system for app preferences.
The acceptance runner must therefore record `CFBundleIdentifier`, product name,
version, `app.isPackaged`, and the exact `.app` path. Ad-hoc packaging is useful
for local evidence, but is not signed-release evidence. ([Apple CFBundleIdentifier](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleidentifier),
[Electron application packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution))

Grant/revoke is a human-operated host-state test: change the exact packaged app
in System Settings, quit the app completely, relaunch it, and perform a real
capture. A runner may read and record the status and result category, but must
not mutate TCC, infer permission from a mocked status, or log pixels, notes,
clipboard bytes, paths, or window titles. A late revocation should be handled as
the next capture's `permission-blocked`/capture failure; an already-returned
image may finish its clipboard or Stage side effect under the existing workflow
boundary. No claim is made here that Electron emits a permission-change event.

## Implementation checklist

1. [x] Add a pure `screenCapturePermissionPolicy(status, platform)` function. On
   non-macOS it returns `allowed`; on macOS it returns `blocked` only for
   `denied`/`restricted`, and `attempt` for the remaining documented values.
2. [x] Use that function in `ElectronCaptureBackend`; preserve the second status
   check after `getSources()` and on empty-image failure.
3. [x] Add a user-facing, sanitized `permission-blocked` result copy with a restart
   instruction. Keep existing overlay/main-window cleanup and clipboard
   preservation.
4. [ ] Extend the packaged acceptance output with status, bundle identity, and a
   boolean indicating whether the result was permission-blocked. Never emit
   user content or a permission database dump. Keep this open until native
   acceptance resumes; do not weaken the renderer boundary solely for automation.

No product Settings screen is required for this issue. A future “Open System
Settings” action may be evaluated separately; it is not needed to establish the
policy seam or acceptance evidence.

## Exact test table

| Case | Pure/unit assertion | Packaged/native evidence | Human-operated? |
| --- | --- | --- | --- |
| non-macOS + any status | Policy is `allowed`; no macOS denial is fabricated. | Native Windows capture remains a separate Gate A row. | No |
| macOS `not-determined` | Policy is `attempt`; no prompt/request API is called. | Record status, then capture outcome. | No |
| macOS `granted` | Policy is `attempt`; capture backend still validates sources and image. | Exact packaged app returns non-empty source/image. | No |
| macOS `denied` | Policy is `blocked`; no source enumeration or clipboard write. | TCC-denied packaged run yields `permission-blocked`; main surface recovers. | Set TCC state manually |
| macOS `restricted` | Policy is `blocked`; same cleanup and no side effect. | Only if host policy can produce this state; otherwise mark unavailable, not passed. | Usually admin/MDM state |
| macOS `unknown` | Policy is `attempt`; capture failure remains honest if the OS rejects it. | Record status and actual result; never relabel as granted. | No |
| Revoke while idle | Next capture rechecks and blocks/fails safely. | Revoke exact app, relaunch, capture. | Yes |
| Grant after denial | Existing process is not declared recovered solely by status. | Grant exact app, fully quit, relaunch, capture succeeds. | Yes |
| Bundle identity | Policy tests do not substitute identity. | Assert `com.dsandhu.screenfling`, product/version, packaged artifact. | Verify Settings names ScreenFling |
| Failure recovery | `permission-blocked` closes overlay, restores main surface, retains prior clipboard. | Packaged denial run checks result/idle/window invariants. | Observe once |

Headless repository tests can cover the policy matrix, cleanup, operation
boundaries, and sanitized diagnostic schema. They cannot prove macOS TCC,
System Settings labeling, bundle identity, restart behavior, compositor source
enumeration, or hardware capture. Those require the exact packaged artifact on a
macOS host. Electron documents that Windows reports `granted` for screen, so a
Windows “permission denial” row is not meaningful; test capture failure and
packaged capture separately. ([Electron systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences))

## Limitations and non-goals

- `getMediaAccessStatus` is a point-in-time indication, not proof that a source
  will be returned or that returned pixels are correct.
- Electron provides no `askForMediaAccess("screen")`; do not add a fake call,
  hidden browser permission request, or native helper to simulate one.
- Apple’s restart requirement is documented by the ScreenCaptureKit sample; the
  future native acceptance should verify it for this Electron thumbnail path
  rather than generalize beyond the observed host.
- The current ad-hoc `package:mac` artifact is not notarized/release-signed;
  do not use it to claim release identity stability.
- No native ScreenCaptureKit fallback is justified until the practical Electron
  path fails a measured acceptance row, consistent with the existing roadmap.

## Sources and repository evidence

Repository files read: [Roadmap](../ROADMAP.md), [Architecture](../docs/ARCHITECTURE.md),
[Phase 8 capture acceptance plan](phase-8-capture-acceptance-plan.md), [Phase 8 results](phase-8-capture-lifecycle-results.md),
`src/main/electron-capture-backend.ts`, `src/main/capture-controller.ts`,
`src/main/index.ts`, `tools/acceptance/capture.cjs`, `package.json`.

External sources: [Electron systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences),
[Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer),
[Electron packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution),
[Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit),
[Apple capture sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos),
[Apple CFBundleIdentifier](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleidentifier),
and [Apple Screen Recording settings](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac).

Context7 was used first with `/electron/electron`; its output was checked against
the linked Electron and Apple first-party documentation. Claims about pinned
Electron behavior should be rechecked if the Electron version changes.

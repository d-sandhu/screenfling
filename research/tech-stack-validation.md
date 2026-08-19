# ScreenFling production tech-stack validation

Research date: 2026-08-19

Status: Supporting research snapshot. Canonical decisions live in
[the product direction](../docs/PRODUCT.md),
[architecture](../docs/ARCHITECTURE.md), and [roadmap](../ROADMAP.md).

Scope: a serious open-source desktop application with first-class macOS and Windows support. Linux is optional and explicitly deferred. Ghostty is one possible destination adapter, not a product dependency.

## Executive decision

**Keep Electron + TypeScript + React + Node.js as ScreenFling's production stack.** It is the best current fit for a project whose first job is cross-platform screen capture, image clipboard handling, global shortcuts, fast overlay UI, subprocess-based terminal adapters, and signed macOS/Windows distribution.

Use native code only behind narrow interfaces after a measured Electron or Node limitation. Rust is a good default candidate for a later native helper, but the project should not create that helper before a real adapter needs macOS Accessibility or Windows UI Automation.

This is not a recommendation to make the product macOS-only or Ghostty-specific. The public contract should be:

```text
Tier 1: macOS + Windows
Optional later: Linux, with no parity or delivery promise
Destination adapters: capability-based and independently supported
```

Tauri 2 is credible, especially when binary size and idle memory dominate. It is not the better starting point here because Tauri has official shortcut, clipboard, window, updater, and packaging facilities but no official cross-platform desktop-capture plugin. ScreenFling would therefore need Rust/platform capture work at the beginning, while Electron already exposes the capture primitive directly. Fully native Swift/AppKit plus C#/WinUI would maximize platform control but create two applications and two contributor paths before the product has proven its routing value.

## Research method

Context7 was used first, as requested. The selected current documentation sets were:

- Electron: `/electron/electron`
- Tauri 2: `/tauri-apps/tauri-docs`
- xAI API: `/websites/x_ai`

Context7 queries covered capture, clipboard, global shortcuts, overlay windows, permissions, process boundaries, signing, updates, and xAI X Search. Claims were then checked against the owning projects' current documentation: Electron, Tauri, Apple, Microsoft, Node.js, Electron Forge, and xAI.

A live xAI X Search was also run to collect practitioner reports. Those X posts are kept in a separate, lower-confidence section. They are useful warnings and counterexamples, not proof of framework behavior and not a representative survey. The API credential was not recorded in the repository or copied into any example.

## 1. Documented facts

### Electron covers the shared desktop foundation

Electron provides the required primitives in one maintained cross-platform shell:

- [`desktopCapturer.getSources`](https://www.electronjs.org/docs/latest/api/desktop-capturer) enumerates screen and window capture sources in the main process.
- [`DesktopCapturerSource`](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source) includes a `NativeImage` thumbnail and, when available, a `display_id` corresponding to Electron's display ID. Electron explicitly says the returned thumbnail size is not guaranteed to equal the requested size, so ScreenFling must measure the returned image.
- [`screen`](https://www.electronjs.org/docs/latest/api/screen) exposes all displays, their bounds, and display scale information; it also provides platform-specific coordinate conversion helpers. Its documentation distinguishes device-independent points from physical pixels, which is essential for mixed-DPI crop accuracy.
- [`nativeImage`](https://www.electronjs.org/docs/latest/api/native-image) supplies image conversion and cropping, and [`clipboard.writeImage`](https://www.electronjs.org/docs/latest/api/clipboard) writes a `NativeImage` to the operating-system clipboard.
- [`globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut) works when ScreenFling is unfocused. Registration returns a success flag; shortcuts already claimed by another application can fail silently, so conflict UX is required.
- [`BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window) supports frameless, transparent, always-on-top, focusable, and click-through window behavior on macOS and Windows. Electron also documents limitations of transparent windows, so the capture spike must test the exact overlay configuration rather than assume identical compositor behavior.

These APIs establish feasibility, not pixel accuracy or latency. In particular, the capture image's actual dimensions and the selected display's DIP geometry must be mapped using measured ratios. A custom region capture should be treated as a workflow built on full-display capture plus crop, not as a single guaranteed Electron API call.

### Permissions are real product work

On macOS, Screen Recording permission is required for screen capture. Electron exposes its state through [`systemPreferences.getMediaAccessStatus("screen")`](https://www.electronjs.org/docs/latest/api/system-preferences). Electron also exposes whether the process is a trusted Accessibility client through `isTrustedAccessibilityClient`. Apple's native [ScreenCaptureKit sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos) likewise requires Screen Recording permission and an application restart after the first grant in its documented setup.

External application control is a separate permission and API surface from capture:

- Apple's [`AXUIElement`](https://developer.apple.com/documentation/applicationservices/axuielement_h) API is how assistive applications communicate with and control accessible macOS applications.
- Microsoft [UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview) exposes desktop UI elements through COM client interfaces and control patterns.

Electron does not provide a general AXUIElement or Windows UI Automation wrapper. Tauri does not remove this requirement either. A terminal's own CLI, socket, AppleScript dictionary, or structured agent API should be preferred over desktop-wide UI automation. Native Accessibility/UI Automation belongs in an optional adapter backend when no cooperative API exists.

### Electron has a mature distribution path

Electron recommends [Electron Forge for packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution). Forge combines packaging, makers, signing, and publishing, while Electron's [code-signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing) covers macOS signing/notarization and Windows certificates or Azure Artifact Signing. [`autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater) supports macOS and Windows, and macOS auto-updates require a signed application.

For an open-source project, Forge's [GitHub publisher](https://www.electronforge.io/config/publishers/github) can publish artifacts to GitHub Releases, and public GitHub repositories can use Electron's hosted update service. Release jobs still need native macOS and Windows runners for trustworthy platform packaging and signing.

The official Forge [Vite plugin remains marked experimental](https://www.electronforge.io/config/plugins/vite), with possible breaking changes in minor releases. The lower-risk initial build setup is therefore Forge's stable TypeScript/Webpack path. This choice does not prevent moving the renderer build to Vite later.

### Electron's security and performance costs are manageable, not imaginary

Electron embeds Chromium and Node and uses a browser-style [multi-process model](https://www.electronjs.org/docs/latest/tutorial/process-model). It will have a larger baseline distribution and memory footprint than a system-webview Tauri application. No framework-independent benchmark can predict the actual ScreenFling numbers, so claims should wait for packaged measurements.

Electron's [security checklist](https://www.electronjs.org/docs/latest/tutorial/security) requires sandboxed renderers, context isolation, no Node integration in renderers, a restrictive Content Security Policy, sender validation, and current Electron releases. Electron's [performance guide](https://www.electronjs.org/docs/latest/tutorial/performance) also warns against blocking the main process. Image encoding, slow adapter discovery, and native-helper I/O must not run synchronously on the main UI thread.

For ScreenFling, all renderer content can be bundled locally. There is no reason for the privileged application window to load arbitrary remote pages.

### Tauri 2 is capable, but capture changes the equation

Tauri's official ecosystem includes:

- a cross-platform [global-shortcut plugin](https://v2.tauri.app/plugin/global-shortcut/);
- an image-capable [clipboard plugin](https://v2.tauri.app/reference/javascript/clipboard-manager/) with `readImage` and `writeImage` on desktop;
- Rust [`command`](https://v2.tauri.app/develop/calling-rust/) functions callable from a web frontend;
- a signed [updater plugin](https://v2.tauri.app/plugin/updater/);
- macOS and Windows signing, installers, and [GitHub Actions guidance](https://v2.tauri.app/distribute/pipelines/github/).

Tauri uses the operating system webview—WebView2 on Windows and WKWebView on macOS—instead of shipping a common Chromium runtime. Its [process-model documentation](https://v2.tauri.app/concept/process-model/) correctly identifies the benefit, a smaller application, and the tradeoff: platform webview differences must be considered.

The current [official Tauri plugin catalogue](https://v2.tauri.app/plugin/) does not include desktop screen capture. ScreenFling would need to implement or adopt platform-specific capture code from the start. On macOS, true transparent webviews also require Tauri's `macos-private-api` feature and prevent App Store acceptance according to the [Tauri webview API](https://v2.tauri.app/reference/javascript/api/namespacewebview/). An opaque window displaying the already-captured desktop can avoid that particular restriction, but it does not remove the capture implementation work.

This does not make Tauri a poor framework. It means Tauri's strongest advantages are not aligned with ScreenFling's earliest technical risk. If most privileged logic later moves to Rust anyway and Electron's measured footprint becomes a product problem, Tauri becomes worth revisiting.

### Fully native applications maximize control and duplicate the product

Apple's [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit) provides high-performance, fine-grained macOS screen/window capture. Microsoft's [Windows.Graphics.Capture](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture) provides display/window frames and secure system selection UI. Microsoft recommends [WinUI 3 with Windows App SDK](https://learn.microsoft.com/en-us/windows/apps/) for new native Windows desktop applications.

A Swift/AppKit application and a C#/WinUI application would offer the shortest path to each platform's newest APIs. They would not share UI, lifecycle code, permission handling, updater integration, or most external-automation code. ScreenFling would pay that duplication before it knows which adapters users value. Native applications are therefore an optimization path for a proven product, not the right initial architecture.

## 2. Comparison for ScreenFling

The table below mixes documented capabilities with explicit architectural inference. “Best” means best fit for this project, not a universal framework ranking.

| Concern | Electron + TS/React/Node | Tauri 2 + TS/React/Rust | Separate Swift + WinUI apps |
| --- | --- | --- | --- |
| Full-display source capture | Built-in `desktopCapturer`; resolution/latency still need testing | No official capture plugin; native Rust/platform implementation required | Best direct access to ScreenCaptureKit and Windows.Graphics.Capture |
| Image clipboard | Built in | Official plugin | Native APIs |
| Global shortcuts | Built in | Official plugin | Native APIs |
| Region-selection UI | One consistent Chromium renderer; transparent/overlay behavior still needs platform tests | Shared web UI, but WKWebView/WebView2 differences and macOS transparency restriction matter | Two platform UIs |
| Terminal/CLI adapters | Node subprocess, filesystem, sockets, and npm ecosystem are immediately available | Rust implementation or permission-scoped shell/Node sidecar | Reimplemented per platform or shared through another core |
| AX/UI Automation | Requires native helper/addon | Requires native Rust/platform bindings | Direct platform access |
| Packaging, signing, updater | Mature Forge + Electron updater path | Mature Tauri bundler/updater path | Mature but duplicated paths |
| Runtime size/idle footprint | Structurally larger because Chromium and Node ship with the app | Structurally smaller because system webviews are reused | Potentially smallest per platform |
| Renderer consistency | Same Chromium engine on both Tier-1 platforms | Different OS webviews | Different native UI frameworks |
| Contributor entry cost | Most changes are TypeScript/React; native work is isolated | UI is TypeScript/React, privileged features require Rust | Contributors need Swift/macOS or C#/C++/Windows specialization |
| Fit today | **Best** | Viable fallback | Premature |

The key inference is that ScreenFling is integration-heavy, not compute-heavy. The main risk is reliable operating-system and destination behavior. Changing from Electron to Tauri does not eliminate native capture or automation complexity; it changes where that complexity is written.

## 3. Lower-confidence field evidence from X Search

The live xAI X Search found useful but anecdotal reports:

- An OpenCode maintainer described moving from Tauri to Electron for development speed and reliability ([post](https://x.com/brendonovich/status/2045114479244165151)).
- Another developer described system WKWebView/Safari behavior as a reason for switching to Electron ([post](https://x.com/stolinski/status/2024134641364709506)).
- Individual developers reported difficulty around Tauri macOS overlay/global-input work ([post](https://x.com/ostapondo/status/2089808108419752437)), dynamic transparent windows ([post](https://x.com/Likhith_1542/status/2035360976816730509)), global shortcuts ([post](https://x.com/sttk3com/status/2082300159694934339)), and Windows signing ([post](https://x.com/SamDarcyAI/status/2029925849235865677)).
- Counterevidence exists: one developer posted a favorable memory comparison for a small screenshot/tray Tauri app ([post](https://x.com/iStelios/status/2088579077271699881)), and another reported successfully shipping a small Tauri utility ([post](https://x.com/chenzeling4/status/2053472663662682602)).

These posts support two cautions already present in official documentation: system-webview differences are real, and Tauri can deliver much smaller utilities. They do not establish failure rates, framework quality, or what ScreenFling itself will measure. The stack decision does not depend on them.

## 4. Recommended production architecture

### Application stack

- **Electron**, pinned to a supported release and upgraded regularly.
- **TypeScript with strict checking** for the main process, preload boundary, core model, and adapters.
- **React** for settings, capture controls, target picker, preview, and later history. Keep the actual selection surface small—Canvas or SVG plus a thin React wrapper is enough.
- **Node.js in Electron's main process** for subprocesses, local files, sockets, terminal CLIs, AppleScript/PowerShell invocation, and helper supervision.
- **Electron Forge with the stable TypeScript/Webpack integration** for packaging initially. Reconsider Forge's Vite plugin when its experimental designation is removed or when its development-speed benefit clearly outweighs upgrade churn.
- **GitHub Actions on native macOS and Windows runners** for tests and signed releases.
- **Rust only when a native boundary is proven necessary.** Prefer a versioned, narrowly scoped helper rather than moving the application's domain model into Rust.

### Process and trust boundaries

```text
Electron main process
  application lifecycle
  permission state
  shortcut registration
  capture coordinator
  clipboard
  destination registry
  adapter subprocesses
  native-helper supervision

Sandboxed preload
  small, typed, validated commands/events only

Local React renderers
  selection overlay
  note + target picker
  settings/diagnostics

Optional native helper
  macOS AX operations OR Windows UI Automation
  no product state, UI, network access, or plugin loading
```

Renderer settings should include `nodeIntegration: false`, `contextIsolation: true`, and sandboxing. IPC messages need runtime validation, operation IDs, and sender checks. Screenshots and notes should never enter logs. No remote content should be loaded in privileged renderers.

### Capture backend contract

Keep capture behind a backend even though Electron is the initial implementation:

```ts
type CaptureBackend = {
  listDisplays(): Promise<DisplayInfo[]>;
  snapshotDisplay(displayId: string): Promise<CapturedFrame>;
};

type CapturedFrame = {
  image: NativeImage;
  pixelSize: { width: number; height: number };
  displayBoundsDip: Rectangle;
  capturedAt: number;
};
```

Crop coordinates should use the returned image's measured pixel dimensions divided by the selected display's DIP bounds. Capture the desktop before showing the overlay, then render the frozen frame beneath the selection mask. This prevents ScreenFling's own overlay from appearing in the screenshot and avoids depending on compositor exclusion behavior.

If Electron capture fails the acceptance gate, replace only `CaptureBackend` with ScreenCaptureKit on macOS or Windows.Graphics.Capture on Windows. A capture failure is not automatically a reason to rewrite the shell.

### Adapter strategy

Begin with compiled-in TypeScript adapters and a capability contract. Do not create a public executable-plugin ABI in the first release.

```ts
type DestinationCapabilities = {
  address: "exact" | "best-effort";
  imageInput: "clipboard-key" | "local-file" | "structured" | "none";
  textInput: "paste" | "structured" | "none";
  verification: Array<
    "target-live" | "composer-ready" | "image-attached" | "turn-completed"
  >;
  actions: Array<"copy" | "stage" | "send">;
};
```

An adapter can wrap tmux, WezTerm, Ghostty, iTerm2, a managed Codex session, or a future Windows control surface. Ghostty is just one entry. Prefer cooperative control surfaces—CLI, socket, AppleScript dictionary, structured API—over system-wide synthetic input. Add third-party plugins only after several real adapters show which API is stable; until then, an internal interface is easier to change and safer for a screenshot-handling application.

### Native helper rule

Do not build a generic “automation engine.” Add the smallest native surface needed by a supported adapter. Before choosing a standalone Rust helper, test how macOS TCC attributes Accessibility/Automation permission to the packaged app and nested helper. If a helper causes a second confusing consent identity, consider an in-process Node-API addon or a tiny platform-native component for that one function. On Windows, a Rust helper using UI Automation may be a clean fit. This decision is adapter-specific.

## 5. Validation gates before calling the stack settled

### Gate A: packaged capture quality

Test signed or release-like builds on real macOS and Windows hardware:

1. pre-create or prewarm the selection renderer;
2. capture each display at full physical resolution;
3. verify one-pixel crop edges on 1x and high-DPI displays;
4. test mixed scaling, negative display origins, rotation, sleep/wake, and display reconnect;
5. measure shortcut-to-interactive-overlay and release-to-clipboard p50/p95;
6. run at least 200 capture/cancel cycles and look for monotonic memory, listener, image, or window growth;
7. verify that cancel leaves the prior clipboard untouched.

The roadmap's latency targets are reasonable hypotheses, not guarantees. Record numbers in CI artifacts or a benchmark note; do not advertise them until packaged builds pass.

### Gate B: routing safety

For every adapter:

1. enumerate an exact target identifier;
2. revalidate it immediately before staging;
3. alternate at least 100 stages between two targets;
4. require zero wrong-target events;
5. never send Enter in a Stage path;
6. leave the image on the clipboard after failure;
7. distinguish `dispatched/unverified` from verified attachment.

The routing gate matters more to product validity than which terminal happens to be used during development.

### Gate C: distribution

- Build and smoke-test macOS arm64 and the Windows architecture chosen for Tier 1; add macOS x64/universal only if the intended user base justifies it.
- Sign and notarize macOS releases.
- Sign Windows installers to reduce avoidable SmartScreen friction.
- Publish checksums and a draft GitHub Release before promotion.
- Test update rollback/failure behavior before enabling unattended update installation.

UI-level capture and OS permission tests need real machines. Hosted CI remains useful for type checking, unit tests, adapter parsing fixtures, build reproducibility, packaging, and basic launch smoke tests, but it cannot substitute for TCC, multi-monitor, clipboard, and external-application acceptance runs.

## 6. xAI X Search: current official usage

xAI's current [X Search documentation](https://docs.x.ai/developers/tools/x-search) describes a server-side `x_search` tool on the Responses API. It performs keyword, semantic, user, and thread search over X. It is supported by the xAI SDK, OpenAI Responses-compatible SDKs, and the Vercel AI SDK.

A safe JavaScript request uses an environment variable, never a literal key:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

const response = await client.responses.create({
  model: "grok-4.6",
  input: "Find recent first-hand reports about Electron and Tauri desktop capture.",
  tools: [{ type: "x_search" }],
});

console.log(response.output_text);
console.log(response.citations);
```

The current docs use `grok-4.6`; model availability and aliases can change, so research automation should query the account's model catalogue or pin an explicitly supported model rather than treating `latest` as reproducible. X Search accepts `allowed_x_handles` or `excluded_x_handles` (up to 20, mutually exclusive), `from_date`/`to_date` in ISO 8601 format, and optional image/video understanding.

xAI's [citation documentation](https://docs.x.ai/developers/tools/citations) says the response's `citations` list is returned by default and inline citations can also be requested/returned. In the live research run used for this report, the answer contained usable inline X links while the top-level citations field was null. A production research collector should therefore preserve inline citation annotations/links and tolerate an absent top-level list.

Current [tool pricing](https://docs.x.ai/developers/pricing) charges X Search at **$5 per 1,000 tool calls**, in addition to model input, reasoning, and output tokens. Media understanding found through search is token-billed. One response may invoke the tool multiple times: the run used here reported 18 X Search calls, which corresponds to $0.09 in tool-invocation charges at the posted rate, plus tokens. Its inclusive `cost_in_usd_ticks` was 1,927,944,000; using xAI's documented conversion of 10,000,000,000 ticks per USD, the total billed cost was approximately **$0.193**. [Rate limits](https://docs.x.ai/developers/rate-limits) are per model and team tier across requests per second and tokens per minute.

X Search is useful for maintainer research and demand discovery. It should not be part of ScreenFling's runtime: that would conflict with the local-first, no-account, no-cloud core and add a variable-cost dependency unrelated to capture or routing.

## 7. Trigger points for changing the stack

Do **not** revisit the framework because of taste, one social post, or one difficult native adapter. Revisit it when evidence crosses one of these boundaries:

1. **Capture failure:** both Electron source-thumbnail and display-media/first-frame approaches fail the agreed pixel-accuracy or warm-latency gate on Tier-1 systems. First replace only the capture backend with native code.
2. **Overlay failure:** signed packaged Electron builds cannot reliably present and dismiss the selection overlay across supported macOS and Windows display configurations after a focused engineering spike.
3. **Footprint harms adoption:** measured installer size, idle resident memory, startup time, or battery impact repeatedly appears in user feedback or prevents the agreed product budget. Benchmark an equivalent Tauri vertical slice before migrating.
4. **Rust becomes the real application:** most new product work, adapters, and state move into Rust while the Electron/Node layer becomes a thin webview host. At that point Tauri can simplify rather than complicate the architecture.
5. **Distribution requirement changes:** a required store, enterprise deployment policy, sandbox, or entitlement is incompatible with the chosen Electron delivery path. Evaluate a native shell or Tauri against that concrete requirement.
6. **Two products emerge:** macOS and Windows workflows become materially different and the maintainer/community can sustain two specialized applications. Only then consider separate Swift and WinUI implementations.

Tauri should replace Electron only after a representative Tauri spike wins on the failed criterion while preserving capture quality, shortcut behavior, adapter reach, signed updates, and contributor maintainability. Native capture helpers are a normal extension point and do not by themselves invalidate Electron.

## Final stack decision

```text
Ship target:       macOS + Windows
Desktop shell:     Electron
Primary language:  TypeScript
UI:                React, with a small Canvas/SVG selection surface
Privileged runtime: Electron main process + Node.js
Packaging:         Electron Forge, stable TypeScript/Webpack path initially
CI/releases:       GitHub Actions on native macOS and Windows runners
Native code:       none initially; narrow Rust/platform helper only after a failed gate
Adapters:          compiled-in, capability-based; Ghostty is optional
Linux:             deferred/community-interest, no initial commitment
Cloud/xAI:         maintainer research only, never required by the product
```

**Conclusion:** the roadmap's core stack is valid for a serious open-source macOS-and-Windows product. The correction needed is scope and architecture, not a framework rewrite: define Tier-1 platforms, keep capture and destination adapters replaceable, validate packaged behavior on both operating systems, and make native code earn its way in through measured failures.

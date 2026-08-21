const { spawn, spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { chromium } = require("playwright");
const { z } = require("zod");

const packageMetadata = require("../../package.json");

const DEFAULT_CAPTURE_RUNS = 20;
const DEFAULT_CANCEL_RUNS = 200;
const DEFAULT_COOLDOWN_MS = 120_000;
const CAPTURE_WARMUP_RUNS = 3;
const SELECTION_COMPLETION_P95_TARGET_MS = 150;
const OVERLAY_ACTION_TIMEOUT_MS = 5_000;
const OVERLAY_EMERGENCY_CLOSE_TIMEOUT_MS = 1_000;
const OVERLAY_READY_TIMEOUT_MS = 5_000;
const MAX_RUNS = 1_000;
const portAddressSchema = z.object({ port: z.number().int().min(1).max(65_535) });
const processListSchema = z.string();
const viewportSchema = z.strictObject({
  width: z.number().finite().int().min(8),
  height: z.number().finite().int().min(8),
});
const imageDimensionsSchema = z.strictObject({
  height: z.number().finite().int().positive(),
  width: z.number().finite().int().positive(),
});
const macBundleSchema = z.object({
  CFBundleIdentifier: z.string().min(1),
  CFBundleName: z.string().min(1),
  CFBundleShortVersionString: z.string().min(1),
});
const expectedArtifact = z
  .object({
    build: z.object({ appId: z.string().min(1) }),
    productName: z.string().min(1),
    version: z.string().min(1),
  })
  .parse(packageMetadata);

function parseIntegerFlag(name, fallback, maximum = MAX_RUNS) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw.slice(prefix.length), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error("invalid-acceptance-argument");
  }
  return parsed;
}

function executableFlag() {
  const prefix = "--executable=";
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  return raw === undefined ? null : path.resolve(raw.slice(prefix.length));
}

function defaultExecutableCandidates() {
  if (process.platform === "darwin") {
    return [
      path.resolve("release/mac-arm64/ScreenFling.app/Contents/MacOS/ScreenFling"),
      path.resolve("release/mac/ScreenFling.app/Contents/MacOS/ScreenFling"),
    ];
  }
  if (process.platform === "win32") {
    return [path.resolve("release/win-unpacked/ScreenFling.exe")];
  }
  return [];
}

function resolveExecutable() {
  const explicit = executableFlag();
  if (explicit !== null) {
    if (!existsSync(explicit)) throw new Error("package-not-found");
    return explicit;
  }
  const candidate = defaultExecutableCandidates().find((path) => existsSync(path));
  if (candidate === undefined) throw new Error("package-not-found");
  return candidate;
}

async function readArtifactEvidence(executable) {
  if (process.platform === "darwin") {
    const plist = await import("plist");
    const contents = path.resolve(path.dirname(executable), "..");
    const asar = path.join(contents, "Resources", "app.asar");
    if (!existsSync(asar)) throw new Error("package-not-found");
    const bundle = macBundleSchema.parse(
      plist.parse(readFileSync(path.join(contents, "Info.plist"), "utf8")),
    );
    if (
      bundle.CFBundleIdentifier !== expectedArtifact.build.appId ||
      bundle.CFBundleName !== expectedArtifact.productName ||
      bundle.CFBundleShortVersionString !== expectedArtifact.version
    ) {
      throw new Error("artifact-identity-mismatch");
    }
    return {
      bundleIdentifier: bundle.CFBundleIdentifier,
      identityVerified: true,
      metadataSource: "packaged-info-plist",
      name: bundle.CFBundleName,
      version: bundle.CFBundleShortVersionString,
    };
  }
  if (process.platform === "win32") {
    const asar = path.join(path.dirname(executable), "resources", "app.asar");
    if (!existsSync(asar)) throw new Error("package-not-found");
    return {
      bundleIdentifier: null,
      identityVerified: false,
      metadataSource: "packaged-identity-unverified",
      name: null,
      version: null,
    };
  }
  throw new Error("unsupported-platform");
}

function percentile(values, fraction) {
  if (values.length === 0) throw new Error("empty-acceptance-sample");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(values) {
  return {
    count: values.length,
    minimum: percentile(values, 0),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: percentile(values, 1),
  };
}

function linearSlope(values) {
  if (values.length < 2) return 0;
  const averageIndex = (values.length - 1) / 2;
  const averageValue = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const centeredIndex = index - averageIndex;
    numerator += centeredIndex * (values[index] - averageValue);
    denominator += centeredIndex * centeredIndex;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = portAddressSchema.safeParse(server.address());
  if (!address.success) throw new Error("devtools-unavailable");
  const port = address.data.port;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose();
      else rejectClose(error);
    });
  });
  return port;
}

async function connectToApplication(port, child) {
  const endpoint = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("application-exited");
    try {
      return await chromium.connectOverCDP(endpoint, { timeout: 1_000 });
    } catch {
      await delay(250);
    }
  }
  throw new Error("devtools-unavailable");
}

function livePages(context) {
  return context.pages().filter((page) => !page.isClosed());
}

async function waitForWorkflowPhase(mainWindow, phase, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const snapshot = await mainWindow.evaluate(() => window.screenFling?.getSnapshot());
    if (snapshot?.phase === phase) return snapshot;
    if (snapshot?.phase === "result") {
      const reason =
        snapshot.result.status === "failed" ? snapshot.result.reason : snapshot.result.status;
      if (reason === "permission-blocked") throw new Error("capture-permission-blocked");
      throw new Error("capture-workflow-failed");
    }
    await delay(10);
  }
  throw new Error("workflow-timeout");
}

async function readDiagnostics(mainWindow) {
  return mainWindow.evaluate(() => {
    const bridge = window.screenFling;
    if (bridge === undefined) throw new Error("Diagnostics bridge unavailable.");
    return bridge.getDiagnostics();
  });
}

function mainPage(context) {
  const page = livePages(context).find((candidate) => !candidate.url().includes("surface=capture"));
  if (page === undefined) throw new Error("main-window-unavailable");
  return page;
}

async function waitForOverlay(context, timeoutMs = OVERLAY_READY_TIMEOUT_MS) {
  let abandoned = false;
  let overlay;
  try {
    return await withTimeout(
      async () => {
        overlay = await context.waitForEvent("page");
        if (abandoned) {
          await closeOverlayAfterFailure(overlay);
          throw new Error("overlay-open-timeout");
        }
        await overlay.waitForURL(/surface=capture/);
        await overlay.getByText("Drag to capture", { exact: true }).waitFor({ state: "visible" });
        return overlay;
      },
      timeoutMs,
      "overlay-open-timeout",
    );
  } catch (cause) {
    abandoned = true;
    if (overlay !== undefined) await closeOverlayAfterFailure(overlay);
    throw cause;
  }
}

async function startCapture(mainWindow, context, timeoutMs = OVERLAY_READY_TIMEOUT_MS) {
  const startedAt = performance.now();
  let abandoned = false;
  let overlay;
  try {
    return await withTimeout(
      async () => {
        const overlayPromise = waitForOverlay(context, timeoutMs);
        await mainWindow.getByRole("button", { name: "Capture region" }).click();
        overlay = await overlayPromise;
        if (abandoned) {
          await closeOverlayAfterFailure(overlay);
          throw new Error("overlay-ready-timeout");
        }
        const snapshot = await waitForWorkflowPhase(mainWindow, "selecting", timeoutMs);
        return {
          overlay,
          operationId: snapshot.operationId,
          elapsedMs: performance.now() - startedAt,
        };
      },
      timeoutMs,
      "overlay-ready-timeout",
    );
  } catch (cause) {
    abandoned = true;
    if (overlay !== undefined) await closeOverlayAfterFailure(overlay);
    throw cause;
  }
}

async function dismissResult(mainWindow) {
  await mainWindow.getByRole("button", { name: "Done" }).click();
  await mainWindow.getByRole("button", { name: "Capture region" }).waitFor({ state: "visible" });
  const snapshot = await mainWindow.evaluate(() => window.screenFling?.getSnapshot());
  if (snapshot?.phase !== "idle") throw new Error("workflow-not-idle");
}

async function allowExpectedPageClose(page, action, timeoutMs = OVERLAY_ACTION_TIMEOUT_MS) {
  try {
    await withTimeout(action, timeoutMs, "overlay-action-timeout");
  } catch (cause) {
    if (!page.isClosed()) throw cause;
  }
}

async function closeOverlayAfterFailure(overlay) {
  if (overlay.isClosed()) return;
  try {
    await withTimeout(
      () => overlay.close({ runBeforeUnload: false }),
      OVERLAY_EMERGENCY_CLOSE_TIMEOUT_MS,
      "overlay-emergency-close-timeout",
    );
  } catch {
    // Application termination is the final cleanup boundary.
  }
}

async function runOverlayAction(overlay, action, timeoutMs) {
  try {
    await allowExpectedPageClose(overlay, action, timeoutMs);
    if (!overlay.isClosed()) {
      await withTimeout(
        async () => {
          while (!overlay.isClosed()) await delay(10);
        },
        timeoutMs,
        "overlay-close-timeout",
      );
    }
  } catch (cause) {
    await closeOverlayAfterFailure(overlay);
    throw cause;
  }
}

async function withTimeout(action, timeoutMs, reason) {
  let timeout;
  try {
    return await Promise.race([
      action(),
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(() => rejectTimeout(new Error(reason)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function runWarmup(mainWindow, context) {
  const { operationId, overlay } = await startCapture(mainWindow, context);
  await cancelOverlay(overlay, operationId);
  await mainWindow.getByRole("heading", { name: "Capture cancelled" }).waitFor();
  await dismissResult(mainWindow);
}

async function cancelOverlay(overlay, operationId, timeoutMs = OVERLAY_ACTION_TIMEOUT_MS) {
  await runOverlayAction(
    overlay,
    () =>
      overlay.evaluate((id) => {
        const bridge = window.captureOverlay;
        if (bridge === undefined) throw new Error("Capture bridge unavailable.");
        return bridge.cancel({ operationId: id });
      }, operationId),
    timeoutMs,
  );
}

async function completeOverlaySelection(overlay, request, timeoutMs = OVERLAY_ACTION_TIMEOUT_MS) {
  await runOverlayAction(
    overlay,
    () =>
      overlay.evaluate((selectionRequest) => {
        const bridge = window.captureOverlay;
        if (bridge === undefined) throw new Error("Capture bridge unavailable.");
        return bridge.completeSelection(selectionRequest);
      }, request),
    timeoutMs,
  );
}

async function runCapture(mainWindow, context) {
  const {
    operationId,
    overlay,
    elapsedMs: captureActionToOverlayInteractiveMs,
  } = await startCapture(mainWindow, context);
  const display = await overlay.evaluate(() => ({
    screenPositionDip: {
      x: window.screenX,
      y: window.screenY,
    },
    screenSizeDip: {
      width: window.screen.width,
      height: window.screen.height,
    },
    overlayViewportDip: { width: window.innerWidth, height: window.innerHeight },
    scaleFactor: window.devicePixelRatio,
    orientationAngle: window.screen.orientation.angle,
  }));
  const viewport = viewportSchema.parse(
    await overlay.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  );
  const returnedPixels = imageDimensionsSchema.parse(
    await overlay.locator("img.overlay__image").evaluate((image) => ({
      height: image.naturalHeight,
      width: image.naturalWidth,
    })),
  );
  const completionRequest = {
    operationId,
    selection: {
      x: viewport.width * 0.25,
      y: viewport.height * 0.25,
      width: viewport.width * 0.5,
      height: viewport.height * 0.5,
    },
  };
  const completedAt = performance.now();
  await completeOverlaySelection(overlay, completionRequest);

  await waitForWorkflowPhase(mainWindow, "editing");
  const copyButton = mainWindow.getByRole("button", { name: "Copy only" });
  await copyButton.waitFor({ state: "visible" });
  const selectionCompletionToReviewReadyMs = performance.now() - completedAt;
  await copyButton.click();
  await waitForWorkflowPhase(mainWindow, "result");
  await mainWindow.getByRole("heading", { name: "Copied" }).waitFor();
  const selectionCompletionToClipboardVerifiedMs = performance.now() - completedAt;
  const snapshot = await mainWindow.evaluate(() => window.screenFling?.getSnapshot());
  if (snapshot?.phase !== "result" || snapshot.result.status !== "copied") {
    throw new Error("clipboard-verification-failed");
  }
  await dismissResult(mainWindow);

  return {
    captureActionToOverlayInteractiveMs,
    selectionCompletionToReviewReadyMs,
    selectionCompletionToClipboardVerifiedMs,
    display: {
      ...display,
      requestedPixels: {
        height: Math.ceil(display.screenSizeDip.height * display.scaleFactor),
        width: Math.ceil(display.screenSizeDip.width * display.scaleFactor),
      },
      returnedPixels,
    },
  };
}

function macWorkingSetKib(rootPid) {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" });
  const output = processListSchema.safeParse(result.stdout);
  if (result.status !== 0 || !output.success) return null;
  const rows = output.data
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length === 3 && row.every(Number.isFinite));
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parentPid] of rows) {
      if (!descendants.has(parentPid) || descendants.has(pid)) continue;
      descendants.add(pid);
      changed = true;
    }
  }
  return rows.reduce((sum, [pid, , rss]) => (descendants.has(pid) ? sum + rss : sum), 0);
}

function workingSetKib(rootPid) {
  return process.platform === "darwin" ? macWorkingSetKib(rootPid) : null;
}

async function runCancel(mainWindow, context, rootPid) {
  const { operationId, overlay } = await startCapture(mainWindow, context);
  await cancelOverlay(overlay, operationId);
  await mainWindow.getByRole("heading", { name: "Capture cancelled" }).waitFor();
  const snapshot = await mainWindow.evaluate(() => window.screenFling?.getSnapshot());
  if (snapshot?.phase !== "result" || snapshot.result.status !== "cancelled") {
    throw new Error("cancel-verification-failed");
  }
  if (livePages(context).length !== 1) throw new Error("overlay-window-leaked");
  const memory = workingSetKib(rootPid);
  await dismissResult(mainWindow);
  return memory;
}

async function closeApplication(browser, child) {
  await browser.close().catch(() => undefined);
  await terminateApplication(child);
}

async function terminateApplication(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function classifyFailure(cause) {
  if (!(cause instanceof Error)) return "acceptance-runner-failed";
  const known = new Set([
    "acceptance-runner-failed",
    "application-exited",
    "artifact-identity-mismatch",
    "cancel-verification-failed",
    "capture-permission-blocked",
    "capture-workflow-failed",
    "clipboard-verification-failed",
    "devtools-unavailable",
    "empty-acceptance-sample",
    "invalid-acceptance-argument",
    "invalid-overlay-geometry",
    "main-window-unavailable",
    "overlay-action-timeout",
    "overlay-close-timeout",
    "overlay-open-timeout",
    "overlay-ready-timeout",
    "overlay-window-leaked",
    "package-not-found",
    "unpackaged-application",
    "unsupported-platform",
    "workflow-not-idle",
  ]);
  if (known.has(cause.message)) return cause.message;
  if (cause.message.includes("Timeout")) return "workflow-timeout";
  return "acceptance-runner-failed";
}

async function main() {
  const captureRuns = parseIntegerFlag("capture-runs", DEFAULT_CAPTURE_RUNS);
  const cancelRuns = parseIntegerFlag("cancel-runs", DEFAULT_CANCEL_RUNS);
  const cooldownMs = parseIntegerFlag("cooldown-ms", DEFAULT_COOLDOWN_MS, 300_000);
  if (captureRuns === 0 && cancelRuns === 0) throw new Error("empty-acceptance-sample");

  const port = await reservePort();
  const executable = resolveExecutable();
  const artifact = await readArtifactEvidence(executable);
  const child = spawn(
    executable,
    [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`],
    {
      stdio: "ignore",
    },
  );
  if (child.pid === undefined) throw new Error("application-exited");
  let browser;
  try {
    browser = await connectToApplication(port, child);
  } catch (cause) {
    await terminateApplication(child);
    throw cause;
  }
  try {
    const context = browser.contexts()[0];
    if (context === undefined) throw new Error("main-window-unavailable");
    const mainWindow = mainPage(context);
    await mainWindow.getByRole("button", { name: "Capture region" }).waitFor({ state: "visible" });
    const packaged = mainWindow.url().startsWith("screenfling://");
    if (!packaged) throw new Error("unpackaged-application");
    const userAgent = await mainWindow.evaluate(() => navigator.userAgent);

    await runWarmup(mainWindow, context);
    if (captureRuns > 0) {
      for (let index = 0; index < CAPTURE_WARMUP_RUNS; index += 1) {
        await runCapture(mainWindow, context);
      }
    }
    const captureSamples = [];
    for (let index = 0; index < captureRuns; index += 1) {
      captureSamples.push(await runCapture(mainWindow, context));
    }

    const memorySamples = [];
    const beforeCancelCycles = workingSetKib(child.pid);
    for (let index = 0; index < cancelRuns; index += 1) {
      const memory = await runCancel(mainWindow, context, child.pid);
      if (memory !== null) memorySamples.push(memory);
    }
    await delay(cooldownMs);
    const afterCooldown = workingSetKib(child.pid);
    const diagnostics = await readDiagnostics(mainWindow);

    const captureActionTimes = captureSamples.map(
      (sample) => sample.captureActionToOverlayInteractiveMs,
    );
    const reviewTimes = captureSamples.map((sample) => sample.selectionCompletionToReviewReadyMs);
    const clipboardTimes = captureSamples.map(
      (sample) => sample.selectionCompletionToClipboardVerifiedMs,
    );
    const clipboardSummary = captureRuns === 0 ? null : summarize(clipboardTimes);
    const clipboardP95Passed =
      clipboardSummary === null || clipboardSummary.p95 <= SELECTION_COMPLETION_P95_TARGET_MS;
    const report = {
      acceptance: "production-capture",
      status: clipboardP95Passed ? "passed" : "failed",
      host: {
        platform: os.platform(),
        arch: os.arch(),
        osRelease: os.release(),
      },
      application: {
        name: artifact.name,
        version: artifact.version,
        bundleIdentifier: artifact.bundleIdentifier,
        identityVerified: artifact.identityVerified,
        metadataSource: artifact.metadataSource,
        packaged,
        packagedEvidence: ["app.asar", "screenfling-url-scheme"],
        screenCaptureObserved: true,
        mediaAccessStatus: "not-observed-through-hardened-boundary",
        electron: /Electron\/([^ ]+)/.exec(userAgent)?.[1] ?? "unavailable",
        chrome: /Chrome\/([^ ]+)/.exec(userAgent)?.[1] ?? "unavailable",
      },
      displayObservations: captureSamples.length === 0 ? [] : [captureSamples[0].display],
      diagnostics,
      captureWarmupRuns: captureRuns === 0 ? 0 : CAPTURE_WARMUP_RUNS,
      captureRuns,
      cancelRuns,
      timingsMs:
        captureRuns === 0
          ? null
          : {
              captureActionToOverlayInteractive: summarize(captureActionTimes),
              selectionCompletionToReviewReady: summarize(reviewTimes),
              selectionCompletionToClipboardVerified: clipboardSummary,
            },
      gateChecks: {
        selectionCompletionToClipboardVerifiedP95: {
          targetMs: SELECTION_COMPLETION_P95_TARGET_MS,
          observedMs: clipboardSummary?.p95 ?? null,
          passed: clipboardP95Passed,
        },
      },
      cancelSoak: {
        resultVerifiedEveryCycle: cancelRuns === 0 ? null : true,
        idleVerifiedEveryCycle: cancelRuns === 0 ? null : true,
        windowCountStable: cancelRuns === 0 ? null : true,
        workingSetKib:
          memorySamples.length === 0
            ? null
            : {
                first: memorySamples[0],
                beforeCycles: beforeCancelCycles,
                last: memorySamples.at(-1),
                minimum: Math.min(...memorySamples),
                maximum: Math.max(...memorySamples),
                slopePerCycle: linearSlope(memorySamples),
                afterCooldown,
              },
      },
      limitations: [
        "The capture action is a product button, not an operating-system global shortcut.",
        "The product diagnostics snapshot covers the full process lifetime, including warmup workflows.",
        "Selection completion is invoked through the validated overlay bridge; pointer-drag behavior is a separate unit and human smoke check.",
        "Cancel results and window cleanup are observed; the runner cannot inspect the macOS image clipboard through the hardened renderer boundary.",
        "The runner does not simulate display hardware, sleep, permission changes, or Windows on macOS.",
        "Working-set samples are evidence, not proof that no native image allocation is retained.",
      ],
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "passed") process.exitCode = 1;
  } finally {
    await closeApplication(browser, child);
  }
}

if (require.main === module) {
  main().catch((cause) => {
    process.stderr.write(
      `${JSON.stringify({ acceptance: "production-capture", status: "failed", reason: classifyFailure(cause) })}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  allowExpectedPageClose,
  cancelOverlay,
  completeOverlaySelection,
  readArtifactEvidence,
  readDiagnostics,
  startCapture,
  waitForOverlay,
};

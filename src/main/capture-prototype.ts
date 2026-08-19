import { createHash, randomUUID } from "node:crypto";

import {
  BrowserWindow,
  app,
  clipboard,
  desktopCapturer,
  ipcMain,
  screen,
  systemPreferences,
} from "electron";
import { z } from "zod";

import { CAPTURE_PROTOTYPE_CHANNELS } from "../shared/capture-prototype-contract";

import type { Display, NativeImage, Rectangle } from "electron";

declare function gc(): void;

const selectionSchema = z.strictObject({
  operationId: z.uuidv4(),
  selection: z.strictObject({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  }),
});

const operationSchema = z.strictObject({ operationId: z.uuidv4() });

type CaptureSample = {
  readonly display: Display;
  readonly image: NativeImage;
  readonly captureMs: number;
  readonly requestedPixels: { readonly width: number; readonly height: number };
  readonly returnedPixels: { readonly width: number; readonly height: number };
};

type TimingSummary = {
  readonly minimum: number;
  readonly median: number;
  readonly p95: number;
  readonly maximum: number;
};

type BenchmarkCycle = {
  readonly captureMs: number;
  readonly cropMs: number | null;
  readonly clipboardMs: number | null;
  readonly displayId: string;
  readonly requestedPixels: { readonly width: number; readonly height: number };
  readonly returnedPixels: { readonly width: number; readonly height: number };
};

function parseCount(flag: string): number | null {
  const argument = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (argument === undefined) return null;
  const count = Number.parseInt(argument.slice(flag.length + 1), 10);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000) {
    throw new Error(`${flag} must be an integer between 1 and 1000.`);
  }
  return count;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  const value = sorted[index];
  if (value === undefined) throw new Error("Cannot summarize an empty sample.");
  return value;
}

function summarize(values: readonly number[]): TimingSummary {
  return {
    minimum: percentile(values, 0),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: percentile(values, 1),
  };
}

function linearSlope(values: readonly number[]): number {
  const count = values.length;
  const averageIndex = (count - 1) / 2;
  const averageValue = values.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < count; index += 1) {
    const centeredIndex = index - averageIndex;
    const value = values[index];
    if (value === undefined) continue;
    numerator += centeredIndex * (value - averageValue);
    denominator += centeredIndex * centeredIndex;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestPrototypeGarbageCollection(): boolean {
  if (!process.argv.includes("--force-gc")) return false;
  try {
    gc();
    return true;
  } catch {
    return false;
  }
}

function clipboardDigest(): string {
  const hash = createHash("sha256");
  const formats = clipboard.availableFormats("clipboard").sort();
  hash.update(formats.join("\n"));
  hash.update(clipboard.readText("clipboard"));
  hash.update(clipboard.readHTML("clipboard"));
  hash.update(clipboard.readRTF("clipboard"));
  hash.update(clipboard.readImage("clipboard").toPNG());
  const bookmark = clipboard.readBookmark();
  hash.update(bookmark.title);
  hash.update(bookmark.url);
  return hash.digest("hex");
}

async function captureDisplay(display: Display): Promise<CaptureSample> {
  const requestedPixels = {
    width: Math.ceil(display.bounds.width * display.scaleFactor),
    height: Math.ceil(display.bounds.height * display.scaleFactor),
  };
  const startedAt = performance.now();
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: requestedPixels,
      fetchWindowIcons: false,
    });
  } catch {
    const permission =
      process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("screen")
        : "platform-does-not-report";
    throw new Error(`Failed to get screen sources; permission status: ${permission}.`);
  }
  const captureMs = performance.now() - startedAt;
  const source = sources.find((candidate) => candidate.display_id === String(display.id));
  if (source === undefined) {
    const availableIds = sources.map((candidate) => candidate.display_id || "unavailable");
    throw new Error(
      `No exact source for display ${display.id}; available display IDs: ${availableIds.join(", ")}.`,
    );
  }
  if (source.thumbnail.isEmpty()) throw new Error("The selected display capture was empty.");

  return {
    display,
    image: source.thumbnail,
    captureMs,
    requestedPixels,
    returnedPixels: source.thumbnail.getSize(),
  };
}

function selectionToPixels(
  selection: z.infer<typeof selectionSchema>["selection"],
  sample: CaptureSample,
): Rectangle {
  const widthRatio = sample.returnedPixels.width / sample.display.bounds.width;
  const heightRatio = sample.returnedPixels.height / sample.display.bounds.height;
  const left = Math.max(0, Math.floor(selection.x * widthRatio));
  const top = Math.max(0, Math.floor(selection.y * heightRatio));
  const right = Math.min(
    sample.returnedPixels.width,
    Math.ceil((selection.x + selection.width) * widthRatio),
  );
  const bottom = Math.min(
    sample.returnedPixels.height,
    Math.ceil((selection.y + selection.height) * heightRatio),
  );
  if (right <= left || bottom <= top) throw new Error("Selection mapped to an empty crop.");
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function centerSelection(sample: CaptureSample) {
  return {
    x: sample.display.bounds.width * 0.25,
    y: sample.display.bounds.height * 0.25,
    width: sample.display.bounds.width * 0.5,
    height: sample.display.bounds.height * 0.5,
  };
}

async function runBenchmarkCycle(cancelOnly: boolean): Promise<BenchmarkCycle> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sample = await captureDisplay(display);
  if (cancelOnly) {
    const preview = sample.image.toJPEG(90);
    if (preview.byteLength === 0) throw new Error("Preview encoding was empty.");
    return {
      captureMs: sample.captureMs,
      cropMs: null,
      clipboardMs: null,
      displayId: String(display.id),
      requestedPixels: sample.requestedPixels,
      returnedPixels: sample.returnedPixels,
    };
  }

  const cropStartedAt = performance.now();
  const cropped = sample.image.crop(selectionToPixels(centerSelection(sample), sample));
  const cropMs = performance.now() - cropStartedAt;
  const clipboardStartedAt = performance.now();
  clipboard.writeImage(cropped);
  if (clipboard.readImage().isEmpty()) throw new Error("Clipboard verification failed.");
  const clipboardMs = performance.now() - clipboardStartedAt;
  return {
    captureMs: sample.captureMs,
    cropMs,
    clipboardMs,
    displayId: String(display.id),
    requestedPixels: sample.requestedPixels,
    returnedPixels: sample.returnedPixels,
  };
}

async function runBenchmark(iterations: number, cancelOnly: boolean): Promise<void> {
  const captureTimes: number[] = [];
  const cropTimes: number[] = [];
  const clipboardTimes: number[] = [];
  const memorySamples: number[] = [];
  const clipboardBefore = clipboardDigest();
  let returnedPixels = { width: 0, height: 0 };
  let requestedPixels = { width: 0, height: 0 };
  let displayId = "";
  let forcedGcAvailable = false;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cycle = await runBenchmarkCycle(cancelOnly);
    captureTimes.push(cycle.captureMs);
    returnedPixels = cycle.returnedPixels;
    requestedPixels = cycle.requestedPixels;
    displayId = cycle.displayId;
    if (cycle.cropMs !== null) cropTimes.push(cycle.cropMs);
    if (cycle.clipboardMs !== null) clipboardTimes.push(cycle.clipboardMs);
    await delay(100);
    forcedGcAvailable = requestPrototypeGarbageCollection() || forcedGcAvailable;
    memorySamples.push(process.memoryUsage().rss);
  }

  const cooldownRssBytes: number[] = [];
  for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
    await delay(1_000);
    cooldownRssBytes.push(process.memoryUsage().rss);
  }

  const result = {
    prototype: "capture-gate-a",
    mode: cancelOnly ? "cancel" : "capture-crop-clipboard",
    packaged: app.isPackaged,
    iterations,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    permission:
      process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("screen")
        : "platform-does-not-report",
    displayId,
    requestedPixels,
    returnedPixels,
    captureMs: summarize(captureTimes),
    cropMs: cancelOnly ? null : summarize(cropTimes),
    clipboardMs: cancelOnly ? null : summarize(clipboardTimes),
    clipboardUnchanged: cancelOnly ? clipboardDigest() === clipboardBefore : null,
    forcedGcAvailable,
    rssBytes: {
      first: memorySamples[0],
      last: memorySamples.at(-1),
      minimum: Math.min(...memorySamples),
      maximum: Math.max(...memorySamples),
      slopePerCycle: linearSlope(memorySamples),
      cooldown: cooldownRssBytes,
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.quit();
}

const overlayDocument = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Capture Gate A Prototype</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; cursor: crosshair; user-select: none; }
    #snapshot { position: fixed; inset: 0; width: 100%; height: 100%; }
    #shade { position: fixed; inset: 0; background: rgb(0 0 0 / 34%); }
    #selection { position: fixed; display: none; border: 1px solid white; box-shadow: 0 0 0 1px rgb(0 0 0 / 65%); }
    #state { position: fixed; left: 16px; bottom: 16px; margin: 0; padding: 8px 10px; color: white; background: rgb(0 0 0 / 72%); font: 12px/1.35 ui-monospace, monospace; pointer-events: none; }
  </style>
</head>
<body>
  <img id="snapshot" alt="Frozen display snapshot" draggable="false" />
  <div id="shade"></div>
  <div id="selection"></div>
  <pre id="state">Loading frozen snapshot…</pre>
  <script>
    const image = document.querySelector('#snapshot');
    const selection = document.querySelector('#selection');
    const state = document.querySelector('#state');
    let operationId = null;
    let start = null;

    function render(current) {
      selection.style.display = 'block';
      selection.style.left = current.x + 'px';
      selection.style.top = current.y + 'px';
      selection.style.width = current.width + 'px';
      selection.style.height = current.height + 'px';
      state.textContent = JSON.stringify({ operationId, selection: current }, null, 2);
    }

    window.capturePrototype.onSnapshot((snapshot) => {
      operationId = snapshot.operationId;
      image.addEventListener('load', async () => {
        URL.revokeObjectURL(image.src);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await window.capturePrototype.ready({ operationId });
        if (snapshot.automatic) {
          await window.capturePrototype.complete({
            operationId,
            selection: {
              x: window.innerWidth * 0.25,
              y: window.innerHeight * 0.25,
              width: window.innerWidth * 0.5,
              height: window.innerHeight * 0.5,
            },
          });
        }
      }, { once: true });
      image.src = URL.createObjectURL(new Blob([snapshot.preview], { type: 'image/jpeg' }));
    });

    addEventListener('pointerdown', (event) => {
      start = { x: event.clientX, y: event.clientY };
      render({ x: start.x, y: start.y, width: 1, height: 1 });
    });
    addEventListener('pointermove', (event) => {
      if (start === null) return;
      render({
        x: Math.min(start.x, event.clientX),
        y: Math.min(start.y, event.clientY),
        width: Math.max(1, Math.abs(event.clientX - start.x)),
        height: Math.max(1, Math.abs(event.clientY - start.y)),
      });
    });
    addEventListener('pointerup', (event) => {
      if (start === null || operationId === null) return;
      const finalSelection = {
        x: Math.min(start.x, event.clientX),
        y: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      };
      start = null;
      if (finalSelection.width > 0 && finalSelection.height > 0) {
        window.capturePrototype.complete({ operationId, selection: finalSelection });
      }
    });
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && operationId !== null) {
        window.capturePrototype.cancel({ operationId });
      }
    });
  </script>
</body>
</html>`;

async function runInteractive(preload: string): Promise<void> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const operationId = randomUUID();
  const automatic = process.argv.includes("--auto-overlay");
  const clipboardBefore = clipboardDigest();
  let overlayReadyMs: number | null = null;

  const overlay = new BrowserWindow({
    ...display.bounds,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: "#000000",
    webPreferences: {
      preload,
      additionalArguments: ["--capture-prototype"],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  overlay.webContents.on("preload-error", (_event, preloadPath, error) => {
    process.stderr.write(`Capture prototype preload error in ${preloadPath}: ${error.message}\n`);
  });
  overlay.webContents.on("console-message", (_event, level, message) => {
    process.stderr.write(`Capture prototype renderer console (${level}): ${message}\n`);
  });
  overlay.webContents.on("render-process-gone", (_event, details) => {
    process.stderr.write(`Capture prototype renderer exited: ${details.reason}\n`);
  });
  await overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayDocument)}`);

  const startedAt = performance.now();
  const sample = await captureDisplay(display);
  const previewStartedAt = performance.now();
  const preview = sample.image.toJPEG(90);
  const previewEncodeMs = performance.now() - previewStartedAt;

  const authorize = (senderId: number) => {
    if (senderId !== overlay.webContents.id) {
      throw new Error("Rejected capture prototype message from another renderer.");
    }
  };

  ipcMain.handle(CAPTURE_PROTOTYPE_CHANNELS.ready, (event, payload) => {
    authorize(event.sender.id);
    const request = operationSchema.parse(payload);
    if (request.operationId !== operationId) throw new Error("Stale capture operation.");
    overlayReadyMs = performance.now() - startedAt;
    overlay.show();
    return { overlayReadyMs };
  });

  ipcMain.handle(CAPTURE_PROTOTYPE_CHANNELS.complete, (event, payload) => {
    authorize(event.sender.id);
    const request = selectionSchema.parse(payload);
    if (request.operationId !== operationId) throw new Error("Stale capture operation.");
    const cropStartedAt = performance.now();
    const crop = selectionToPixels(request.selection, sample);
    const image = sample.image.crop(crop);
    const cropMs = performance.now() - cropStartedAt;
    const clipboardStartedAt = performance.now();
    clipboard.writeImage(image);
    const clipboardMs = performance.now() - clipboardStartedAt;
    const result = {
      prototype: "capture-gate-a",
      mode: automatic ? "automatic-overlay" : "interactive",
      packaged: app.isPackaged,
      permission:
        process.platform === "darwin"
          ? systemPreferences.getMediaAccessStatus("screen")
          : "platform-does-not-report",
      display: {
        id: String(display.id),
        boundsDip: display.bounds,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
      },
      requestedPixels: sample.requestedPixels,
      returnedPixels: sample.returnedPixels,
      selectionDip: request.selection,
      cropPixels: crop,
      captureMs: sample.captureMs,
      previewEncodeMs,
      overlayReadyMs,
      cropMs,
      clipboardMs,
      clipboardImageEmpty: clipboard.readImage().isEmpty(),
    };
    process.stdout.write(
      `${automatic ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`,
    );
    overlay.close();
    app.quit();
  });

  ipcMain.handle(CAPTURE_PROTOTYPE_CHANNELS.cancel, (event, payload) => {
    authorize(event.sender.id);
    const request = operationSchema.parse(payload);
    if (request.operationId !== operationId) throw new Error("Stale capture operation.");
    process.stdout.write(
      `${JSON.stringify({
        prototype: "capture-gate-a",
        mode: "interactive-cancel",
        clipboardUnchanged: clipboardDigest() === clipboardBefore,
      })}\n`,
    );
    overlay.close();
    app.quit();
  });

  overlay.webContents.send(CAPTURE_PROTOTYPE_CHANNELS.snapshot, {
    operationId,
    preview,
    automatic,
  });
}

export function isCapturePrototype(): boolean {
  return process.argv.includes("--capture-prototype");
}

export async function startCapturePrototype(preload: string): Promise<void> {
  const benchmark = parseCount("--benchmark");
  const cancelBenchmark = parseCount("--cancel-benchmark");
  if (benchmark !== null && cancelBenchmark !== null) {
    throw new Error("Choose one benchmark mode.");
  }
  if (benchmark !== null) return runBenchmark(benchmark, false);
  if (cancelBenchmark !== null) return runBenchmark(cancelBenchmark, true);
  return runInteractive(preload);
}

export function reportCapturePrototypeFailure(error: Error): void {
  const permission =
    process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("screen")
      : "platform-does-not-report";
  process.stderr.write(
    `${JSON.stringify({
      prototype: "capture-gate-a",
      status: "failed",
      packaged: app.isPackaged,
      permission,
      error: error.message,
    })}\n`,
  );
  app.exit(1);
}

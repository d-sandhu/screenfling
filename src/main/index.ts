import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { app, BrowserWindow, globalShortcut, powerMonitor, screen } from "electron";

import { IPC_CHANNELS } from "../shared/bridge";
import { registerAppProtocol } from "./app-protocol";
import { registerCaptureLifecycle } from "./capture-lifecycle";
import { CaptureController } from "./capture-controller";
import { CaptureOverlayWindow } from "./capture-overlay-window";
import { CaptureSession } from "./capture-session";
import { createConfiguredAdapters } from "./configured-adapters";
import { DestinationRegistry } from "./destination-registry";
import { ElectronCaptureBackend, ElectronImageClipboard } from "./electron-capture-backend";
import { registerWorkflowIpc } from "./ipc";
import { createMainWindowOptions } from "./window-options";
import { readDevRendererUrl, rendererDocumentUrl } from "./renderer-url";
import { WorkflowDiagnostics } from "./workflow-diagnostics";
import { WorkflowStore } from "./workflow-store";

import type { ShortcutStatus } from "../shared/bridge";
import type { WorkflowSnapshot } from "../shared/workflow";

let mainWindow: BrowserWindow | null = null;
const workflow = new WorkflowStore();
const diagnostics = new WorkflowDiagnostics(() => performance.now());
const rendererUrl = readDevRendererUrl(process.env.ELECTRON_RENDERER_URL);
const mainRendererUrl = rendererDocumentUrl(rendererUrl, "main");
const overlayRendererUrl = rendererDocumentUrl(rendererUrl, "capture");
const captureShortcut = "CommandOrControl+Shift+9";
let shortcutRegistered = false;

function getMainWebContents() {
  return mainWindow?.webContents ?? null;
}

function createWindow(): BrowserWindow {
  const preload = join(__dirname, "../preload/index.js");
  const window = new BrowserWindow(createMainWindowOptions(preload));
  mainWindow = window;

  window.once("ready-to-show", () => {
    if (workflow.snapshot.phase !== "snapshotting" && workflow.snapshot.phase !== "selecting") {
      window.show();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, respond) => {
    respond(false);
  });
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  void window.loadURL(mainRendererUrl);

  return window;
}

function showMainWindow(): void {
  const window = mainWindow ?? createWindow();
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

async function hideMainWindowForCapture(): Promise<void> {
  const window = mainWindow;
  if (window === null || window.isDestroyed() || !window.isVisible()) return;
  window.hide();
  await new Promise((resolve) => setTimeout(resolve, 16));
}

function publishWorkflow(snapshot: WorkflowSnapshot): void {
  const window = mainWindow;
  if (window === null || window.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.snapshotChanged, snapshot);
}

function getShortcutStatus(): ShortcutStatus {
  return { accelerator: captureShortcut, registered: shortcutRegistered };
}

void app.whenReady().then(() => {
  registerAppProtocol();
  const preload = join(__dirname, "../preload/index.js");
  let controller: CaptureController;
  const overlay = new CaptureOverlayWindow(preload, rendererUrl, () => {
    controller.overlayClosedUnexpectedly();
  });
  const capture = new CaptureSession(new ElectronCaptureBackend(), new ElectronImageClipboard());
  const destinations = new DestinationRegistry(
    createConfiguredAdapters(process.env, process.platform),
  );
  controller = new CaptureController(
    workflow,
    diagnostics,
    capture,
    destinations,
    overlay,
    {
      hideForCapture: hideMainWindowForCapture,
      publishWorkflow,
      show: showMainWindow,
    },
    randomUUID,
  );

  registerWorkflowIpc(
    getMainWebContents,
    () => overlay.webContents,
    mainRendererUrl,
    overlayRendererUrl,
    controller,
    () => diagnostics.snapshot(),
    getShortcutStatus,
  );
  createWindow();
  try {
    shortcutRegistered = globalShortcut.register(captureShortcut, () => {
      void controller.startCapture("shortcut");
    });
  } catch {
    shortcutRegistered = false;
  }

  registerCaptureLifecycle(
    {
      displayAdded: (listener) => {
        screen.on("display-added", (_event, display) => listener(String(display.id)));
      },
      displayMetricsChanged: (listener) => {
        screen.on("display-metrics-changed", (_event, display) => listener(String(display.id)));
      },
      displayRemoved: (listener) => {
        screen.on("display-removed", (_event, display) => listener(String(display.id)));
      },
      resumed: (listener) => {
        powerMonitor.on("resume", listener);
      },
      suspended: (listener) => {
        powerMonitor.on("suspend", listener);
      },
    },
    controller,
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

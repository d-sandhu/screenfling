import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  powerMonitor,
  screen,
  systemPreferences,
} from "electron";

import { IPC_CHANNELS } from "../shared/bridge";
import { ApplicationLifecycle } from "./application-lifecycle";
import { registerAppProtocol } from "./app-protocol";
import { registerCaptureLifecycle } from "./capture-lifecycle";
import { CaptureController } from "./capture-controller";
import { CaptureOverlayWindow } from "./capture-overlay-window";
import { CaptureSession } from "./capture-session";
import { createConfiguredAdapters } from "./configured-adapters";
import { DestinationRegistry } from "./destination-registry";
import { ElectronCaptureBackend, ElectronImageClipboard } from "./electron-capture-backend";
import { registerWorkflowIpc } from "./ipc";
import { readScreenCaptureReadiness } from "./screen-capture-permission";
import { ShortcutManager } from "./shortcut-manager";
import { NodeShortcutPreferenceFiles, ShortcutPreferenceStore } from "./shortcut-preference-store";
import { createMainWindowOptions } from "./window-options";
import { readDevRendererUrl, rendererDocumentUrl } from "./renderer-url";
import { WorkflowDiagnostics } from "./workflow-diagnostics";
import { WorkflowStore } from "./workflow-store";
import { WezTermSetup } from "./wezterm-setup";

import type { WorkflowSnapshot } from "../shared/workflow";

let mainWindow: BrowserWindow | null = null;
let shortcutManager: ShortcutManager | null = null;
let applicationLifecycle: ApplicationLifecycle | null = null;
let quitting = false;
const workflow = new WorkflowStore();
const diagnostics = new WorkflowDiagnostics(() => performance.now());
const rendererUrl = readDevRendererUrl(process.env.ELECTRON_RENDERER_URL);
const mainRendererUrl = rendererDocumentUrl(rendererUrl, "main");
const overlayRendererUrl = rendererDocumentUrl(rendererUrl, "capture");

function getMainWebContents() {
  return mainWindow?.webContents ?? null;
}

function stopApplication(): void {
  quitting = true;
  applicationLifecycle?.beginQuit();
  dialog.showErrorBox(
    "ScreenFling stopped",
    "ScreenFling could not restore its window. Restart the app. No workflow action was retried. " +
      "Check the chosen destination before attempting another Stage.",
  );
  app.quit();
}

function createWindow(): BrowserWindow {
  const preload = join(__dirname, "../preload/index.js");
  const window = new BrowserWindow(createMainWindowOptions(preload));
  mainWindow = window;

  window.once("ready-to-show", () => {
    if (quitting || mainWindow !== window || window.isDestroyed()) return;
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
  window.webContents.on("render-process-gone", () => {
    if (!quitting && mainWindow === window) applicationLifecycle?.mainRendererGone();
  });
  // A hung renderer cannot process Escape or its own recovery controls.
  window.on("unresponsive", () => {
    if (!quitting && mainWindow === window) applicationLifecycle?.mainRendererGone();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  void window.loadURL(mainRendererUrl).catch(() => {
    if (!quitting && mainWindow === window) applicationLifecycle?.mainRendererGone();
  });

  return window;
}

function recreateMainWindow(): void {
  const previous = mainWindow;
  // Install the new authorized sender before destroying the old surface.
  // Keeping a window alive also avoids window-all-closed quitting on Windows.
  createWindow();
  if (previous !== null && !previous.isDestroyed()) previous.destroy();
}

function showMainWindow(): void {
  if (quitting) return;
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
  if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.snapshotChanged, snapshot);
}

async function initializeApplication(): Promise<void> {
  await app.whenReady();
  if (quitting) return;
  registerAppProtocol();
  const preload = join(__dirname, "../preload/index.js");
  let controller: CaptureController;
  const overlay = new CaptureOverlayWindow(preload, rendererUrl, () => {
    controller.overlayClosedUnexpectedly();
  });
  const capture = new CaptureSession(new ElectronCaptureBackend(), new ElectronImageClipboard());
  const weztermSetup = new WezTermSetup(
    join(app.getPath("userData"), "connections", "wezterm.json"),
    process.platform,
    () => !quitting && workflow.snapshot.phase === "idle",
    () => {
      app.relaunch();
      quitting = true;
      app.quit();
    },
  );
  const adapterEnvironment = await weztermSetup.initialize(process.env);
  const destinations = new DestinationRegistry(
    createConfiguredAdapters(adapterEnvironment, process.platform),
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
  const shortcut = new ShortcutManager(
    {
      isRegistered: (accelerator) => globalShortcut.isRegistered(accelerator),
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    new ShortcutPreferenceStore(
      join(app.getPath("userData"), "shortcut.json"),
      new NodeShortcutPreferenceFiles(),
      randomUUID,
    ),
    () => {
      if (applicationLifecycle === null || quitting) return;
      if (workflow.snapshot.phase === "idle") void controller.startCapture("shortcut");
      else applicationLifecycle.activate();
    },
  );
  shortcutManager = shortcut;
  await shortcut.initialize();
  if (quitting) return;

  registerWorkflowIpc(
    getMainWebContents,
    () => overlay.webContents,
    mainRendererUrl,
    overlayRendererUrl,
    controller,
    () => diagnostics.snapshot(),
    () =>
      readScreenCaptureReadiness(process.platform, () =>
        systemPreferences.getMediaAccessStatus("screen"),
      ),
    shortcut,
    weztermSetup,
  );
  applicationLifecycle = new ApplicationLifecycle({
    phase: () => workflow.snapshot.phase,
    showMain: showMainWindow,
    showOverlay: () => overlay.show(),
    recreateMain: recreateMainWindow,
    stop: stopApplication,
  });
  createWindow();

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
}

app.on("activate", () => applicationLifecycle?.activate());
app.on("second-instance", () => applicationLifecycle?.activate());
app.on("before-quit", () => {
  quitting = true;
  applicationLifecycle?.beginQuit();
});
app.on("will-quit", () => {
  shortcutManager?.dispose();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

if (app.requestSingleInstanceLock()) {
  void initializeApplication().catch(stopApplication);
} else {
  app.quit();
}

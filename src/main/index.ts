import { join } from "node:path";

import { app, BrowserWindow } from "electron";

import { registerAppProtocol } from "./app-protocol";
import {
  isCapturePrototype,
  reportCapturePrototypeFailure,
  startCapturePrototype,
} from "./capture-prototype";
import { registerWorkflowIpc } from "./ipc";
import { createMainWindowOptions } from "./window-options";
import { readDevRendererUrl } from "./renderer-url";
import { WorkflowStore } from "./workflow-store";

let mainWindow: BrowserWindow | null = null;
const workflow = new WorkflowStore();
const rendererUrl = readDevRendererUrl(process.env.ELECTRON_RENDERER_URL);

function getMainWebContents() {
  return mainWindow?.webContents ?? null;
}

function createWindow(): BrowserWindow {
  const preload = join(__dirname, "../preload/index.js");
  const window = new BrowserWindow(createMainWindowOptions(preload));
  mainWindow = window;

  window.once("ready-to-show", () => {
    window.show();
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

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadURL("screenfling://bundle/index.html");
  }

  return window;
}

void app.whenReady().then(() => {
  registerAppProtocol();
  if (isCapturePrototype()) {
    const preload = join(__dirname, "../preload/index.js");
    void startCapturePrototype(preload).catch((cause) => {
      const error = cause instanceof Error ? cause : new Error("Unknown capture failure.");
      reportCapturePrototypeFailure(error);
    });
    return;
  }
  registerWorkflowIpc(getMainWebContents, rendererUrl, workflow);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

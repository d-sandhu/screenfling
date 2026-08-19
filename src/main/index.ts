import { join } from "node:path";

import { app, BrowserWindow } from "electron";

import { registerAppProtocol } from "./app-protocol";
import { createMainWindowOptions } from "./window-options";
import { readDevRendererUrl } from "./renderer-url";

let mainWindow: BrowserWindow | null = null;

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

  const rendererUrl = readDevRendererUrl(process.env.ELECTRON_RENDERER_URL);
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadURL("screenfling://bundle/index.html");
  }

  return window;
}

void app.whenReady().then(() => {
  registerAppProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

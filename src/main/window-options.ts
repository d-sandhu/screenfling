import type { BrowserWindowConstructorOptions } from "electron";
import type { CaptureDisplay } from "./capture-session";

export function createMainWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    backgroundColor: "#101114",
    height: 720,
    minHeight: 640,
    minWidth: 760,
    show: false,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload,
      sandbox: true,
    },
    width: 920,
  };
}

export function createCaptureWindowOptions(
  preload: string,
  display: CaptureDisplay,
): BrowserWindowConstructorOptions {
  return {
    acceptFirstMouse: true,
    alwaysOnTop: true,
    backgroundColor: "#000000",
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    height: display.height,
    maximizable: false,
    minimizable: false,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    useContentSize: true,
    webPreferences: {
      additionalArguments: ["--screenfling-surface=capture"],
      contextIsolation: true,
      nodeIntegration: false,
      preload,
      sandbox: true,
    },
    width: display.width,
    x: display.x,
    y: display.y,
  };
}

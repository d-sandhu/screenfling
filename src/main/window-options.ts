import type { BrowserWindowConstructorOptions } from "electron";

export function createMainWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    backgroundColor: "#101114",
    height: 560,
    minHeight: 480,
    minWidth: 640,
    show: false,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload,
      sandbox: true,
    },
    width: 760,
  };
}

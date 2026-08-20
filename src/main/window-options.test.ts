import { describe, expect, it } from "vitest";

import { createCaptureWindowOptions, createMainWindowOptions } from "./window-options";

describe("createMainWindowOptions", () => {
  it("keeps the renderer sandboxed behind a preload boundary", () => {
    const options = createMainWindowOptions("/tmp/preload.js");

    expect(options.show).toBe(false);
    expect(options).toMatchObject({
      height: 720,
      minHeight: 640,
      minWidth: 760,
      width: 920,
    });
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "/tmp/preload.js",
      sandbox: true,
    });
  });
});

describe("createCaptureWindowOptions", () => {
  it("creates an exact hidden display-local sandbox", () => {
    expect(
      createCaptureWindowOptions("/tmp/preload.js", {
        id: "42",
        x: -1512,
        y: 0,
        width: 1512,
        height: 982,
        scaleFactor: 2,
        rotation: 0,
      }),
    ).toMatchObject({
      x: -1512,
      y: 0,
      width: 1512,
      height: 982,
      alwaysOnTop: true,
      frame: false,
      resizable: false,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        additionalArguments: ["--screenfling-surface=capture"],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  });
});

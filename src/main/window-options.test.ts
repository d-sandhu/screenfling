import { describe, expect, it } from "vitest";

import { createMainWindowOptions } from "./window-options";

describe("createMainWindowOptions", () => {
  it("keeps the renderer sandboxed behind a preload boundary", () => {
    const options = createMainWindowOptions("/tmp/preload.js");

    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "/tmp/preload.js",
      sandbox: true,
    });
  });
});

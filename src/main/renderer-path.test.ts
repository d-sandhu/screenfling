import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveRendererAsset } from "./renderer-path";

describe("resolveRendererAsset", () => {
  const rendererRoot = resolve("fixtures", "renderer");

  it("maps bundle URLs into the renderer root", () => {
    expect(resolveRendererAsset(rendererRoot, "screenfling://bundle/assets/app.js")).toBe(
      join(rendererRoot, "assets", "app.js"),
    );
  });

  it("rejects requests outside the bundle", () => {
    expect(
      resolveRendererAsset(rendererRoot, "screenfling://bundle/%2e%2e%2fmain/index.js"),
    ).toBeNull();
  });

  it("rejects other origins and the bundle root", () => {
    expect(resolveRendererAsset(rendererRoot, "screenfling://other/index.html")).toBeNull();
    expect(resolveRendererAsset(rendererRoot, "screenfling://bundle/")).toBeNull();
  });
});

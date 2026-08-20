import { describe, expect, it } from "vitest";

import { readDevRendererUrl, rendererDocumentUrl } from "./renderer-url";

describe("readDevRendererUrl", () => {
  it("accepts local electron-vite origins", () => {
    expect(readDevRendererUrl("http://localhost:5173/")).toBe("http://localhost:5173/");
    expect(readDevRendererUrl("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173/");
  });

  it("returns null when the development server is not configured", () => {
    expect(readDevRendererUrl(undefined)).toBeNull();
  });

  it.each([
    "https://example.com/",
    "http://user:secret@localhost:5173/",
    "file:///tmp/index.html",
    "http://localhost:5173/unexpected",
  ])("rejects an untrusted renderer URL: %s", (url) => {
    expect(() => readDevRendererUrl(url)).toThrow(
      "ELECTRON_RENDERER_URL must be an uncredentialed loopback origin.",
    );
  });
});

describe("renderer document URLs", () => {
  it("keeps main and capture surfaces on exact same-origin documents", () => {
    expect(rendererDocumentUrl(null, "main")).toBe("screenfling://bundle/index.html");
    expect(rendererDocumentUrl(null, "capture")).toBe(
      "screenfling://bundle/index.html?surface=capture",
    );
    expect(rendererDocumentUrl("http://127.0.0.1:5173/", "capture")).toBe(
      "http://127.0.0.1:5173/?surface=capture",
    );
  });
});

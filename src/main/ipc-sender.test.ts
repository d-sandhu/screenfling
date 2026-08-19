import { describe, expect, it } from "vitest";

import { isTrustedIpcSenderEvidence, isTrustedRendererFrameUrl } from "./ipc-sender";

describe("IPC renderer URL policy", () => {
  it("accepts only the exact packaged entry point in production", () => {
    expect(isTrustedRendererFrameUrl("screenfling://bundle/index.html", null)).toBe(true);
    expect(isTrustedRendererFrameUrl("screenfling://bundle/settings.html", null)).toBe(false);
    expect(isTrustedRendererFrameUrl("screenfling://bundle/index.html?trusted=true", null)).toBe(
      false,
    );
  });

  it("accepts only the configured development document", () => {
    const developmentUrl = "http://127.0.0.1:5173/";
    expect(isTrustedRendererFrameUrl(developmentUrl, developmentUrl)).toBe(true);
    expect(isTrustedRendererFrameUrl("http://localhost:5173/", developmentUrl)).toBe(false);
    expect(isTrustedRendererFrameUrl("http://127.0.0.1:5173/other", developmentUrl)).toBe(false);
  });

  it("rejects malformed input and packaged URLs in development", () => {
    expect(isTrustedRendererFrameUrl("not a URL", null)).toBe(false);
    expect(
      isTrustedRendererFrameUrl("screenfling://bundle/index.html", "http://127.0.0.1:5173/"),
    ).toBe(false);
  });
});

describe("IPC sender evidence policy", () => {
  const trustedEvidence = {
    webContentsMatches: true,
    mainFrameMatches: true,
    frameUrl: "screenfling://bundle/index.html",
  };

  it("requires the selected main window, its main frame, and its exact URL", () => {
    expect(isTrustedIpcSenderEvidence(trustedEvidence, null)).toBe(true);
  });

  it.each([
    { ...trustedEvidence, webContentsMatches: false },
    { ...trustedEvidence, mainFrameMatches: false },
    { ...trustedEvidence, frameUrl: null },
    { ...trustedEvidence, frameUrl: "screenfling://bundle/other.html" },
  ])("rejects mismatched, child-frame, closed-window, or wrong-URL evidence", (evidence) => {
    expect(isTrustedIpcSenderEvidence(evidence, null)).toBe(false);
  });
});

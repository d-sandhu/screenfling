import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IdleCaptureActions, ScreenCaptureReadiness } from "./screen-capture-readiness";

import type { ScreenCaptureReadinessSnapshot } from "../../shared/screen-capture-readiness";

function render(
  readiness: ScreenCaptureReadinessSnapshot | null,
  refreshState: "checking" | "idle" = "idle",
): string {
  return renderToStaticMarkup(
    createElement(ScreenCaptureReadiness, {
      onRefresh: () => undefined,
      readiness,
      refreshState,
    }),
  );
}

describe("Screen Recording readiness", () => {
  it("renders an accessible loading state", () => {
    const markup = render(null);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Checking Screen Recording…");
  });

  it.each([
    ["granted", "Permission reported granted", "still validates"],
    ["not-determined", "Permission not confirmed", "first capture may ask macOS"],
    ["denied", "Permission is off", "Screen &amp; System Audio Recording"],
    ["restricted", "Permission is restricted", "restart ScreenFling"],
    ["unknown", "Status unavailable", "Capture remains available"],
  ] as const)("renders honest macOS %s guidance", (status, title, detail) => {
    const markup = render({ platform: "macos", status, version: 1 });
    expect(markup).toContain(title);
    expect(markup).toContain(detail);
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Check again");
  });

  it.each(["windows", "linux", "other"] as const)(
    "does not claim a macOS permission result on %s",
    (platform) => {
      const markup = render({ platform, status: "not-applicable", version: 1 });
      expect(markup).toContain("Checked during capture");
      expect(markup).not.toContain("Permission reported granted");
    },
  );

  it("labels a pending manual recheck", () => {
    expect(render({ platform: "macos", status: "denied", version: 1 }, "checking")).toContain(
      "Checking…",
    );
  });

  it("keeps the native Capture action available when permission is reported denied", () => {
    const markup = renderToStaticMarkup(
      createElement(IdleCaptureActions, {
        onRefresh: () => undefined,
        onStartCapture: () => undefined,
        readiness: { platform: "macos", status: "denied", version: 1 },
        refreshState: "idle",
        startState: "idle",
      }),
    );

    expect(markup).toContain("Permission is off");
    expect(markup).toContain(
      '<button class="button button--primary button--capture" type="button">',
    );
    expect(markup).toContain('<button class="text-button" type="button">Check again</button>');
  });
});

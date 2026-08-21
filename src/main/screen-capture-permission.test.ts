import { describe, expect, it } from "vitest";

import { screenCapturePermissionPolicy } from "./screen-capture-permission";

describe("screen capture permission policy", () => {
  it.each([
    ["denied", "blocked"],
    ["restricted", "blocked"],
    ["not-determined", "attempt"],
    ["granted", "attempt"],
    ["unknown", "attempt"],
  ] as const)("maps macOS %s to %s", (status, expected) => {
    expect(screenCapturePermissionPolicy(status, "darwin")).toBe(expected);
  });

  it.each(["win32", "linux"] as const)(
    "does not fabricate a screen-permission block on %s",
    (platform) => {
      for (const status of [
        "denied",
        "restricted",
        "not-determined",
        "granted",
        "unknown",
      ] as const) {
        expect(screenCapturePermissionPolicy(status, platform)).toBe("allowed");
      }
    },
  );
});

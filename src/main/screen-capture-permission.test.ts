import { describe, expect, it } from "vitest";

import {
  readScreenCaptureReadiness,
  screenCapturePermissionPolicy,
} from "./screen-capture-permission";

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

describe("screen capture readiness", () => {
  it.each(["not-determined", "granted", "denied", "restricted", "unknown"] as const)(
    "reports the macOS %s status without upgrading it to capture evidence",
    (status) => {
      expect(readScreenCaptureReadiness("darwin", () => status)).toEqual({
        platform: "macos",
        status,
        version: 1,
      });
    },
  );

  it.each([
    ["win32", "windows"],
    ["linux", "linux"],
    ["freebsd", "other"],
  ] as const)("does not query or fabricate macOS TCC state on %s", (platform, expected) => {
    let reads = 0;
    expect(
      readScreenCaptureReadiness(platform, () => {
        reads += 1;
        return "granted";
      }),
    ).toEqual({ platform: expected, status: "not-applicable", version: 1 });
    expect(reads).toBe(0);
  });

  it("fails closed to an unknown status without leaking an Electron error", () => {
    expect(
      readScreenCaptureReadiness("darwin", () => {
        throw new Error("private host detail");
      }),
    ).toEqual({ platform: "macos", status: "unknown", version: 1 });
  });

  it("normalizes an unexpected runtime status to unknown", () => {
    expect(readScreenCaptureReadiness("darwin", () => "limited")).toEqual({
      platform: "macos",
      status: "unknown",
      version: 1,
    });
  });
});

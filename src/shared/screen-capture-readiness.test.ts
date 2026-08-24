import { describe, expect, it } from "vitest";

import { screenCaptureReadinessSchema } from "./screen-capture-readiness";

describe("screen capture readiness contract", () => {
  it.each(["not-determined", "granted", "denied", "restricted", "unknown"] as const)(
    "accepts the closed macOS %s status",
    (status) => {
      expect(screenCaptureReadinessSchema.parse({ platform: "macos", status, version: 1 })).toEqual(
        { platform: "macos", status, version: 1 },
      );
    },
  );

  it.each(["windows", "linux", "other"] as const)(
    "uses not-applicable rather than a fabricated permission on %s",
    (platform) => {
      expect(
        screenCaptureReadinessSchema.parse({
          platform,
          status: "not-applicable",
          version: 1,
        }),
      ).toEqual({ platform, status: "not-applicable", version: 1 });
      expect(
        screenCaptureReadinessSchema.safeParse({ platform, status: "granted", version: 1 }).success,
      ).toBe(false);
    },
  );

  it.each([
    { platform: "macos", status: "granted", version: 2 },
    { extra: true, platform: "macos", status: "granted", version: 1 },
    { platform: "macos", status: "not-applicable", version: 1 },
    { platform: "plan9", status: "not-applicable", version: 1 },
  ])("rejects malformed or expanded readiness values", (value) => {
    expect(screenCaptureReadinessSchema.safeParse(value).success).toBe(false);
  });
});

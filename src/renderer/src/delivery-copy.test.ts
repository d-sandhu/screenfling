import { describe, expect, it } from "vitest";

import { failureCopy } from "./delivery-copy";

describe("delivery result copy", () => {
  it("gives recoverable macOS Screen Recording guidance", () => {
    expect(failureCopy("permission-blocked")).toEqual({
      title: "Capture stopped",
      detail:
        "Screen Recording access is off for ScreenFling. Enable it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart ScreenFling.",
    });
  });
});

import { describe, expect, it } from "vitest";

import { deliveryCopy, failureCopy } from "./delivery-copy";

import type { DeliveryResult } from "../../shared/workflow";

const DESTINATION = {
  id: "wezterm:generation-a:7",
  adapter: "wezterm",
  surface: { kind: "pane", locator: "7" },
} as const;

describe("delivery result copy", () => {
  it("gives recoverable macOS Screen Recording guidance", () => {
    expect(failureCopy("permission-blocked")).toEqual({
      title: "Capture stopped",
      detail:
        "Screen Recording access is off for ScreenFling. Enable it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart ScreenFling.",
    });
  });

  it.each([
    [
      { status: "failed", reason: "target-stale" },
      "The selected destination changed before Stage. The image remains on your clipboard for manual paste.",
    ],
    [
      { status: "failed", reason: "unsupported" },
      "This destination does not support the requested Stage action. The image remains on your clipboard for manual paste.",
    ],
    [
      { status: "failed", reason: "dispatch-failed" },
      "ScreenFling could not confirm the destination operation. The image remains on your clipboard for manual paste.",
    ],
  ] satisfies readonly (readonly [DeliveryResult, string])[])(
    "preserves explicit manual fallback for %j",
    (result, detail) => {
      expect(deliveryCopy(result)).toEqual({ title: "Capture stopped", detail });
    },
  );

  it("keeps the clipboard fallback explicit after uncertain dispatch", () => {
    expect(deliveryCopy({ status: "dispatched-unverified", destination: DESTINATION })).toEqual({
      title: "Staged — unverified",
      detail:
        "Input was dispatched to WezTerm · pane 7 without submission. Attachment could not be verified; the image remains on your clipboard for manual paste.",
    });
  });

  it("does not claim clipboard fallback when the image write could not be verified", () => {
    const copy = deliveryCopy({ status: "failed", reason: "clipboard-failed" });
    expect(copy).toEqual({
      title: "Capture stopped",
      detail: "ScreenFling could not verify the image on the clipboard, so Stage stopped.",
    });
    expect(copy.detail).not.toContain("remains on your clipboard");
  });
});

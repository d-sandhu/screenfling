import { describe, expect, it } from "vitest";

import { deliveryCopy, failureCopy, revealCopy } from "./delivery-copy";

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
      "The selected destination changed before Stage. The image was copied to your clipboard for manual paste. Check the clipboard before pasting.",
    ],
    [
      { status: "failed", reason: "unsupported" },
      "This destination does not support the requested Stage action. The image was copied to your clipboard for manual paste. Check the clipboard before pasting.",
    ],
    [
      { status: "failed", reason: "dispatch-failed" },
      "ScreenFling could not confirm the destination operation. Check the chosen destination before pasting again. The image was copied to your clipboard for manual paste. Check the clipboard before pasting.",
    ],
  ] satisfies readonly (readonly [DeliveryResult, string])[])(
    "preserves explicit manual fallback for %j",
    (result, detail) => {
      expect(deliveryCopy(result)).toEqual({ title: "Capture stopped", detail });
      expect(detail).not.toContain("remains on your clipboard");
      expect(detail).toContain("Check the clipboard before pasting.");
    },
  );

  it("keeps the clipboard fallback explicit after uncertain dispatch", () => {
    expect(deliveryCopy({ status: "dispatched-unverified", destination: DESTINATION })).toEqual({
      title: "Staged — unverified",
      detail:
        "Stage was attempted once for WezTerm · pane 7 without Enter. Attachment could not be verified. Check that destination before pasting again. The image was verified on your clipboard.",
    });
  });

  it("does not claim clipboard fallback when the image write could not be verified", () => {
    const copy = deliveryCopy({ status: "failed", reason: "clipboard-failed" });
    expect(copy).toEqual({
      title: "Capture stopped",
      detail:
        "ScreenFling could not verify the image on the clipboard. No Stage was attempted. Check the clipboard before trying again.",
    });
    expect(copy.detail).not.toContain("remains on your clipboard");
  });
});

describe("Reveal result copy", () => {
  it("describes activation honestly without claiming foreground or delivery", () => {
    const copy = revealCopy({ status: "revealed" });
    expect(copy).toEqual({
      title: "Reveal requested",
      detail:
        "WezTerm accepted the exact-pane activation request. ScreenFling cannot verify operating-system foreground or visibility.",
    });
    expect(copy.detail).not.toMatch(/attached|sent|submitted/u);
  });

  it.each(["stale", "unavailable", "unsupported", "failed"] as const)(
    "keeps the Stage result explicit after %s",
    (status) => {
      expect(revealCopy({ status }).detail).toContain("Stage result is unchanged");
    },
  );
});

it("does not claim that an unexpected outcome had no side effects", () => {
  const copy = deliveryCopy({ status: "failed", reason: "unexpected" });
  expect(copy.detail).toContain("Check the clipboard and chosen destination");
  expect(copy.detail).not.toContain("before delivering anything");
});

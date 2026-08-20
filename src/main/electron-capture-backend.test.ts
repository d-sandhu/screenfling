import { describe, expect, it } from "vitest";

import { CaptureUnavailableError } from "./capture-session";
import {
  isSameCaptureDisplay,
  requestedCaptureSize,
  selectExactScreenSource,
} from "./electron-capture-backend";

import type { CaptureImage } from "./capture-session";
import type { PixelCrop, PixelSize } from "../shared/capture-geometry";

class SourceImage implements CaptureImage {
  crop(_crop: PixelCrop): CaptureImage {
    return this;
  }

  getSize(): PixelSize {
    return { width: 1, height: 1 };
  }

  isEmpty(): boolean {
    return false;
  }

  toBitmap(): Uint8Array {
    return Uint8Array.from([1]);
  }

  toJPEG(_quality: number): Uint8Array {
    return Uint8Array.from([1]);
  }

  toPNG(): Uint8Array {
    return Uint8Array.from([1]);
  }
}

describe("Electron display capture selection", () => {
  it("requests the display physical-pixel dimensions", () => {
    expect(
      requestedCaptureSize({
        id: "1",
        x: 0,
        y: 0,
        width: 1512,
        height: 982,
        scaleFactor: 2,
        rotation: 0,
      }),
    ).toEqual({ width: 3024, height: 1964 });
  });

  it("treats display geometry as part of the capture generation", () => {
    const selected = {
      id: "1",
      x: -1512,
      y: 0,
      width: 1512,
      height: 982,
      scaleFactor: 2,
      rotation: 0,
    };
    expect(isSameCaptureDisplay(selected, selected)).toBe(true);
    expect(isSameCaptureDisplay(selected, { ...selected, scaleFactor: 1 })).toBe(false);
    expect(isSameCaptureDisplay(selected, { ...selected, rotation: 90 })).toBe(false);
    expect(isSameCaptureDisplay(selected, { ...selected, x: 0 })).toBe(false);
    expect(isSameCaptureDisplay(selected, { ...selected, width: 982, height: 1512 })).toBe(false);
  });

  it("selects exactly one source by display ID", () => {
    const selected = new SourceImage();
    expect(
      selectExactScreenSource("42", [
        { displayId: "1", image: new SourceImage() },
        { displayId: "42", image: selected },
      ]),
    ).toBe(selected);
  });

  it.each([
    { sources: [] },
    {
      sources: [
        { displayId: "42", image: new SourceImage() },
        { displayId: "42", image: new SourceImage() },
      ],
    },
  ])("fails closed on missing or ambiguous display sources", ({ sources }) => {
    expect(() => selectExactScreenSource("42", sources)).toThrow(CaptureUnavailableError);
  });

  it("rejects unsafe requested geometry", () => {
    expect(() =>
      requestedCaptureSize({
        id: "1",
        x: 0,
        y: 0,
        width: Number.MAX_VALUE,
        height: 100,
        scaleFactor: 2,
        rotation: 0,
      }),
    ).toThrow(CaptureUnavailableError);
  });
});

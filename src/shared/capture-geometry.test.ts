import { describe, expect, it } from "vitest";

import { InvalidCaptureGeometryError, mapDipSelectionToPixelCrop } from "./capture-geometry";

describe("display-local DIP to returned-image pixel mapping", () => {
  it("maps a fractional Retina selection with inclusive crop coverage", () => {
    expect(
      mapDipSelectionToPixelCrop(
        { x: 378, y: 217.75, width: 756, height: 435.5 },
        { width: 1512, height: 982 },
        { width: 3024, height: 1964 },
      ),
    ).toEqual({ x: 756, y: 435, width: 1512, height: 872 });
  });

  it("uses independent measured ratios for fractional scaling", () => {
    expect(
      mapDipSelectionToPixelCrop(
        { x: 10.2, y: 20.4, width: 100.3, height: 200.2 },
        { width: 1920, height: 1080 },
        { width: 3000, height: 1688 },
      ),
    ).toEqual({ x: 15, y: 31, width: 158, height: 314 });
  });

  it("maps the complete display to the exact returned image bounds", () => {
    expect(
      mapDipSelectionToPixelCrop(
        { x: 0, y: 0, width: 2560, height: 1440 },
        { width: 2560, height: 1440 },
        { width: 3840, height: 2160 },
      ),
    ).toEqual({ x: 0, y: 0, width: 3840, height: 2160 });
  });

  it("preserves a non-empty crop for a tiny valid selection", () => {
    expect(
      mapDipSelectionToPixelCrop(
        { x: 100.01, y: 200.01, width: 0.01, height: 0.01 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 100, y: 200, width: 1, height: 1 });
  });

  it.each([
    [
      { x: -1, y: 0, width: 10, height: 10 },
      { width: 100, height: 100 },
    ],
    [
      { x: 0, y: 0, width: 0, height: 10 },
      { width: 100, height: 100 },
    ],
    [
      { x: 95, y: 0, width: 10, height: 10 },
      { width: 100, height: 100 },
    ],
    [
      { x: 0, y: 95, width: 10, height: 10 },
      { width: 100, height: 100 },
    ],
    [
      { x: Number.NaN, y: 0, width: 10, height: 10 },
      { width: 100, height: 100 },
    ],
  ])("rejects invalid or non-local selection geometry", (selection, displaySize) => {
    expect(() =>
      mapDipSelectionToPixelCrop(selection, displaySize, { width: 200, height: 200 }),
    ).toThrow(InvalidCaptureGeometryError);
  });

  it.each([
    [
      { width: 0, height: 100 },
      { width: 200, height: 200 },
    ],
    [
      { width: Number.MIN_VALUE, height: 100 },
      { width: 200, height: 200 },
    ],
    [
      { width: 100, height: Number.POSITIVE_INFINITY },
      { width: 200, height: 200 },
    ],
    [
      { width: 100, height: 100 },
      { width: 200.5, height: 200 },
    ],
    [
      { width: 100, height: 100 },
      { width: 200, height: -1 },
    ],
  ])("rejects invalid display or returned-image sizes", (displaySize, returnedImageSize) => {
    expect(() =>
      mapDipSelectionToPixelCrop(
        { x: 0, y: 0, width: 10, height: 10 },
        displaySize,
        returnedImageSize,
      ),
    ).toThrow(InvalidCaptureGeometryError);
  });
});

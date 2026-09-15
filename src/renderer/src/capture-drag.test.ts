import { describe, expect, it } from "vitest";

import { CaptureDragTracker, pointOnDisplay } from "./capture-drag";
import { mapDipSelectionToPixelCrop } from "../../shared/capture-geometry";

describe("capture drag tracker", () => {
  it("owns synchronous pointer progress without waiting for a render", () => {
    const tracker = new CaptureDragTracker();

    expect(tracker.begin({ x: 10, y: 20 })).toEqual({
      current: { x: 10, y: 20 },
      start: { x: 10, y: 20 },
    });
    expect(tracker.move({ x: 40, y: 70 })).toEqual({
      current: { x: 40, y: 70 },
      start: { x: 10, y: 20 },
    });
    expect(tracker.complete({ x: 80, y: 90 })).toEqual({
      drag: { current: { x: 80, y: 90 }, start: { x: 10, y: 20 } },
      selection: { x: 10, y: 20, width: 70, height: 70 },
    });
  });

  it("normalizes a reverse drag and clears completed state", () => {
    const tracker = new CaptureDragTracker();
    tracker.begin({ x: 90, y: 80 });

    expect(tracker.complete({ x: 30, y: 20 })?.selection).toEqual({
      x: 30,
      y: 20,
      width: 60,
      height: 60,
    });
    expect(tracker.move({ x: 100, y: 100 })).toBeNull();
  });

  it("clears an abandoned drag", () => {
    const tracker = new CaptureDragTracker();
    tracker.begin({ x: 10, y: 10 });
    tracker.cancel();

    expect(tracker.complete({ x: 20, y: 20 })).toBeNull();
  });
});

describe("capture coordinates under page zoom", () => {
  it.each([0.5, 1, 1.25, 2])("keeps the same crop at %s zoom without double-applying Retina scale", (zoom) => {
    const display = { id: "42", x: -1920, y: -1080, width: 1920, height: 1080, scaleFactor: 2, rotation: 0 };
    const bounds = { left: 0, top: 0, width: display.width / zoom, height: display.height / zoom };
    const tracker = new CaptureDragTracker();
    tracker.begin(pointOnDisplay({ x: 960 / zoom, y: 540 / zoom }, bounds, display));
    const result = tracker.complete(pointOnDisplay({ x: 240 / zoom, y: 135 / zoom }, bounds, display));
    expect(result?.selection).toEqual({ x: 240, y: 135, width: 720, height: 405 });
    if (result === null) throw new Error("Expected a completed selection.");
    expect(mapDipSelectionToPixelCrop(result.selection, display, { width: 3840, height: 2160 })).toEqual({
      x: 480, y: 270, width: 1440, height: 810,
    });
  });

  it("uses the actual content bounds and clamps captured pointers outside the display", () => {
    const bounds = { left: 10, top: 20, width: 800, height: 400 };
    const display = { width: 1600, height: 1200 };
    expect(pointOnDisplay({ x: 210, y: 120 }, bounds, display)).toEqual({ x: 400, y: 300 });
    expect(pointOnDisplay({ x: -50, y: -50 }, bounds, display)).toEqual({ x: 0, y: 0 });
    expect(pointOnDisplay({ x: 900, y: 500 }, bounds, display)).toEqual({ x: 1600, y: 1200 });
  });
});

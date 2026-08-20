import { describe, expect, it } from "vitest";

import { CaptureDragTracker } from "./capture-drag";

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

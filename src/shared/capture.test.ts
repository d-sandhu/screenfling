import { describe, expect, it } from "vitest";

import {
  MAX_CAPTURE_PREVIEW_BYTES,
  captureDraftSchema,
  captureOverlaySnapshotSchema,
  dipSelectionSchema,
} from "./capture";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("capture IPC contracts", () => {
  it("accepts a bounded snapshot with measured geometry", () => {
    const snapshot = captureOverlaySnapshotSchema.parse({
      operationId: OPERATION_ID,
      display: { id: "1", width: 1512, height: 982, scaleFactor: 2, rotation: 0 },
      returnedPixels: { width: 3024, height: 1964 },
      preview: Uint8Array.from([1, 2, 3]),
    });

    expect(snapshot.returnedPixels).toEqual({ width: 3024, height: 1964 });
  });

  it.each([new Uint8Array(), new Uint8Array(MAX_CAPTURE_PREVIEW_BYTES + 1)])(
    "rejects empty or oversized preview data",
    (preview) => {
      expect(
        captureOverlaySnapshotSchema.safeParse({
          operationId: OPERATION_ID,
          display: { id: "1", width: 100, height: 100, scaleFactor: 1, rotation: 0 },
          returnedPixels: { width: 100, height: 100 },
          preview,
        }).success,
      ).toBe(false);
    },
  );

  it("rejects non-local selection values and expanded draft payloads", () => {
    expect(dipSelectionSchema.safeParse({ x: -1, y: 0, width: 10, height: 10 }).success).toBe(
      false,
    );
    expect(
      captureDraftSchema.safeParse({
        operationId: OPERATION_ID,
        selection: { x: 0, y: 0, width: 10, height: 10 },
        pixels: { width: 20, height: 20 },
        preview: Uint8Array.from([1]),
        path: "/not-allowed.png",
      }).success,
    ).toBe(false);
  });
});

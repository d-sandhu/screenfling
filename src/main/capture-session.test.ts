import { describe, expect, it } from "vitest";

import {
  CaptureSession,
  CaptureSessionStateError,
  CaptureUnavailableError,
  ClipboardWriteError,
} from "./capture-session";

import type {
  CaptureBackend,
  CaptureDisplay,
  CaptureImage,
  CapturedDisplay,
  ClipboardImageEvidence,
  ImageClipboard,
} from "./capture-session";
import type { PixelCrop, PixelSize } from "../shared/capture-geometry";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const STALE_OPERATION_ID = "8b2165ea-699b-44f1-a497-95df2f997834";
const DISPLAY: CaptureDisplay = {
  id: "42",
  x: -1512,
  y: 0,
  width: 1512,
  height: 982,
  scaleFactor: 2,
  rotation: 0,
};

class FakeImage implements CaptureImage {
  readonly crops: PixelCrop[] = [];
  readonly #empty: boolean;
  readonly #jpeg: Uint8Array;
  readonly #size: PixelSize;

  constructor(size: PixelSize, empty = false, jpeg = Uint8Array.from([1, 2, 3])) {
    this.#size = size;
    this.#empty = empty;
    this.#jpeg = jpeg;
  }

  crop(crop: PixelCrop): CaptureImage {
    this.crops.push(crop);
    return new FakeImage({ width: crop.width, height: crop.height });
  }

  getSize(): PixelSize {
    return this.#size;
  }

  isEmpty(): boolean {
    return this.#empty;
  }

  toBitmap(): Uint8Array {
    return Uint8Array.from([4, 3, 2, 1]);
  }

  toJPEG(_quality: number): Uint8Array {
    return this.#jpeg;
  }

  toPNG(): Uint8Array {
    return Uint8Array.from([137, 80, 78, 71]);
  }
}

class FakeBackend implements CaptureBackend {
  readonly #capture: CapturedDisplay;
  calls = 0;

  constructor(capture: CapturedDisplay) {
    this.#capture = capture;
  }

  async captureDisplay(_display: CaptureDisplay): Promise<CapturedDisplay> {
    this.calls += 1;
    return this.#capture;
  }

  getDisplayAtPointer(): CaptureDisplay {
    return this.#capture.display;
  }
}

class FakeClipboard implements ImageClipboard {
  readback: ClipboardImageEvidence | null = null;
  throwOnWrite = false;
  throwOnRead = false;
  writes: Uint8Array[] = [];

  readImageEvidence(): ClipboardImageEvidence | null {
    if (this.throwOnRead) throw new Error("synthetic-clipboard-read-failure");
    return this.readback;
  }

  writePng(png: Uint8Array): void {
    if (this.throwOnWrite) throw new Error("instrumented clipboard failure");
    this.writes.push(png);
  }
}

function createCapture(image = new FakeImage({ width: 3024, height: 1964 })) {
  const backend = new FakeBackend({
    display: DISPLAY,
    image,
  });
  const clipboard = new FakeClipboard();
  const session = new CaptureSession(backend, clipboard);
  return { backend, clipboard, image, session };
}

function beginAtPointer(session: CaptureSession, operationId = OPERATION_ID) {
  return session.begin(operationId, session.getDisplayAtPointer());
}

describe("production capture session", () => {
  it("rechecks exact current pixels without writing and refuses stale, missing, or unreadable evidence", async () => {
    const { clipboard, session } = createCapture();
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(false);
    await beginAtPointer(session);
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(false);
    const { pixels } = session.complete(OPERATION_ID, { x: 10, y: 10, width: 20, height: 20 });
    const bitmap = Uint8Array.from([4, 3, 2, 1]);
    clipboard.readback = { bitmap, size: pixels };
    session.copy(OPERATION_ID);
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(true);
    expect(session.isClipboardCurrent(STALE_OPERATION_ID)).toBe(false);
    clipboard.readback = { bitmap, size: { width: pixels.width + 1, height: pixels.height } };
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(false);
    clipboard.readback = { bitmap: Uint8Array.from([9, 8, 7, 6]), size: pixels };
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(false);
    clipboard.readback = null;
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(false);
    clipboard.readback = { bitmap, size: pixels };
    clipboard.throwOnRead = true;
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(false);
    clipboard.throwOnRead = false;
    session.release(OPERATION_ID);
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(false);
    expect(clipboard.writes).toHaveLength(1);
  });

  it("retains a lossless capture while exposing only a bounded overlay preview", async () => {
    const { backend, session } = createCapture();

    await expect(beginAtPointer(session)).resolves.toEqual({
      operationId: OPERATION_ID,
      display: DISPLAY,
      returnedPixels: { width: 3024, height: 1964 },
      preview: Uint8Array.from([1, 2, 3]),
    });
    expect(backend.calls).toBe(1);
    expect(session.activeOperationId).toBe(OPERATION_ID);
    expect(session.activeDisplayId).toBe("42");
  });

  it("maps, crops, and writes PNG only after explicit Copy", async () => {
    const { clipboard, image, session } = createCapture();
    await beginAtPointer(session);

    const draft = session.complete(OPERATION_ID, {
      x: 378,
      y: 217.75,
      width: 756,
      height: 435.5,
    });

    expect(image.crops).toEqual([{ x: 756, y: 435, width: 1512, height: 872 }]);
    expect(draft.pixels).toEqual({ width: 1512, height: 872 });
    expect(session.getDraft(OPERATION_ID)).toBe(draft);
    expect(clipboard.writes).toHaveLength(0);

    clipboard.readback = {
      bitmap: Uint8Array.from([4, 3, 2, 1]),
      size: { width: 1512, height: 872 },
    };
    session.copy(OPERATION_ID);
    expect(clipboard.writes).toEqual([Uint8Array.from([137, 80, 78, 71])]);
  });

  it("keeps a full-display selection usable when its crop shares the source object", async () => {
    class WholeDisplayImage extends FakeImage {
      override crop(_crop: PixelCrop): CaptureImage {
        return this;
      }
    }
    const { clipboard, image, session } = createCapture(
      new WholeDisplayImage({ width: 3024, height: 1964 }),
    );
    await beginAtPointer(session);
    const selection = { x: 0, y: 0, width: DISPLAY.width, height: DISPLAY.height };
    const draft = session.complete(OPERATION_ID, selection);

    expect(draft.pixels).toEqual(image.getSize());
    expect(clipboard.writes).toHaveLength(0);
    expect(() => session.complete(OPERATION_ID, selection)).toThrow(CaptureSessionStateError);
    clipboard.readback = { bitmap: image.toBitmap(), size: draft.pixels };
    session.copy(OPERATION_ID);
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(true);
    expect(session.getDraft(OPERATION_ID)).toBe(draft);
    expect(session.activeDisplayId).toBe(DISPLAY.id);
    session.release(OPERATION_ID);
    expect(session.isClipboardCurrent(OPERATION_ID)).toBe(false);
    expect(clipboard.writes).toHaveLength(1);
  });

  it("releases a cancelled capture without touching the clipboard", async () => {
    const { clipboard, session } = createCapture();
    await beginAtPointer(session);

    session.release(OPERATION_ID);

    expect(session.activeOperationId).toBeNull();
    expect(clipboard.writes).toHaveLength(0);
  });

  it("rejects stale, duplicate, and pre-crop operations", async () => {
    const { session } = createCapture();
    await beginAtPointer(session);

    await expect(beginAtPointer(session, STALE_OPERATION_ID)).rejects.toThrow(
      CaptureSessionStateError,
    );
    expect(() => session.complete(STALE_OPERATION_ID, { x: 0, y: 0, width: 1, height: 1 })).toThrow(
      CaptureSessionStateError,
    );
    expect(() => session.copy(OPERATION_ID)).toThrow(CaptureSessionStateError);
  });

  it("rejects a concurrent begin while the first capture is pending", async () => {
    const capture = {
      display: { ...DISPLAY, x: 0, width: 100, height: 100, scaleFactor: 1 },
      image: new FakeImage({ width: 100, height: 100 }),
    };
    let finishCapture: (capture: CapturedDisplay) => void = () => undefined;
    const backend: CaptureBackend = {
      captureDisplay: () =>
        new Promise((resolve) => {
          finishCapture = resolve;
        }),
      getDisplayAtPointer: () => capture.display,
    };
    const session = new CaptureSession(backend, new FakeClipboard());

    const first = beginAtPointer(session);
    await expect(beginAtPointer(session, STALE_OPERATION_ID)).rejects.toThrow(
      CaptureSessionStateError,
    );
    finishCapture(capture);
    await expect(first).resolves.toMatchObject({ operationId: OPERATION_ID });
  });

  it("does not install a pending capture after cancellation", async () => {
    const capture = {
      display: { ...DISPLAY, x: 0, width: 100, height: 100, scaleFactor: 1 },
      image: new FakeImage({ width: 100, height: 100 }),
    };
    let finishCapture: (capture: CapturedDisplay) => void = () => undefined;
    const session = new CaptureSession(
      {
        captureDisplay: () =>
          new Promise((resolve) => {
            finishCapture = resolve;
          }),
        getDisplayAtPointer: () => capture.display,
      },
      new FakeClipboard(),
    );

    const pending = beginAtPointer(session);
    session.release(OPERATION_ID);
    finishCapture(capture);

    await expect(pending).rejects.toThrow(CaptureSessionStateError);
    expect(session.activeOperationId).toBeNull();
  });

  it("invalidates a pending capture on any display topology change", async () => {
    const capture = {
      display: { ...DISPLAY, x: 0, width: 100, height: 100, scaleFactor: 1 },
      image: new FakeImage({ width: 100, height: 100 }),
    };
    let finishCapture: (capture: CapturedDisplay) => void = () => undefined;
    const session = new CaptureSession(
      {
        captureDisplay: () =>
          new Promise((resolve) => {
            finishCapture = resolve;
          }),
        getDisplayAtPointer: () => capture.display,
      },
      new FakeClipboard(),
    );

    const pending = beginAtPointer(session);
    expect(session.invalidateDisplay("display-added-or-changed")).toBe(OPERATION_ID);
    finishCapture(capture);

    await expect(pending).rejects.toThrow(CaptureSessionStateError);
    expect(session.activeOperationId).toBeNull();
  });

  it("invalidates only the active display generation", async () => {
    const { session } = createCapture();
    await beginAtPointer(session);

    expect(session.invalidateDisplay("another-display")).toBeNull();
    expect(session.invalidateDisplay("42")).toBe(OPERATION_ID);
    expect(session.activeOperationId).toBeNull();
  });

  it("rejects empty captures and mismatched clipboard pixel evidence", async () => {
    const emptyCapture = createCapture(new FakeImage({ width: 100, height: 100 }, true));
    await expect(beginAtPointer(emptyCapture.session)).rejects.toThrow(CaptureUnavailableError);

    const { clipboard, session } = createCapture();
    await beginAtPointer(session);
    session.complete(OPERATION_ID, { x: 0, y: 0, width: 10, height: 10 });
    clipboard.readback = {
      bitmap: Uint8Array.from([9, 9, 9]),
      size: { width: 20, height: 20 },
    };
    expect(() => session.copy(OPERATION_ID)).toThrow(ClipboardWriteError);
  });

  it("normalizes clipboard implementation failures", async () => {
    const { clipboard, session } = createCapture();
    await beginAtPointer(session);
    session.complete(OPERATION_ID, { x: 0, y: 0, width: 10, height: 10 });
    clipboard.throwOnWrite = true;

    expect(() => session.copy(OPERATION_ID)).toThrow(ClipboardWriteError);
  });
});

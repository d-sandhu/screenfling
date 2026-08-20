import { describe, expect, it } from "vitest";

import {
  CaptureSession,
  CaptureSessionStateError,
  CaptureUnavailableError,
  ClipboardWriteError,
} from "./capture-session";

import type {
  CaptureBackend,
  CaptureImage,
  CapturedDisplay,
  ClipboardImageEvidence,
  ImageClipboard,
} from "./capture-session";
import type { PixelCrop, PixelSize } from "../shared/capture-geometry";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const STALE_OPERATION_ID = "8b2165ea-699b-44f1-a497-95df2f997834";

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

  async captureDisplayAtPointer(): Promise<CapturedDisplay> {
    this.calls += 1;
    return this.#capture;
  }
}

class FakeClipboard implements ImageClipboard {
  readback: ClipboardImageEvidence | null = null;
  throwOnWrite = false;
  writes: Uint8Array[] = [];

  readImageEvidence(): ClipboardImageEvidence | null {
    return this.readback;
  }

  writePng(png: Uint8Array): void {
    if (this.throwOnWrite) throw new Error("instrumented clipboard failure");
    this.writes.push(png);
  }
}

function createCapture(image = new FakeImage({ width: 3024, height: 1964 })) {
  const backend = new FakeBackend({
    display: { id: "42", width: 1512, height: 982, scaleFactor: 2, rotation: 0 },
    image,
  });
  const clipboard = new FakeClipboard();
  const session = new CaptureSession(backend, clipboard);
  return { backend, clipboard, image, session };
}

describe("production capture session", () => {
  it("retains a lossless capture while exposing only a bounded overlay preview", async () => {
    const { backend, session } = createCapture();

    await expect(session.begin(OPERATION_ID)).resolves.toEqual({
      operationId: OPERATION_ID,
      display: { id: "42", width: 1512, height: 982, scaleFactor: 2, rotation: 0 },
      returnedPixels: { width: 3024, height: 1964 },
      preview: Uint8Array.from([1, 2, 3]),
    });
    expect(backend.calls).toBe(1);
    expect(session.activeOperationId).toBe(OPERATION_ID);
    expect(session.activeDisplayId).toBe("42");
  });

  it("maps, crops, and writes PNG only after explicit Copy", async () => {
    const { clipboard, image, session } = createCapture();
    await session.begin(OPERATION_ID);

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

  it("releases a cancelled capture without touching the clipboard", async () => {
    const { clipboard, session } = createCapture();
    await session.begin(OPERATION_ID);

    session.release(OPERATION_ID);

    expect(session.activeOperationId).toBeNull();
    expect(clipboard.writes).toHaveLength(0);
  });

  it("rejects stale, duplicate, and pre-crop operations", async () => {
    const { session } = createCapture();
    await session.begin(OPERATION_ID);

    await expect(session.begin(STALE_OPERATION_ID)).rejects.toThrow(CaptureSessionStateError);
    expect(() => session.complete(STALE_OPERATION_ID, { x: 0, y: 0, width: 1, height: 1 })).toThrow(
      CaptureSessionStateError,
    );
    expect(() => session.copy(OPERATION_ID)).toThrow(CaptureSessionStateError);
  });

  it("rejects a concurrent begin while the first capture is pending", async () => {
    const capture = {
      display: { id: "42", width: 100, height: 100, scaleFactor: 1, rotation: 0 },
      image: new FakeImage({ width: 100, height: 100 }),
    };
    let finishCapture: (capture: CapturedDisplay) => void = () => undefined;
    const backend: CaptureBackend = {
      captureDisplayAtPointer: () =>
        new Promise((resolve) => {
          finishCapture = resolve;
        }),
    };
    const session = new CaptureSession(backend, new FakeClipboard());

    const first = session.begin(OPERATION_ID);
    await expect(session.begin(STALE_OPERATION_ID)).rejects.toThrow(CaptureSessionStateError);
    finishCapture(capture);
    await expect(first).resolves.toMatchObject({ operationId: OPERATION_ID });
  });

  it("does not install a pending capture after cancellation", async () => {
    const capture = {
      display: { id: "42", width: 100, height: 100, scaleFactor: 1, rotation: 0 },
      image: new FakeImage({ width: 100, height: 100 }),
    };
    let finishCapture: (capture: CapturedDisplay) => void = () => undefined;
    const session = new CaptureSession(
      {
        captureDisplayAtPointer: () =>
          new Promise((resolve) => {
            finishCapture = resolve;
          }),
      },
      new FakeClipboard(),
    );

    const pending = session.begin(OPERATION_ID);
    session.release(OPERATION_ID);
    finishCapture(capture);

    await expect(pending).rejects.toThrow(CaptureSessionStateError);
    expect(session.activeOperationId).toBeNull();
  });

  it("invalidates a pending capture on any display topology change", async () => {
    const capture = {
      display: { id: "42", width: 100, height: 100, scaleFactor: 1, rotation: 0 },
      image: new FakeImage({ width: 100, height: 100 }),
    };
    let finishCapture: (capture: CapturedDisplay) => void = () => undefined;
    const session = new CaptureSession(
      {
        captureDisplayAtPointer: () =>
          new Promise((resolve) => {
            finishCapture = resolve;
          }),
      },
      new FakeClipboard(),
    );

    const pending = session.begin(OPERATION_ID);
    expect(session.invalidateDisplay("display-added-or-changed")).toBe(OPERATION_ID);
    finishCapture(capture);

    await expect(pending).rejects.toThrow(CaptureSessionStateError);
    expect(session.activeOperationId).toBeNull();
  });

  it("invalidates only the active display generation", async () => {
    const { session } = createCapture();
    await session.begin(OPERATION_ID);

    expect(session.invalidateDisplay("another-display")).toBeNull();
    expect(session.invalidateDisplay("42")).toBe(OPERATION_ID);
    expect(session.activeOperationId).toBeNull();
  });

  it("rejects empty captures and mismatched clipboard pixel evidence", async () => {
    const emptyCapture = createCapture(new FakeImage({ width: 100, height: 100 }, true));
    await expect(emptyCapture.session.begin(OPERATION_ID)).rejects.toThrow(CaptureUnavailableError);

    const { clipboard, session } = createCapture();
    await session.begin(OPERATION_ID);
    session.complete(OPERATION_ID, { x: 0, y: 0, width: 10, height: 10 });
    clipboard.readback = {
      bitmap: Uint8Array.from([9, 9, 9]),
      size: { width: 20, height: 20 },
    };
    expect(() => session.copy(OPERATION_ID)).toThrow(ClipboardWriteError);
  });

  it("normalizes clipboard implementation failures", async () => {
    const { clipboard, session } = createCapture();
    await session.begin(OPERATION_ID);
    session.complete(OPERATION_ID, { x: 0, y: 0, width: 10, height: 10 });
    clipboard.throwOnWrite = true;

    expect(() => session.copy(OPERATION_ID)).toThrow(ClipboardWriteError);
  });
});

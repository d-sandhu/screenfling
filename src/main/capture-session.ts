import {
  captureDraftSchema,
  captureOverlaySnapshotSchema,
  dipSelectionSchema,
} from "../shared/capture";
import { mapDipSelectionToPixelCrop } from "../shared/capture-geometry";
import { operationIdSchema } from "../shared/domain";

import type { CaptureDraft, CaptureOverlaySnapshot, DipSelectionInput } from "../shared/capture";
import type { PixelCrop, PixelSize } from "../shared/capture-geometry";

const OVERLAY_JPEG_QUALITY = 90;
const DRAFT_JPEG_QUALITY = 86;

export type CaptureDisplay = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly scaleFactor: number;
  readonly rotation: number;
};

export type CaptureImage = {
  readonly crop: (crop: PixelCrop) => CaptureImage;
  readonly getSize: () => PixelSize;
  readonly isEmpty: () => boolean;
  readonly toBitmap: () => Uint8Array;
  readonly toJPEG: (quality: number) => Uint8Array;
  readonly toPNG: () => Uint8Array;
};

export type CapturedDisplay = {
  readonly display: CaptureDisplay;
  readonly image: CaptureImage;
};

export type CaptureBackend = {
  readonly captureDisplayAtPointer: () => Promise<CapturedDisplay>;
};

export type ClipboardImageEvidence = {
  readonly bitmap: Uint8Array;
  readonly size: PixelSize;
};

export type ImageClipboard = {
  readonly readImageEvidence: () => ClipboardImageEvidence | null;
  readonly writePng: (png: Uint8Array) => void;
};

type ActiveCapture = {
  readonly operationId: string;
  readonly display: CaptureDisplay;
  readonly fullImage: CaptureImage;
  readonly returnedPixels: PixelSize;
  draft: CaptureDraft | null;
  croppedImage: CaptureImage | null;
};

export class CapturePermissionBlockedError extends Error {
  constructor() {
    super("Screen capture permission is blocked.");
    this.name = "CapturePermissionBlockedError";
  }
}

export class CaptureUnavailableError extends Error {
  constructor(message = "The selected display could not be captured.") {
    super(message);
    this.name = "CaptureUnavailableError";
  }
}

export class CaptureSessionStateError extends Error {
  constructor() {
    super("The capture operation is not current.");
    this.name = "CaptureSessionStateError";
  }
}

export class ClipboardWriteError extends Error {
  constructor() {
    super("The capture could not be verified on the image clipboard.");
    this.name = "ClipboardWriteError";
  }
}

function encodePreview(image: CaptureImage, quality: number): Uint8Array {
  const preview = image.toJPEG(quality);
  if (preview.byteLength === 0) throw new CaptureUnavailableError("Capture preview was empty.");
  return new Uint8Array(preview);
}

function hasSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function hasSameImageEvidence(
  expected: ClipboardImageEvidence,
  actual: ClipboardImageEvidence | null,
): boolean {
  return (
    actual !== null &&
    expected.size.width === actual.size.width &&
    expected.size.height === actual.size.height &&
    hasSameBytes(expected.bitmap, actual.bitmap)
  );
}

export class CaptureSession {
  readonly #backend: CaptureBackend;
  readonly #clipboard: ImageClipboard;
  #active: ActiveCapture | null = null;
  #pendingOperationId: string | null = null;

  constructor(backend: CaptureBackend, clipboard: ImageClipboard) {
    this.#backend = backend;
    this.#clipboard = clipboard;
  }

  get activeOperationId(): string | null {
    return this.#active?.operationId ?? this.#pendingOperationId;
  }

  get activeDisplayId(): string | null {
    return this.#active?.display.id ?? null;
  }

  async begin(operationId: string): Promise<CaptureOverlaySnapshot> {
    if (this.#active !== null || this.#pendingOperationId !== null) {
      throw new CaptureSessionStateError();
    }
    const safeOperationId = operationIdSchema.parse(operationId);
    this.#pendingOperationId = safeOperationId;
    try {
      const captured = await this.#backend.captureDisplayAtPointer();
      if (this.#pendingOperationId !== safeOperationId) throw new CaptureSessionStateError();
      if (captured.image.isEmpty()) throw new CaptureUnavailableError("Display capture was empty.");

      const returnedPixels = captured.image.getSize();
      const snapshot = captureOverlaySnapshotSchema.parse({
        operationId: safeOperationId,
        display: captured.display,
        returnedPixels,
        preview: encodePreview(captured.image, OVERLAY_JPEG_QUALITY),
      });
      this.#active = {
        operationId: safeOperationId,
        display: snapshot.display,
        fullImage: captured.image,
        returnedPixels: snapshot.returnedPixels,
        draft: null,
        croppedImage: null,
      };
      return snapshot;
    } catch (cause) {
      if (this.#pendingOperationId !== safeOperationId) throw new CaptureSessionStateError();
      throw cause;
    } finally {
      if (this.#pendingOperationId === safeOperationId) this.#pendingOperationId = null;
    }
  }

  complete(operationId: string, selectionInput: DipSelectionInput): CaptureDraft {
    const active = this.#requireActive(operationId);
    if (active.draft !== null) throw new CaptureSessionStateError();
    const selection = dipSelectionSchema.parse(selectionInput);
    const crop = mapDipSelectionToPixelCrop(selection, active.display, active.returnedPixels);
    const croppedImage = active.fullImage.crop(crop);
    if (croppedImage.isEmpty()) throw new CaptureUnavailableError("Selected crop was empty.");

    const draft = captureDraftSchema.parse({
      operationId: active.operationId,
      selection,
      pixels: croppedImage.getSize(),
      preview: encodePreview(croppedImage, DRAFT_JPEG_QUALITY),
    });
    active.croppedImage = croppedImage;
    active.draft = draft;
    return draft;
  }

  getDraft(operationId: string): CaptureDraft {
    const active = this.#requireActive(operationId);
    if (active.draft === null) throw new CaptureSessionStateError();
    return active.draft;
  }

  copy(operationId: string): void {
    const active = this.#requireActive(operationId);
    if (active.croppedImage === null) throw new CaptureSessionStateError();
    try {
      const expected = {
        bitmap: active.croppedImage.toBitmap(),
        size: active.croppedImage.getSize(),
      };
      const png = active.croppedImage.toPNG();
      if (png.byteLength === 0 || expected.bitmap.byteLength === 0) {
        throw new ClipboardWriteError();
      }
      this.#clipboard.writePng(png);
      if (!hasSameImageEvidence(expected, this.#clipboard.readImageEvidence())) {
        throw new ClipboardWriteError();
      }
    } catch {
      throw new ClipboardWriteError();
    }
  }

  release(operationId: string): void {
    const safeOperationId = operationIdSchema.parse(operationId);
    if (this.#pendingOperationId === safeOperationId) {
      this.#pendingOperationId = null;
      return;
    }
    this.#requireActive(safeOperationId);
    this.#active = null;
  }

  invalidateDisplay(displayId: string): string | null {
    if (this.#pendingOperationId !== null) {
      const operationId = this.#pendingOperationId;
      this.#pendingOperationId = null;
      return operationId;
    }
    if (this.#active?.display.id !== displayId) return null;
    const operationId = this.#active.operationId;
    this.#active = null;
    return operationId;
  }

  #requireActive(operationId: string): ActiveCapture {
    const safeOperationId = operationIdSchema.parse(operationId);
    if (this.#active?.operationId !== safeOperationId) throw new CaptureSessionStateError();
    return this.#active;
  }
}

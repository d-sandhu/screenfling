export type DipSize = {
  readonly width: number;
  readonly height: number;
};

export type DipSelection = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PixelSize = {
  readonly width: number;
  readonly height: number;
};

export type PixelCrop = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export class InvalidCaptureGeometryError extends Error {
  constructor() {
    super("Capture geometry must be finite, positive, and display-local.");
    this.name = "InvalidCaptureGeometryError";
  }
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function mapDipSelectionToPixelCrop(
  selection: DipSelection,
  displaySize: DipSize,
  returnedImageSize: PixelSize,
): PixelCrop {
  if (
    !isFinitePositive(displaySize.width) ||
    !isFinitePositive(displaySize.height) ||
    !Number.isSafeInteger(returnedImageSize.width) ||
    returnedImageSize.width <= 0 ||
    !Number.isSafeInteger(returnedImageSize.height) ||
    returnedImageSize.height <= 0 ||
    !isFiniteNonnegative(selection.x) ||
    !isFiniteNonnegative(selection.y) ||
    !isFinitePositive(selection.width) ||
    !isFinitePositive(selection.height) ||
    selection.x + selection.width > displaySize.width ||
    selection.y + selection.height > displaySize.height
  ) {
    throw new InvalidCaptureGeometryError();
  }

  const widthRatio = returnedImageSize.width / displaySize.width;
  const heightRatio = returnedImageSize.height / displaySize.height;
  if (!isFinitePositive(widthRatio) || !isFinitePositive(heightRatio)) {
    throw new InvalidCaptureGeometryError();
  }
  const left = Math.max(0, Math.floor(selection.x * widthRatio));
  const top = Math.max(0, Math.floor(selection.y * heightRatio));
  const right = Math.min(
    returnedImageSize.width,
    Math.ceil((selection.x + selection.width) * widthRatio),
  );
  const bottom = Math.min(
    returnedImageSize.height,
    Math.ceil((selection.y + selection.height) * heightRatio),
  );

  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(top) ||
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(bottom) ||
    right <= left ||
    bottom <= top
  ) {
    throw new InvalidCaptureGeometryError();
  }

  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

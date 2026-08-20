import { clipboard, desktopCapturer, nativeImage, screen, systemPreferences } from "electron";

import { CapturePermissionBlockedError, CaptureUnavailableError } from "./capture-session";

import type { DesktopCapturerSource, Display } from "electron";
import type {
  CaptureBackend,
  CaptureDisplay,
  CaptureImage,
  CapturedDisplay,
  ImageClipboard,
} from "./capture-session";
import type { PixelSize } from "../shared/capture-geometry";

type ScreenSource = {
  readonly displayId: string;
  readonly image: CaptureImage;
};

function toCaptureDisplay(display: Display): CaptureDisplay {
  return {
    id: String(display.id),
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
  };
}

export function isSameCaptureDisplay(selected: CaptureDisplay, current: CaptureDisplay): boolean {
  return (
    selected.id === current.id &&
    selected.width === current.width &&
    selected.height === current.height &&
    selected.scaleFactor === current.scaleFactor &&
    selected.rotation === current.rotation
  );
}

export function requestedCaptureSize(display: CaptureDisplay): PixelSize {
  const width = Math.ceil(display.width * display.scaleFactor);
  const height = Math.ceil(display.height * display.scaleFactor);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new CaptureUnavailableError("Display geometry cannot produce a safe capture size.");
  }
  return { width, height };
}

export function selectExactScreenSource(
  displayId: string,
  sources: readonly ScreenSource[],
): CaptureImage {
  const matches = sources.filter((source) => source.displayId === displayId);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) {
    throw new CaptureUnavailableError("No unique capture source matched the selected display.");
  }
  return match.image;
}

function isPermissionBlocked(): boolean {
  if (process.platform !== "darwin") return false;
  const status = systemPreferences.getMediaAccessStatus("screen");
  return status === "denied" || status === "restricted";
}

function toScreenSource(source: DesktopCapturerSource): ScreenSource {
  return { displayId: source.display_id, image: source.thumbnail };
}

export class ElectronCaptureBackend implements CaptureBackend {
  async captureDisplayAtPointer(): Promise<CapturedDisplay> {
    if (isPermissionBlocked()) throw new CapturePermissionBlockedError();
    const display = toCaptureDisplay(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
    let sources: DesktopCapturerSource[];
    try {
      sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: requestedCaptureSize(display),
        fetchWindowIcons: false,
      });
    } catch (cause) {
      if (isPermissionBlocked()) throw new CapturePermissionBlockedError();
      throw new CaptureUnavailableError(
        cause instanceof Error ? cause.message : "Electron could not enumerate screen sources.",
      );
    }

    const image = selectExactScreenSource(display.id, sources.map(toScreenSource));
    const currentDisplay = screen
      .getAllDisplays()
      .map(toCaptureDisplay)
      .find((candidate) => candidate.id === display.id);
    if (currentDisplay === undefined || !isSameCaptureDisplay(display, currentDisplay)) {
      throw new CaptureUnavailableError("Display geometry changed during capture.");
    }
    if (image.isEmpty()) {
      if (isPermissionBlocked()) throw new CapturePermissionBlockedError();
      throw new CaptureUnavailableError("The selected display returned an empty image.");
    }
    return { display, image };
  }
}

export class ElectronImageClipboard implements ImageClipboard {
  readImageEvidence() {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    return { bitmap: new Uint8Array(image.toBitmap()), size: image.getSize() };
  }

  writePng(png: Uint8Array): void {
    const image = nativeImage.createFromBuffer(Buffer.from(png));
    if (image.isEmpty()) throw new Error("Encoded capture PNG was empty.");
    clipboard.writeImage(image);
  }
}

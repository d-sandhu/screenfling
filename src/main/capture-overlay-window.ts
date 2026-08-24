import { BrowserWindow } from "electron";

import { CAPTURE_OVERLAY_CHANNELS } from "../shared/bridge";
import { rendererDocumentUrl } from "./renderer-url";
import { createCaptureWindowOptions } from "./window-options";

import type { WebContents } from "electron";
import type { CaptureOverlayPort } from "./capture-controller";
import type { CaptureDisplay } from "./capture-session";
import type { CaptureOverlaySnapshot } from "../shared/capture";

type UnexpectedCloseHandler = () => void;

export class CaptureOverlayWindow implements CaptureOverlayPort {
  readonly #devRendererUrl: string | null;
  readonly #onUnexpectedClose: UnexpectedCloseHandler;
  readonly #preload: string;
  #intentionalClose = false;
  #window: BrowserWindow | null = null;

  constructor(
    preload: string,
    devRendererUrl: string | null,
    onUnexpectedClose: UnexpectedCloseHandler,
  ) {
    this.#preload = preload;
    this.#devRendererUrl = devRendererUrl;
    this.#onUnexpectedClose = onUnexpectedClose;
  }

  get webContents(): WebContents | null {
    return this.#window?.webContents ?? null;
  }

  async prepare(display: CaptureDisplay): Promise<void> {
    if (this.#window !== null) throw new Error("A capture overlay is already open.");
    const window = new BrowserWindow(createCaptureWindowOptions(this.#preload, display));
    this.#window = window;
    this.#intentionalClose = false;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, respond) => {
      respond(false);
    });
    window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    window.webContents.on("render-process-gone", () => {
      this.#handleUnexpectedClose(window);
    });
    window.on("closed", () => {
      const wasCurrent = this.#window === window;
      if (wasCurrent) this.#window = null;
      if (wasCurrent && !this.#intentionalClose) this.#onUnexpectedClose();
    });

    try {
      await window.loadURL(rendererDocumentUrl(this.#devRendererUrl, "capture"));
      if (this.#window !== window) throw new Error("Capture overlay closed while loading.");
    } catch (cause) {
      if (this.#window === window) this.close();
      else if (!window.isDestroyed()) window.destroy();
      throw cause;
    }
  }

  sendSnapshot(snapshot: CaptureOverlaySnapshot): void {
    const window = this.#requireWindow();
    window.webContents.send(CAPTURE_OVERLAY_CHANNELS.snapshot, snapshot);
  }

  show(): void {
    const window = this.#requireWindow();
    window.show();
    window.focus();
  }

  close(): void {
    const window = this.#window;
    if (window === null) return;
    this.#intentionalClose = true;
    this.#window = null;
    if (!window.isDestroyed()) window.destroy();
  }

  #handleUnexpectedClose(window: BrowserWindow): void {
    if (this.#window !== window || this.#intentionalClose) return;
    this.#window = null;
    if (!window.isDestroyed()) window.destroy();
    this.#onUnexpectedClose();
  }

  #requireWindow(): BrowserWindow {
    if (this.#window === null || this.#window.isDestroyed()) {
      throw new Error("Capture overlay is unavailable.");
    }
    return this.#window;
  }
}

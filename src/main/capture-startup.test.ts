import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CAPTURE_STARTUP_TIMEOUT_MS, CaptureController } from "./capture-controller";
import { CaptureSession } from "./capture-session";
import { DestinationRegistry } from "./destination-registry";
import { WorkflowDiagnostics } from "./workflow-diagnostics";
import { WorkflowStore } from "./workflow-store";

import type { CaptureOverlaySnapshot } from "../shared/capture";
import type { CaptureDisplay, CaptureImage, CapturedDisplay } from "./capture-session";

const FIRST = "550e8400-e29b-41d4-a716-446655440000";
const SECOND = "550e8400-e29b-41d4-a716-446655440001";
const DISPLAY: CaptureDisplay = {
  id: "42",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  scaleFactor: 1,
  rotation: 0,
};
const IMAGE: CaptureImage = {
  crop: () => IMAGE,
  getSize: () => ({ width: 100, height: 100 }),
  isEmpty: () => false,
  toBitmap: () => Uint8Array.from([1, 2, 3, 4]),
  toJPEG: () => Uint8Array.from([1, 2, 3]),
  toPNG: () => Uint8Array.from([137, 80, 78, 71]),
};
const CAPTURE: CapturedDisplay = { display: DISPLAY, image: IMAGE };

function deferred<Value>() {
  let finish: ((value: Value) => void) | null = null;
  const promise = new Promise<Value>((resolve) => {
    finish = resolve;
  });
  return {
    promise,
    resolve: (value: Value) => {
      if (finish === null) throw new Error("Deferred promise was not initialized.");
      finish(value);
    },
  };
}

function createHarness() {
  let operation = 0;
  const backend = {
    captureDisplay: vi.fn(() => Promise.resolve(CAPTURE)),
    getDisplayAtPointer: () => DISPLAY,
  };
  const clipboard = { readImageEvidence: () => null, writePng: vi.fn() };
  const overlay = {
    close: vi.fn(),
    prepare: vi.fn(() => Promise.resolve()),
    sendSnapshot: vi.fn((_snapshot: CaptureOverlaySnapshot) => undefined),
    show: vi.fn(),
  };
  const main = {
    hideForCapture: vi.fn(() => Promise.resolve()),
    publishWorkflow: vi.fn(),
    show: vi.fn(),
  };
  const session = new CaptureSession(backend, clipboard);
  const diagnostics = new WorkflowDiagnostics(() => Date.now());
  const controller = new CaptureController(
    new WorkflowStore(),
    diagnostics,
    session,
    new DestinationRegistry([]),
    overlay,
    main,
    () => {
      operation += 1;
      return operation === 1 ? FIRST : SECOND;
    },
  );
  return { backend, clipboard, controller, diagnostics, main, overlay, session };
}

describe("bounded capture startup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("settles a hung capture, frees its state, and leaves the clipboard unchanged", async () => {
    const { backend, clipboard, controller, diagnostics, main, overlay, session } = createHarness();
    const capture = deferred<CapturedDisplay>();
    backend.captureDisplay.mockReturnValueOnce(capture.promise);
    const pending = controller.startCapture();

    await vi.advanceTimersByTimeAsync(CAPTURE_STARTUP_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({
      phase: "result",
      result: { status: "failed", reason: "capture-failed" },
    });
    expect(session.activeOperationId).toBeNull();
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(main.show).toHaveBeenCalledOnce();
    expect(clipboard.writePng).not.toHaveBeenCalled();
    capture.resolve(CAPTURE);
    await vi.advanceTimersByTimeAsync(0);
    expect(diagnostics.snapshot().delivery.failures.captureFailed).toBe(1);
    expect(overlay.sendSnapshot).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds hung overlay preparation even after capture has succeeded", async () => {
    const { controller, overlay, session } = createHarness();
    const prepared = deferred<void>();
    overlay.prepare.mockReturnValueOnce(prepared.promise);
    const pending = controller.startCapture();

    await vi.advanceTimersByTimeAsync(CAPTURE_STARTUP_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({ phase: "result" });
    expect(session.activeOperationId).toBeNull();
    expect(overlay.close).toHaveBeenCalledOnce();
    prepared.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(overlay.sendSnapshot).not.toHaveBeenCalled();
  });

  it("also bounds missing renderer readiness after the snapshot was sent", async () => {
    const { clipboard, controller, overlay, session } = createHarness();
    await controller.startCapture();
    expect(overlay.sendSnapshot).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(CAPTURE_STARTUP_TIMEOUT_MS);

    expect(controller.snapshot).toMatchObject({ phase: "result" });
    expect(session.activeOperationId).toBeNull();
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(overlay.show).not.toHaveBeenCalled();
    expect(clipboard.writePng).not.toHaveBeenCalled();
  });

  it("bounds a hung hide and does not capture when it eventually completes", async () => {
    const { backend, controller, main, overlay } = createHarness();
    const hidden = deferred<void>();
    main.hideForCapture.mockReturnValueOnce(hidden.promise);
    const pending = controller.startCapture();
    await vi.advanceTimersByTimeAsync(CAPTURE_STARTUP_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({ phase: "result" });

    hidden.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.captureDisplay).not.toHaveBeenCalled();
    expect(overlay.prepare).not.toHaveBeenCalled();
    expect(main.show).toHaveBeenCalledOnce();
  });

  it("cancels startup without waiting for an unresponsive backend", async () => {
    const { backend, clipboard, controller } = createHarness();
    const capture = deferred<CapturedDisplay>();
    backend.captureDisplay.mockReturnValueOnce(capture.promise);
    const pending = controller.startCapture();
    await vi.advanceTimersByTimeAsync(0);

    controller.cancel(FIRST);

    await expect(pending).resolves.toMatchObject({ result: { status: "cancelled" } });
    expect(vi.getTimerCount()).toBe(0);
    expect(clipboard.writePng).not.toHaveBeenCalled();
    capture.resolve(CAPTURE);
    await vi.advanceTimersByTimeAsync(0);
  });

  it("removes the startup deadline when selection is ready", async () => {
    const { clipboard, controller, overlay } = createHarness();
    await controller.startCapture();
    controller.overlayReady(FIRST);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(CAPTURE_STARTUP_TIMEOUT_MS * 2);

    expect(controller.snapshot).toMatchObject({ phase: "selecting" });
    expect(overlay.close).not.toHaveBeenCalled();
    expect(clipboard.writePng).not.toHaveBeenCalled();
    controller.cancel(FIRST);
  });

  it("does not close a newer overlay when old preparation eventually succeeds", async () => {
    const { controller, overlay } = createHarness();
    const prepared = deferred<void>();
    overlay.prepare.mockReturnValueOnce(prepared.promise);
    const pending = controller.startCapture();
    await vi.advanceTimersByTimeAsync(0);
    controller.cancel(FIRST);
    await pending;
    controller.dismissResult(FIRST);
    await controller.startCapture();
    controller.overlayReady(SECOND);

    prepared.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.snapshot).toMatchObject({ phase: "selecting", operationId: SECOND });
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(overlay.sendSnapshot).toHaveBeenCalledOnce();
    controller.cancel(SECOND);
  });

  it("ignores old captured pixels after timeout and a successful new capture", async () => {
    const { backend, controller, overlay, session } = createHarness();
    const capture = deferred<CapturedDisplay>();
    backend.captureDisplay.mockReturnValueOnce(capture.promise);
    const pending = controller.startCapture();
    await vi.advanceTimersByTimeAsync(CAPTURE_STARTUP_TIMEOUT_MS);
    await pending;
    controller.dismissResult(FIRST);
    await controller.startCapture();
    controller.overlayReady(SECOND);

    capture.resolve(CAPTURE);
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.snapshot).toMatchObject({ phase: "selecting", operationId: SECOND });
    expect(session.activeOperationId).toBe(SECOND);
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(overlay.sendSnapshot).toHaveBeenCalledOnce();
    controller.cancel(SECOND);
  });
});

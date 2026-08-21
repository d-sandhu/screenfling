import { describe, expect, it } from "vitest";

import { CaptureController } from "./capture-controller";
import { CapturePermissionBlockedError, CaptureSession } from "./capture-session";
import { DestinationRegistry } from "./destination-registry";
import { parseDestination } from "../shared/domain";
import { InvalidWorkflowTransitionError, StaleWorkflowActionError } from "../shared/workflow";
import { WorkflowStore } from "./workflow-store";

import type { CaptureOverlayPort, MainSurfacePort } from "./capture-controller";
import type {
  AdapterStageRequest,
  AdapterStageResult,
  DestinationAdapter,
} from "./destination-adapter";
import type {
  CaptureBackend,
  CaptureDisplay,
  CaptureImage,
  CapturedDisplay,
  ClipboardImageEvidence,
  ImageClipboard,
} from "./capture-session";
import type { CaptureOverlaySnapshot } from "../shared/capture";
import type { PixelCrop, PixelSize } from "../shared/capture-geometry";
import type { WorkflowSnapshot } from "../shared/workflow";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const DISPLAY: CaptureDisplay = {
  id: "42",
  x: -1512,
  y: 0,
  width: 1512,
  height: 982,
  scaleFactor: 2,
  rotation: 0,
};
const DESTINATION = parseDestination({
  id: "instrumented:generation-a:7",
  adapter: "instrumented",
  endpoint: { scope: "local", instanceId: "generation-a" },
  surface: { kind: "pane", locator: "7" },
  context: { cwd: "/screenfling", observedAt: "2026-08-20T16:00:00.000Z" },
  capabilities: {
    address: "exact",
    imageInput: "clipboard-key",
    textInput: "paste",
    readBack: "none",
    verification: ["target-live"],
    actions: ["copy", "stage"],
  },
});

class ControllerImage implements CaptureImage {
  readonly #size: PixelSize;

  constructor(size: PixelSize) {
    this.#size = size;
  }

  crop(crop: PixelCrop): CaptureImage {
    return new ControllerImage({ width: crop.width, height: crop.height });
  }

  getSize(): PixelSize {
    return this.#size;
  }

  isEmpty(): boolean {
    return false;
  }

  toBitmap(): Uint8Array {
    return Uint8Array.from([4, 3, 2, 1]);
  }

  toJPEG(_quality: number): Uint8Array {
    return Uint8Array.from([1, 2, 3]);
  }

  toPNG(): Uint8Array {
    return Uint8Array.from([137, 80, 78, 71]);
  }
}

class ControllerBackend implements CaptureBackend {
  readonly calls: string[];
  error: Error | null = null;
  waitForFinish = false;
  #finish: ((capture: CapturedDisplay) => void) | null = null;

  constructor(calls: string[]) {
    this.calls = calls;
  }

  captureDisplay(display: CaptureDisplay): Promise<CapturedDisplay> {
    this.calls.push("capture");
    if (this.error !== null) return Promise.reject(this.error);
    const capture = { display, image: new ControllerImage({ width: 3024, height: 1964 }) };
    if (!this.waitForFinish) return Promise.resolve(capture);
    return new Promise((resolve) => {
      this.#finish = resolve;
    });
  }

  finish(): void {
    this.#finish?.({ display: DISPLAY, image: new ControllerImage({ width: 3024, height: 1964 }) });
  }

  getDisplayAtPointer(): CaptureDisplay {
    this.calls.push("display");
    return DISPLAY;
  }
}

class ControllerClipboard implements ImageClipboard {
  evidence: ClipboardImageEvidence | null = null;
  writes = 0;

  readImageEvidence(): ClipboardImageEvidence | null {
    return this.evidence;
  }

  writePng(_png: Uint8Array): void {
    this.writes += 1;
  }
}

class ControllerOverlay implements CaptureOverlayPort {
  readonly calls: string[];
  closeCalls = 0;
  sent: CaptureOverlaySnapshot | null = null;
  showCalls = 0;

  constructor(calls: string[]) {
    this.calls = calls;
  }

  close(): void {
    this.closeCalls += 1;
  }

  async prepare(_display: CaptureDisplay): Promise<void> {
    this.calls.push("prepare");
  }

  sendSnapshot(snapshot: CaptureOverlaySnapshot): void {
    this.calls.push("send");
    this.sent = snapshot;
  }

  show(): void {
    this.showCalls += 1;
  }
}

class ControllerMainSurface implements MainSurfacePort {
  published: WorkflowSnapshot[] = [];
  showCalls = 0;

  async hideForCapture(): Promise<void> {
    return undefined;
  }

  publishWorkflow(snapshot: WorkflowSnapshot): void {
    this.published.push(snapshot);
  }

  show(): void {
    this.showCalls += 1;
  }
}

class ControllerDestinationAdapter implements DestinationAdapter {
  readonly id = "instrumented";
  readonly staged: AdapterStageRequest[] = [];
  waitForFinish = false;
  #finish: ((result: AdapterStageResult) => void) | null = null;

  async discover() {
    return [DESTINATION];
  }

  async stageIfCurrent(request: AdapterStageRequest): Promise<AdapterStageResult> {
    this.staged.push(request);
    if (!this.waitForFinish) return { status: "dispatched-unverified" };
    return new Promise((resolve) => {
      this.#finish = resolve;
    });
  }

  finish(result: AdapterStageResult): void {
    this.#finish?.(result);
  }
}

function createHarness(adapter: DestinationAdapter | null = null) {
  const calls: string[] = [];
  const backend = new ControllerBackend(calls);
  const clipboard = new ControllerClipboard();
  const overlay = new ControllerOverlay(calls);
  const mainSurface = new ControllerMainSurface();
  const session = new CaptureSession(backend, clipboard);
  const controller = new CaptureController(
    new WorkflowStore(),
    session,
    new DestinationRegistry(adapter === null ? [] : [adapter]),
    overlay,
    mainSurface,
    () => OPERATION_ID,
  );
  return { backend, calls, clipboard, controller, mainSurface, overlay, session };
}

async function prepareEditingCapture(
  harness: ReturnType<typeof createHarness>,
): Promise<PixelSize> {
  await harness.controller.startCapture();
  harness.controller.overlayReady(OPERATION_ID);
  harness.controller.completeSelection(OPERATION_ID, {
    x: 378,
    y: 217.75,
    width: 756,
    height: 435.5,
  });
  const { pixels } = harness.controller.getDraft(OPERATION_ID);
  harness.clipboard.evidence = {
    bitmap: Uint8Array.from([4, 3, 2, 1]),
    size: pixels,
  };
  return pixels;
}

describe("capture workflow controller", () => {
  it("preloads the hidden overlay before capturing and sends the frozen snapshot", async () => {
    const { calls, controller, overlay } = createHarness();

    await expect(controller.startCapture()).resolves.toMatchObject({
      phase: "snapshotting",
      operationId: OPERATION_ID,
    });
    expect(calls).toEqual(["display", "prepare", "capture", "send"]);
    expect(overlay.sent).toMatchObject({ operationId: OPERATION_ID, display: DISPLAY });
    expect(overlay.showCalls).toBe(0);
  });

  it("runs selection through an explicit verified Copy result", async () => {
    const { clipboard, controller, mainSurface, overlay } = createHarness();
    await controller.startCapture();

    expect(controller.overlayReady(OPERATION_ID)).toMatchObject({ phase: "selecting" });
    expect(overlay.showCalls).toBe(1);
    expect(
      controller.completeSelection(OPERATION_ID, {
        x: 378,
        y: 217.75,
        width: 756,
        height: 435.5,
      }),
    ).toMatchObject({ phase: "editing" });
    const draft = controller.getDraft(OPERATION_ID);
    expect(draft.pixels).toEqual({ width: 1512, height: 872 });

    clipboard.evidence = {
      bitmap: Uint8Array.from([4, 3, 2, 1]),
      size: draft.pixels,
    };
    expect(controller.copyCapture(OPERATION_ID)).toEqual({
      phase: "result",
      operationId: OPERATION_ID,
      result: { status: "copied" },
    });
    expect(clipboard.writes).toBe(1);
    expect(mainSurface.showCalls).toBe(1);
  });

  it("lets cancellation win while the backend capture is pending", async () => {
    const { backend, controller, session } = createHarness();
    backend.waitForFinish = true;
    const pending = controller.startCapture();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.activeOperationId).toBe(OPERATION_ID);

    expect(controller.cancel(OPERATION_ID)).toMatchObject({
      phase: "result",
      result: { status: "cancelled" },
    });
    backend.finish();
    await expect(pending).resolves.toMatchObject({ result: { status: "cancelled" } });
    expect(session.activeOperationId).toBeNull();
  });

  it("fails an active selection when its display changes", async () => {
    const { controller, session } = createHarness();
    await controller.startCapture();
    controller.overlayReady(OPERATION_ID);

    expect(controller.displayChanged("42")).toMatchObject({
      phase: "result",
      result: { status: "failed", reason: "capture-failed" },
    });
    expect(session.activeOperationId).toBeNull();
  });

  it("fails a pending snapshot when the capture environment changes", async () => {
    const { backend, controller, mainSurface, overlay, session } = createHarness();
    backend.waitForFinish = true;
    const pending = controller.startCapture();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.captureEnvironmentChanged()).toMatchObject({
      phase: "result",
      result: { status: "failed", reason: "capture-failed" },
    });
    backend.finish();
    await expect(pending).resolves.toMatchObject({
      phase: "result",
      result: { status: "failed", reason: "capture-failed" },
    });
    expect(session.activeOperationId).toBeNull();
    expect(overlay.closeCalls).toBe(1);
    expect(mainSurface.showCalls).toBe(1);
  });

  it("fails selection and review safely when the capture environment changes", async () => {
    const selecting = createHarness();
    await selecting.controller.startCapture();
    selecting.controller.overlayReady(OPERATION_ID);

    expect(selecting.controller.captureEnvironmentChanged()).toMatchObject({
      phase: "result",
      result: { status: "failed", reason: "capture-failed" },
    });
    expect(selecting.session.activeOperationId).toBeNull();
    expect(selecting.clipboard.writes).toBe(0);

    const editing = createHarness();
    await prepareEditingCapture(editing);
    expect(editing.controller.captureEnvironmentChanged()).toMatchObject({
      phase: "result",
      result: { status: "failed", reason: "capture-failed" },
    });
    expect(editing.session.activeOperationId).toBeNull();
    expect(editing.clipboard.writes).toBe(0);
  });

  it("maps macOS permission denial without opening the overlay", async () => {
    const { backend, clipboard, controller, mainSurface, overlay, session } = createHarness();
    backend.error = new CapturePermissionBlockedError();

    await expect(controller.startCapture()).resolves.toMatchObject({
      phase: "result",
      result: { status: "failed", reason: "permission-blocked" },
    });
    expect(overlay.showCalls).toBe(0);
    expect(overlay.closeCalls).toBe(1);
    expect(mainSurface.showCalls).toBe(1);
    expect(session.activeOperationId).toBeNull();
    expect(clipboard.writes).toBe(0);
  });

  it("recovers the main surface when the hidden overlay cannot render", async () => {
    const { controller, mainSurface, overlay, session } = createHarness();
    await controller.startCapture();

    expect(controller.overlayFailed(OPERATION_ID)).toEqual({
      phase: "result",
      operationId: OPERATION_ID,
      result: { status: "failed", reason: "capture-failed" },
    });
    expect(session.activeOperationId).toBeNull();
    expect(overlay.closeCalls).toBe(1);
    expect(mainSurface.showCalls).toBe(1);
  });

  it("rejects a second start without creating another capture or revealing main", async () => {
    const { backend, controller, mainSurface } = createHarness();
    await controller.startCapture();

    await expect(controller.startCapture()).resolves.toMatchObject({ phase: "snapshotting" });
    expect(backend.calls.filter((call) => call === "capture")).toHaveLength(1);
    expect(mainSurface.showCalls).toBe(0);
  });

  it("rejects stale cancellation before changing capture or window state", async () => {
    const { controller, mainSurface, overlay, session } = createHarness();
    await controller.startCapture();
    controller.overlayReady(OPERATION_ID);

    expect(() => controller.cancel("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toThrow(
      StaleWorkflowActionError,
    );
    expect(controller.snapshot).toEqual({ phase: "selecting", operationId: OPERATION_ID });
    expect(session.activeOperationId).toBe(OPERATION_ID);
    expect(overlay.closeCalls).toBe(0);
    expect(mainSurface.showCalls).toBe(0);
  });

  it("joins verified clipboard output to one exact unverified Stage transaction", async () => {
    const adapter = new ControllerDestinationAdapter();
    const harness = createHarness(adapter);
    await prepareEditingCapture(harness);

    await expect(harness.controller.discoverDestinations(OPERATION_ID)).resolves.toEqual([
      DESTINATION,
    ]);
    await expect(
      harness.controller.stageCapture(OPERATION_ID, DESTINATION.id, "literal note"),
    ).resolves.toEqual({
      phase: "result",
      operationId: OPERATION_ID,
      result: {
        status: "dispatched-unverified",
        destination: {
          id: DESTINATION.id,
          adapter: DESTINATION.adapter,
          surface: DESTINATION.surface,
        },
      },
    });

    expect(harness.clipboard.writes).toBe(1);
    expect(adapter.staged).toEqual([{ destination: DESTINATION, note: "literal note" }]);
    expect(harness.session.activeOperationId).toBeNull();
    expect(harness.mainSurface.published.slice(-4).map((snapshot) => snapshot.phase)).toEqual([
      "target-selected",
      "writing-clipboard",
      "staging",
      "result",
    ]);
  });

  it("preserves verified clipboard fallback when the selected Stage action is unsupported", async () => {
    const copyOnly = parseDestination({
      ...DESTINATION,
      id: "instrumented:generation-a:copy-only",
      capabilities: {
        ...DESTINATION.capabilities,
        actions: ["copy"],
        verification: [],
      },
    });
    let adapterCalls = 0;
    const adapter: DestinationAdapter = {
      id: "instrumented",
      discover: async () => [copyOnly],
      stageIfCurrent: async () => {
        adapterCalls += 1;
        return { status: "dispatched-unverified" };
      },
    };
    const harness = createHarness(adapter);
    await prepareEditingCapture(harness);
    await harness.controller.discoverDestinations(OPERATION_ID);

    await expect(
      harness.controller.stageCapture(OPERATION_ID, copyOnly.id, null),
    ).resolves.toMatchObject({
      phase: "result",
      result: { status: "failed", reason: "unsupported" },
    });
    expect(harness.clipboard.writes).toBe(1);
    expect(adapterCalls).toBe(0);
    expect(harness.session.activeOperationId).toBeNull();
  });

  it("does not cancel or invalidate a workflow after destination dispatch begins", async () => {
    const adapter = new ControllerDestinationAdapter();
    adapter.waitForFinish = true;
    const harness = createHarness(adapter);
    await prepareEditingCapture(harness);
    await harness.controller.discoverDestinations(OPERATION_ID);

    const pending = harness.controller.stageCapture(OPERATION_ID, DESTINATION.id, null);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.controller.snapshot).toMatchObject({ phase: "staging" });
    expect(() => harness.controller.cancel(OPERATION_ID)).toThrow(InvalidWorkflowTransitionError);
    expect(harness.controller.displayChanged(DISPLAY.id)).toMatchObject({ phase: "staging" });
    expect(harness.controller.captureEnvironmentChanged()).toMatchObject({ phase: "staging" });
    await expect(
      harness.controller.stageCapture(OPERATION_ID, DESTINATION.id, null),
    ).rejects.toThrow(InvalidWorkflowTransitionError);
    expect(harness.session.activeOperationId).toBe(OPERATION_ID);

    adapter.finish({ status: "dispatched-unverified" });
    await expect(pending).resolves.toMatchObject({
      phase: "result",
      result: {
        status: "dispatched-unverified",
        destination: {
          id: DESTINATION.id,
          adapter: DESTINATION.adapter,
          surface: DESTINATION.surface,
        },
      },
    });
  });
});

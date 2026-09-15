import { describe, expect, it, vi } from "vitest";

import { parseDestination } from "../shared/domain";
import { workflowSnapshotSchema } from "../shared/workflow";
import { CaptureController } from "./capture-controller";
import { CaptureSession } from "./capture-session";
import { DestinationRegistry } from "./destination-registry";
import { WorkflowDiagnostics } from "./workflow-diagnostics";
import { WorkflowStore } from "./workflow-store";

import type { CaptureImage } from "./capture-session";
import type { RevealResult } from "../shared/workflow";

const OPERATION = "550e8400-e29b-41d4-a716-446655440000";
const OTHER = "550e8400-e29b-41d4-a716-446655440001";
const DISPLAY = { id: "1", x: 0, y: 0, width: 16, height: 16, scaleFactor: 1, rotation: 0 };
const BITMAP = new Uint8Array(16 * 16 * 4).fill(100);
const IMAGE: CaptureImage = {
  crop: () => IMAGE,
  getSize: () => ({ width: 16, height: 16 }),
  isEmpty: () => false,
  toBitmap: () => BITMAP,
  toJPEG: () => new Uint8Array([1, 2, 3]),
  toPNG: () => new Uint8Array([137, 80, 78, 71]),
};

function createHarness(capability = true, implementation = true) {
  const destination = parseDestination({
    id: "synthetic:generation:7", adapter: "synthetic",
    endpoint: { scope: "local", instanceId: "generation" },
    surface: { kind: "pane", locator: "7" },
    capabilities: {
      address: "exact", imageInput: "clipboard-key", textInput: "paste", readBack: "none",
      verification: ["target-live"], actions: capability ? ["copy", "stage", "reveal"] : ["copy", "stage"],
    },
  });
  let finishReveal: ((result: RevealResult) => void) | undefined;
  const reveal = vi.fn(() => new Promise<RevealResult>((resolve) => { finishReveal = resolve; }));
  const adapter = {
    id: "synthetic",
    discover: vi.fn(async () => [destination]),
    stageIfCurrent: vi.fn(async () => ({ status: "dispatched-unverified" as const })),
    ...(implementation ? { revealIfCurrent: reveal } : {}),
  };
  const clipboard = {
    writePng: vi.fn(),
    readImageEvidence: () => ({ bitmap: BITMAP, size: IMAGE.getSize() }),
  };
  const publish = vi.fn();
  const controller = new CaptureController(
    new WorkflowStore(), new WorkflowDiagnostics(() => 0),
    new CaptureSession({ getDisplayAtPointer: () => DISPLAY, captureDisplay: async () => ({ display: DISPLAY, image: IMAGE }) }, clipboard),
    new DestinationRegistry([adapter]),
    { prepare: async () => undefined, sendSnapshot: () => undefined, show: () => undefined, close: () => undefined },
    { hideForCapture: async () => undefined, publishWorkflow: publish, show: () => undefined },
    () => OPERATION,
  );
  const stage = async () => {
    await controller.startCapture();
    controller.overlayReady(OPERATION);
    controller.completeSelection(OPERATION, { x: 0, y: 0, width: 16, height: 16 });
    await controller.discoverDestinations(OPERATION);
    return controller.stageCapture(OPERATION, destination.id, null);
  };
  return { adapter, clipboard, controller, destination, publish, reveal, stage,
    finishReveal: () => { if (finishReveal === undefined) throw new Error("Reveal was not requested."); finishReveal({ status: "revealed" }); },
  };
}

describe("main-owned Reveal recovery", () => {
  it("restores availability from a snapshot without discovery or delivery replay and consumes it before awaiting Reveal", async () => {
    const harness = createHarness();
    const result = await harness.stage();
    expect(result).toMatchObject({ phase: "result", revealAvailable: true });
    expect(harness.publish).toHaveBeenLastCalledWith(result);
    expect(workflowSnapshotSchema.parse(harness.controller.snapshot)).toEqual(result);
    // A new renderer reads this state; no local destination selection is needed.
    expect(harness.controller.snapshot).toEqual(result);
    expect(harness.adapter.discover).toHaveBeenCalledOnce();
    expect(harness.adapter.stageIfCurrent).toHaveBeenCalledOnce();
    await expect(harness.controller.revealDestination(OTHER)).resolves.toEqual({ status: "stale" });
    expect(harness.controller.snapshot).toMatchObject({ revealAvailable: true });

    const pending = harness.controller.revealDestination(OPERATION);
    expect(harness.controller.snapshot).toMatchObject({ revealAvailable: false });
    await expect(harness.controller.revealDestination(OPERATION)).resolves.toEqual({ status: "stale" });
    harness.finishReveal();
    await expect(pending).resolves.toEqual({ status: "revealed" });
    expect(harness.controller.snapshot).toEqual({ ...result, revealAvailable: false });
    await expect(harness.controller.revealDestination(OPERATION)).resolves.toEqual({ status: "stale" });
    expect(harness.reveal).toHaveBeenCalledExactlyOnceWith({ destination: harness.destination });
    expect(harness.clipboard.writePng).toHaveBeenCalledOnce();
    expect(harness.adapter.stageIfCurrent).toHaveBeenCalledOnce();
    harness.controller.dismissResult(OPERATION);
    expect(harness.controller.snapshot).toEqual({ phase: "idle" });
  });

  it.each([{ capability: false, implementation: true }, { capability: true, implementation: false }])(
    "does not advertise a missing capability or implementation (%#)",
    async ({ capability, implementation }) => {
      const harness = createHarness(capability, implementation);
      await expect(harness.stage()).resolves.toMatchObject({ phase: "result", revealAvailable: false });
      expect(harness.controller.snapshot).toMatchObject({ revealAvailable: false });
      await expect(harness.controller.revealDestination(OPERATION)).resolves.toEqual({ status: "unsupported" });
      expect(harness.reveal).not.toHaveBeenCalled();
    },
  );
});

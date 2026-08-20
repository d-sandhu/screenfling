import { CapturePermissionBlockedError, CaptureSessionStateError } from "./capture-session";

import type { CaptureDisplay, CaptureSession } from "./capture-session";
import type { CaptureDraft, CaptureOverlaySnapshot, DipSelectionInput } from "../shared/capture";
import type { DeliveryResult, WorkflowSnapshot } from "../shared/workflow";
import type { WorkflowStore } from "./workflow-store";

export type CaptureOverlayPort = {
  readonly close: () => void;
  readonly prepare: (display: CaptureDisplay) => Promise<void>;
  readonly sendSnapshot: (snapshot: CaptureOverlaySnapshot) => void;
  readonly show: () => void;
};

export type MainSurfacePort = {
  readonly hideForCapture: () => Promise<void>;
  readonly publishWorkflow: (snapshot: WorkflowSnapshot) => void;
  readonly show: () => void;
};

type OperationIdFactory = () => string;

function isActiveOperation(snapshot: WorkflowSnapshot, operationId: string): boolean {
  return (
    snapshot.phase !== "idle" && snapshot.phase !== "result" && snapshot.operationId === operationId
  );
}

export class CaptureController {
  readonly #capture: CaptureSession;
  readonly #createOperationId: OperationIdFactory;
  readonly #mainSurface: MainSurfacePort;
  readonly #overlay: CaptureOverlayPort;
  readonly #workflow: WorkflowStore;

  constructor(
    workflow: WorkflowStore,
    capture: CaptureSession,
    overlay: CaptureOverlayPort,
    mainSurface: MainSurfacePort,
    createOperationId: OperationIdFactory,
  ) {
    this.#workflow = workflow;
    this.#capture = capture;
    this.#overlay = overlay;
    this.#mainSurface = mainSurface;
    this.#createOperationId = createOperationId;
  }

  get snapshot(): WorkflowSnapshot {
    return this.#workflow.snapshot;
  }

  async startCapture(): Promise<WorkflowSnapshot> {
    if (this.#workflow.snapshot.phase !== "idle") return this.#workflow.snapshot;

    const operationId = this.#createOperationId();
    this.#publish(this.#workflow.start(operationId));
    try {
      await this.#mainSurface.hideForCapture();
      if (!isActiveOperation(this.#workflow.snapshot, operationId)) {
        return this.#workflow.snapshot;
      }
      const display = this.#capture.getDisplayAtPointer();
      await this.#overlay.prepare(display);
      if (!isActiveOperation(this.#workflow.snapshot, operationId)) {
        this.#overlay.close();
        return this.#workflow.snapshot;
      }

      const snapshot = await this.#capture.begin(operationId, display);
      if (!isActiveOperation(this.#workflow.snapshot, operationId)) {
        if (this.#capture.activeOperationId === operationId) this.#capture.release(operationId);
        this.#overlay.close();
        return this.#workflow.snapshot;
      }
      this.#overlay.sendSnapshot(snapshot);
      return this.#workflow.snapshot;
    } catch (cause) {
      if (
        cause instanceof CaptureSessionStateError &&
        !isActiveOperation(this.#workflow.snapshot, operationId)
      ) {
        return this.#workflow.snapshot;
      }
      const reason =
        cause instanceof CapturePermissionBlockedError ? "permission-blocked" : "capture-failed";
      return this.#fail(operationId, reason);
    }
  }

  overlayReady(operationId: string): WorkflowSnapshot {
    const snapshot = this.#workflow.advance(operationId, "selecting");
    this.#overlay.show();
    return this.#publish(snapshot);
  }

  overlayFailed(operationId: string): WorkflowSnapshot {
    return this.#fail(operationId, "capture-failed");
  }

  completeSelection(operationId: string, selection: DipSelectionInput): WorkflowSnapshot {
    try {
      this.#capture.complete(operationId, selection);
      const snapshot = this.#workflow.advance(operationId, "editing");
      this.#overlay.close();
      this.#mainSurface.show();
      return this.#publish(snapshot);
    } catch {
      return this.#fail(operationId, "capture-failed");
    }
  }

  getDraft(operationId: string): CaptureDraft {
    return this.#capture.getDraft(operationId);
  }

  copyCapture(operationId: string): WorkflowSnapshot {
    this.#publish(this.#workflow.advance(operationId, "writing-clipboard"));
    try {
      this.#capture.copy(operationId);
      this.#capture.release(operationId);
      return this.#publish(this.#workflow.finish(operationId, { status: "copied" }));
    } catch {
      return this.#fail(operationId, "clipboard-failed");
    }
  }

  cancel(operationId: string): WorkflowSnapshot {
    const snapshot = this.#workflow.cancel(operationId);
    if (this.#capture.activeOperationId === operationId) this.#capture.release(operationId);
    this.#overlay.close();
    this.#mainSurface.show();
    return this.#publish(snapshot);
  }

  dismissResult(operationId: string): WorkflowSnapshot {
    return this.#publish(this.#workflow.dismissResult(operationId));
  }

  displayChanged(displayId: string): WorkflowSnapshot {
    const current = this.#workflow.snapshot;
    if (current.phase === "snapshotting") {
      if (this.#capture.activeOperationId === current.operationId) {
        this.#capture.release(current.operationId);
      }
      this.#overlay.close();
      this.#mainSurface.show();
      return this.#publish(
        this.#workflow.finish(current.operationId, {
          status: "failed",
          reason: "capture-failed",
        }),
      );
    }

    const operationId = this.#capture.invalidateDisplay(displayId);
    if (operationId === null || !isActiveOperation(this.#workflow.snapshot, operationId)) {
      return this.#workflow.snapshot;
    }
    this.#overlay.close();
    this.#mainSurface.show();
    return this.#publish(
      this.#workflow.finish(operationId, { status: "failed", reason: "capture-failed" }),
    );
  }

  overlayClosedUnexpectedly(): WorkflowSnapshot {
    const current = this.#workflow.snapshot;
    if (current.phase !== "snapshotting" && current.phase !== "selecting") {
      return this.#workflow.snapshot;
    }
    if (this.#capture.activeOperationId === current.operationId) {
      this.#capture.release(current.operationId);
    }
    this.#mainSurface.show();
    return this.#publish(this.#workflow.cancel(current.operationId));
  }

  #fail(
    operationId: string,
    reason: Extract<DeliveryResult, { readonly status: "failed" }>["reason"],
  ): WorkflowSnapshot {
    if (!isActiveOperation(this.#workflow.snapshot, operationId)) return this.#workflow.snapshot;
    if (this.#capture.activeOperationId === operationId) this.#capture.release(operationId);
    this.#overlay.close();
    this.#mainSurface.show();
    return this.#publish(this.#workflow.finish(operationId, { status: "failed", reason }));
  }

  #publish(snapshot: WorkflowSnapshot): WorkflowSnapshot {
    this.#mainSurface.publishWorkflow(snapshot);
    return snapshot;
  }
}

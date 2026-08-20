import { z } from "zod";

import { operationIdSchema } from "./domain";

import type { CaptureDraft, CaptureOverlaySnapshot, CaptureSelectionRequest } from "./capture";
import type { WorkflowSnapshot } from "./workflow";

export const BRIDGE_VERSION = 3;

export const IPC_CHANNELS = Object.freeze({
  cancelOperation: "workflow:cancel-operation",
  copyCapture: "workflow:copy-capture",
  dismissResult: "workflow:dismiss-result",
  getCaptureDraft: "workflow:get-capture-draft",
  getShortcutStatus: "workflow:get-shortcut-status",
  getSnapshot: "workflow:get-snapshot",
  snapshotChanged: "workflow:snapshot-changed",
  startCapture: "workflow:start-capture",
});

export const CAPTURE_OVERLAY_CHANNELS = Object.freeze({
  cancel: "capture-overlay:cancel",
  completeSelection: "capture-overlay:complete-selection",
  failed: "capture-overlay:failed",
  ready: "capture-overlay:ready",
  snapshot: "capture-overlay:snapshot",
});

export const operationRequestSchema = z.strictObject({ operationId: operationIdSchema }).readonly();

export type OperationRequest = z.infer<typeof operationRequestSchema>;
export type WorkflowIpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const shortcutStatusSchema = z
  .strictObject({
    accelerator: z.string().min(1).max(64),
    registered: z.boolean(),
  })
  .readonly();

export type ShortcutStatus = z.infer<typeof shortcutStatusSchema>;
export type Unsubscribe = () => void;

export type ScreenFlingBridge = {
  readonly apiVersion: typeof BRIDGE_VERSION;
  readonly cancelOperation: (request: OperationRequest) => Promise<WorkflowSnapshot>;
  readonly copyCapture: (request: OperationRequest) => Promise<WorkflowSnapshot>;
  readonly dismissResult: (request: OperationRequest) => Promise<WorkflowSnapshot>;
  readonly getCaptureDraft: (request: OperationRequest) => Promise<CaptureDraft>;
  readonly getShortcutStatus: () => Promise<ShortcutStatus>;
  readonly getSnapshot: () => Promise<WorkflowSnapshot>;
  readonly onWorkflowSnapshot: (listener: (snapshot: WorkflowSnapshot) => void) => Unsubscribe;
  readonly startCapture: () => Promise<WorkflowSnapshot>;
};

export type CaptureOverlayBridge = {
  readonly cancel: (request: OperationRequest) => Promise<WorkflowSnapshot>;
  readonly completeSelection: (request: CaptureSelectionRequest) => Promise<WorkflowSnapshot>;
  readonly failed: (request: OperationRequest) => Promise<WorkflowSnapshot>;
  readonly onSnapshot: (listener: (snapshot: CaptureOverlaySnapshot) => void) => Unsubscribe;
  readonly ready: (request: OperationRequest) => Promise<WorkflowSnapshot>;
};

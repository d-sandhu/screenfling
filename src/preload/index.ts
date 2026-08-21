import { contextBridge, ipcRenderer } from "electron";

import {
  BRIDGE_VERSION,
  CAPTURE_OVERLAY_CHANNELS,
  IPC_CHANNELS,
  operationRequestSchema,
  shortcutStatusSchema,
  stageCaptureRequestSchema,
} from "../shared/bridge";
import {
  captureDraftSchema,
  captureOverlaySnapshotSchema,
  captureSelectionRequestSchema,
} from "../shared/capture";
import { LatestValueRelay } from "../shared/latest-value-relay";
import { destinationListSchema } from "../shared/domain";
import { diagnosticsSnapshotSchema } from "../shared/diagnostics";
import { revealResultSchema, workflowSnapshotSchema } from "../shared/workflow";

import type {
  CaptureOverlayBridge,
  OperationRequest,
  ScreenFlingBridge,
  StageCaptureRequest,
  ShortcutStatus,
  Unsubscribe,
} from "../shared/bridge";
import type {
  CaptureDraft,
  CaptureOverlaySnapshot,
  CaptureSelectionRequest,
} from "../shared/capture";
import type { RevealResult, WorkflowSnapshot } from "../shared/workflow";
import type { Destination } from "../shared/domain";
import type { DiagnosticsSnapshot } from "../shared/diagnostics";

type OperationWorkflowChannel =
  | typeof IPC_CHANNELS.cancelOperation
  | typeof IPC_CHANNELS.copyCapture
  | typeof IPC_CHANNELS.dismissResult;

const isCaptureSurface = process.argv.includes("--screenfling-surface=capture");
const captureSnapshotRelay = new LatestValueRelay<CaptureOverlaySnapshot>();

async function invokeOperationWorkflow(
  channel: OperationWorkflowChannel,
  request: OperationRequest,
): Promise<WorkflowSnapshot> {
  const validatedRequest = operationRequestSchema.parse(request);
  return workflowSnapshotSchema.parse(await ipcRenderer.invoke(channel, validatedRequest));
}

async function invokeNoPayloadWorkflow(
  channel: typeof IPC_CHANNELS.getSnapshot | typeof IPC_CHANNELS.startCapture,
): Promise<WorkflowSnapshot> {
  return workflowSnapshotSchema.parse(await ipcRenderer.invoke(channel));
}

async function getCaptureDraft(request: OperationRequest): Promise<CaptureDraft> {
  const validatedRequest = operationRequestSchema.parse(request);
  return captureDraftSchema.parse(
    await ipcRenderer.invoke(IPC_CHANNELS.getCaptureDraft, validatedRequest),
  );
}

async function getDiagnostics(): Promise<DiagnosticsSnapshot> {
  return diagnosticsSnapshotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.getDiagnostics));
}

async function getShortcutStatus(): Promise<ShortcutStatus> {
  return shortcutStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.getShortcutStatus));
}

async function discoverDestinations(request: OperationRequest): Promise<readonly Destination[]> {
  const validatedRequest = operationRequestSchema.parse(request);
  return destinationListSchema.parse(
    await ipcRenderer.invoke(IPC_CHANNELS.discoverDestinations, validatedRequest),
  );
}

async function stageCapture(request: StageCaptureRequest): Promise<WorkflowSnapshot> {
  const validatedRequest = stageCaptureRequestSchema.parse(request);
  return workflowSnapshotSchema.parse(
    await ipcRenderer.invoke(IPC_CHANNELS.stageCapture, validatedRequest),
  );
}

async function revealDestination(request: OperationRequest): Promise<RevealResult> {
  const validatedRequest = operationRequestSchema.parse(request);
  return revealResultSchema.parse(
    await ipcRenderer.invoke(IPC_CHANNELS.revealDestination, validatedRequest),
  );
}

function onWorkflowSnapshot(listener: (snapshot: WorkflowSnapshot) => void): Unsubscribe {
  const receive = (_event: Electron.IpcRendererEvent, payload: WorkflowSnapshot) => {
    listener(workflowSnapshotSchema.parse(payload));
  };
  ipcRenderer.on(IPC_CHANNELS.snapshotChanged, receive);
  return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshotChanged, receive);
}

const mainBridge: ScreenFlingBridge = Object.freeze({
  apiVersion: BRIDGE_VERSION,
  cancelOperation: (request) => invokeOperationWorkflow(IPC_CHANNELS.cancelOperation, request),
  copyCapture: (request) => invokeOperationWorkflow(IPC_CHANNELS.copyCapture, request),
  dismissResult: (request) => invokeOperationWorkflow(IPC_CHANNELS.dismissResult, request),
  discoverDestinations,
  getCaptureDraft,
  getDiagnostics,
  getShortcutStatus,
  getSnapshot: () => invokeNoPayloadWorkflow(IPC_CHANNELS.getSnapshot),
  onWorkflowSnapshot,
  revealDestination,
  startCapture: () => invokeNoPayloadWorkflow(IPC_CHANNELS.startCapture),
  stageCapture,
});

async function invokeOverlayOperation(
  channel:
    | typeof CAPTURE_OVERLAY_CHANNELS.cancel
    | typeof CAPTURE_OVERLAY_CHANNELS.failed
    | typeof CAPTURE_OVERLAY_CHANNELS.ready,
  request: OperationRequest,
): Promise<WorkflowSnapshot> {
  const validatedRequest = operationRequestSchema.parse(request);
  return workflowSnapshotSchema.parse(await ipcRenderer.invoke(channel, validatedRequest));
}

async function completeSelection(request: CaptureSelectionRequest): Promise<WorkflowSnapshot> {
  const validatedRequest = captureSelectionRequestSchema.parse(request);
  return workflowSnapshotSchema.parse(
    await ipcRenderer.invoke(CAPTURE_OVERLAY_CHANNELS.completeSelection, validatedRequest),
  );
}

function onCaptureSnapshot(
  listener: (snapshot: ReturnType<typeof captureOverlaySnapshotSchema.parse>) => void,
): Unsubscribe {
  return captureSnapshotRelay.subscribe(listener);
}

function receiveCaptureSnapshot(
  _event: Electron.IpcRendererEvent,
  payload: CaptureOverlaySnapshot,
): void {
  captureSnapshotRelay.publish(captureOverlaySnapshotSchema.parse(payload));
}

if (isCaptureSurface) {
  ipcRenderer.on(CAPTURE_OVERLAY_CHANNELS.snapshot, receiveCaptureSnapshot);
}

const overlayBridge: CaptureOverlayBridge = Object.freeze({
  cancel: (request) => invokeOverlayOperation(CAPTURE_OVERLAY_CHANNELS.cancel, request),
  completeSelection,
  failed: (request) => invokeOverlayOperation(CAPTURE_OVERLAY_CHANNELS.failed, request),
  onSnapshot: onCaptureSnapshot,
  ready: (request) => invokeOverlayOperation(CAPTURE_OVERLAY_CHANNELS.ready, request),
});

if (isCaptureSurface) {
  contextBridge.exposeInMainWorld("captureOverlay", overlayBridge);
} else {
  contextBridge.exposeInMainWorld("screenFling", mainBridge);
}

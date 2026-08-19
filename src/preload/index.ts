import { contextBridge, ipcRenderer } from "electron";

import { BRIDGE_VERSION, IPC_CHANNELS, operationRequestSchema } from "../shared/bridge";
import { CAPTURE_PROTOTYPE_CHANNELS } from "../shared/capture-prototype-contract";
import { workflowSnapshotSchema } from "../shared/workflow";

import type { OperationRequest, ScreenFlingBridge, WorkflowIpcChannel } from "../shared/bridge";

async function invokeWorkflow(
  channel: WorkflowIpcChannel,
  request: OperationRequest,
): Promise<ReturnType<typeof workflowSnapshotSchema.parse>> {
  const validatedRequest = operationRequestSchema.parse(request);
  const response = await ipcRenderer.invoke(channel, validatedRequest);
  return workflowSnapshotSchema.parse(response);
}

const bridge: ScreenFlingBridge = Object.freeze({
  apiVersion: BRIDGE_VERSION,
  cancelOperation: (request) => invokeWorkflow(IPC_CHANNELS.cancelOperation, request),
  dismissResult: (request) => invokeWorkflow(IPC_CHANNELS.dismissResult, request),
});

const capturePrototypeBridge = Object.freeze({
  onSnapshot: (
    listener: (snapshot: { operationId: string; preview: Uint8Array; automatic: boolean }) => void,
  ) => {
    ipcRenderer.once(CAPTURE_PROTOTYPE_CHANNELS.snapshot, (_event, snapshot) => {
      listener(snapshot);
    });
  },
  ready: (request: OperationRequest) =>
    ipcRenderer.invoke(CAPTURE_PROTOTYPE_CHANNELS.ready, request),
  complete: (request: {
    operationId: string;
    selection: { x: number; y: number; width: number; height: number };
  }) => ipcRenderer.invoke(CAPTURE_PROTOTYPE_CHANNELS.complete, request),
  cancel: (request: OperationRequest) =>
    ipcRenderer.invoke(CAPTURE_PROTOTYPE_CHANNELS.cancel, request),
});

if (process.argv.includes("--capture-prototype")) {
  contextBridge.exposeInMainWorld("capturePrototype", capturePrototypeBridge);
} else {
  contextBridge.exposeInMainWorld("screenFling", bridge);
}

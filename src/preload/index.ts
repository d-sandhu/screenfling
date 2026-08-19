import { contextBridge, ipcRenderer } from "electron";

import { BRIDGE_VERSION, IPC_CHANNELS, operationRequestSchema } from "../shared/bridge";
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

contextBridge.exposeInMainWorld("screenFling", bridge);

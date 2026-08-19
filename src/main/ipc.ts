import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../shared/bridge";
import { assertTrustedIpcSender } from "./ipc-sender";
import { createValidatedOperationHandler } from "./validated-operation-handler";

import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { WorkflowStore } from "./workflow-store";

type MainWebContentsProvider = () => WebContents | null;

export function registerWorkflowIpc(
  mainWebContents: MainWebContentsProvider,
  devRendererUrl: string | null,
  workflow: WorkflowStore,
): void {
  const authorize = (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSender(event, mainWebContents(), devRendererUrl);
  };
  const cancelOperation = createValidatedOperationHandler(authorize, (operationId) =>
    workflow.cancel(operationId),
  );
  const dismissResult = createValidatedOperationHandler(authorize, (operationId) =>
    workflow.dismissResult(operationId),
  );

  ipcMain.handle(IPC_CHANNELS.cancelOperation, cancelOperation);
  ipcMain.handle(IPC_CHANNELS.dismissResult, dismissResult);
}

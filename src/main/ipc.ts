import { ipcMain } from "electron";

import {
  CAPTURE_OVERLAY_CHANNELS,
  IPC_CHANNELS,
  stageCaptureRequestSchema,
} from "../shared/bridge";
import { captureSelectionRequestSchema } from "../shared/capture";
import { assertTrustedIpcSender } from "./ipc-sender";
import {
  createAuthorizedNoPayloadHandler,
  createValidatedOperationHandler,
} from "./validated-operation-handler";

import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { ShortcutStatus } from "../shared/bridge";
import type { DiagnosticsSnapshot } from "../shared/diagnostics";
import type { CaptureController } from "./capture-controller";
import type { SerializedIpcValue } from "./validated-operation-handler";

type WebContentsProvider = () => WebContents | null;
type DiagnosticsProvider = () => DiagnosticsSnapshot;
type ShortcutStatusProvider = () => ShortcutStatus;

export function registerWorkflowIpc(
  mainWebContents: WebContentsProvider,
  overlayWebContents: WebContentsProvider,
  mainRendererUrl: string,
  overlayRendererUrl: string,
  controller: CaptureController,
  diagnostics: DiagnosticsProvider,
  shortcutStatus: ShortcutStatusProvider,
): void {
  const authorizeMain = (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSender(event, mainWebContents(), mainRendererUrl);
  };
  const authorizeOverlay = (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSender(event, overlayWebContents(), overlayRendererUrl);
  };

  ipcMain.handle(
    IPC_CHANNELS.getSnapshot,
    createAuthorizedNoPayloadHandler(authorizeMain, () => controller.snapshot),
  );
  ipcMain.handle(
    IPC_CHANNELS.getDiagnostics,
    createAuthorizedNoPayloadHandler(authorizeMain, diagnostics),
  );
  ipcMain.handle(
    IPC_CHANNELS.getShortcutStatus,
    createAuthorizedNoPayloadHandler(authorizeMain, shortcutStatus),
  );
  ipcMain.handle(
    IPC_CHANNELS.startCapture,
    createAuthorizedNoPayloadHandler(authorizeMain, () => controller.startCapture()),
  );
  ipcMain.handle(
    IPC_CHANNELS.getCaptureDraft,
    createValidatedOperationHandler(authorizeMain, (operationId) =>
      controller.getDraft(operationId),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.discoverDestinations,
    createValidatedOperationHandler(authorizeMain, (operationId) =>
      controller.discoverDestinations(operationId),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.copyCapture,
    createValidatedOperationHandler(authorizeMain, (operationId) =>
      controller.copyCapture(operationId),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.cancelOperation,
    createValidatedOperationHandler(authorizeMain, (operationId) => controller.cancel(operationId)),
  );
  ipcMain.handle(
    IPC_CHANNELS.dismissResult,
    createValidatedOperationHandler(authorizeMain, (operationId) =>
      controller.dismissResult(operationId),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.revealDestination,
    createValidatedOperationHandler(authorizeMain, (operationId) =>
      controller.revealDestination(operationId),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.stageCapture,
    (event: IpcMainInvokeEvent, ...payloads: SerializedIpcValue[]) => {
      authorizeMain(event);
      if (payloads.length !== 1) throw new Error("Invalid Stage request.");
      const request = stageCaptureRequestSchema.safeParse(payloads[0]);
      if (!request.success) throw new Error("Invalid Stage request.");
      return controller.stageCapture(
        request.data.operationId,
        request.data.destinationId,
        request.data.note,
      );
    },
  );

  ipcMain.handle(
    CAPTURE_OVERLAY_CHANNELS.ready,
    createValidatedOperationHandler(authorizeOverlay, (operationId) =>
      controller.overlayReady(operationId),
    ),
  );
  ipcMain.handle(
    CAPTURE_OVERLAY_CHANNELS.cancel,
    createValidatedOperationHandler(authorizeOverlay, (operationId) =>
      controller.cancel(operationId),
    ),
  );
  ipcMain.handle(
    CAPTURE_OVERLAY_CHANNELS.failed,
    createValidatedOperationHandler(authorizeOverlay, (operationId) =>
      controller.overlayFailed(operationId),
    ),
  );
  ipcMain.handle(
    CAPTURE_OVERLAY_CHANNELS.completeSelection,
    (event: IpcMainInvokeEvent, ...payloads: SerializedIpcValue[]) => {
      authorizeOverlay(event);
      if (payloads.length !== 1) throw new Error("Invalid capture selection request.");
      const request = captureSelectionRequestSchema.safeParse(payloads[0]);
      if (!request.success) throw new Error("Invalid capture selection request.");
      return controller.completeSelection(request.data.operationId, request.data.selection);
    },
  );
}

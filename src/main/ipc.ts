import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import { wezTermFileFieldSchema, wezTermPathSchema, wezTermSetupConfigurationSchema } from "../shared/wezterm-setup";
import type { WezTermSetup } from "./wezterm-setup";

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
  createValidatedShortcutHandler,
} from "./validated-operation-handler";

import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { DiagnosticsSnapshot } from "../shared/diagnostics";
import type { ScreenCaptureReadinessSnapshot } from "../shared/screen-capture-readiness";
import type { CaptureController } from "./capture-controller";
import type { ShortcutOperations } from "./shortcut-manager";
import type { SerializedIpcValue } from "./validated-operation-handler";

type WebContentsProvider = () => WebContents | null;
type DiagnosticsProvider = () => DiagnosticsSnapshot;
type ScreenCaptureReadinessProvider = () => ScreenCaptureReadinessSnapshot;
type ReadinessHandler<Event> = (
  event: Event,
  ...payloads: SerializedIpcValue[]
) => ScreenCaptureReadinessSnapshot;
type ReadinessHandlerRegistrar<Event> = (channel: string, handler: ReadinessHandler<Event>) => void;

export function registerScreenCaptureReadinessIpc<Event>(
  register: ReadinessHandlerRegistrar<Event>,
  authorize: (event: Event) => void,
  screenCaptureReadiness: ScreenCaptureReadinessProvider,
): void {
  register(
    IPC_CHANNELS.getScreenCaptureReadiness,
    createAuthorizedNoPayloadHandler(authorize, screenCaptureReadiness),
  );
}

export function registerWorkflowIpc(
  mainWebContents: WebContentsProvider,
  overlayWebContents: WebContentsProvider,
  mainRendererUrl: string,
  overlayRendererUrl: string,
  controller: CaptureController,
  diagnostics: DiagnosticsProvider,
  screenCaptureReadiness: ScreenCaptureReadinessProvider,
  shortcut: ShortcutOperations,
  weztermSetup: WezTermSetup,
): void {
  const authorizeMain = (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSender(event, mainWebContents(), mainRendererUrl);
  };
  const authorizeOverlay = (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSender(event, overlayWebContents(), overlayRendererUrl);
  };

  ipcMain.handle(
    IPC_CHANNELS.checkWezTermSetup,
    (event: IpcMainInvokeEvent, ...payloads: SerializedIpcValue[]) => {
      authorizeMain(event);
      if (payloads.length !== 1) throw new Error("Invalid connection check.");
      const parsed = wezTermSetupConfigurationSchema.safeParse(payloads[0]);
      if (!parsed.success) throw new Error("Invalid connection check.");
      return weztermSetup.check(parsed.data);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.chooseWezTermFile,
    (event: IpcMainInvokeEvent, ...payloads: SerializedIpcValue[]) => {
      authorizeMain(event);
      if (payloads.length !== 1) throw new Error("Invalid file selection.");
      const field = wezTermFileFieldSchema.safeParse(payloads[0]);
      if (!field.success) throw new Error("Invalid file selection.");
      return weztermSetup.chooseFile(async () => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window === null || window.isDestroyed()) return null;
        const chosen = await dialog.showOpenDialog(window, {
          title: field.data === "executable" ? "Choose the WezTerm executable" : "Choose your WezTerm configuration",
          defaultPath: field.data === "executable" ? "/Applications/WezTerm.app/Contents/MacOS" : app.getPath("home"),
          properties: ["openFile", "showHiddenFiles", "treatPackageAsDirectory", "noResolveAliases"],
        });
        if (chosen.canceled || window.isDestroyed() || event.sender.isDestroyed()) return null;
        authorizeMain(event);
        const path = wezTermPathSchema.safeParse(chosen.filePaths[0]);
        return path.success ? path.data : null;
      }).catch(() => { throw new Error("File selection failed."); });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.openScreenRecordingSettings,
    createAuthorizedNoPayloadHandler(authorizeMain, async () => {
      if (process.platform !== "darwin" || controller.snapshot.phase !== "idle") return false;
      try {
        // Fixed destination only: renderer input never becomes an external URL.
        await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
        return true;
      } catch { return false; }
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.getWezTermSetup,
    createAuthorizedNoPayloadHandler(authorizeMain, () => weztermSetup.getSnapshot()),
  );
  ipcMain.handle(
    IPC_CHANNELS.restartApplication,
    createAuthorizedNoPayloadHandler(authorizeMain, () => weztermSetup.restart()),
  );
  ipcMain.handle(
    IPC_CHANNELS.saveWezTermSetup,
    (event: IpcMainInvokeEvent, ...payloads: SerializedIpcValue[]) => {
      authorizeMain(event);
      if (payloads.length !== 1) throw new Error("Invalid connection setup.");
      const parsed = wezTermSetupConfigurationSchema.nullable().safeParse(payloads[0]);
      if (!parsed.success) throw new Error("Invalid connection setup.");
      return weztermSetup.save(parsed.data);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getSnapshot,
    createAuthorizedNoPayloadHandler(authorizeMain, () => controller.snapshot),
  );
  ipcMain.handle(
    IPC_CHANNELS.getDiagnostics,
    createAuthorizedNoPayloadHandler(authorizeMain, diagnostics),
  );
  registerScreenCaptureReadinessIpc(
    (channel, handler) => ipcMain.handle(channel, handler),
    authorizeMain,
    screenCaptureReadiness,
  );
  ipcMain.handle(
    IPC_CHANNELS.getShortcutStatus,
    createAuthorizedNoPayloadHandler(authorizeMain, () => shortcut.getStatus()),
  );
  ipcMain.handle(
    IPC_CHANNELS.resetShortcut,
    createAuthorizedNoPayloadHandler(authorizeMain, () => shortcut.reset()),
  );
  ipcMain.handle(
    IPC_CHANNELS.setShortcut,
    createValidatedShortcutHandler(authorizeMain, (configuration) => shortcut.set(configuration)),
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
      controller.discoverDestinationsWithStatus(operationId),
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

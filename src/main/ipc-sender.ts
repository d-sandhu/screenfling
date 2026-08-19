import type { IpcMainInvokeEvent, WebContents } from "electron";

const PACKAGED_RENDERER_URL = "screenfling://bundle/index.html";

export type IpcSenderEvidence = {
  readonly webContentsMatches: boolean;
  readonly mainFrameMatches: boolean;
  readonly frameUrl: string | null;
};

export function isTrustedRendererFrameUrl(
  frameUrl: string,
  devRendererUrl: string | null,
): boolean {
  try {
    const parsedFrameUrl = new URL(frameUrl);
    if (devRendererUrl !== null) {
      return parsedFrameUrl.href === new URL(devRendererUrl).href;
    }
    return parsedFrameUrl.href === PACKAGED_RENDERER_URL;
  } catch {
    return false;
  }
}

export function isTrustedIpcSenderEvidence(
  evidence: IpcSenderEvidence,
  devRendererUrl: string | null,
): boolean {
  return (
    evidence.webContentsMatches &&
    evidence.mainFrameMatches &&
    evidence.frameUrl !== null &&
    isTrustedRendererFrameUrl(evidence.frameUrl, devRendererUrl)
  );
}

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  expectedWebContents: WebContents | null,
  devRendererUrl: string | null,
): void {
  const senderFrame = event.senderFrame;
  const evidence: IpcSenderEvidence = {
    webContentsMatches: expectedWebContents !== null && event.sender === expectedWebContents,
    mainFrameMatches: expectedWebContents !== null && senderFrame === expectedWebContents.mainFrame,
    frameUrl: senderFrame?.url ?? null,
  };

  if (!isTrustedIpcSenderEvidence(evidence, devRendererUrl)) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
}

import type { IpcMainInvokeEvent, WebContents } from "electron";

export type IpcSenderEvidence = {
  readonly webContentsMatches: boolean;
  readonly mainFrameMatches: boolean;
  readonly frameUrl: string | null;
};

export function isTrustedRendererFrameUrl(frameUrl: string, expectedRendererUrl: string): boolean {
  try {
    return new URL(frameUrl).href === new URL(expectedRendererUrl).href;
  } catch {
    return false;
  }
}

export function isTrustedIpcSenderEvidence(
  evidence: IpcSenderEvidence,
  expectedRendererUrl: string,
): boolean {
  return (
    evidence.webContentsMatches &&
    evidence.mainFrameMatches &&
    evidence.frameUrl !== null &&
    isTrustedRendererFrameUrl(evidence.frameUrl, expectedRendererUrl)
  );
}

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  expectedWebContents: WebContents | null,
  expectedRendererUrl: string,
): void {
  const senderFrame = event.senderFrame;
  const evidence: IpcSenderEvidence = {
    webContentsMatches: expectedWebContents !== null && event.sender === expectedWebContents,
    mainFrameMatches: expectedWebContents !== null && senderFrame === expectedWebContents.mainFrame,
    frameUrl: senderFrame?.url ?? null,
  };

  if (!isTrustedIpcSenderEvidence(evidence, expectedRendererUrl)) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
}

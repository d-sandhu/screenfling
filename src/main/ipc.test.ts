import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "../shared/bridge";
import { registerScreenCaptureReadinessIpc } from "./ipc";

import type { ScreenCaptureReadinessSnapshot } from "../shared/screen-capture-readiness";
import type { SerializedIpcValue } from "./validated-operation-handler";

type TestEvent = "main" | "overlay" | "wrong-document";
type TestHandler = (
  event: TestEvent,
  ...payloads: SerializedIpcValue[]
) => ScreenCaptureReadinessSnapshot;

class RecordingReadinessRegistrar {
  channel: string | null = null;
  handler: TestHandler | null = null;

  register = (channel: string, handler: TestHandler): void => {
    this.channel = channel;
    this.handler = handler;
  };

  invoke(event: TestEvent, ...payloads: SerializedIpcValue[]): ScreenCaptureReadinessSnapshot {
    if (this.handler === null) throw new Error("Readiness IPC was not registered.");
    return this.handler(event, ...payloads);
  }
}

describe("Screen Recording readiness IPC registration", () => {
  it("registers the exact channel, authorizes first, and accepts no payload", () => {
    const registrar = new RecordingReadinessRegistrar();
    const snapshot = { platform: "macos", status: "denied", version: 1 } as const;
    const provider = vi.fn(() => snapshot);
    const authorize = vi.fn((event: TestEvent) => {
      if (event !== "main") throw new Error("Rejected IPC from an untrusted renderer.");
    });

    registerScreenCaptureReadinessIpc(registrar.register, authorize, provider);

    expect(registrar.channel).toBe(IPC_CHANNELS.getScreenCaptureReadiness);
    expect(registrar.invoke("main")).toEqual(snapshot);
    expect(provider).toHaveBeenCalledOnce();
    expect(() => registrar.invoke("main", {})).toThrow("Invalid empty workflow request.");
    expect(provider).toHaveBeenCalledOnce();

    for (const event of ["overlay", "wrong-document"] as const) {
      expect(() => registrar.invoke(event)).toThrow("Rejected IPC from an untrusted renderer.");
    }
    expect(authorize).toHaveBeenCalledTimes(4);
    expect(provider).toHaveBeenCalledOnce();
  });
});

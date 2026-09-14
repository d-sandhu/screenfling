import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBoundedProcess } from "./bounded-process";

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { BoundedProcessRequest } from "./bounded-process";

// Real streams, synthetic process events; no module mock or operating-system process.
class ProcessFixture extends ChildProcess {
  override stdin = new PassThrough();
  override stdout = new PassThrough();
  override stderr = new PassThrough();
  override stdio: ChildProcessWithoutNullStreams["stdio"] = [
    this.stdin,
    this.stdout,
    this.stderr,
    undefined,
    undefined,
  ];
  override pid: number | undefined = 123_456;
  override kill = vi.fn((_signal?: NodeJS.Signals | number) => true);
}

const request = {
  executable: "/synthetic/not-executed",
  arguments: [],
  environment: {},
  input: null,
  maxOutputBytes: 64,
  timeoutMs: 100,
} satisfies BoundedProcessRequest;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded process lifecycle", () => {
  it("rejects a stalled guard and never launches after a late approval", async () => {
    const launch = vi.fn(() => new ProcessFixture());
    const result = runBoundedProcess(
      {
        ...request,
        beforeSpawn: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 200)),
      },
      launch,
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual({ status: "failed", reason: "guard-rejected" });
    await vi.runAllTimersAsync();
    expect(launch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("absorbs a late guard rejection without launching or leaking its timer", async () => {
    const launch = vi.fn(() => new ProcessFixture());
    const result = runBoundedProcess(
      {
        ...request,
        beforeSpawn: () =>
          new Promise<boolean>((_resolve, reject) => {
            setTimeout(() => reject(new Error("synthetic-late-guard-failure")), 200);
          }),
      },
      launch,
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual({ status: "failed", reason: "guard-rejected" });
    await vi.runAllTimersAsync();
    expect(launch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the guard deadline after an immediate inspection failure", async () => {
    const launch = vi.fn(() => new ProcessFixture());
    await expect(
      runBoundedProcess(
        {
          ...request,
          beforeSpawn: () => Promise.reject(new Error("synthetic-inspection-failure")),
        },
        launch,
      ),
    ).resolves.toEqual({ status: "failed", reason: "guard-rejected" });
    expect(launch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one deadline between inspection and the child, then releases all pipes", async () => {
    const child = new ProcessFixture();
    const result = runBoundedProcess(
      {
        ...request,
        beforeSpawn: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 75)),
      },
      () => child,
    );
    await vi.advanceTimersByTimeAsync(75);
    await vi.advanceTimersByTimeAsync(24);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual({ status: "failed", reason: "timeout" });
    expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
    expect(child.stdin.destroyed).toBe(true);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not mislabel a post-launch error as proof that no process started", async () => {
    const child = new ProcessFixture();
    const result = runBoundedProcess(request, () => child);
    child.emit("error", new Error("synthetic-kill-error"));
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual({ status: "failed", reason: "exit" });
    expect(child.kill).toHaveBeenCalledTimes(2);
    child.emit("error", new Error("synthetic-late-error"));
    await vi.runAllTimersAsync();
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the original timeout when termination itself emits an error", async () => {
    const child = new ProcessFixture();
    child.kill.mockImplementation(() => {
      child.emit("error", new Error("synthetic-kill-error"));
      return false;
    });
    const result = runBoundedProcess(request, () => child);
    await vi.advanceTimersByTimeAsync(300);
    await expect(result).resolves.toEqual({ status: "failed", reason: "timeout" });
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["stdout", "stderr"] as const)(
    "settles a %s read error without an uncaught main-process exception",
    async (stream) => {
      const child = new ProcessFixture();
      const result = runBoundedProcess(request, () => child);
      child[stream].emit("error", new Error("synthetic-pipe-read-error"));
      await vi.advanceTimersByTimeAsync(200);
      await expect(result).resolves.toEqual({ status: "failed", reason: "exit" });
      expect(child[stream].destroyed).toBe(true);
      child[stream].emit("error", new Error("synthetic-late-pipe-error"));
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("retains the proven no-spawn result when the child never acquired a PID", async () => {
    const child = new ProcessFixture();
    child.pid = undefined;
    const result = runBoundedProcess(request, () => child);
    child.emit("error", new Error("synthetic-spawn-failure"));
    await expect(result).resolves.toEqual({ status: "failed", reason: "spawn" });
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.stdin.destroyed).toBe(true);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

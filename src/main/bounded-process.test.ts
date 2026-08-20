import { describe, expect, it } from "vitest";

import { runBoundedProcess } from "./bounded-process";

const nodeCommand = (script: string, input: Uint8Array | null = null) => ({
  executable: process.execPath,
  arguments: ["-e", script],
  environment: process.env,
  input,
  maxOutputBytes: 1_024,
  timeoutMs: 2_000,
});

describe("bounded process runner", () => {
  it("passes exact stdin bytes and collects bounded stdout", async () => {
    const input = Uint8Array.from([0, 22, 39, 92, 226, 152, 131]);
    const result = await runBoundedProcess(
      nodeCommand("process.stdin.on('data', chunk => process.stdout.write(chunk))", input),
    );

    expect(result).toEqual({ status: "success", stdout: input });
  });

  it("terminates commands that exceed the output budget", async () => {
    await expect(
      runBoundedProcess({
        ...nodeCommand("process.stdout.write('x'.repeat(2048))"),
        maxOutputBytes: 64,
      }),
    ).resolves.toEqual({ status: "failed", reason: "output-limit" });
  });

  it("terminates commands that exceed their deadline", async () => {
    await expect(
      runBoundedProcess({
        ...nodeCommand("setInterval(() => undefined, 1000)"),
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ status: "failed", reason: "timeout" });
  });

  it("force-settles after a command ignores graceful termination", async () => {
    const startedAt = Date.now();
    await expect(
      runBoundedProcess({
        ...nodeCommand(
          "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1000)",
        ),
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ status: "failed", reason: "timeout" });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("checks the final guard before attempting to spawn", async () => {
    await expect(
      runBoundedProcess({
        ...nodeCommand("process.exit(0)"),
        beforeSpawn: async () => false,
        executable: "/screenfling/should-not-exist",
      }),
    ).resolves.toEqual({ status: "failed", reason: "guard-rejected" });
  });

  it("maps synchronous spawn failures into the bounded result", async () => {
    await expect(
      runBoundedProcess({
        ...nodeCommand("process.exit(0)"),
        executable: "invalid\u0000executable",
      }),
    ).resolves.toEqual({ status: "failed", reason: "spawn" });
  });
});

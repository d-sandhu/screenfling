import { spawn } from "node:child_process";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

const FORCE_KILL_GRACE_MS = 100;
const SETTLEMENT_GRACE_MS = 100;

export type ProcessFailureReason =
  "exit" | "guard-rejected" | "input" | "output-limit" | "spawn" | "timeout";

export type BoundedProcessResult =
  | { readonly status: "success"; readonly stdout: Uint8Array }
  | { readonly status: "failed"; readonly reason: ProcessFailureReason };

export type BoundedProcessRequest = {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly input: Uint8Array | null;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
  readonly beforeSpawn?: () => Promise<boolean>;
};

export type BoundedProcessRunner = (
  request: BoundedProcessRequest,
) => Promise<BoundedProcessResult>;

export async function runBoundedProcess(
  request: BoundedProcessRequest,
): Promise<BoundedProcessResult> {
  if (request.beforeSpawn !== undefined) {
    try {
      if (!(await request.beforeSpawn())) {
        return { status: "failed", reason: "guard-rejected" };
      }
    } catch {
      return { status: "failed", reason: "guard-rejected" };
    }
  }

  return new Promise((resolve) => {
    let failure: ProcessFailureReason | null = null;
    let outputBytes = 0;
    let settled = false;
    let deadline: NodeJS.Timeout | null = null;
    let forceKillDeadline: NodeJS.Timeout | null = null;
    let settlementDeadline: NodeJS.Timeout | null = null;
    const stdout: Buffer[] = [];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(request.executable, request.arguments, {
        env: request.environment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolve({ status: "failed", reason: "spawn" });
      return;
    }

    const finish = (result: BoundedProcessResult) => {
      if (settled) return;
      settled = true;
      if (deadline !== null) clearTimeout(deadline);
      if (forceKillDeadline !== null) clearTimeout(forceKillDeadline);
      if (settlementDeadline !== null) clearTimeout(settlementDeadline);
      resolve(result);
    };
    const stopFor = (reason: ProcessFailureReason) => {
      if (failure !== null) return;
      failure = reason;
      child.kill();
      forceKillDeadline = setTimeout(() => {
        child.kill("SIGKILL");
        settlementDeadline = setTimeout(() => {
          finish({ status: "failed", reason });
        }, SETTLEMENT_GRACE_MS);
      }, FORCE_KILL_GRACE_MS);
    };
    const countOutput = (chunk: Buffer, retain: boolean) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > request.maxOutputBytes) {
        stopFor("output-limit");
        return;
      }
      if (retain) stdout.push(chunk);
    };

    deadline = setTimeout(() => stopFor("timeout"), request.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => countOutput(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => countOutput(chunk, false));
    child.on("error", () => finish({ status: "failed", reason: "spawn" }));
    child.on("close", (code) => {
      if (failure !== null) {
        finish({ status: "failed", reason: failure });
        return;
      }
      if (code !== 0) {
        finish({ status: "failed", reason: "exit" });
        return;
      }
      finish({ status: "success", stdout: new Uint8Array(Buffer.concat(stdout)) });
    });
    child.stdin.on("error", () => stopFor("input"));
    child.stdin.end(request.input === null ? undefined : Buffer.from(request.input));
  });
}

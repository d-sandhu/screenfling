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

type ProcessLauncher = (request: BoundedProcessRequest) => ChildProcessWithoutNullStreams;

function launchProcess(request: BoundedProcessRequest): ChildProcessWithoutNullStreams {
  return spawn(request.executable, request.arguments, {
    env: request.environment,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

export async function runBoundedProcess(
  request: BoundedProcessRequest,
  launch: ProcessLauncher = launchProcess,
): Promise<BoundedProcessResult> {
  const expiresAt = performance.now() + request.timeoutMs;
  if (request.beforeSpawn !== undefined) {
    let guardDeadline: NodeJS.Timeout | undefined;
    try {
      const allowed = await Promise.race([
        Promise.resolve().then(request.beforeSpawn),
        new Promise<boolean>((resolve) => {
          guardDeadline = setTimeout(() => resolve(false), request.timeoutMs);
        }),
      ]);
      // Expired guards prove no dispatch. A late resolution must never launch.
      if (!allowed || performance.now() >= expiresAt) {
        return { status: "failed", reason: "guard-rejected" };
      }
    } catch {
      return { status: "failed", reason: "guard-rejected" };
    } finally {
      clearTimeout(guardDeadline);
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
      child = launch(request);
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
      // Force-settlement must release our pipes even if no close event arrives.
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(result);
    };
    const stopFor = (reason: ProcessFailureReason) => {
      if (settled || failure !== null) return;
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
      if (settled || failure !== null) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > request.maxOutputBytes) {
        stopFor("output-limit");
        return;
      }
      if (retain) stdout.push(chunk);
    };

    deadline = setTimeout(() => stopFor("timeout"), Math.max(0, expiresAt - performance.now()));
    child.stdout.on("data", (chunk: Buffer) => countOutput(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => countOutput(chunk, false));
    child.on("error", () => {
      if (child.pid === undefined) finish({ status: "failed", reason: "spawn" });
      // A kill/control error after launch cannot prove that no input was sent.
      else stopFor("exit");
    });
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

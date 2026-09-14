import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { chmod } from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { Transform } from "node:stream";

import { runBoundedProcess } from "./bounded-process";
import { areMacSelectorAclsTrusted } from "./macos-selector-acl";

import type { TransformCallback } from "node:stream";
import type {
  BoundedProcessRequest,
  BoundedProcessResult,
  BoundedProcessRunner,
} from "./bounded-process";

const MAX_SOCKET_PATH_BYTES = 103;
const MAX_RELAY_BYTES = 1024 * 1024;
const NO_PATH_CONTROLS = /^[^\p{Cc}\p{Zl}\p{Zp}]+$/u;

type AclCheck = (paths: readonly string[]) => Promise<boolean>;

// A one-command local transport, not a persistent service or a new destination.
// The already validated socket parent supplies the private namespace. No TCP,
// payload file, terminal read-back, protocol parsing, reconnect, or retry exists.
export async function runPinnedWezTermProcess(
  request: BoundedProcessRequest,
  run: BoundedProcessRunner = runBoundedProcess,
  checkAcl: AclCheck = areMacSelectorAclsTrusted,
): Promise<BoundedProcessResult> {
  const socketPath = request.environment.WEZTERM_UNIX_SOCKET;
  const guard = request.beforeSpawn;
  if (
    socketPath === undefined ||
    guard === undefined ||
    !isAbsolute(socketPath) ||
    !NO_PATH_CONTROLS.test(socketPath) ||
    Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES
  ) {
    return { status: "failed", reason: "guard-rejected" };
  }
  const localPath = join(dirname(socketPath), `.sf-${randomBytes(6).toString("hex")}`);
  if (Buffer.byteLength(localPath) > MAX_SOCKET_PATH_BYTES) {
    return { status: "failed", reason: "guard-rejected" };
  }

  const lifetime = new AbortController();
  // EOF in one direction must not discard a response still arriving in the other.
  const upstream = new Socket({ allowHalfOpen: true });
  upstream.pause();
  let downstream: Socket | null = null;
  let authorized = false;
  let transportFailed = false;
  let relayedBytes = 0;
  const pipes: Transform[] = [];
  const server = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (client) => {
    if (lifetime.signal.aborted || !authorized || downstream !== null) {
      client.destroy();
      stopTransport();
      return;
    }
    downstream = client;
    // Stop accepting immediately. The accepted connection remains usable.
    server.close();
    client.on("error", stopTransport);
    client.on("close", close);
    forward(client, upstream);
    forward(upstream, client);
  });

  function close(): void {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    upstream.destroy();
    downstream?.destroy();
    for (const pipe of pipes) pipe.destroy();
    // A callback also handles the not-yet-listening/already-closed cases.
    server.close(() => undefined);
  }

  function stopTransport(): void {
    transportFailed = true;
    close();
  }

  function forward(source: Socket, target: Socket): void {
    const pipe = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
        relayedBytes += chunk.byteLength;
        if (relayedBytes > MAX_RELAY_BYTES || lifetime.signal.aborted) {
          done(new Error("WezTerm local transport stopped."));
          return;
        }
        done(null, chunk);
      },
    });
    pipes.push(pipe);
    pipe.on("error", stopTransport);
    source.pipe(pipe).pipe(target);
  }

  upstream.on("error", stopTransport);
  upstream.on("close", () => {
    if (downstream === null) close();
  });
  server.on("error", stopTransport);

  try {
    const result = await run({
      ...request,
      environment: { ...request.environment, WEZTERM_UNIX_SOCKET: localPath },
      beforeSpawn: async () => {
        if (!(await guard()) || lifetime.signal.aborted) return false;
        const connected = once(upstream, "connect", { signal: lifetime.signal });
        upstream.connect(socketPath);
        await connected;
        if (lifetime.signal.aborted) return false;
        const listening = once(server, "listening", { signal: lifetime.signal });
        server.listen(localPath);
        await listening;
        if (lifetime.signal.aborted) return false;
        await chmod(localPath, 0o600);
        if (lifetime.signal.aborted) return false;
        if (!(await checkAcl([localPath])) || lifetime.signal.aborted) return false;
        // Revalidate AFTER connecting and before allowing any protocol bytes.
        // Replacing the original pathname later cannot retarget this connection.
        if (!(await guard()) || lifetime.signal.aborted) return false;
        authorized = true;
        return true;
      },
    });
    return transportFailed && result.status === "success"
      ? { status: "failed", reason: "exit" }
      : result;
  } finally {
    // Also cancels setup when the runner's shared guard/process deadline expires.
    // Every awaited setup step checks this lifetime before opening the next resource.
    close();
  }
}

export const runWezTermProcess: BoundedProcessRunner = (request) => {
  const sideEffect =
    request.arguments.includes("send-text") || request.arguments.includes("activate-pane");
  return sideEffect ? runPinnedWezTermProcess(request) : runBoundedProcess(request);
};

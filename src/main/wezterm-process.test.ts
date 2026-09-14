import { once } from "node:events";
import { chmod, lstat, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBoundedProcess } from "./bounded-process";
import { runPinnedWezTermProcess } from "./wezterm-process";

import type { Socket } from "node:net";
import type { BoundedProcessRequest, BoundedProcessRunner } from "./bounded-process";

const INPUT = new TextEncoder().encode('synthetic "quote" \\ café');
const CLIENT = `
  const { connect } = require('node:net');
  const socket = connect(process.env.WEZTERM_UNIX_SOCKET);
  socket.on('error', () => process.exit(2));
  socket.on('data', chunk => process.stdout.write(chunk));
  process.stdin.pipe(socket);
`;

async function openEndpoint(path: string) {
  const received: number[] = [];
  const peers = new Set<Socket>();
  let connections = 0;
  const server = createServer((peer) => {
    connections += 1;
    peers.add(peer);
    peer.on("error", () => undefined);
    peer.on("close", () => peers.delete(peer));
    peer.on("data", (chunk: Buffer) => {
      received.push(...chunk);
      peer.write(chunk);
    });
  });
  const listening = once(server, "listening");
  server.listen(path);
  await listening;
  await chmod(path, 0o600);
  return {
    received,
    connections: () => connections,
    disconnect: () => {
      for (const peer of peers) peer.destroy();
    },
    close: () => {
      for (const peer of peers) peer.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

type Endpoint = Awaited<ReturnType<typeof openEndpoint>>;
type Fixture = {
  readonly directory: string;
  readonly first: Endpoint;
  readonly request: BoundedProcessRequest;
  readonly replace: () => Promise<Endpoint>;
};

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sf-pin-"));
  const path = join(directory, "mux");
  const endpoints: Endpoint[] = [];
  try {
    const first = await openEndpoint(path);
    endpoints.push(first);
    const original = await lstat(path, { bigint: true });
    await run({
      directory,
      first,
      request: {
        executable: process.execPath,
        arguments: ["-e", CLIENT],
        environment: { ...process.env, WEZTERM_UNIX_SOCKET: path },
        input: INPUT,
        maxOutputBytes: 1024,
        timeoutMs: 3_000,
        beforeSpawn: async () => {
          const current = await lstat(path, { bigint: true });
          return current.dev === original.dev && current.ino === original.ino;
        },
      },
      replace: async () => {
        await rename(path, join(directory, "old"));
        const replacement = await openEndpoint(path);
        endpoints.push(replacement);
        return replacement;
      },
    });
  } finally {
    for (const endpoint of endpoints) await endpoint.close();
    await rm(directory, { recursive: true, force: true });
  }
}

// These are real local sockets and subprocesses, but synthetic receivers, not
// WezTerm or agent acceptance. macOS runs use the real bundled ACL inspector.
describe.skipIf(process.platform !== "darwin")("pinned WezTerm command transport", () => {
  it("negative control: a pathname-only guard can dispatch to a replacement", async () => {
    await withFixture(async ({ first, replace, request }) => {
      const replacements: Endpoint[] = [];
      const originalGuard = request.beforeSpawn;
      const result = await runBoundedProcess({
        ...request,
        beforeSpawn: async () => {
          if (originalGuard === undefined || !(await originalGuard())) return false;
          replacements.push(await replace());
          return true;
        },
      });
      expect(result).toEqual({ status: "success", stdout: INPUT });
      expect(first.received).toEqual([]);
      expect(replacements).toHaveLength(1);
      expect(replacements[0]?.received).toEqual([...INPUT]);
    });
  });

  it("never reaches a replacement across 20 real-socket interleavings", async () => {
    for (let trial = 0; trial < 20; trial += 1) {
      await withFixture(async ({ directory, first, replace, request }) => {
        const replacements: Endpoint[] = [];
        const interleave: BoundedProcessRunner = async (command) => {
          const { beforeSpawn, ...checked } = command;
          if (beforeSpawn === undefined || !(await beforeSpawn())) {
            return { status: "failed", reason: "guard-rejected" };
          }
          replacements.push(await replace());
          return runBoundedProcess(checked);
        };
        const result = await runPinnedWezTermProcess(request, interleave);
        expect(result).toEqual({ status: "success", stdout: INPUT });
        expect(first.received).toEqual([...INPUT]);
        expect(replacements).toHaveLength(1);
        expect(replacements[0]?.received).toEqual([]);
        expect(replacements[0]?.connections()).toBe(0);
        expect(await readdir(directory)).toEqual(["mux", "old"]);
      });
    }
  }, 30_000);

  it("refuses a replacement detected after connecting but before dispatch", async () => {
    await withFixture(async ({ directory, first, replace, request }) => {
      let checks = 0;
      const replacements: Endpoint[] = [];
      const result = await runPinnedWezTermProcess({
        ...request,
        beforeSpawn: async () => {
          checks += 1;
          if (checks === 1) return true;
          replacements.push(await replace());
          return false;
        },
      });
      expect(result).toEqual({ status: "failed", reason: "guard-rejected" });
      expect(first.received).toEqual([]);
      expect(replacements).toHaveLength(1);
      expect(replacements[0]?.received).toEqual([]);
      expect(await readdir(directory)).toEqual(["mux", "old"]);
    });
  });

  it("refuses an ACL inspection failure without transmitting bytes", async () => {
    await withFixture(async ({ directory, first, request }) => {
      const result = await runPinnedWezTermProcess(request, runBoundedProcess, async () => false);
      expect(result).toEqual({ status: "failed", reason: "guard-rejected" });
      expect(first.received).toEqual([]);
      expect(await readdir(directory)).toEqual(["mux"]);
    });
  });

  it("removes the relay after a proven executable launch failure", async () => {
    await withFixture(async ({ directory, first, request }) => {
      const result = await runPinnedWezTermProcess({ ...request, executable: "invalid\0command" });
      expect(result).toEqual({ status: "failed", reason: "spawn" });
      expect(first.received).toEqual([]);
      expect(await readdir(directory)).toEqual(["mux"]);
    });
  });

  it("times out an unused lease and removes its private socket", async () => {
    await withFixture(async ({ directory, first, request }) => {
      const result = await runPinnedWezTermProcess({
        ...request,
        arguments: ["-e", "setInterval(() => undefined, 1000)"],
        timeoutMs: 500,
      });
      expect(result).toEqual({ status: "failed", reason: "timeout" });
      expect(first.received).toEqual([]);
      expect(await readdir(directory)).toEqual(["mux"]);
    });
  });

  it("cannot open a relay after a timed-out initial guard eventually approves", async () => {
    await withFixture(async ({ directory, first, request }) => {
      let approve: (value: boolean) => void = () => undefined;
      const deferred = new Promise<boolean>((resolve) => {
        approve = resolve;
      });
      const result = await runPinnedWezTermProcess({
        ...request,
        beforeSpawn: () => deferred,
        timeoutMs: 20,
      });
      expect(result).toEqual({ status: "failed", reason: "guard-rejected" });
      approve(true);
      await new Promise((resolve) => setImmediate(resolve));
      expect(first.connections()).toBe(0);
      expect(first.received).toEqual([]);
      expect(await readdir(directory)).toEqual(["mux"]);
    });
  });

  it("rejects overlong socket paths before Node can truncate their identity", async () => {
    await withFixture(async ({ directory, first, request }) => {
      const result = await runPinnedWezTermProcess({
        ...request,
        environment: { WEZTERM_UNIX_SOCKET: "/" + "s".repeat(103) },
      });
      expect(result).toEqual({ status: "failed", reason: "guard-rejected" });
      expect(first.connections()).toBe(0);
      expect(await readdir(directory)).toEqual(["mux"]);
    });
  });

  it("does not reconnect when the original upstream dies after validation", async () => {
    await withFixture(async ({ directory, first, replace, request }) => {
      const replacements: Endpoint[] = [];
      const interleave: BoundedProcessRunner = async (command) => {
        const { beforeSpawn, ...checked } = command;
        if (beforeSpawn === undefined || !(await beforeSpawn())) {
          return { status: "failed", reason: "guard-rejected" };
        }
        replacements.push(await replace());
        first.disconnect();
        return runBoundedProcess(checked);
      };
      await runPinnedWezTermProcess(request, interleave);
      expect(first.received).toEqual([]);
      expect(replacements).toHaveLength(1);
      expect(replacements[0]?.received).toEqual([]);
      expect(replacements[0]?.connections()).toBe(0);
      expect(await readdir(directory)).toEqual(["mux", "old"]);
    });
  });

  it("bounds traffic in the relay even when the client does not print stdout", async () => {
    await withFixture(async ({ directory, first, request }) => {
      const input = new Uint8Array(2 * 1024 * 1024).fill(120);
      const result = await runPinnedWezTermProcess({
        ...request,
        input,
        arguments: ["-e", CLIENT.replace("process.stdout.write(chunk)", "undefined")],
      });
      expect(result.status).toBe("failed");
      expect(first.received.length).toBeLessThan(input.length);
      expect(first.received.length).toBeLessThanOrEqual(1024 * 1024);
      expect(await readdir(directory)).toEqual(["mux"]);
    });
  });

  it("cleans up a timed-out ACL read and ignores its eventual approval", async () => {
    await withFixture(async ({ directory, first, request }) => {
      let approve: (value: boolean) => void = () => undefined;
      const deferred = new Promise<boolean>((resolve) => {
        approve = resolve;
      });
      const result = await runPinnedWezTermProcess(
        { ...request, timeoutMs: 500 },
        runBoundedProcess,
        () => deferred,
      );
      expect(result).toEqual({ status: "failed", reason: "guard-rejected" });
      expect(first.received).toEqual([]);
      expect(await readdir(directory)).toEqual(["mux"]);
      approve(true);
      await new Promise((resolve) => setImmediate(resolve));
      expect(first.received).toEqual([]);
      expect(await readdir(directory)).toEqual(["mux"]);
    });
  });
});

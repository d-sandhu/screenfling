import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runBoundedProcess } from "./bounded-process";
import {
  createWezTermAdapter,
  readWezTermGeneration,
  SUPPORTED_WEZTERM_VERSION,
  WezTermAdapter,
} from "./wezterm-adapter";
import { runPinnedWezTermProcess, runWezTermProcess } from "./wezterm-process";

import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import type { BoundedProcessRequest } from "./bounded-process";

const EXECUTABLE = process.env.SCREENFLING_TEST_WEZTERM_EXECUTABLE;
const SERVER = process.env.SCREENFLING_TEST_WEZTERM_MUX_SERVER;
const RECEIVER = `
  const fs = require('node:fs');
  const output = process.argv[1];
  process.stdin.setRawMode(true);
  process.stdin.on('data', chunk => fs.appendFileSync(output, chunk));
  process.stdin.on('end', () => process.exit(0));
  fs.writeFileSync(output, Buffer.alloc(0), { mode: 0o600 });
  process.stdin.resume();
`;
const NOTE = 'synthetic "quote" \\ café Enter';
const BINDING = Uint8Array.from([22]);
const PAYLOAD = Buffer.concat([BINDING, Buffer.from(NOTE)]);
const paneList = z.array(z.object({ pane_id: z.number().int().nonnegative().safe() }));

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Synthetic WezTerm fixture did not become ready.");
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  const force = setTimeout(() => child.kill("SIGKILL"), 1_000);
  child.kill();
  try {
    await closed;
  } finally {
    clearTimeout(force);
  }
}

// The explicit CI fixture binary is checksum-pinned before this file runs.
// This uses a headless mux and synthetic raw-byte consumers: no GUI, Screen
// Recording, clipboard, focus, image attachment, or real agent is exercised.
describe.skipIf(process.platform !== "darwin" || EXECUTABLE === undefined || SERVER === undefined)(
  "pinned native WezTerm CLI transport",
  () => {
    it("stages 100 payloads and cannot reach a replaced mux socket", async () => {
      if (EXECUTABLE === undefined || SERVER === undefined) {
        throw new Error("Missing fixture binary.");
      }
      const directory = await mkdtemp(join(homedir(), "sf-wezterm-"));
      const socketPath = join(directory, "mux");
      const configFile = join(directory, "config.lua");
      const outputs = [join(directory, "one"), join(directory, "two")] as const;
      const environment = {
        HOME: directory,
        XDG_CONFIG_HOME: directory,
        XDG_DATA_HOME: directory,
        XDG_CACHE_HOME: directory,
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        WEZTERM_UNIX_SOCKET: socketPath,
      };
      const peers = new Set<Socket>();
      let replacementConnections = 0;
      let replacementBytes = 0;
      const replacement = createServer((peer) => {
        replacementConnections += 1;
        peers.add(peer);
        peer.on("error", () => undefined);
        peer.on("data", (chunk: Buffer) => {
          replacementBytes += chunk.byteLength;
        });
        peer.on("close", () => peers.delete(peer));
      });
      let server: ChildProcess | null = null;
      try {
        await writeFile(
          configFile,
          `return { automatically_reload_config = false, unix_domains = {{ name = "synthetic", socket_path = ${JSON.stringify(socketPath)} }} }`,
          { mode: 0o600 },
        );
        server = spawn(
          SERVER,
          ["--config-file", configFile, "--", process.execPath, "-e", RECEIVER, outputs[0]],
          { cwd: directory, env: environment, stdio: "ignore" },
        );
        server.on("error", () => undefined);
        const cli = async (arguments_: readonly string[]) => {
          const result = await runBoundedProcess({
            executable: EXECUTABLE,
            arguments: ["--config-file", configFile, "cli", "--no-auto-start", ...arguments_],
            environment,
            input: null,
            maxOutputBytes: 64 * 1024,
            timeoutMs: 3_000,
          });
          if (result.status !== "success") throw new Error("Native fixture CLI request failed.");
          return new TextDecoder().decode(result.stdout);
        };
        await waitUntil(async () => (await readFile(outputs[0]).catch(() => null)) !== null);
        const first = paneList.parse(JSON.parse(await cli(["list", "--format", "json"])))[0];
        if (first === undefined) throw new Error("Missing synthetic pane.");
        const second = Number(
          (
            await cli([
              "spawn",
              "--pane-id",
              String(first.pane_id),
              "--cwd",
              directory,
              "--",
              process.execPath,
              "-e",
              RECEIVER,
              outputs[1],
            ])
          ).trim(),
        );
        expect(Number.isSafeInteger(second)).toBe(true);
        expect(second).not.toBe(first.pane_id);
        await waitUntil(async () => (await readFile(outputs[1]).catch(() => null)) !== null);
        const config = { executable: EXECUTABLE, configFile, socketPath, imagePasteInput: BINDING };
        const adapter = createWezTermAdapter(config);
        const destinations = await adapter.discover();
        expect(destinations).toHaveLength(2);
        const targets = [first.pane_id, second].map((id) => {
          const target = destinations.find(
            (destination) => destination.surface.locator === String(id),
          );
          if (target === undefined) {
            throw new Error("Production adapter did not discover the exact pane.");
          }
          return target;
        });
        const payloads: [Buffer[], Buffer[]] = [[], []];
        for (let trial = 0; trial < 100; trial += 1) {
          const index = trial % 2 === 0 ? 0 : 1;
          const target = targets[index];
          if (target === undefined) throw new Error("Missing alternating target.");
          const note = `${NOTE} trial-${trial}`;
          payloads[index].push(Buffer.concat([BINDING, Buffer.from(note)]));
          expect(await adapter.stageIfCurrent({ destination: target, note })).toEqual({
            status: "dispatched-unverified",
          });
        }
        // Unique payloads prove per-trial routing and order, not just equal totals.
        const expected = [Buffer.concat(payloads[0]), Buffer.concat(payloads[1])] as const;
        await waitUntil(
          async () =>
            (await readFile(outputs[0])).length === expected[0].length &&
            (await readFile(outputs[1])).length === expected[1].length,
        );
        expect(await readFile(outputs[0])).toEqual(expected[0]);
        expect(await readFile(outputs[1])).toEqual(expected[1]);

        // Interleave at the last possible boundary: transport is authorized and
        // connected, but the real WezTerm send-text process has not started.
        const racedAdapter = new WezTermAdapter(config, {
          now: () => new Date(),
          readGeneration: readWezTermGeneration,
          runProcess: async (request: BoundedProcessRequest) => {
            if (!request.arguments.includes("send-text")) return runWezTermProcess(request);
            return runPinnedWezTermProcess(request, async (command) => {
              const { beforeSpawn, ...checked } = command;
              if (beforeSpawn === undefined || !(await beforeSpawn())) {
                return { status: "failed", reason: "guard-rejected" };
              }
              await rename(socketPath, join(directory, "old"));
              const listening = once(replacement, "listening");
              replacement.listen(socketPath);
              await listening;
              return runBoundedProcess(checked);
            });
          },
        });
        const target = (await racedAdapter.discover()).find(
          (destination) => destination.surface.locator === String(first.pane_id),
        );
        if (target === undefined) throw new Error("Missing interleaving target.");
        expect(await racedAdapter.stageIfCurrent({ destination: target, note: NOTE })).toEqual({
          status: "dispatched-unverified",
        });
        await waitUntil(
          async () => (await readFile(outputs[0])).length === expected[0].length + PAYLOAD.length,
        );
        expect(await readFile(outputs[0])).toEqual(Buffer.concat([expected[0], PAYLOAD]));
        expect(await readFile(outputs[1])).toEqual(expected[1]);
        expect(replacementConnections).toBe(0);
        expect(replacementBytes).toBe(0);
        expect((await readdir(directory)).some((entry) => entry.startsWith(".sf-"))).toBe(false);
        expect(SUPPORTED_WEZTERM_VERSION).toBe("20240203-110809-5046fc22");
      } finally {
        if (server !== null) await stop(server);
        for (const peer of peers) peer.destroy();
        await new Promise<void>((resolve) => replacement.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      }
    }, 120_000);
  },
);

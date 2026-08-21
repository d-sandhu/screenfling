import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SUPPORTED_WEZTERM_VERSION,
  WezTermAdapter,
  WEZTERM_ADAPTER_ID,
  readWezTermGeneration,
} from "./wezterm-adapter";

import type {
  BoundedProcessRequest,
  BoundedProcessResult,
  BoundedProcessRunner,
} from "./bounded-process";
import type { WezTermAdapterConfig, WezTermAdapterDependencies } from "./wezterm-adapter";
import type { Destination } from "../shared/domain";

const encoder = new TextEncoder();
const GENERATION_A = "a".repeat(64);
const GENERATION_B = "b".repeat(64);
const VERSION_TEXT = `wezterm ${SUPPORTED_WEZTERM_VERSION}\n`;
const IMAGE_PASTE_INPUT = Uint8Array.from([27, 91, 49, 126]);
const FIXTURE_ROOT = process.platform === "win32" ? "C:\\screenfling" : "/screenfling";
const EXECUTABLE_PATH = join(FIXTURE_ROOT, "bin", "wezterm");
const CONFIG_PATH = join(FIXTURE_ROOT, "config", "wezterm.lua");
const SOCKET_PATH = join(FIXTURE_ROOT, "run", "wezterm.sock");

type PaneFixture = {
  readonly window_id: number;
  readonly tab_id: number;
  readonly pane_id: number;
  readonly workspace: string;
  readonly size: { readonly rows: number; readonly cols: number };
  readonly title: string;
  readonly cwd: string | null;
  readonly extra?: string;
};

function paneFixture(paneId: number, cwd: string | null = "file:///screenfling"): PaneFixture {
  return {
    window_id: 1,
    tab_id: 2,
    pane_id: paneId,
    workspace: "default",
    size: { rows: 40, cols: 120 },
    title: "Claude Code",
    cwd,
    extra: "additive fields are allowed",
  };
}

function success(text: string): BoundedProcessResult {
  return { status: "success", stdout: encoder.encode(text) };
}

class FakeWezTermRunner {
  readonly requests: BoundedProcessRequest[] = [];
  readonly spawnedRevealRequests: BoundedProcessRequest[] = [];
  readonly spawnedRequests: BoundedProcessRequest[] = [];
  readonly spawnedSendRequests: BoundedProcessRequest[] = [];
  versionResult: BoundedProcessResult = success(VERSION_TEXT);
  listResult: BoundedProcessResult = success(JSON.stringify([paneFixture(7)]));
  revealResult: BoundedProcessResult = success("");
  sendResult: BoundedProcessResult = success("");
  beforeProcessGuard: ((request: BoundedProcessRequest) => void) | null = null;
  beforeRevealGuard: (() => void) | null = null;
  beforeSendGuard: (() => void) | null = null;

  readonly run: BoundedProcessRunner = async (request) => {
    this.requests.push(request);
    if (request.arguments.includes("activate-pane")) this.beforeRevealGuard?.();
    if (request.arguments.includes("send-text")) this.beforeSendGuard?.();
    this.beforeProcessGuard?.(request);
    if (request.beforeSpawn !== undefined && !(await request.beforeSpawn())) {
      return { status: "failed", reason: "guard-rejected" };
    }
    this.spawnedRequests.push(request);
    if (request.arguments.length === 1 && request.arguments[0] === "--version") {
      return this.versionResult;
    }
    if (request.arguments.includes("list")) return this.listResult;
    if (request.arguments.includes("activate-pane")) {
      this.spawnedRevealRequests.push(request);
      return this.revealResult;
    }
    if (!request.arguments.includes("send-text")) {
      return { status: "failed", reason: "spawn" };
    }

    this.spawnedSendRequests.push(request);
    return this.sendResult;
  };
}

function adapterConfig(): WezTermAdapterConfig {
  return {
    executable: EXECUTABLE_PATH,
    configFile: CONFIG_PATH,
    socketPath: SOCKET_PATH,
    imagePasteInput: IMAGE_PASTE_INPUT,
  };
}

function adapterDependencies(
  runner: FakeWezTermRunner,
  readGeneration: () => Promise<string>,
): WezTermAdapterDependencies {
  return {
    now: () => new Date("2026-08-20T16:00:00.000Z"),
    readGeneration: async () => readGeneration(),
    runProcess: runner.run,
  };
}

function createAdapter(
  runner: FakeWezTermRunner,
  readGeneration: () => Promise<string> = async () => GENERATION_A,
): WezTermAdapter {
  return new WezTermAdapter(adapterConfig(), adapterDependencies(runner, readGeneration));
}

async function firstDestination(adapter: WezTermAdapter): Promise<Destination> {
  const destinations = await adapter.discover();
  const destination = destinations[0];
  if (destination === undefined) throw new Error("Expected a discovered destination.");
  return destination;
}

function sendArguments(paneId: number): readonly string[] {
  return [
    "--config-file",
    CONFIG_PATH,
    "cli",
    "--no-auto-start",
    "send-text",
    "--no-paste",
    "--pane-id",
    String(paneId),
  ];
}

function revealArguments(paneId: number): readonly string[] {
  return [
    "--config-file",
    CONFIG_PATH,
    "cli",
    "--no-auto-start",
    "activate-pane",
    "--pane-id",
    String(paneId),
  ];
}

describe("WezTerm destination adapter", () => {
  it("discovers exact generation-bound panes through the pinned instance", async () => {
    const runner = new FakeWezTermRunner();
    runner.listResult = success(JSON.stringify([paneFixture(7), paneFixture(8, null)]));
    const adapter = createAdapter(runner);

    const destinations = await adapter.discover();

    expect(destinations).toHaveLength(2);
    expect(destinations[0]).toMatchObject({
      id: `wezterm:${GENERATION_A}:7`,
      adapter: WEZTERM_ADAPTER_ID,
      endpoint: { scope: "local", instanceId: GENERATION_A },
      surface: { kind: "pane", locator: "7" },
      context: {
        cwd: "file:///screenfling",
        observedAt: "2026-08-20T16:00:00.000Z",
      },
      capabilities: {
        address: "exact",
        imageInput: "clipboard-key",
        textInput: "paste",
        readBack: "none",
        verification: ["target-live"],
        actions: ["copy", "stage", "reveal"],
      },
    });
    expect(destinations[1]?.context).toEqual({
      observedAt: "2026-08-20T16:00:00.000Z",
    });
    expect(runner.requests[0]?.arguments).toEqual(["--version"]);
    expect(runner.requests[1]?.arguments).toEqual([
      "--config-file",
      CONFIG_PATH,
      "cli",
      "--no-auto-start",
      "list",
      "--format",
      "json",
    ]);
    expect(runner.requests[1]?.environment.WEZTERM_UNIX_SOCKET).toBe(SOCKET_PATH);
    expect(runner.requests[1]?.environment.WEZTERM_PANE).toBeUndefined();
  });

  it("rejects unsupported versions before pane discovery", async () => {
    const runner = new FakeWezTermRunner();
    runner.versionResult = success("wezterm 20990101-000000-unknown\n");
    const adapter = createAdapter(runner);

    await expect(adapter.preflight()).resolves.toEqual({
      status: "unavailable",
      reason: "unsupported-version",
    });
    await expect(adapter.discover()).resolves.toEqual([]);
    expect(runner.requests.some((request) => request.arguments.includes("list"))).toBe(false);
  });

  it("does not spawn an untrusted executable during preflight", async () => {
    const runner = new FakeWezTermRunner();
    const adapter = createAdapter(runner, async () => {
      throw new Error("untrusted selector fixture");
    });

    await expect(adapter.preflight()).resolves.toEqual({
      status: "unavailable",
      reason: "instance",
    });
    expect(runner.requests).toEqual([]);
  });

  it("rejects a selector replacement across the version probe", async () => {
    const runner = new FakeWezTermRunner();
    let generationReads = 0;
    const adapter = createAdapter(runner, async () => {
      generationReads += 1;
      return generationReads === 1 ? GENERATION_A : GENERATION_B;
    });

    await expect(adapter.preflight()).resolves.toEqual({
      status: "unavailable",
      reason: "instance",
    });
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]?.arguments).toEqual(["--version"]);
  });

  it("prevents the version probe when selectors change at the spawn boundary", async () => {
    const runner = new FakeWezTermRunner();
    let generation = GENERATION_A;
    runner.beforeProcessGuard = () => {
      generation = GENERATION_B;
      runner.beforeProcessGuard = null;
    };
    const adapter = createAdapter(runner, async () => generation);

    await expect(adapter.preflight()).resolves.toEqual({
      status: "unavailable",
      reason: "instance",
    });
    expect(runner.spawnedRequests).toEqual([]);
  });

  it("prevents pane discovery when selectors change at the list spawn boundary", async () => {
    const runner = new FakeWezTermRunner();
    let generation = GENERATION_A;
    runner.beforeProcessGuard = (request) => {
      if (request.arguments.includes("list")) generation = GENERATION_B;
    };
    const adapter = createAdapter(runner, async () => generation);

    await expect(adapter.discover()).resolves.toEqual([]);
    expect(runner.spawnedRequests.some((request) => request.arguments.includes("list"))).toBe(
      false,
    );
  });

  it("fails closed for malformed, duplicate, unsafe, or oversized pane lists", async () => {
    const invalidLists = [
      "not json",
      JSON.stringify([paneFixture(7), paneFixture(7)]),
      JSON.stringify([{ ...paneFixture(7), title: "unsafe\nlabel" }]),
      JSON.stringify([{ ...paneFixture(7), size: { rows: 0, cols: 120 } }]),
      JSON.stringify(Array.from({ length: 4_097 }, (_, index) => paneFixture(index))),
    ];

    for (const invalidList of invalidLists) {
      const runner = new FakeWezTermRunner();
      runner.listResult = success(invalidList);
      await expect(createAdapter(runner).discover()).resolves.toEqual([]);
    }
  });

  it("dispatches one literal payload to one explicit pane without Enter", async () => {
    const runner = new FakeWezTermRunner();
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);
    const note = "quotes ' \" · Unicode ☃ · $PATH · <C-v>";

    await expect(adapter.stageIfCurrent({ destination, note })).resolves.toEqual({
      status: "dispatched-unverified",
    });

    expect(runner.spawnedSendRequests).toHaveLength(1);
    const sendRequest = runner.spawnedSendRequests[0];
    expect(sendRequest?.arguments).toEqual(sendArguments(7));
    expect(sendRequest?.input).toEqual(
      Uint8Array.from([...IMAGE_PASTE_INPUT, ...encoder.encode(note)]),
    );
    expect(sendRequest?.input?.includes(10)).toBe(false);
    expect(sendRequest?.input?.includes(13)).toBe(false);
  });

  it("reveals one exact pane without input, fallback selection, or Stage retry", async () => {
    const runner = new FakeWezTermRunner();
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);

    await expect(adapter.revealIfCurrent({ destination })).resolves.toEqual({
      status: "revealed",
    });

    expect(runner.spawnedRevealRequests).toHaveLength(1);
    const request = runner.spawnedRevealRequests[0];
    expect(request?.arguments).toEqual(revealArguments(7));
    expect(request?.input).toBeNull();
    expect(request?.environment.WEZTERM_PANE).toBeUndefined();
    expect(runner.spawnedSendRequests).toEqual([]);
  });

  it("returns stale without activation when the retained Reveal pane disappears", async () => {
    const runner = new FakeWezTermRunner();
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);
    runner.listResult = success("[]");

    await expect(adapter.revealIfCurrent({ destination })).resolves.toEqual({ status: "stale" });
    expect(runner.spawnedRevealRequests).toEqual([]);
  });

  it("returns stale without activation when pane discovery becomes ambiguous", async () => {
    const runner = new FakeWezTermRunner();
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);
    runner.listResult = success(JSON.stringify([paneFixture(7), paneFixture(7)]));

    await expect(adapter.revealIfCurrent({ destination })).resolves.toEqual({ status: "stale" });
    expect(runner.spawnedRevealRequests).toEqual([]);
  });

  it("returns unsupported when the pinned WezTerm version no longer matches", async () => {
    const runner = new FakeWezTermRunner();
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);
    runner.versionResult = success("wezterm 20990101-000000-unknown\n");

    await expect(adapter.revealIfCurrent({ destination })).resolves.toEqual({
      status: "unsupported",
    });
    expect(runner.spawnedRevealRequests).toEqual([]);
  });

  it("guards the final Reveal spawn and never retries a failed activation", async () => {
    const guardedRunner = new FakeWezTermRunner();
    let generation = GENERATION_A;
    const guardedAdapter = createAdapter(guardedRunner, async () => generation);
    const guardedDestination = await firstDestination(guardedAdapter);
    guardedRunner.beforeRevealGuard = () => {
      generation = GENERATION_B;
    };

    await expect(
      guardedAdapter.revealIfCurrent({ destination: guardedDestination }),
    ).resolves.toEqual({ status: "stale" });
    expect(guardedRunner.spawnedRevealRequests).toEqual([]);

    const failedRunner = new FakeWezTermRunner();
    failedRunner.revealResult = { status: "failed", reason: "exit" };
    const failedAdapter = createAdapter(failedRunner);
    const failedDestination = await firstDestination(failedAdapter);
    await expect(
      failedAdapter.revealIfCurrent({ destination: failedDestination }),
    ).resolves.toEqual({ status: "failed" });
    expect(failedRunner.spawnedRevealRequests).toHaveLength(1);
  });

  it("distinguishes an unavailable Reveal executable without retrying", async () => {
    const runner = new FakeWezTermRunner();
    runner.revealResult = { status: "failed", reason: "spawn" };
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);

    await expect(adapter.revealIfCurrent({ destination })).resolves.toEqual({
      status: "unavailable",
    });
    expect(runner.spawnedRevealRequests).toHaveLength(1);
  });

  it("routes 100 alternating operations without crossing similar panes", async () => {
    const runner = new FakeWezTermRunner();
    runner.listResult = success(JSON.stringify([paneFixture(7), paneFixture(8)]));
    const adapter = createAdapter(runner);
    const destinations = await adapter.discover();

    for (let index = 0; index < 100; index += 1) {
      const destination = destinations[index % 2];
      if (destination === undefined) throw new Error("Expected both pane destinations.");
      await expect(adapter.stageIfCurrent({ destination, note: null })).resolves.toEqual({
        status: "dispatched-unverified",
      });
    }

    const routedPaneIds = runner.spawnedSendRequests.map((request) => {
      return request.arguments.at(-1);
    });
    expect(routedPaneIds).toEqual(
      Array.from({ length: 100 }, (_, index) => String(index % 2 === 0 ? 7 : 8)),
    );
  });

  it("returns stale without sending when the pane disappears", async () => {
    const runner = new FakeWezTermRunner();
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);
    runner.listResult = success("[]");

    await expect(adapter.stageIfCurrent({ destination, note: null })).resolves.toEqual({
      status: "stale",
    });
    expect(runner.spawnedSendRequests).toEqual([]);
  });

  it("returns stale when the instance generation changes during revalidation", async () => {
    const runner = new FakeWezTermRunner();
    let generation = GENERATION_A;
    const adapter = createAdapter(runner, async () => generation);
    const destination = await firstDestination(adapter);
    generation = GENERATION_B;

    await expect(adapter.stageIfCurrent({ destination, note: null })).resolves.toEqual({
      status: "stale",
    });
    expect(runner.spawnedSendRequests).toEqual([]);
  });

  it("runs a final generation guard before the only send", async () => {
    const runner = new FakeWezTermRunner();
    let generation = GENERATION_A;
    const adapter = createAdapter(runner, async () => generation);
    const destination = await firstDestination(adapter);
    runner.beforeSendGuard = () => {
      generation = GENERATION_B;
    };

    await expect(adapter.stageIfCurrent({ destination, note: null })).resolves.toEqual({
      status: "stale",
    });
    expect(runner.spawnedSendRequests).toEqual([]);
  });

  it("never retries uncertain send failures", async () => {
    const runner = new FakeWezTermRunner();
    runner.sendResult = { status: "failed", reason: "timeout" };
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);

    await expect(adapter.stageIfCurrent({ destination, note: null })).resolves.toEqual({
      status: "dispatched-unverified",
    });
    expect(runner.spawnedSendRequests).toHaveLength(1);
  });

  it("reports a proven pre-dispatch spawn failure as failed", async () => {
    const runner = new FakeWezTermRunner();
    runner.sendResult = { status: "failed", reason: "spawn" };
    const adapter = createAdapter(runner);
    const destination = await firstDestination(adapter);

    await expect(adapter.stageIfCurrent({ destination, note: null })).resolves.toEqual({
      status: "failed",
    });
    expect(runner.spawnedSendRequests).toHaveLength(1);
  });

  it("preserves an unchanged exact route across destination refresh", async () => {
    const runner = new FakeWezTermRunner();
    const adapter = createAdapter(runner);
    const oldDestination = await firstDestination(adapter);
    await adapter.discover();

    await expect(
      adapter.stageIfCurrent({ destination: oldDestination, note: null }),
    ).resolves.toEqual({ status: "dispatched-unverified" });
    expect(runner.spawnedSendRequests).toHaveLength(1);
  });

  it("rejects image-paste bindings that contain implicit submit controls", () => {
    expect(() => {
      new WezTermAdapter(
        { ...adapterConfig(), imagePasteInput: Uint8Array.from([22, 13]) },
        adapterDependencies(new FakeWezTermRunner(), async () => GENERATION_A),
      );
    }).toThrow();
  });

  it("rejects relative executable, config, and socket selectors", () => {
    for (const field of ["executable", "configFile", "socketPath"] as const) {
      expect(() => {
        new WezTermAdapter(
          { ...adapterConfig(), [field]: "relative/path" },
          adapterDependencies(new FakeWezTermRunner(), async () => GENERATION_A),
        );
      }).toThrow();
    }
  });

  it.skipIf(process.platform !== "darwin")(
    "changes the instance generation when the selected socket is replaced",
    async () => {
      const fixtureDirectory = await mkdtemp(join(tmpdir(), "screenfling-wezterm-generation-"));
      const executable = join(fixtureDirectory, "wezterm");
      const configFile = join(fixtureDirectory, "wezterm.lua");
      const socketPath = join(fixtureDirectory, "wezterm.sock");
      const firstServer = createServer();
      const replacementServer = createServer();
      const config = {
        executable,
        configFile,
        socketPath,
        imagePasteInput: IMAGE_PASTE_INPUT,
      };

      try {
        await Promise.all([
          writeFile(executable, "binary fixture"),
          writeFile(configFile, "config fixture"),
        ]);
        await Promise.all([chmod(executable, 0o700), chmod(configFile, 0o600)]);
        await new Promise<void>((resolveListen, rejectListen) => {
          firstServer.once("error", rejectListen);
          firstServer.listen(socketPath, resolveListen);
        });
        await chmod(socketPath, 0o600);
        const firstGeneration = await readWezTermGeneration(config, SUPPORTED_WEZTERM_VERSION);
        await new Promise<void>((resolveClose) => firstServer.close(() => resolveClose()));
        await rm(socketPath, { force: true });
        await new Promise<void>((resolveListen, rejectListen) => {
          replacementServer.once("error", rejectListen);
          replacementServer.listen(socketPath, resolveListen);
        });
        await chmod(socketPath, 0o600);
        const replacementGeneration = await readWezTermGeneration(
          config,
          SUPPORTED_WEZTERM_VERSION,
        );

        expect(firstGeneration).toMatch(/^[a-f\d]{64}$/u);
        expect(replacementGeneration).toMatch(/^[a-f\d]{64}$/u);
        expect(replacementGeneration).not.toBe(firstGeneration);
      } finally {
        if (firstServer.listening) {
          await new Promise<void>((resolveClose) => firstServer.close(() => resolveClose()));
        }
        if (replacementServer.listening) {
          await new Promise<void>((resolveClose) => replacementServer.close(() => resolveClose()));
        }
        await rm(fixtureDirectory, { recursive: true, force: true });
      }
    },
  );
});

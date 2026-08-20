import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { z } from "zod";

import { destinationSchema, noteSchema } from "../shared/domain";
import { runBoundedProcess } from "./bounded-process";

import type { BoundedProcessRequest, BoundedProcessRunner } from "./bounded-process";
import type {
  AdapterStageRequest,
  AdapterStageResult,
  DestinationAdapter,
} from "./destination-adapter";
import type { Destination } from "../shared/domain";

export const WEZTERM_ADAPTER_ID = "wezterm";
export const SUPPORTED_WEZTERM_VERSION = "20240203-110809-5046fc22";

const VERSION_OUTPUT = `wezterm ${SUPPORTED_WEZTERM_VERSION}`;
const MAX_LIST_BYTES = 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024;
const MAX_PANES = 4_096;
const NO_PATH_CONTROLS = /^[^\p{Cc}\p{Zl}\p{Zp}]+$/u;
const NO_LABEL_CONTROLS = /^[^\p{Cc}\p{Zl}\p{Zp}]*$/u;

const pathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .regex(NO_PATH_CONTROLS)
  .refine(isAbsolute, "Adapter paths must be absolute.");
const contextLabelSchema = z.string().max(4_096).regex(NO_LABEL_CONTROLS);
const wezTermAdapterConfigSchema = z
  .strictObject({
    executable: pathSchema,
    configFile: pathSchema,
    socketPath: pathSchema,
    imagePasteInput: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength > 0 && value.byteLength <= 64)
      .refine((value) => !value.includes(10) && !value.includes(13)),
  })
  .readonly();

const paneDimensionSchema = z.number().int().positive().safe().max(1_000_000);
const wezTermPaneSchema = z.object({
  window_id: z.number().int().nonnegative().safe(),
  tab_id: z.number().int().nonnegative().safe(),
  pane_id: z.number().int().nonnegative().safe(),
  workspace: contextLabelSchema.min(1),
  size: z.object({
    rows: paneDimensionSchema,
    cols: paneDimensionSchema,
  }),
  title: contextLabelSchema,
  cwd: contextLabelSchema.nullable(),
});
const wezTermPaneListSchema = z.array(wezTermPaneSchema).max(MAX_PANES).readonly();

export type WezTermAdapterConfig = z.input<typeof wezTermAdapterConfigSchema>;
export type WezTermGenerationReader = (
  config: Readonly<WezTermAdapterConfig>,
  version: string,
) => Promise<string>;

export type WezTermAdapterDependencies = {
  readonly now: () => Date;
  readonly readGeneration: WezTermGenerationReader;
  readonly runProcess: BoundedProcessRunner;
};

export type WezTermPreflightResult =
  | { readonly status: "ready"; readonly generation: string; readonly version: string }
  | {
      readonly status: "unavailable";
      readonly reason: "binary" | "instance" | "unsupported-version";
    };

type WezTermPane = z.infer<typeof wezTermPaneSchema>;
type ReadyPreflight = Extract<WezTermPreflightResult, { readonly status: "ready" }>;

type WezTermSnapshot = ReadyPreflight & {
  readonly panes: readonly WezTermPane[];
};

type WezTermSnapshotResult =
  | { readonly status: "ready"; readonly snapshot: WezTermSnapshot }
  | { readonly status: "generation-changed" }
  | { readonly status: "unavailable" };

type WezTermRoute = {
  readonly destination: Destination;
  readonly generation: string;
  readonly paneId: number;
};

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parsePaneList(bytes: Uint8Array): readonly WezTermPane[] | null {
  const text = decodeUtf8(bytes);
  if (text === null) return null;
  try {
    const parsed = wezTermPaneListSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const paneIds = parsed.data.map((pane) => pane.pane_id);
    if (new Set(paneIds).size !== paneIds.length) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function joinInput(imagePasteInput: Uint8Array, note: string | null): Uint8Array {
  if (note === null || note.length === 0) return Uint8Array.from(imagePasteInput);
  const noteInput = new TextEncoder().encode(note);
  const input = new Uint8Array(imagePasteInput.byteLength + noteInput.byteLength);
  input.set(imagePasteInput);
  input.set(noteInput, imagePasteInput.byteLength);
  return input;
}

async function pathGenerationEvidence(path: string): Promise<string> {
  const canonicalPath = await realpath(path);
  const evidence = await stat(canonicalPath, { bigint: true });
  return [
    canonicalPath,
    evidence.dev.toString(),
    evidence.ino.toString(),
    evidence.mode.toString(),
    evidence.size.toString(),
    evidence.birthtimeNs.toString(),
    evidence.mtimeNs.toString(),
  ].join("\u0000");
}

export async function readWezTermGeneration(
  config: Readonly<WezTermAdapterConfig>,
  version: string,
): Promise<string> {
  const evidence = await Promise.all([
    pathGenerationEvidence(config.executable),
    pathGenerationEvidence(config.configFile),
    pathGenerationEvidence(config.socketPath),
  ]);
  return createHash("sha256")
    .update([version, ...evidence].join("\u0001"))
    .digest("hex");
}

function sameRoute(destination: Destination, route: WezTermRoute): boolean {
  return (
    destination.id === route.destination.id &&
    destination.adapter === WEZTERM_ADAPTER_ID &&
    destination.endpoint.scope === "local" &&
    destination.endpoint.instanceId === route.generation &&
    destination.surface.kind === "pane" &&
    destination.surface.locator === String(route.paneId)
  );
}

export class WezTermAdapter implements DestinationAdapter {
  readonly id = WEZTERM_ADAPTER_ID;
  readonly #config: Readonly<WezTermAdapterConfig>;
  readonly #dependencies: WezTermAdapterDependencies;
  readonly #routes = new Map<string, WezTermRoute>();

  constructor(config: WezTermAdapterConfig, dependencies: WezTermAdapterDependencies) {
    const parsedConfig = wezTermAdapterConfigSchema.parse(config);
    this.#config = {
      ...parsedConfig,
      imagePasteInput: Uint8Array.from(parsedConfig.imagePasteInput),
    };
    this.#dependencies = dependencies;
  }

  async preflight(): Promise<WezTermPreflightResult> {
    const versionResult = await this.#dependencies.runProcess(
      this.#processRequest(["--version"], null, MAX_PROCESS_OUTPUT_BYTES),
    );
    if (versionResult.status !== "success") {
      return { status: "unavailable", reason: "binary" };
    }
    const versionOutput = decodeUtf8(versionResult.stdout)?.trim();
    if (versionOutput !== VERSION_OUTPUT) {
      return { status: "unavailable", reason: "unsupported-version" };
    }
    try {
      const generation = await this.#dependencies.readGeneration(
        this.#config,
        SUPPORTED_WEZTERM_VERSION,
      );
      if (!/^[a-f\d]{64}$/u.test(generation)) {
        return { status: "unavailable", reason: "instance" };
      }
      return { status: "ready", generation, version: SUPPORTED_WEZTERM_VERSION };
    } catch {
      return { status: "unavailable", reason: "instance" };
    }
  }

  async discover(): Promise<readonly Destination[]> {
    this.#routes.clear();
    const snapshotResult = await this.#snapshot();
    if (snapshotResult.status !== "ready") return [];
    const { snapshot } = snapshotResult;

    const observedAt = this.#dependencies.now().toISOString();
    const destinations: Destination[] = [];
    for (const pane of snapshot.panes) {
      const routeId = `wezterm:${snapshot.generation}:${pane.pane_id}`;
      const context =
        pane.cwd === null || pane.cwd.length === 0 ? { observedAt } : { cwd: pane.cwd, observedAt };
      const destination = destinationSchema.safeParse({
        id: routeId,
        adapter: WEZTERM_ADAPTER_ID,
        endpoint: { scope: "local", instanceId: snapshot.generation },
        surface: { kind: "pane", locator: String(pane.pane_id) },
        context,
        capabilities: {
          address: "exact",
          imageInput: "clipboard-key",
          textInput: "paste",
          readBack: "none",
          verification: ["target-live"],
          actions: ["copy", "stage"],
        },
      });
      if (!destination.success) {
        this.#routes.clear();
        return [];
      }
      const route = {
        destination: destination.data,
        generation: snapshot.generation,
        paneId: pane.pane_id,
      };
      this.#routes.set(destination.data.id, route);
      destinations.push(destination.data);
    }
    return destinations;
  }

  async stageIfCurrent(request: AdapterStageRequest): Promise<AdapterStageResult> {
    const destination = destinationSchema.safeParse(request.destination);
    const note = request.note === null ? null : noteSchema.safeParse(request.note);
    if (!destination.success || (note !== null && !note.success)) {
      return { status: "failed" };
    }
    const route = this.#routes.get(destination.data.id);
    if (route === undefined || !sameRoute(destination.data, route)) {
      return { status: "stale" };
    }

    const snapshotResult = await this.#snapshot();
    if (snapshotResult.status === "generation-changed") return { status: "stale" };
    if (snapshotResult.status === "unavailable") return { status: "failed" };
    const { snapshot } = snapshotResult;
    if (snapshot.generation !== route.generation) return { status: "stale" };
    if (snapshot.panes.filter((pane) => pane.pane_id === route.paneId).length !== 1) {
      return { status: "stale" };
    }

    const safeNote = note === null ? null : note.data;
    return this.#sendText(route, joinInput(this.#config.imagePasteInput, safeNote));
  }

  async #snapshot(): Promise<WezTermSnapshotResult> {
    const preflight = await this.preflight();
    if (preflight.status !== "ready") return { status: "unavailable" };
    const listResult = await this.#dependencies.runProcess(
      this.#processRequest(this.#cliArguments(["list", "--format", "json"]), null, MAX_LIST_BYTES),
    );
    if (listResult.status !== "success") return { status: "unavailable" };
    const panes = parsePaneList(listResult.stdout);
    if (panes === null) return { status: "unavailable" };
    try {
      const generationAfterList = await this.#dependencies.readGeneration(
        this.#config,
        preflight.version,
      );
      if (generationAfterList !== preflight.generation) {
        return { status: "generation-changed" };
      }
    } catch {
      return { status: "unavailable" };
    }
    return { status: "ready", snapshot: { ...preflight, panes } };
  }

  async #sendText(route: WezTermRoute, input: Uint8Array): Promise<AdapterStageResult> {
    const result = await this.#dependencies.runProcess(
      this.#processRequest(
        this.#cliArguments(["send-text", "--no-paste", "--pane-id", String(route.paneId)]),
        input,
        MAX_PROCESS_OUTPUT_BYTES,
        async () => {
          try {
            return (
              (await this.#dependencies.readGeneration(this.#config, SUPPORTED_WEZTERM_VERSION)) ===
              route.generation
            );
          } catch {
            return false;
          }
        },
      ),
    );
    if (result.status === "success") return { status: "dispatched-unverified" };
    if (result.reason === "guard-rejected") return { status: "stale" };
    if (result.reason === "spawn") return { status: "failed" };
    return { status: "dispatched-unverified" };
  }

  #cliArguments(arguments_: readonly string[]): readonly string[] {
    return ["--config-file", this.#config.configFile, "cli", "--no-auto-start", ...arguments_];
  }

  #processRequest(
    arguments_: readonly string[],
    input: Uint8Array | null,
    maxOutputBytes: number,
    beforeSpawn?: () => Promise<boolean>,
  ): BoundedProcessRequest {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      WEZTERM_UNIX_SOCKET: this.#config.socketPath,
    };
    delete environment.WEZTERM_PANE;
    const request = {
      executable: this.#config.executable,
      arguments: arguments_,
      environment,
      input,
      maxOutputBytes,
      timeoutMs: 3_000,
    };
    if (beforeSpawn === undefined) return request;
    return { ...request, beforeSpawn };
  }
}

export function createWezTermAdapter(config: WezTermAdapterConfig): WezTermAdapter {
  return new WezTermAdapter(config, {
    now: () => new Date(),
    readGeneration: readWezTermGeneration,
    runProcess: runBoundedProcess,
  });
}

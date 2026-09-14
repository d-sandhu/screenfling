import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { wezTermSetupConfigurationSchema } from "../shared/wezterm-setup";
import { createWezTermAdapter } from "./wezterm-adapter";

import type { AdapterEnvironment } from "./configured-adapters";
import type {
  WezTermSetupConfiguration,
  WezTermSetupOutcome,
  WezTermSetupSnapshot,
} from "../shared/wezterm-setup";

const persistedSchema = z.strictObject({
  version: z.literal(1),
  configuration: wezTermSetupConfigurationSchema.nullable(),
});
const missingFile = z.object({ code: z.literal("ENOENT") });
type Probe = (configuration: WezTermSetupConfiguration) => Promise<boolean>;

async function probe(configuration: WezTermSetupConfiguration): Promise<boolean> {
  const adapter = createWezTermAdapter({
    executable: configuration.executable,
    configFile: configuration.configFile,
    socketPath: configuration.socketPath,
    imagePasteInput: Buffer.from(configuration.imageInputHex, "hex"),
  });
  // Read-only discovery; never test a binding by writing to a user's pane.
  return (await adapter.discover()).length > 0;
}

export class WezTermSetup {
  #snapshot: WezTermSetupSnapshot;
  #saving = false;
  #restarting = false;

  constructor(
    readonly filePath: string,
    readonly platform: NodeJS.Platform,
    readonly isIdle: () => boolean,
    readonly restartApplication: () => void,
    readonly checkConnection: Probe = probe,
  ) {
    this.#snapshot = {
      supported: platform === "darwin",
      source: "none",
      configuration: null,
      restartRequired: false,
    };
  }

  getSnapshot(): WezTermSetupSnapshot {
    return { ...this.#snapshot };
  }

  async initialize(environment: AdapterEnvironment): Promise<AdapterEnvironment> {
    if (!this.#snapshot.supported) return {};
    const explicit = [
      environment.SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE,
      environment.SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE,
      environment.SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET,
      environment.SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX,
    ].some((value) => value !== undefined);
    if (explicit) {
      const parsed = wezTermSetupConfigurationSchema.safeParse({
        executable: environment.SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE,
        configFile: environment.SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE,
        socketPath: environment.SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET,
        imageInputHex: environment.SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX,
      });
      this.#snapshot.source = "environment";
      this.#snapshot.configuration = parsed.success ? parsed.data : null;
      // A partial explicit configuration must not silently select a saved endpoint.
      return environment;
    }
    try {
      const file = await open(
        this.filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const metadata = await file.stat();
        if (
          !metadata.isFile() ||
          (metadata.mode & 0o077) !== 0 ||
          (process.getuid !== undefined && metadata.uid !== process.getuid())
        ) {
          throw new Error("Untrusted connection preference.");
        }
        const buffer = Buffer.alloc(20_001);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 20_000) throw new Error("Oversized connection preference.");
        const persisted = persistedSchema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString()));
        this.#snapshot.configuration = persisted.configuration;
        this.#snapshot.source = persisted.configuration === null ? "none" : "saved";
      } finally {
        await file.close();
      }
    } catch (cause) {
      if (!missingFile.safeParse(cause).success) this.#snapshot.source = "invalid";
    }
    const configuration = this.#snapshot.configuration;
    return configuration === null
      ? {}
      : {
          SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE: configuration.executable,
          SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE: configuration.configFile,
          SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET: configuration.socketPath,
          SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX: configuration.imageInputHex,
        };
  }

  async save(configuration: WezTermSetupConfiguration | null): Promise<WezTermSetupOutcome> {
    if (!this.#snapshot.supported) return "unsupported";
    if (this.#snapshot.source === "environment") return "environment-override";
    if (this.#saving || this.#restarting || !this.isIdle()) return "busy";
    const parsed = wezTermSetupConfigurationSchema.nullable().safeParse(configuration);
    if (!parsed.success) return "failed";
    this.#saving = true;
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      if (parsed.data !== null && !(await this.checkConnection(parsed.data))) return "unavailable";
      if (!this.isIdle()) return "busy";
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      await writeFile(
        temporaryPath,
        JSON.stringify({ version: 1, configuration: parsed.data }) + "\n",
        { flag: "wx", mode: 0o600, flush: true },
      );
      await rename(temporaryPath, this.filePath);
      this.#snapshot = {
        supported: true,
        source: parsed.data === null ? "none" : "saved",
        configuration: parsed.data,
        restartRequired: true,
      };
      // The running adapter is unchanged even if capture began during the disk write.
      return "saved";
    } catch {
      return "failed";
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      this.#saving = false;
    }
  }

  restart(): boolean {
    if (this.#saving || this.#restarting || !this.#snapshot.restartRequired || !this.isIdle()) {
      return false;
    }
    this.#restarting = true;
    try {
      this.restartApplication();
      return true;
    } catch {
      this.#restarting = false;
      return false;
    }
  }
}

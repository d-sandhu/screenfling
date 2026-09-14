import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { wezTermSetupConfigurationSchema } from "../shared/wezterm-setup";
import { createWezTermAdapter } from "./wezterm-adapter";
import {
  assertPrivatePreferenceFile,
  assertPrivatePreferenceParent,
  boundedPreferenceRead,
  readPreferenceText,
} from "./preference-files";

import type { AdapterEnvironment } from "./configured-adapters";
import type {
  WezTermConnectionStatus,
  WezTermSetupConfiguration,
  WezTermSetupOutcome,
  WezTermSetupSnapshot,
} from "../shared/wezterm-setup";

const persistedSchema = z.strictObject({
  version: z.literal(1),
  configuration: wezTermSetupConfigurationSchema.nullable(),
});
type Probe = (configuration: WezTermSetupConfiguration) => Promise<WezTermConnectionStatus>;

async function probe(configuration: WezTermSetupConfiguration): Promise<WezTermConnectionStatus> {
  const adapter = createWezTermAdapter({
    executable: configuration.executable,
    configFile: configuration.configFile,
    socketPath: configuration.socketPath,
    imagePasteInput: Buffer.from(configuration.imageInputHex, "hex"),
  });
  // Read-only discovery; never test a binding by writing to a user's pane.
  return adapter.checkConnection();
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
      activeConfiguration: null,
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
      this.#snapshot.activeConfiguration = this.#snapshot.configuration;
      // A partial explicit configuration must not silently select a saved endpoint.
      return environment;
    }
    try {
      const text = await boundedPreferenceRead(() => readPreferenceText(this.filePath, 20_000, "private"));
      if (text !== null) {
        const persisted = persistedSchema.parse(JSON.parse(text));
        this.#snapshot.configuration = persisted.configuration;
        this.#snapshot.activeConfiguration = persisted.configuration;
        this.#snapshot.source = persisted.configuration === null ? "none" : "saved";
      }
    } catch {
      this.#snapshot.source = "invalid";
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

  async check(configuration: WezTermSetupConfiguration): Promise<WezTermConnectionStatus> {
    if (!this.#snapshot.supported) return "unsupported";
    if (this.#saving || this.#restarting || !this.isIdle()) return "busy";
    const parsed = wezTermSetupConfigurationSchema.safeParse(configuration);
    if (!parsed.success) return "invalid-configuration";
    this.#saving = true;
    try {
      const result = await this.checkConnection(parsed.data);
      return this.isIdle() ? result : "busy";
    } catch {
      return "instance-unavailable";
    } finally {
      this.#saving = false;
    }
  }

  async chooseFile(choose: () => Promise<string | null>): Promise<string | null> {
    if (!this.#snapshot.supported || this.#snapshot.source === "environment" ||
        this.#saving || this.#restarting || !this.isIdle()) return null;
    this.#saving = true;
    try {
      const selected = await choose();
      return this.isIdle() ? selected : null;
    } finally {
      this.#saving = false;
    }
  }

  async save(configuration: WezTermSetupConfiguration | null): Promise<WezTermSetupOutcome> {
    if (!this.#snapshot.supported) return "unsupported";
    if (this.#snapshot.source === "environment") return "environment-override";
    if (this.#saving || this.#restarting || !this.isIdle()) return "busy";
    const parsed = wezTermSetupConfigurationSchema.nullable().safeParse(configuration);
    if (!parsed.success) return "invalid-configuration";
    this.#saving = true;
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      if (parsed.data !== null) {
        const result = await this.checkConnection(parsed.data);
        if (result !== "ready") return result;
      }
      if (!this.isIdle()) return "busy";
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      await assertPrivatePreferenceParent(this.filePath);
      await writeFile(
        temporaryPath,
        JSON.stringify({ version: 1, configuration: parsed.data }) + "\n",
        { flag: "wx", mode: 0o600, flush: true },
      );
      // Check inherited permissions too. Never repair another file or directory.
      await assertPrivatePreferenceFile(temporaryPath);
      await assertPrivatePreferenceParent(this.filePath);
      await rename(temporaryPath, this.filePath);
      this.#snapshot = {
        supported: true,
        source: parsed.data === null ? "none" : "saved",
        configuration: parsed.data,
        activeConfiguration: this.#snapshot.activeConfiguration,
        restartRequired: JSON.stringify(parsed.data) !== JSON.stringify(this.#snapshot.activeConfiguration),
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
    // Shared by connection changes and explicit Screen Recording recovery.
    if (this.#saving || this.#restarting || !this.isIdle()) {
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

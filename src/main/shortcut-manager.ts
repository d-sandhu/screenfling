import { DEFAULT_SHORTCUT_CONFIGURATION, toShortcutAccelerator } from "../shared/shortcut";

import type {
  ShortcutConfiguration,
  ShortcutStatus,
  ShortcutUpdateResult,
} from "../shared/shortcut";
import type { ShortcutPreferences } from "./shortcut-preference-store";

export type ShortcutRegistrar = {
  readonly isRegistered: (accelerator: string) => boolean;
  readonly register: (accelerator: string, callback: () => void) => boolean;
  readonly unregister: (accelerator: string) => void;
};

export type ShortcutOperations = {
  readonly getStatus: () => ShortcutStatus;
  readonly reset: () => Promise<ShortcutUpdateResult>;
  readonly set: (configuration: ShortcutConfiguration) => Promise<ShortcutUpdateResult>;
};

export class ShortcutManager {
  #busy = false;
  readonly #capture: () => void;
  #cleanupRequired = false;
  readonly #ownedAccelerators = new Set<string>();
  readonly #preferences: ShortcutPreferences;
  readonly #registrar: ShortcutRegistrar;
  #status: ShortcutStatus = {
    accelerator: toShortcutAccelerator(DEFAULT_SHORTCUT_CONFIGURATION),
    cleanupRequired: false,
    configuration: DEFAULT_SHORTCUT_CONFIGURATION,
    configurationState: "default",
    registered: false,
  };

  constructor(registrar: ShortcutRegistrar, preferences: ShortcutPreferences, capture: () => void) {
    this.#registrar = registrar;
    this.#preferences = preferences;
    this.#capture = capture;
  }

  getStatus(): ShortcutStatus {
    return this.#status;
  }

  dispose(): void {
    for (const accelerator of this.#ownedAccelerators) {
      this.#tryUnregister(accelerator);
    }
    this.#status = {
      ...this.#status,
      cleanupRequired: this.#cleanupRequired,
      registered: this.#ownedAccelerators.has(this.#status.accelerator),
    };
  }

  #tryRegister(accelerator: string): boolean {
    let accepted = false;
    try {
      accepted = this.#registrar.register(accelerator, () => {
        if (this.#status.registered && this.#status.accelerator === accelerator) {
          this.#capture();
        }
      });
      if (!accepted) return false;
      this.#ownedAccelerators.add(accelerator);
      if (this.#registrar.isRegistered(accelerator)) return true;
      this.#tryUnregister(accelerator);
      return false;
    } catch {
      if (accepted) this.#tryUnregister(accelerator);
      return false;
    }
  }

  #tryUnregister(accelerator: string): boolean {
    try {
      this.#registrar.unregister(accelerator);
      if (this.#registrar.isRegistered(accelerator)) {
        this.#cleanupRequired = true;
        return false;
      }
      this.#ownedAccelerators.delete(accelerator);
      return true;
    } catch {
      this.#cleanupRequired = true;
      return false;
    }
  }

  #refreshCleanupStatus(): void {
    if (this.#status.cleanupRequired === this.#cleanupRequired) return;
    this.#status = { ...this.#status, cleanupRequired: this.#cleanupRequired };
  }

  async initialize(): Promise<ShortcutStatus> {
    const loaded = await this.#preferences.load().catch(() => ({ kind: "unreadable" }) as const);
    const configuration =
      loaded.kind === "loaded" ? loaded.configuration : DEFAULT_SHORTCUT_CONFIGURATION;
    const configurationState =
      loaded.kind === "loaded" ? "saved" : loaded.kind === "missing" ? "default" : loaded.kind;
    const accelerator = toShortcutAccelerator(configuration);
    const registered = this.#tryRegister(accelerator);
    this.#status = {
      accelerator,
      cleanupRequired: this.#cleanupRequired,
      configuration,
      configurationState,
      registered,
    };
    return this.#status;
  }

  async set(configuration: ShortcutConfiguration): Promise<ShortcutUpdateResult> {
    if (this.#busy) return { outcome: "rejected", reason: "busy", status: this.#status };
    this.#busy = true;
    try {
      return await this.#apply(configuration);
    } finally {
      this.#busy = false;
    }
  }

  async reset(): Promise<ShortcutUpdateResult> {
    return this.set(DEFAULT_SHORTCUT_CONFIGURATION);
  }

  async #apply(configuration: ShortcutConfiguration): Promise<ShortcutUpdateResult> {
    const accelerator = toShortcutAccelerator(configuration);
    const sameAccelerator = accelerator === this.#status.accelerator;
    const alreadySaved = sameAccelerator && this.#status.configurationState === "saved";
    if (alreadySaved && this.#status.registered) {
      return { outcome: "unchanged", status: this.#status };
    }

    const registeredForUpdate = sameAccelerator && this.#status.registered;
    if (!registeredForUpdate && !this.#tryRegister(accelerator)) {
      this.#refreshCleanupStatus();
      return { outcome: "rejected", reason: "unavailable", status: this.#status };
    }

    try {
      await this.#preferences.save(configuration);
    } catch {
      if (!registeredForUpdate) this.#tryUnregister(accelerator);
      this.#refreshCleanupStatus();
      return { outcome: "rejected", reason: "persistence-failed", status: this.#status };
    }

    if (!sameAccelerator && this.#status.registered) {
      this.#tryUnregister(this.#status.accelerator);
    }
    this.#status = {
      accelerator,
      cleanupRequired: this.#cleanupRequired,
      configuration,
      configurationState: "saved",
      registered: true,
    };
    return { outcome: "updated", status: this.#status };
  }
}

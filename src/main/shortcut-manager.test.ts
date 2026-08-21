import { describe, expect, it } from "vitest";

import { DEFAULT_SHORTCUT_CONFIGURATION } from "../shared/shortcut";
import { ShortcutManager } from "./shortcut-manager";

import type { ShortcutConfiguration } from "../shared/shortcut";
import type {
  ShortcutPreferenceLoadResult,
  ShortcutPreferences,
} from "./shortcut-preference-store";
import type { ShortcutRegistrar } from "./shortcut-manager";

class MemoryPreferences implements ShortcutPreferences {
  events: string[] | null = null;
  failLoad = false;
  failSave = false;
  saveWait: Promise<void> | null = null;
  loadResult: ShortcutPreferenceLoadResult = { kind: "missing" };
  readonly saved: ShortcutConfiguration[] = [];

  async load(): Promise<ShortcutPreferenceLoadResult> {
    if (this.failLoad) throw new Error("read failed");
    return this.loadResult;
  }

  async save(configuration: ShortcutConfiguration): Promise<void> {
    this.events?.push(`save:${configuration.modifiers}+${configuration.key}`);
    if (this.failSave) throw new Error("save failed");
    if (this.saveWait !== null) await this.saveWait;
    this.saved.push(configuration);
  }
}

class MemoryRegistrar implements ShortcutRegistrar {
  readonly active = new Set<string>();
  readonly callbacks = new Map<string, () => void>();
  readonly calls: string[] = [];
  readonly stubborn = new Set<string>();
  readonly unavailable = new Set<string>();
  events: string[] | null = null;
  throwOnRegister = false;

  isRegistered(accelerator: string): boolean {
    this.events?.push(`isRegistered:${accelerator}`);
    this.calls.push(`isRegistered:${accelerator}`);
    return this.active.has(accelerator);
  }

  register(accelerator: string, callback: () => void): boolean {
    this.events?.push(`register:${accelerator}`);
    this.calls.push(`register:${accelerator}`);
    if (this.throwOnRegister) throw new Error("registration failed");
    if (this.unavailable.has(accelerator)) return false;
    this.active.add(accelerator);
    this.callbacks.set(accelerator, callback);
    return true;
  }

  unregister(accelerator: string): void {
    this.events?.push(`unregister:${accelerator}`);
    this.calls.push(`unregister:${accelerator}`);
    if (!this.stubborn.has(accelerator)) {
      this.active.delete(accelerator);
      this.callbacks.delete(accelerator);
    }
  }
}

describe("shortcut manager startup", () => {
  it("registers the portable default without writing a first-run preference", async () => {
    const preferences = new MemoryPreferences();
    const registrar = new MemoryRegistrar();
    let captures = 0;
    const manager = new ShortcutManager(registrar, preferences, () => {
      captures += 1;
    });

    await expect(manager.initialize()).resolves.toEqual({
      accelerator: "CommandOrControl+Shift+9",
      cleanupRequired: false,
      configuration: DEFAULT_SHORTCUT_CONFIGURATION,
      configurationState: "default",
      registered: true,
    });
    registrar.callbacks.get("CommandOrControl+Shift+9")?.();

    expect(captures).toBe(1);
    expect(preferences.saved).toEqual([]);
  });

  it("falls back to the default and reports an unreadable preference", async () => {
    const preferences = new MemoryPreferences();
    preferences.failLoad = true;
    const registrar = new MemoryRegistrar();
    const manager = new ShortcutManager(registrar, preferences, () => undefined);

    await expect(manager.initialize()).resolves.toMatchObject({
      configuration: DEFAULT_SHORTCUT_CONFIGURATION,
      configurationState: "unreadable",
      registered: true,
    });
  });

  it("reports an unavailable shortcut when Electron registration throws", async () => {
    const registrar = new MemoryRegistrar();
    registrar.throwOnRegister = true;
    const manager = new ShortcutManager(registrar, new MemoryPreferences(), () => undefined);

    await expect(manager.initialize()).resolves.toMatchObject({
      accelerator: "CommandOrControl+Shift+9",
      registered: false,
    });
  });

  it("loads and registers a strict saved configuration", async () => {
    const preferences = new MemoryPreferences();
    preferences.loadResult = {
      configuration: { key: "F", modifiers: "CommandOrControl+Alt+Shift" },
      kind: "loaded",
    };
    const registrar = new MemoryRegistrar();
    const manager = new ShortcutManager(registrar, preferences, () => undefined);

    await expect(manager.initialize()).resolves.toMatchObject({
      accelerator: "CommandOrControl+Alt+Shift+F",
      configurationState: "saved",
      registered: true,
    });
  });

  it("uses the default but preserves an invalid-preference warning", async () => {
    const preferences = new MemoryPreferences();
    preferences.loadResult = { kind: "invalid" };
    const manager = new ShortcutManager(new MemoryRegistrar(), preferences, () => undefined);

    await expect(manager.initialize()).resolves.toMatchObject({
      configuration: DEFAULT_SHORTCUT_CONFIGURATION,
      configurationState: "invalid",
      registered: true,
    });
  });
});

describe("shortcut manager updates", () => {
  it("registers and persists a candidate before releasing the previous shortcut", async () => {
    const events: string[] = [];
    const preferences = new MemoryPreferences();
    preferences.events = events;
    const registrar = new MemoryRegistrar();
    registrar.events = events;
    const manager = new ShortcutManager(registrar, preferences, () => undefined);
    await manager.initialize();
    events.length = 0;

    const configuration = { key: "A", modifiers: "CommandOrControl+Alt" } as const;
    await expect(manager.set(configuration)).resolves.toEqual({
      outcome: "updated",
      status: {
        accelerator: "CommandOrControl+Alt+A",
        cleanupRequired: false,
        configuration,
        configurationState: "saved",
        registered: true,
      },
    });

    expect(events).toEqual([
      "register:CommandOrControl+Alt+A",
      "isRegistered:CommandOrControl+Alt+A",
      "save:CommandOrControl+Alt+A",
      "unregister:CommandOrControl+Shift+9",
      "isRegistered:CommandOrControl+Shift+9",
    ]);
    expect(registrar.active).toEqual(new Set(["CommandOrControl+Alt+A"]));
  });

  it("rolls back a candidate when persistence fails and retains the working shortcut", async () => {
    const events: string[] = [];
    const preferences = new MemoryPreferences();
    preferences.events = events;
    const registrar = new MemoryRegistrar();
    registrar.events = events;
    const manager = new ShortcutManager(registrar, preferences, () => undefined);
    await manager.initialize();
    events.length = 0;
    preferences.failSave = true;

    await expect(
      manager.set({ key: "B", modifiers: "CommandOrControl+Alt+Shift" }),
    ).resolves.toEqual({
      outcome: "rejected",
      reason: "persistence-failed",
      status: {
        accelerator: "CommandOrControl+Shift+9",
        cleanupRequired: false,
        configuration: DEFAULT_SHORTCUT_CONFIGURATION,
        configurationState: "default",
        registered: true,
      },
    });
    expect(events).toEqual([
      "register:CommandOrControl+Alt+Shift+B",
      "isRegistered:CommandOrControl+Alt+Shift+B",
      "save:CommandOrControl+Alt+Shift+B",
      "unregister:CommandOrControl+Alt+Shift+B",
      "isRegistered:CommandOrControl+Alt+Shift+B",
    ]);
    expect(registrar.active).toEqual(new Set(["CommandOrControl+Shift+9"]));
  });

  it("retains the working shortcut when a candidate is unavailable", async () => {
    const preferences = new MemoryPreferences();
    const registrar = new MemoryRegistrar();
    registrar.unavailable.add("CommandOrControl+Alt+G");
    const manager = new ShortcutManager(registrar, preferences, () => undefined);
    await manager.initialize();

    await expect(
      manager.set({ key: "G", modifiers: "CommandOrControl+Alt" }),
    ).resolves.toMatchObject({
      outcome: "rejected",
      reason: "unavailable",
      status: {
        accelerator: "CommandOrControl+Shift+9",
        registered: true,
      },
    });
    expect(preferences.saved).toEqual([]);
    expect(registrar.active).toEqual(new Set(["CommandOrControl+Shift+9"]));
  });

  it("reports cleanup-required if Electron does not release the old registration", async () => {
    const registrar = new MemoryRegistrar();
    const manager = new ShortcutManager(registrar, new MemoryPreferences(), () => undefined);
    await manager.initialize();
    registrar.stubborn.add("CommandOrControl+Shift+9");

    await expect(
      manager.set({ key: "H", modifiers: "CommandOrControl+Alt" }),
    ).resolves.toMatchObject({
      outcome: "updated",
      status: {
        accelerator: "CommandOrControl+Alt+H",
        cleanupRequired: true,
        registered: true,
      },
    });
    expect(registrar.active).toEqual(
      new Set(["CommandOrControl+Shift+9", "CommandOrControl+Alt+H"]),
    );
  });

  it("resets a saved shortcut to the portable default", async () => {
    const preferences = new MemoryPreferences();
    const registrar = new MemoryRegistrar();
    const manager = new ShortcutManager(registrar, preferences, () => undefined);
    await manager.initialize();
    await manager.set({ key: "C", modifiers: "CommandOrControl+Alt" });

    await expect(manager.reset()).resolves.toMatchObject({
      outcome: "updated",
      status: {
        accelerator: "CommandOrControl+Shift+9",
        configuration: DEFAULT_SHORTCUT_CONFIGURATION,
        configurationState: "saved",
        registered: true,
      },
    });
    expect(preferences.saved).toEqual([
      { key: "C", modifiers: "CommandOrControl+Alt" },
      DEFAULT_SHORTCUT_CONFIGURATION,
    ]);
    expect(registrar.active).toEqual(new Set(["CommandOrControl+Shift+9"]));
  });

  it("rejects a concurrent update instead of queuing stale choices", async () => {
    let releaseSave: () => void = () => undefined;
    const preferences = new MemoryPreferences();
    preferences.saveWait = new Promise((resolve) => {
      releaseSave = resolve;
    });
    const manager = new ShortcutManager(new MemoryRegistrar(), preferences, () => undefined);
    await manager.initialize();

    const firstUpdate = manager.set({ key: "D", modifiers: "CommandOrControl+Alt" });
    await expect(
      manager.set({ key: "E", modifiers: "CommandOrControl+Alt" }),
    ).resolves.toMatchObject({ outcome: "rejected", reason: "busy" });
    releaseSave();
    await expect(firstUpdate).resolves.toMatchObject({ outcome: "updated" });
  });

  it("invokes capture only for the committed accelerator", async () => {
    let releaseSave: () => void = () => undefined;
    const preferences = new MemoryPreferences();
    preferences.saveWait = new Promise((resolve) => {
      releaseSave = resolve;
    });
    const registrar = new MemoryRegistrar();
    let captures = 0;
    const manager = new ShortcutManager(registrar, preferences, () => {
      captures += 1;
    });
    await manager.initialize();
    const previousCallback = registrar.callbacks.get("CommandOrControl+Shift+9");

    const update = manager.set({ key: "K", modifiers: "CommandOrControl+Alt" });
    const candidateCallback = registrar.callbacks.get("CommandOrControl+Alt+K");
    previousCallback?.();
    candidateCallback?.();
    expect(captures).toBe(1);

    releaseSave();
    await update;
    previousCallback?.();
    candidateCallback?.();
    expect(captures).toBe(2);
  });

  it("releases every owned registration during disposal", async () => {
    const registrar = new MemoryRegistrar();
    const manager = new ShortcutManager(registrar, new MemoryPreferences(), () => undefined);
    await manager.initialize();

    manager.dispose();

    expect(registrar.active).toEqual(new Set());
    expect(manager.getStatus()).toMatchObject({ registered: false });
  });
});

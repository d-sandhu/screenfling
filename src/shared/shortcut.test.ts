import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHORTCUT_CONFIGURATION,
  persistedShortcutSchema,
  shortcutConfigurationSchema,
  shortcutUpdateResultSchema,
  toShortcutAccelerator,
} from "./shortcut";

describe("shortcut configuration contract", () => {
  it("converts the portable default configuration to the Electron accelerator", () => {
    expect(DEFAULT_SHORTCUT_CONFIGURATION).toEqual({
      key: "9",
      modifiers: "CommandOrControl+Shift",
    });
    expect(toShortcutAccelerator(DEFAULT_SHORTCUT_CONFIGURATION)).toBe("CommandOrControl+Shift+9");
  });

  it("accepts only the bounded portable modifier and key choices", () => {
    expect(
      shortcutConfigurationSchema.parse({
        key: "A",
        modifiers: "CommandOrControl+Alt+Shift",
      }),
    ).toEqual({ key: "A", modifiers: "CommandOrControl+Alt+Shift" });

    const rejected = [
      { key: "9", modifiers: "Shift" },
      { key: "F5", modifiers: "CommandOrControl+Shift" },
      { key: "a", modifiers: "CommandOrControl+Shift" },
      { key: "A", modifiers: "Command+Shift" },
      { extra: true, key: "A", modifiers: "CommandOrControl+Shift" },
    ];
    for (const configuration of rejected) {
      expect(shortcutConfigurationSchema.safeParse(configuration).success).toBe(false);
    }
  });

  it("versions and strictly validates the persisted preference", () => {
    const persisted = {
      configuration: DEFAULT_SHORTCUT_CONFIGURATION,
      version: 1,
    };

    expect(persistedShortcutSchema.parse(persisted)).toEqual(persisted);
    expect(persistedShortcutSchema.safeParse({ ...persisted, version: 2 }).success).toBe(false);
    expect(persistedShortcutSchema.safeParse({ ...persisted, extra: true }).success).toBe(false);
  });
});

describe("shortcut update result contract", () => {
  it("reports a rejected candidate without replacing the retained status", () => {
    const result = {
      outcome: "rejected",
      reason: "unavailable",
      status: {
        accelerator: "CommandOrControl+Shift+9",
        cleanupRequired: false,
        configuration: DEFAULT_SHORTCUT_CONFIGURATION,
        configurationState: "saved",
        registered: true,
      },
    };

    expect(shortcutUpdateResultSchema.parse(result)).toEqual(result);
    expect(
      shortcutUpdateResultSchema.safeParse({ ...result, reason: "conflict-owner-name" }).success,
    ).toBe(false);
  });
});

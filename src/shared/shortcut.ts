import { z } from "zod";

export const SHORTCUT_MODIFIERS = Object.freeze([
  "CommandOrControl+Shift",
  "CommandOrControl+Alt",
  "CommandOrControl+Alt+Shift",
] as const);

export const SHORTCUT_KEYS = Object.freeze([
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
] as const);

export const shortcutConfigurationSchema = z
  .strictObject({
    key: z.enum(SHORTCUT_KEYS),
    modifiers: z.enum(SHORTCUT_MODIFIERS),
  })
  .readonly();

export type ShortcutConfiguration = z.infer<typeof shortcutConfigurationSchema>;

export const DEFAULT_SHORTCUT_CONFIGURATION: ShortcutConfiguration = Object.freeze({
  key: "9",
  modifiers: "CommandOrControl+Shift",
});

export function toShortcutAccelerator(configuration: ShortcutConfiguration): string {
  return `${configuration.modifiers}+${configuration.key}`;
}

export const persistedShortcutSchema = z
  .strictObject({
    configuration: shortcutConfigurationSchema,
    version: z.literal(1),
  })
  .readonly();

export type PersistedShortcut = z.infer<typeof persistedShortcutSchema>;

export const shortcutConfigurationStateSchema = z.enum([
  "default",
  "saved",
  "invalid",
  "unreadable",
]);

export const shortcutStatusSchema = z
  .strictObject({
    accelerator: z.string().min(1).max(64),
    cleanupRequired: z.boolean(),
    configuration: shortcutConfigurationSchema,
    configurationState: shortcutConfigurationStateSchema,
    registered: z.boolean(),
  })
  .readonly();

export type ShortcutStatus = z.infer<typeof shortcutStatusSchema>;

const updatedShortcutSchema = z
  .strictObject({
    outcome: z.literal("updated"),
    status: shortcutStatusSchema,
  })
  .readonly();

const unchangedShortcutSchema = z
  .strictObject({
    outcome: z.literal("unchanged"),
    status: shortcutStatusSchema,
  })
  .readonly();

const rejectedShortcutUpdateSchema = z
  .strictObject({
    outcome: z.literal("rejected"),
    reason: z.enum(["busy", "persistence-failed", "unavailable"]),
    status: shortcutStatusSchema,
  })
  .readonly();

export const shortcutUpdateResultSchema = z.discriminatedUnion("outcome", [
  updatedShortcutSchema,
  unchangedShortcutSchema,
  rejectedShortcutUpdateSchema,
]);

export type ShortcutUpdateResult = z.infer<typeof shortcutUpdateResultSchema>;

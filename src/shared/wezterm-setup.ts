import { z } from "zod";

export const wezTermPathSchema = z.string().max(4_096).regex(/^\/[^\p{Cc}\p{Zl}\p{Zp}]+$/u, "Use an absolute path without ~ or control characters.");

export const wezTermSetupConfigurationSchema = z.strictObject({
  executable: wezTermPathSchema,
  configFile: wezTermPathSchema,
  socketPath: wezTermPathSchema.refine((value) => {
    const parent = value.slice(0, value.lastIndexOf("/") + 1);
    return [value, `${parent}.sf-000000000000`].every(
      (path) => new TextEncoder().encode(path).length <= 103,
    );
  }, "Use a shorter socket path (at most 103 UTF-8 bytes, including the private relay path)."),
  imageInputHex: z
    .string()
    .regex(/^(?:[a-f\d]{2}){1,64}$/iu, "Enter pairs of hexadecimal digits, with no spaces (for example 16).")
    .refine((hex) => !hex.match(/../gu)?.some((byte) => /^(0a|0d)$/iu.test(byte)), "Enter and newline bytes are not allowed."),
});

export const wezTermSetupSnapshotSchema = z.strictObject({
  supported: z.boolean(),
  source: z.enum(["none", "saved", "environment", "invalid"]),
  configuration: wezTermSetupConfigurationSchema.nullable(),
  restartRequired: z.boolean(),
  activeConfiguration: wezTermSetupConfigurationSchema.nullable(),
});

export const wezTermConnectionStatusSchema = z.enum([
  "ready",
  "invalid-configuration",
  "selectors-rejected",
  "executable-unavailable",
  "unsupported-version",
  "instance-unavailable",
  "no-panes",
  "busy",
  "unsupported",
]);
export type WezTermConnectionStatus = z.infer<typeof wezTermConnectionStatusSchema>;
export const wezTermFileFieldSchema = z.enum(["executable", "configFile"]);
export type WezTermFileField = z.infer<typeof wezTermFileFieldSchema>;

export const wezTermSetupOutcomeSchema = z.enum([
  "saved",
  "busy",
  "unavailable",
  "invalid-configuration",
  "selectors-rejected",
  "executable-unavailable",
  "unsupported-version",
  "instance-unavailable",
  "no-panes",
  "failed",
  "environment-override",
  "unsupported",
]);

export type WezTermSetupConfiguration = z.infer<typeof wezTermSetupConfigurationSchema>;
export type WezTermSetupSnapshot = z.infer<typeof wezTermSetupSnapshotSchema>;
export type WezTermSetupOutcome = z.infer<typeof wezTermSetupOutcomeSchema>;

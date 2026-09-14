import { z } from "zod";

const localPath = z.string().max(4_096).regex(/^\/[^\p{Cc}\p{Zl}\p{Zp}]+$/u);

export const wezTermSetupConfigurationSchema = z.strictObject({
  executable: localPath,
  configFile: localPath,
  socketPath: localPath,
  imageInputHex: z
    .string()
    .regex(/^(?:[a-f\d]{2}){1,64}$/iu)
    .refine((hex) => !hex.match(/../gu)?.some((byte) => /^(0a|0d)$/iu.test(byte))),
});

export const wezTermSetupSnapshotSchema = z.strictObject({
  supported: z.boolean(),
  source: z.enum(["none", "saved", "environment", "invalid"]),
  configuration: wezTermSetupConfigurationSchema.nullable(),
  restartRequired: z.boolean(),
});

export const wezTermSetupOutcomeSchema = z.enum([
  "saved",
  "busy",
  "unavailable",
  "failed",
  "environment-override",
  "unsupported",
]);

export type WezTermSetupConfiguration = z.infer<typeof wezTermSetupConfigurationSchema>;
export type WezTermSetupSnapshot = z.infer<typeof wezTermSetupSnapshotSchema>;
export type WezTermSetupOutcome = z.infer<typeof wezTermSetupOutcomeSchema>;

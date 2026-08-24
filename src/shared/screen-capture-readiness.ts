import { z } from "zod";

export const screenCapturePermissionStatusSchema = z.enum([
  "not-determined",
  "granted",
  "denied",
  "restricted",
  "unknown",
]);

export type ScreenCapturePermissionStatus = z.infer<typeof screenCapturePermissionStatusSchema>;

const macosReadinessSchema = z
  .strictObject({
    platform: z.literal("macos"),
    status: screenCapturePermissionStatusSchema,
    version: z.literal(1),
  })
  .readonly();

const otherPlatformReadinessSchema = z
  .strictObject({
    platform: z.enum(["windows", "linux", "other"]),
    status: z.literal("not-applicable"),
    version: z.literal(1),
  })
  .readonly();

export const screenCaptureReadinessSchema = z.discriminatedUnion("platform", [
  macosReadinessSchema,
  otherPlatformReadinessSchema,
]);

export type ScreenCaptureReadinessSnapshot = z.infer<typeof screenCaptureReadinessSchema>;

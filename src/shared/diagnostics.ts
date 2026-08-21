import { z } from "zod";

import { deliveryFailureReasonSchema } from "./workflow";

export const MAX_DIAGNOSTIC_TIMING_SAMPLES = 200;

const counterSchema = z.number().int().nonnegative().safe();
const durationSchema = z.number().finite().nonnegative();
const timingSummarySchema = z
  .strictObject({
    count: counterSchema.max(MAX_DIAGNOSTIC_TIMING_SAMPLES),
    maximum: durationSchema.nullable(),
    median: durationSchema.nullable(),
    minimum: durationSchema.nullable(),
    p95: durationSchema.nullable(),
  })
  .superRefine((summary, context) => {
    const values = [summary.minimum, summary.median, summary.p95, summary.maximum];
    if (summary.count === 0 && values.some((value) => value !== null)) {
      context.addIssue({ code: "custom", message: "Empty timing summaries cannot claim values." });
      return;
    }
    if (summary.count > 0 && values.some((value) => value === null)) {
      context.addIssue({ code: "custom", message: "Timing samples require complete summaries." });
      return;
    }
    if (
      summary.minimum !== null &&
      summary.median !== null &&
      summary.p95 !== null &&
      summary.maximum !== null &&
      (summary.minimum > summary.median ||
        summary.median > summary.p95 ||
        summary.p95 > summary.maximum)
    ) {
      context.addIssue({ code: "custom", message: "Timing summary order is invalid." });
    }
  })
  .readonly();

export const diagnosticTriggerSchema = z.enum(["button", "shortcut"]);

export const diagnosticDeliveryOutcomeSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("copied") }),
    z.strictObject({ status: z.literal("dispatched-unverified") }),
    z.strictObject({ status: z.literal("staged-verified") }),
    z.strictObject({ status: z.literal("sent-verified") }),
    z.strictObject({ status: z.literal("cancelled") }),
    z.strictObject({ status: z.literal("failed"), reason: deliveryFailureReasonSchema }),
  ])
  .readonly();

const deliveryCountersSchema = z
  .strictObject({
    cancelled: counterSchema,
    copied: counterSchema,
    dispatchedUnverified: counterSchema,
    failures: z
      .strictObject({
        captureFailed: counterSchema,
        clipboardFailed: counterSchema,
        dispatchFailed: counterSchema,
        permissionBlocked: counterSchema,
        targetStale: counterSchema,
        unexpected: counterSchema,
        unsupported: counterSchema,
      })
      .readonly(),
    sentVerified: counterSchema,
    stagedVerified: counterSchema,
  })
  .readonly();

const revealCountersSchema = z
  .strictObject({
    failed: counterSchema,
    revealed: counterSchema,
    stale: counterSchema,
    unavailable: counterSchema,
    unsupported: counterSchema,
  })
  .readonly();

export const diagnosticsSnapshotSchema = z
  .strictObject({
    version: z.literal(1),
    starts: z
      .strictObject({
        button: counterSchema,
        shortcut: counterSchema,
      })
      .readonly(),
    delivery: deliveryCountersSchema,
    reveal: revealCountersSchema,
    timingsMs: z
      .strictObject({
        buttonToSelecting: timingSummarySchema,
        selectionToEditing: timingSummarySchema,
        selectionToResult: timingSummarySchema,
        shortcutToSelecting: timingSummarySchema,
      })
      .readonly(),
  })
  .readonly();

export type DiagnosticDeliveryOutcome = z.infer<typeof diagnosticDeliveryOutcomeSchema>;
export type DiagnosticTrigger = z.infer<typeof diagnosticTriggerSchema>;
export type DiagnosticsSnapshot = z.infer<typeof diagnosticsSnapshotSchema>;

import { z } from "zod";

export const MAX_NOTE_LENGTH = 500;

const NON_SINGLE_LINE_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const boundedIdentifierSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !NON_SINGLE_LINE_CHARACTER.test(value), {
    message: "Identifiers cannot contain controls or line separators.",
  });
export const destinationIdSchema = boundedIdentifierSchema;
const contextLabelSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => {
    return !NON_SINGLE_LINE_CHARACTER.test(value);
  }, "Context labels cannot contain controls or line separators.");

export const operationIdSchema = z.uuidv4();

export const noteSchema = z
  .string()
  .max(MAX_NOTE_LENGTH * 2)
  .refine((value) => Array.from(value).length <= MAX_NOTE_LENGTH, {
    message: `Notes cannot exceed ${MAX_NOTE_LENGTH} Unicode code points.`,
  })
  .refine((value) => !NON_SINGLE_LINE_CHARACTER.test(value), {
    message: "Notes must be one line without controls or line separators.",
  });

const endpointSchema = z
  .strictObject({
    scope: z.enum(["local", "ssh", "wsl", "container"]),
    instanceId: boundedIdentifierSchema,
  })
  .readonly();

const surfaceSchema = z
  .strictObject({
    kind: z.enum(["terminal", "pane", "agent-thread"]),
    locator: boundedIdentifierSchema,
  })
  .readonly();

export const destinationReceiptSchema = z
  .strictObject({
    id: destinationIdSchema,
    adapter: boundedIdentifierSchema,
    surface: surfaceSchema,
  })
  .readonly();

const destinationContextSchema = z
  .strictObject({
    cwd: contextLabelSchema.optional(),
    repoRoot: contextLabelSchema.optional(),
    worktree: contextLabelSchema.optional(),
    revision: contextLabelSchema.optional(),
    observedAt: z.string().datetime({ offset: true }),
  })
  .readonly();

const actionSchema = z.enum(["copy", "stage", "send"]);
const verificationSchema = z.enum([
  "target-live",
  "composer-ready",
  "image-attached",
  "turn-completed",
]);

const capabilitiesSchema = z
  .strictObject({
    address: z.enum(["exact", "best-effort"]),
    imageInput: z.enum(["clipboard-key", "local-file", "remote-file", "structured", "none"]),
    textInput: z.enum(["paste", "structured", "none"]),
    readBack: z.enum(["structured", "screen-text", "none"]),
    verification: z.array(verificationSchema).readonly(),
    actions: z.array(actionSchema).readonly(),
  })
  .superRefine((capabilities, context) => {
    if (new Set(capabilities.actions).size !== capabilities.actions.length) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "Destination actions must be unique.",
      });
    }
    if (new Set(capabilities.verification).size !== capabilities.verification.length) {
      context.addIssue({
        code: "custom",
        path: ["verification"],
        message: "Verification claims must be unique.",
      });
    }
    if (!capabilities.actions.includes("copy")) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "Every destination must retain the Copy fallback.",
      });
    }
    if (
      capabilities.address === "best-effort" &&
      capabilities.actions.some((action) => action !== "copy")
    ) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "Best-effort destinations can expose only Copy.",
      });
    }
    if (
      capabilities.actions.some((action) => action === "stage" || action === "send") &&
      capabilities.imageInput === "none"
    ) {
      context.addIssue({
        code: "custom",
        path: ["imageInput"],
        message: "Stage and Send require an image input capability.",
      });
    }
    if (
      capabilities.actions.some((action) => action === "stage" || action === "send") &&
      !capabilities.verification.includes("target-live")
    ) {
      context.addIssue({
        code: "custom",
        path: ["verification"],
        message: "Stage and Send require live-target verification.",
      });
    }
    if (
      capabilities.verification.some(
        (claim) => claim !== "target-live" && capabilities.readBack === "none",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["verification"],
        message: "Composer and completion verification require read-back.",
      });
    }
    if (
      capabilities.actions.includes("send") &&
      (!capabilities.verification.includes("composer-ready") ||
        !capabilities.verification.includes("image-attached") ||
        !capabilities.verification.includes("turn-completed"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["verification"],
        message: "Send requires composer-ready, image-attached, and turn-completed verification.",
      });
    }
  })
  .readonly();

export const destinationSchema = z
  .strictObject({
    id: destinationIdSchema,
    adapter: boundedIdentifierSchema,
    endpoint: endpointSchema,
    surface: surfaceSchema,
    context: destinationContextSchema.optional(),
    capabilities: capabilitiesSchema,
  })
  .readonly();

export const destinationListSchema = z.array(destinationSchema).max(512).readonly();

export type Destination = z.infer<typeof destinationSchema>;
export type DestinationInput = z.input<typeof destinationSchema>;
export type DestinationReceipt = z.infer<typeof destinationReceiptSchema>;
export type Note = z.infer<typeof noteSchema>;
export type OperationId = z.infer<typeof operationIdSchema>;

export function parseDestination(input: DestinationInput): Destination {
  return destinationSchema.parse(input);
}

export function receiptForDestination(destination: Destination): DestinationReceipt {
  return destinationReceiptSchema.parse({
    id: destination.id,
    adapter: destination.adapter,
    surface: destination.surface,
  });
}

export function parseNote(input: z.input<typeof noteSchema>): Note {
  return noteSchema.parse(input);
}

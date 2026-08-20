import { z } from "zod";

import { operationIdSchema } from "./domain";

export const MAX_CAPTURE_PREVIEW_BYTES = 20 * 1024 * 1024;

const previewSchema = z
  .instanceof(Uint8Array)
  .refine((value) => value.byteLength > 0 && value.byteLength <= MAX_CAPTURE_PREVIEW_BYTES, {
    message: "Capture previews must be non-empty and bounded.",
  });

export const dipSelectionSchema = z
  .strictObject({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .readonly();

const pixelSizeSchema = z
  .strictObject({
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
  })
  .readonly();

export const captureDisplaySchema = z
  .strictObject({
    id: z.string().min(1).max(128),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    scaleFactor: z.number().finite().positive(),
    rotation: z.number().int(),
  })
  .readonly();

export const captureOverlaySnapshotSchema = z
  .strictObject({
    operationId: operationIdSchema,
    display: captureDisplaySchema,
    returnedPixels: pixelSizeSchema,
    preview: previewSchema,
  })
  .readonly();

export const captureDraftSchema = z
  .strictObject({
    operationId: operationIdSchema,
    selection: dipSelectionSchema,
    pixels: pixelSizeSchema,
    preview: previewSchema,
  })
  .readonly();

export const captureSelectionRequestSchema = z
  .strictObject({
    operationId: operationIdSchema,
    selection: dipSelectionSchema,
  })
  .readonly();

export type CaptureDraft = z.infer<typeof captureDraftSchema>;
export type CaptureDisplayInput = z.input<typeof captureDisplaySchema>;
export type CaptureOverlaySnapshot = z.infer<typeof captureOverlaySnapshotSchema>;
export type CaptureSelectionRequest = z.infer<typeof captureSelectionRequestSchema>;
export type DipSelectionInput = z.input<typeof dipSelectionSchema>;

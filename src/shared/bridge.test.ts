import { describe, expect, it } from "vitest";

import { operationRequestSchema, shortcutStatusSchema, stageCaptureRequestSchema } from "./bridge";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("workflow IPC request contract", () => {
  it("accepts a strict UUIDv4 operation request", () => {
    expect(operationRequestSchema.parse({ operationId: OPERATION_ID })).toEqual({
      operationId: OPERATION_ID,
    });
  });

  it.each([{}, { operationId: "not-a-uuid" }, { operationId: OPERATION_ID, extra: "not-allowed" }])(
    "rejects malformed or expanded payloads",
    (payload) => {
      expect(operationRequestSchema.safeParse(payload).success).toBe(false);
    },
  );
});

describe("Stage IPC request contract", () => {
  it("accepts only an operation-bound destination ID and a valid optional note", () => {
    expect(
      stageCaptureRequestSchema.parse({
        operationId: OPERATION_ID,
        destinationId: "wezterm:generation:7",
        note: "literal context",
      }),
    ).toEqual({
      operationId: OPERATION_ID,
      destinationId: "wezterm:generation:7",
      note: "literal context",
    });
    expect(
      stageCaptureRequestSchema.safeParse({
        operationId: OPERATION_ID,
        destinationId: "wezterm:generation:7",
        note: "two\nlines",
      }).success,
    ).toBe(false);
    expect(
      stageCaptureRequestSchema.safeParse({
        operationId: OPERATION_ID,
        destinationId: "wezterm:generation:7",
        note: null,
        executable: "/untrusted/renderer/path",
      }).success,
    ).toBe(false);
  });
});

describe("shortcut status contract", () => {
  it("reports an explicit accelerator conflict without extra fields", () => {
    expect(
      shortcutStatusSchema.parse({ accelerator: "CommandOrControl+Shift+9", registered: false }),
    ).toEqual({ accelerator: "CommandOrControl+Shift+9", registered: false });
    expect(
      shortcutStatusSchema.safeParse({
        accelerator: "CommandOrControl+Shift+9",
        registered: true,
        fallback: "active-window",
      }).success,
    ).toBe(false);
  });
});

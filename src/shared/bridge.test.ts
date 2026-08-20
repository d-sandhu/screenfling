import { describe, expect, it } from "vitest";

import { operationRequestSchema, shortcutStatusSchema } from "./bridge";

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

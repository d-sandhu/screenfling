import { describe, expect, it } from "vitest";

import { operationRequestSchema } from "./bridge";

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

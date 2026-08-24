import { describe, expect, it } from "vitest";

import {
  MAX_DIAGNOSTIC_TIMING_SAMPLES,
  diagnosticDeliveryOutcomeSchema,
  diagnosticsSnapshotSchema,
} from "./diagnostics";

const EMPTY_TIMING = {
  count: 0,
  maximum: null,
  median: null,
  minimum: null,
  p95: null,
} as const;

const EMPTY_SNAPSHOT = {
  version: 2,
  starts: { button: 0, shortcut: 0 },
  delivery: {
    cancelled: 0,
    copied: 0,
    dispatchedUnverified: 0,
    failures: {
      captureFailed: 0,
      clipboardFailed: 0,
      dispatchFailed: 0,
      permissionBlocked: 0,
      targetStale: 0,
      unexpected: 0,
      unsupported: 0,
    },
    sentVerified: 0,
    stagedVerified: 0,
  },
  reveal: { failed: 0, revealed: 0, stale: 0, unavailable: 0, unsupported: 0 },
  timingsMs: {
    buttonToSelecting: EMPTY_TIMING,
    mainHiddenToOverlayPrepared: EMPTY_TIMING,
    mainHiddenToSnapshotReady: EMPTY_TIMING,
    selectionToEditing: EMPTY_TIMING,
    selectionToResult: EMPTY_TIMING,
    shortcutToSelecting: EMPTY_TIMING,
    startToMainHidden: EMPTY_TIMING,
    startupJoinedToSelecting: EMPTY_TIMING,
  },
} as const;

describe("sanitized diagnostics contract", () => {
  it("accepts one fixed, operation-free snapshot", () => {
    expect(diagnosticsSnapshotSchema.parse(EMPTY_SNAPSHOT)).toEqual(EMPTY_SNAPSHOT);
    expect(MAX_DIAGNOSTIC_TIMING_SAMPLES).toBe(200);
  });

  it("rejects content, identities, extra fields, and inconsistent timing claims", () => {
    expect(
      diagnosticsSnapshotSchema.safeParse({ ...EMPTY_SNAPSHOT, note: "private context" }).success,
    ).toBe(false);
    expect(
      diagnosticsSnapshotSchema.safeParse({
        ...EMPTY_SNAPSHOT,
        operationId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(false);
    expect(
      diagnosticsSnapshotSchema.safeParse({
        ...EMPTY_SNAPSHOT,
        timingsMs: {
          ...EMPTY_SNAPSHOT.timingsMs,
          buttonToSelecting: {
            count: 1,
            maximum: null,
            median: null,
            minimum: null,
            p95: null,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only sanitized delivery outcomes", () => {
    expect(diagnosticDeliveryOutcomeSchema.parse({ status: "copied" })).toEqual({
      status: "copied",
    });
    expect(
      diagnosticDeliveryOutcomeSchema.parse({ status: "failed", reason: "target-stale" }),
    ).toEqual({ status: "failed", reason: "target-stale" });
    expect(
      diagnosticDeliveryOutcomeSchema.safeParse({
        status: "dispatched-unverified",
        destination: { id: "private-route" },
      }).success,
    ).toBe(false);
  });
});

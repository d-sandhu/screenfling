import { describe, expect, it } from "vitest";

import { WorkflowDiagnostics } from "./workflow-diagnostics";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_OPERATION_ID = "a6f35ec1-15d7-4c64-9843-0b97a10d20ef";

function operationId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

describe("workflow diagnostics", () => {
  it("aggregates sanitized lifecycle timings and result categories", () => {
    let now = 10;
    const diagnostics = new WorkflowDiagnostics(() => now);
    diagnostics.begin(OPERATION_ID, "button");
    now = 25;
    diagnostics.mark(OPERATION_ID, "selecting");
    now = 30;
    diagnostics.mark(OPERATION_ID, "selection-complete");
    now = 35;
    diagnostics.mark(OPERATION_ID, "editing");
    now = 50;
    diagnostics.finish(OPERATION_ID, { status: "copied" });
    diagnostics.recordReveal({ status: "stale" });

    const snapshot = diagnostics.snapshot();
    expect(snapshot.starts).toEqual({ button: 1, shortcut: 0 });
    expect(snapshot.delivery.copied).toBe(1);
    expect(snapshot.reveal.stale).toBe(1);
    expect(snapshot.timingsMs).toMatchObject({
      buttonToSelecting: { count: 1, minimum: 15, median: 15, p95: 15, maximum: 15 },
      selectionToEditing: { count: 1, minimum: 5, median: 5, p95: 5, maximum: 5 },
      selectionToResult: { count: 1, minimum: 20, median: 20, p95: 20, maximum: 20 },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /operationId|destination|note|image|clipboard(?:Bytes|Content|Text)/iu,
    );
  });

  it("records every fixed delivery and Reveal category without retaining content", () => {
    let now = 0;
    const diagnostics = new WorkflowDiagnostics(() => now);
    const outcomes = [
      { status: "dispatched-unverified" },
      { status: "staged-verified" },
      { status: "sent-verified" },
      { status: "cancelled" },
      { status: "failed", reason: "permission-blocked" },
      { status: "failed", reason: "capture-failed" },
      { status: "failed", reason: "clipboard-failed" },
      { status: "failed", reason: "target-stale" },
      { status: "failed", reason: "unsupported" },
      { status: "failed", reason: "dispatch-failed" },
      { status: "failed", reason: "unexpected" },
    ] as const;

    for (const [index, outcome] of outcomes.entries()) {
      now += 1;
      const id = operationId(index);
      diagnostics.begin(id, "shortcut");
      diagnostics.finish(id, outcome);
    }
    for (const status of ["revealed", "stale", "unavailable", "unsupported", "failed"] as const) {
      diagnostics.recordReveal({ status });
    }

    const snapshot = diagnostics.snapshot();
    expect(snapshot.starts.shortcut).toBe(outcomes.length);
    expect(snapshot.delivery).toMatchObject({
      cancelled: 1,
      copied: 0,
      dispatchedUnverified: 1,
      failures: {
        captureFailed: 1,
        clipboardFailed: 1,
        dispatchFailed: 1,
        permissionBlocked: 1,
        targetStale: 1,
        unexpected: 1,
        unsupported: 1,
      },
      sentVerified: 1,
      stagedVerified: 1,
    });
    expect(snapshot.reveal).toEqual({
      failed: 1,
      revealed: 1,
      stale: 1,
      unavailable: 1,
      unsupported: 1,
    });
  });

  it("ignores stale completion, duplicate finish, and invalid durations", () => {
    let now = 100;
    const diagnostics = new WorkflowDiagnostics(() => now);
    diagnostics.begin(OPERATION_ID, "button");
    diagnostics.begin(OTHER_OPERATION_ID, "shortcut");
    diagnostics.finish(OPERATION_ID, { status: "copied" });
    now = 90;
    diagnostics.mark(OTHER_OPERATION_ID, "selecting");
    diagnostics.mark(OTHER_OPERATION_ID, "selection-complete");
    now = Number.NaN;
    diagnostics.mark(OTHER_OPERATION_ID, "editing");
    diagnostics.finish(OTHER_OPERATION_ID, { status: "cancelled" });
    diagnostics.finish(OTHER_OPERATION_ID, { status: "copied" });

    const snapshot = diagnostics.snapshot();
    expect(snapshot.delivery.cancelled).toBe(1);
    expect(snapshot.delivery.copied).toBe(0);
    expect(snapshot.timingsMs.shortcutToSelecting.count).toBe(0);
    expect(snapshot.timingsMs.selectionToEditing.count).toBe(0);
    expect(snapshot.timingsMs.selectionToResult.count).toBe(0);
  });

  it("retains only the newest 200 samples in each timing stream", () => {
    let now = 0;
    const diagnostics = new WorkflowDiagnostics(() => now);
    for (let index = 1; index <= 205; index += 1) {
      const id = operationId(index);
      diagnostics.begin(id, "button");
      now += index;
      diagnostics.mark(id, "selecting");
      diagnostics.finish(id, { status: "cancelled" });
    }

    expect(diagnostics.snapshot().timingsMs.buttonToSelecting).toEqual({
      count: 200,
      maximum: 205,
      median: 105,
      minimum: 6,
      p95: 195,
    });
  });
});

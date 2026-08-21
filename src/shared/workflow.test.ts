import { describe, expect, it } from "vitest";

import {
  IDLE_WORKFLOW,
  InvalidWorkflowTransitionError,
  StaleWorkflowActionError,
  advanceWorkflow,
  cancelWorkflow,
  finishWorkflow,
  revealResultSchema,
  resetWorkflow,
  startWorkflow,
} from "./workflow";

import type { ActiveWorkflowPhase, WorkflowSnapshot } from "./workflow";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const STALE_OPERATION_ID = "8b2165ea-699b-44f1-a497-95df2f997834";
const DESTINATION_RECEIPT = {
  id: "instrumented:7",
  adapter: "instrumented",
  surface: { kind: "pane", locator: "7" },
} as const;

function advanceThrough(
  initial: WorkflowSnapshot,
  phases: readonly ActiveWorkflowPhase[],
): WorkflowSnapshot {
  let snapshot = initial;
  for (const phase of phases) {
    snapshot = advanceWorkflow(snapshot, OPERATION_ID, phase);
  }
  return snapshot;
}

describe("workflow state machine", () => {
  it("runs the explicit Stage path and resets only after a result", () => {
    const started = startWorkflow(IDLE_WORKFLOW, OPERATION_ID);
    const staging = advanceThrough(started, [
      "selecting",
      "editing",
      "target-selected",
      "writing-clipboard",
      "staging",
    ]);
    const result = finishWorkflow(staging, OPERATION_ID, {
      status: "staged-verified",
      destination: DESTINATION_RECEIPT,
    });

    expect(result).toEqual({
      phase: "result",
      operationId: OPERATION_ID,
      result: { status: "staged-verified", destination: DESTINATION_RECEIPT },
    });
    expect(resetWorkflow(result, OPERATION_ID)).toBe(IDLE_WORKFLOW);
  });

  it("supports an honest unverified Stage result after the one adapter transaction", () => {
    const staging = advanceThrough(startWorkflow(IDLE_WORKFLOW, OPERATION_ID), [
      "selecting",
      "editing",
      "target-selected",
      "writing-clipboard",
      "staging",
    ]);
    expect(
      finishWorkflow(staging, OPERATION_ID, {
        status: "dispatched-unverified",
        destination: DESTINATION_RECEIPT,
      }),
    ).toMatchObject({ phase: "result" });
  });

  it("permits Copy only after the clipboard write", () => {
    const writingClipboard = advanceThrough(startWorkflow(IDLE_WORKFLOW, OPERATION_ID), [
      "selecting",
      "editing",
      "writing-clipboard",
    ]);
    expect(finishWorkflow(writingClipboard, OPERATION_ID, { status: "copied" })).toMatchObject({
      result: { status: "copied" },
    });
  });

  it("keeps exact-target validation on the Stage branch", () => {
    const editing = advanceThrough(startWorkflow(IDLE_WORKFLOW, OPERATION_ID), [
      "selecting",
      "editing",
    ]);
    expect(advanceWorkflow(editing, OPERATION_ID, "target-selected")).toMatchObject({
      phase: "target-selected",
    });
    expect(() => advanceWorkflow(editing, OPERATION_ID, "staging")).toThrow(
      InvalidWorkflowTransitionError,
    );
  });

  it("rejects a second start and skipped transitions", () => {
    const started = startWorkflow(IDLE_WORKFLOW, OPERATION_ID);
    expect(() => startWorkflow(started, STALE_OPERATION_ID)).toThrow(
      InvalidWorkflowTransitionError,
    );
    expect(() => advanceWorkflow(started, OPERATION_ID, "editing")).toThrow(
      InvalidWorkflowTransitionError,
    );
  });

  it("rejects malformed operation IDs", () => {
    expect(() => startWorkflow(IDLE_WORKFLOW, "operation-1")).toThrow();
  });

  it("rejects stale actions without changing the current workflow", () => {
    const started = startWorkflow(IDLE_WORKFLOW, OPERATION_ID);
    expect(() => advanceWorkflow(started, STALE_OPERATION_ID, "selecting")).toThrow(
      StaleWorkflowActionError,
    );
    expect(started).toEqual({ phase: "snapshotting", operationId: OPERATION_ID });
  });

  it("allows cancellation from an active state but not from idle", () => {
    const started = startWorkflow(IDLE_WORKFLOW, OPERATION_ID);
    expect(cancelWorkflow(started, OPERATION_ID)).toMatchObject({
      phase: "result",
      result: { status: "cancelled" },
    });
    expect(() => cancelWorkflow(IDLE_WORKFLOW, OPERATION_ID)).toThrow(
      InvalidWorkflowTransitionError,
    );
  });

  it("does not claim cancellation after the Stage branch begins", () => {
    const targetSelected = advanceThrough(startWorkflow(IDLE_WORKFLOW, OPERATION_ID), [
      "selecting",
      "editing",
      "target-selected",
    ]);
    const writingClipboard = advanceWorkflow(targetSelected, OPERATION_ID, "writing-clipboard");
    const staging = advanceWorkflow(writingClipboard, OPERATION_ID, "staging");

    expect(() => cancelWorkflow(targetSelected, OPERATION_ID)).toThrow(
      InvalidWorkflowTransitionError,
    );
    expect(() => cancelWorkflow(writingClipboard, OPERATION_ID)).toThrow(
      InvalidWorkflowTransitionError,
    );
    expect(() => cancelWorkflow(staging, OPERATION_ID)).toThrow(InvalidWorkflowTransitionError);
  });

  it("records permission denial as a bounded failure category", () => {
    const started = startWorkflow(IDLE_WORKFLOW, OPERATION_ID);
    expect(
      finishWorkflow(started, OPERATION_ID, {
        status: "failed",
        reason: "permission-blocked",
      }),
    ).toMatchObject({ result: { reason: "permission-blocked" } });
  });

  it("does not permit Send before a verified Send phase exists", () => {
    const staging = advanceThrough(startWorkflow(IDLE_WORKFLOW, OPERATION_ID), [
      "selecting",
      "editing",
      "target-selected",
      "writing-clipboard",
      "staging",
    ]);
    expect(() =>
      finishWorkflow(staging, OPERATION_ID, {
        status: "sent-verified",
        destination: DESTINATION_RECEIPT,
      }),
    ).toThrow(InvalidWorkflowTransitionError);
  });
});

describe("Reveal result contract", () => {
  it.each(["revealed", "stale", "unavailable", "unsupported", "failed"] as const)(
    "accepts the bounded %s outcome",
    (status) => {
      expect(revealResultSchema.parse({ status })).toEqual({ status });
    },
  );

  it("rejects expanded Reveal claims", () => {
    expect(
      revealResultSchema.safeParse({ status: "revealed", foregroundVerified: true }).success,
    ).toBe(false);
  });
});

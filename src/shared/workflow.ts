import { z } from "zod";

import { destinationReceiptSchema, operationIdSchema } from "./domain";

export const activeWorkflowPhaseSchema = z.enum([
  "snapshotting",
  "selecting",
  "editing",
  "target-selected",
  "writing-clipboard",
  "staging",
]);

export const deliveryResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("copied") }),
    z.strictObject({
      status: z.literal("dispatched-unverified"),
      destination: destinationReceiptSchema,
    }),
    z.strictObject({
      status: z.literal("staged-verified"),
      destination: destinationReceiptSchema,
    }),
    z.strictObject({
      status: z.literal("sent-verified"),
      destination: destinationReceiptSchema,
    }),
    z.strictObject({
      status: z.literal("failed"),
      reason: z.enum([
        "permission-blocked",
        "capture-failed",
        "clipboard-failed",
        "target-stale",
        "unsupported",
        "dispatch-failed",
        "unexpected",
      ]),
    }),
    z.strictObject({ status: z.literal("cancelled") }),
  ])
  .readonly();

export const revealResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("revealed") }),
    z.strictObject({ status: z.literal("stale") }),
    z.strictObject({ status: z.literal("unavailable") }),
    z.strictObject({ status: z.literal("unsupported") }),
    z.strictObject({ status: z.literal("failed") }),
  ])
  .readonly();

const idleWorkflowSchema = z.strictObject({ phase: z.literal("idle") });
const activeWorkflowSchema = z.strictObject({
  phase: activeWorkflowPhaseSchema,
  operationId: operationIdSchema,
});
const resultWorkflowSchema = z.strictObject({
  phase: z.literal("result"),
  operationId: operationIdSchema,
  result: deliveryResultSchema,
});

export const workflowSnapshotSchema = z
  .union([idleWorkflowSchema, activeWorkflowSchema, resultWorkflowSchema])
  .readonly();

export type ActiveWorkflowPhase = z.infer<typeof activeWorkflowPhaseSchema>;
export type DeliveryResult = z.infer<typeof deliveryResultSchema>;
export type RevealResult = z.infer<typeof revealResultSchema>;
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;

export const IDLE_WORKFLOW: WorkflowSnapshot = workflowSnapshotSchema.parse({
  phase: "idle",
});

export class InvalidWorkflowTransitionError extends Error {
  constructor() {
    super("The requested workflow transition is not allowed.");
    this.name = "InvalidWorkflowTransitionError";
  }
}

export class StaleWorkflowActionError extends Error {
  constructor() {
    super("The workflow action is stale.");
    this.name = "StaleWorkflowActionError";
  }
}

function canAdvanceTo(phase: ActiveWorkflowPhase, targetPhase: ActiveWorkflowPhase): boolean {
  switch (phase) {
    case "snapshotting":
      return targetPhase === "selecting";
    case "selecting":
      return targetPhase === "editing";
    case "editing":
      return targetPhase === "target-selected" || targetPhase === "writing-clipboard";
    case "target-selected":
      return targetPhase === "writing-clipboard";
    case "writing-clipboard":
      return targetPhase === "staging";
    case "staging":
      return false;
  }
}

function requireActiveOperation(
  snapshot: WorkflowSnapshot,
  operationId: string,
): Extract<
  WorkflowSnapshot,
  { readonly operationId: string; readonly phase: ActiveWorkflowPhase }
> {
  if (snapshot.phase === "idle" || snapshot.phase === "result") {
    throw new InvalidWorkflowTransitionError();
  }
  if (snapshot.operationId !== operationId) throw new StaleWorkflowActionError();
  return snapshot;
}

function isAllowedResult(phase: ActiveWorkflowPhase, result: DeliveryResult): boolean {
  if (result.status === "failed" || result.status === "cancelled") return true;
  if (result.status === "copied") return phase === "writing-clipboard";
  if (result.status === "sent-verified") return false;
  return phase === "staging";
}

export function startWorkflow(snapshot: WorkflowSnapshot, operationId: string): WorkflowSnapshot {
  if (snapshot.phase !== "idle") throw new InvalidWorkflowTransitionError();
  return workflowSnapshotSchema.parse({
    phase: "snapshotting",
    operationId: operationIdSchema.parse(operationId),
  });
}

export function advanceWorkflow(
  snapshot: WorkflowSnapshot,
  operationId: string,
  targetPhase: ActiveWorkflowPhase,
): WorkflowSnapshot {
  const active = requireActiveOperation(snapshot, operationId);
  if (!canAdvanceTo(active.phase, targetPhase)) {
    throw new InvalidWorkflowTransitionError();
  }
  return workflowSnapshotSchema.parse({ phase: targetPhase, operationId });
}

export function finishWorkflow(
  snapshot: WorkflowSnapshot,
  operationId: string,
  result: DeliveryResult,
): WorkflowSnapshot {
  const active = requireActiveOperation(snapshot, operationId);
  if (!isAllowedResult(active.phase, result)) {
    throw new InvalidWorkflowTransitionError();
  }
  return workflowSnapshotSchema.parse({ phase: "result", operationId, result });
}

export function cancelWorkflow(snapshot: WorkflowSnapshot, operationId: string): WorkflowSnapshot {
  if (
    snapshot.phase === "target-selected" ||
    snapshot.phase === "writing-clipboard" ||
    snapshot.phase === "staging"
  ) {
    throw new InvalidWorkflowTransitionError();
  }
  return finishWorkflow(snapshot, operationId, { status: "cancelled" });
}

export function resetWorkflow(snapshot: WorkflowSnapshot, operationId: string): WorkflowSnapshot {
  if (snapshot.phase !== "result") throw new InvalidWorkflowTransitionError();
  if (snapshot.operationId !== operationId) throw new StaleWorkflowActionError();
  return IDLE_WORKFLOW;
}

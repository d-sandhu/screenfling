import {
  IDLE_WORKFLOW,
  advanceWorkflow,
  cancelWorkflow,
  finishWorkflow,
  resetWorkflow,
  startWorkflow,
} from "../shared/workflow";

import type { ActiveWorkflowPhase, DeliveryResult, WorkflowSnapshot } from "../shared/workflow";

export class WorkflowStore {
  #snapshot: WorkflowSnapshot = IDLE_WORKFLOW;

  get snapshot(): WorkflowSnapshot {
    return this.#snapshot;
  }

  start(operationId: string): WorkflowSnapshot {
    this.#snapshot = startWorkflow(this.#snapshot, operationId);
    return this.#snapshot;
  }

  advance(operationId: string, targetPhase: ActiveWorkflowPhase): WorkflowSnapshot {
    this.#snapshot = advanceWorkflow(this.#snapshot, operationId, targetPhase);
    return this.#snapshot;
  }

  finish(operationId: string, result: DeliveryResult): WorkflowSnapshot {
    this.#snapshot = finishWorkflow(this.#snapshot, operationId, result);
    return this.#snapshot;
  }

  cancel(operationId: string): WorkflowSnapshot {
    this.#snapshot = cancelWorkflow(this.#snapshot, operationId);
    return this.#snapshot;
  }

  dismissResult(operationId: string): WorkflowSnapshot {
    this.#snapshot = resetWorkflow(this.#snapshot, operationId);
    return this.#snapshot;
  }
}

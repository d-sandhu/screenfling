import { operationRequestSchema } from "../shared/bridge";

import type { WorkflowSnapshot } from "../shared/workflow";

type SerializedIpcRecord = {
  readonly [key: string]: SerializedIpcValue;
};

export type SerializedIpcValue =
  null | boolean | number | string | readonly SerializedIpcValue[] | SerializedIpcRecord;

type OperationAuthorizer<Event> = (event: Event) => void;
type OperationAction = (operationId: string) => WorkflowSnapshot;
type ValidatedOperationHandler<Event> = (
  event: Event,
  ...payloads: SerializedIpcValue[]
) => WorkflowSnapshot;

export function createValidatedOperationHandler<Event>(
  authorize: OperationAuthorizer<Event>,
  action: OperationAction,
): ValidatedOperationHandler<Event> {
  return (event, ...payloads) => {
    authorize(event);
    if (payloads.length !== 1) throw new Error("Invalid workflow request.");

    const request = operationRequestSchema.safeParse(payloads[0]);
    if (!request.success) throw new Error("Invalid workflow request.");
    return action(request.data.operationId);
  };
}

import { operationRequestSchema } from "../shared/bridge";
import { shortcutConfigurationSchema } from "../shared/shortcut";

import type { ShortcutConfiguration } from "../shared/shortcut";

type SerializedIpcRecord = {
  readonly [key: string]: SerializedIpcValue;
};

export type SerializedIpcValue =
  null | boolean | number | string | readonly SerializedIpcValue[] | SerializedIpcRecord;

type OperationAuthorizer<Event> = (event: Event) => void;
type OperationAction<Result> = (operationId: string) => Result;
type ValidatedOperationHandler<Event, Result> = (
  event: Event,
  ...payloads: SerializedIpcValue[]
) => Result;

export function createValidatedOperationHandler<Event, Result>(
  authorize: OperationAuthorizer<Event>,
  action: OperationAction<Result>,
): ValidatedOperationHandler<Event, Result> {
  return (event, ...payloads) => {
    authorize(event);
    if (payloads.length !== 1) throw new Error("Invalid workflow request.");

    const request = operationRequestSchema.safeParse(payloads[0]);
    if (!request.success) throw new Error("Invalid workflow request.");
    return action(request.data.operationId);
  };
}

type NoPayloadAction<Result> = () => Result;
type AuthorizedNoPayloadHandler<Event, Result> = (
  event: Event,
  ...payloads: SerializedIpcValue[]
) => Result;

export function createAuthorizedNoPayloadHandler<Event, Result>(
  authorize: OperationAuthorizer<Event>,
  action: NoPayloadAction<Result>,
): AuthorizedNoPayloadHandler<Event, Result> {
  return (event, ...payloads) => {
    authorize(event);
    if (payloads.length !== 0) throw new Error("Invalid empty workflow request.");
    return action();
  };
}

type ShortcutAction<Result> = (configuration: ShortcutConfiguration) => Result;

export function createValidatedShortcutHandler<Event, Result>(
  authorize: OperationAuthorizer<Event>,
  action: ShortcutAction<Result>,
): ValidatedOperationHandler<Event, Result> {
  return (event, ...payloads) => {
    authorize(event);
    if (payloads.length !== 1) throw new Error("Invalid shortcut request.");

    const request = shortcutConfigurationSchema.safeParse(payloads[0]);
    if (!request.success) throw new Error("Invalid shortcut request.");
    return action(request.data);
  };
}

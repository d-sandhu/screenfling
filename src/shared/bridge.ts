import { z } from "zod";

import { operationIdSchema } from "./domain";

import type { WorkflowSnapshot } from "./workflow";

export const BRIDGE_VERSION = 2;

export const IPC_CHANNELS = Object.freeze({
  cancelOperation: "workflow:cancel-operation",
  dismissResult: "workflow:dismiss-result",
});

export const operationRequestSchema = z.strictObject({ operationId: operationIdSchema }).readonly();

export type OperationRequest = z.infer<typeof operationRequestSchema>;
export type WorkflowIpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type ScreenFlingBridge = {
  readonly apiVersion: typeof BRIDGE_VERSION;
  readonly cancelOperation: (request: OperationRequest) => Promise<WorkflowSnapshot>;
  readonly dismissResult: (request: OperationRequest) => Promise<WorkflowSnapshot>;
};

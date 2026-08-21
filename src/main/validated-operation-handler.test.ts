import { describe, expect, it } from "vitest";

import { StaleWorkflowActionError } from "../shared/workflow";
import {
  createAuthorizedNoPayloadHandler,
  createValidatedOperationHandler,
  createValidatedShortcutHandler,
} from "./validated-operation-handler";
import { WorkflowStore } from "./workflow-store";

import type { SerializedIpcValue } from "./validated-operation-handler";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const STALE_OPERATION_ID = "8b2165ea-699b-44f1-a497-95df2f997834";

describe("validated workflow operation handler", () => {
  it("authorizes before parsing or running an operation", () => {
    const calls: string[] = [];
    const handler = createValidatedOperationHandler(
      (event: string) => {
        calls.push(`authorize:${event}`);
        if (event !== "trusted") throw new Error("untrusted");
      },
      (operationId) => {
        calls.push(`operate:${operationId}`);
        return { phase: "idle" };
      },
    );

    expect(() => handler("untrusted", { operationId: "malformed" })).toThrow("untrusted");
    expect(calls).toEqual(["authorize:untrusted"]);
  });

  it("rejects malformed positional payloads", () => {
    const invalidPayloads: readonly (readonly SerializedIpcValue[])[] = [
      [],
      [{ operationId: "malformed" }],
      [{ operationId: OPERATION_ID, extra: true }],
      [{ operationId: OPERATION_ID }, null],
    ];
    let operationRan = false;
    const handler = createValidatedOperationHandler(
      (_event: string) => undefined,
      () => {
        operationRan = true;
        return { phase: "idle" };
      },
    );

    for (const payloads of invalidPayloads) {
      expect(() => handler("trusted", ...payloads)).toThrow("Invalid workflow request.");
    }
    expect(operationRan).toBe(false);
  });

  it("passes one validated operation ID to the requested action", () => {
    let receivedOperationId = "";
    const handler = createValidatedOperationHandler(
      (_event: string) => undefined,
      (operationId) => {
        receivedOperationId = operationId;
        return { phase: "idle" };
      },
    );

    expect(handler("trusted", { operationId: OPERATION_ID })).toEqual({
      phase: "idle",
    });
    expect(receivedOperationId).toBe(OPERATION_ID);
  });

  it("preserves stale-operation rejection from the main-owned store", () => {
    const workflow = new WorkflowStore();
    workflow.start(OPERATION_ID);
    const handler = createValidatedOperationHandler(
      (_event: string) => undefined,
      (operationId) => workflow.cancel(operationId),
    );

    expect(() => handler("trusted", { operationId: STALE_OPERATION_ID })).toThrow(
      StaleWorkflowActionError,
    );
    expect(workflow.snapshot).toMatchObject({ operationId: OPERATION_ID });
  });
});

describe("authorized no-payload handler", () => {
  it("authorizes and rejects hidden positional input", () => {
    const calls: string[] = [];
    const handler = createAuthorizedNoPayloadHandler(
      (event: string) => calls.push(`authorize:${event}`),
      () => {
        calls.push("action");
        return { phase: "idle" };
      },
    );

    expect(handler("trusted")).toEqual({ phase: "idle" });
    expect(() => handler("trusted", null)).toThrow("Invalid empty workflow request.");
    expect(calls).toEqual(["authorize:trusted", "action", "authorize:trusted"]);
  });
});

describe("validated shortcut handler", () => {
  it("authorizes, rejects expanded input, and passes one portable configuration", () => {
    const calls: string[] = [];
    const handler = createValidatedShortcutHandler(
      (event: string) => {
        calls.push(`authorize:${event}`);
        if (event !== "trusted") throw new Error("untrusted");
      },
      (configuration) => {
        calls.push(`set:${configuration.modifiers}+${configuration.key}`);
        return { outcome: "updated" };
      },
    );

    expect(() => handler("untrusted", { key: "A", modifiers: "Shift" })).toThrow("untrusted");
    expect(() =>
      handler("trusted", {
        extra: true,
        key: "A",
        modifiers: "CommandOrControl+Shift",
      }),
    ).toThrow("Invalid shortcut request.");
    expect(handler("trusted", { key: "A", modifiers: "CommandOrControl+Shift" })).toEqual({
      outcome: "updated",
    });
    expect(calls).toEqual([
      "authorize:untrusted",
      "authorize:trusted",
      "authorize:trusted",
      "set:CommandOrControl+Shift+A",
    ]);
  });
});

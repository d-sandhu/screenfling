import { describe, expect, it } from "vitest";

import { parseDestination, parseNote } from "../shared/domain";
import { adapterStageResultSchema } from "./destination-adapter";
import { stageDestination } from "./stage-destination";

import type {
  AdapterStageRequest,
  AdapterStageResult,
  DestinationAdapter,
} from "./destination-adapter";

const selected = parseDestination({
  id: "instrumented:7",
  adapter: "instrumented",
  endpoint: { scope: "local", instanceId: "instance-generation-a" },
  surface: { kind: "pane", locator: "7" },
  context: {
    cwd: "/same/path",
    observedAt: "2026-08-20T12:00:00.000Z",
  },
  capabilities: {
    address: "exact",
    imageInput: "clipboard-key",
    textInput: "paste",
    readBack: "none",
    verification: ["target-live"],
    actions: ["copy", "stage"],
  },
});
const destinationReceipt = {
  id: selected.id,
  adapter: selected.adapter,
  surface: selected.surface,
};

function createAdapter(
  stageResult: AdapterStageResult,
  stageRequests: AdapterStageRequest[],
): DestinationAdapter {
  return {
    id: "instrumented",
    discover: async () => [selected],
    stageIfCurrent: async (request) => {
      stageRequests.push(request);
      return stageResult;
    },
  };
}

describe("destination staging orchestration", () => {
  it("delegates one final-currentness transaction with the exact selected route", async () => {
    const stageRequests: AdapterStageRequest[] = [];
    const adapter = createAdapter({ status: "dispatched-unverified" }, stageRequests);

    await expect(stageDestination(adapter, selected, parseNote("literal note"))).resolves.toEqual({
      status: "dispatched-unverified",
      destination: destinationReceipt,
    });
    expect(stageRequests).toEqual([{ destination: selected, note: "literal note" }]);
  });

  it.each([
    [{ status: "stale" }, "target-stale"],
    [{ status: "permission-blocked" }, "permission-blocked"],
    [{ status: "failed" }, "dispatch-failed"],
  ] satisfies readonly (readonly [
    AdapterStageResult,
    "target-stale" | "permission-blocked" | "dispatch-failed",
  ])[])("fails closed when the adapter transaction returns %j", async (stageResult, reason) => {
    const stageRequests: AdapterStageRequest[] = [];

    await expect(
      stageDestination(createAdapter(stageResult, stageRequests), selected, null),
    ).resolves.toEqual({ status: "failed", reason });
    expect(stageRequests).toHaveLength(1);
  });

  it("lets the adapter refuse a route that changed at the final side-effect boundary", async () => {
    let sideEffects = 0;
    const adapter: DestinationAdapter = {
      id: "instrumented",
      discover: async () => [selected],
      stageIfCurrent: async () => {
        const stillCurrent = false;
        if (!stillCurrent) return { status: "stale" };
        sideEffects += 1;
        return { status: "dispatched-unverified" };
      },
    };

    await expect(stageDestination(adapter, selected, null)).resolves.toEqual({
      status: "failed",
      reason: "target-stale",
    });
    expect(sideEffects).toBe(0);
  });

  it("does not retry an uncertain or failed transaction", async () => {
    const uncertainRequests: AdapterStageRequest[] = [];
    const failedRequests: AdapterStageRequest[] = [];

    await expect(
      stageDestination(
        createAdapter({ status: "dispatched-unverified" }, uncertainRequests),
        selected,
        null,
      ),
    ).resolves.toEqual({ status: "dispatched-unverified", destination: destinationReceipt });
    await expect(
      stageDestination(createAdapter({ status: "failed" }, failedRequests), selected, null),
    ).resolves.toEqual({ status: "failed", reason: "dispatch-failed" });
    expect(uncertainRequests).toHaveLength(1);
    expect(failedRequests).toHaveLength(1);
  });

  it("requires advertised note input before passing note data to an adapter", async () => {
    const noText = parseDestination({
      ...selected,
      capabilities: { ...selected.capabilities, textInput: "none" },
    });
    const stageRequests: AdapterStageRequest[] = [];

    await expect(
      stageDestination(
        createAdapter({ status: "dispatched-unverified" }, stageRequests),
        noText,
        parseNote("not allowed"),
      ),
    ).resolves.toEqual({ status: "failed", reason: "dispatch-failed" });
    expect(stageRequests).toHaveLength(0);
  });

  it("rejects an adapter mismatch before the transaction", async () => {
    const stageRequests: AdapterStageRequest[] = [];
    const adapter = createAdapter({ status: "dispatched-unverified" }, stageRequests);
    const wrongAdapter = { ...adapter, id: "another-adapter" };

    await expect(stageDestination(wrongAdapter, selected, null)).resolves.toEqual({
      status: "failed",
      reason: "dispatch-failed",
    });
    expect(stageRequests).toHaveLength(0);
  });

  it("runtime-validates the selected destination before the transaction", async () => {
    const stageRequests: AdapterStageRequest[] = [];
    const malformed = {
      ...selected,
      endpoint: { ...selected.endpoint, instanceId: "" },
    };

    await expect(
      stageDestination(
        createAdapter({ status: "dispatched-unverified" }, stageRequests),
        malformed,
        null,
      ),
    ).resolves.toEqual({ status: "failed", reason: "dispatch-failed" });
    expect(stageRequests).toHaveLength(0);
  });

  it("runtime-validates the note before the transaction", async () => {
    const stageRequests: AdapterStageRequest[] = [];

    await expect(
      stageDestination(
        createAdapter({ status: "dispatched-unverified" }, stageRequests),
        selected,
        "two\nlines",
      ),
    ).resolves.toEqual({ status: "failed", reason: "dispatch-failed" });
    expect(stageRequests).toHaveLength(0);
  });

  it("rejects unearned staged verification", async () => {
    const stageRequests: AdapterStageRequest[] = [];

    await expect(
      stageDestination(createAdapter({ status: "staged-verified" }, stageRequests), selected, null),
    ).resolves.toEqual({ status: "failed", reason: "dispatch-failed" });
    expect(stageRequests).toHaveLength(1);
  });

  it("accepts staged verification only when the selected capability claims support it", async () => {
    const verifiable = parseDestination({
      ...selected,
      capabilities: {
        ...selected.capabilities,
        readBack: "screen-text",
        verification: ["target-live", "composer-ready", "image-attached"],
      },
    });
    const stageRequests: AdapterStageRequest[] = [];

    await expect(
      stageDestination(
        createAdapter({ status: "staged-verified" }, stageRequests),
        verifiable,
        null,
      ),
    ).resolves.toEqual({ status: "staged-verified", destination: destinationReceipt });
  });

  it("maps thrown adapter failures without retrying", async () => {
    let transactions = 0;
    const adapter: DestinationAdapter = {
      id: "instrumented",
      discover: async () => [selected],
      stageIfCurrent: async () => {
        transactions += 1;
        throw new Error("instrumented failure");
      },
    };

    await expect(stageDestination(adapter, selected, null)).resolves.toEqual({
      status: "failed",
      reason: "dispatch-failed",
    });
    expect(transactions).toBe(1);
  });

  it("rejects extra fields in adapter outcomes", () => {
    expect(
      adapterStageResultSchema.safeParse({ status: "dispatched-unverified", extra: true }).success,
    ).toBe(false);
  });
});

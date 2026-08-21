import { describe, expect, it } from "vitest";

import { parseDestination, receiptForDestination } from "../../shared/domain";
import { revealDestinationForResult } from "./reveal-result";

const DESTINATION = parseDestination({
  id: "wezterm:generation-a:7",
  adapter: "wezterm",
  endpoint: { scope: "local", instanceId: "generation-a" },
  surface: { kind: "pane", locator: "7" },
  capabilities: {
    address: "exact",
    imageInput: "clipboard-key",
    textInput: "paste",
    readBack: "none",
    verification: ["target-live"],
    actions: ["copy", "stage", "reveal"],
  },
});
const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("result-scoped Reveal availability", () => {
  it("offers Reveal only for the exact retained destination receipt", () => {
    const snapshot = {
      phase: "result",
      operationId: OPERATION_ID,
      result: {
        status: "dispatched-unverified",
        destination: receiptForDestination(DESTINATION),
      },
    } as const;

    expect(revealDestinationForResult(snapshot, DESTINATION)).toBe(DESTINATION);
    expect(
      revealDestinationForResult(snapshot, {
        ...DESTINATION,
        id: "wezterm:generation-a:8",
        surface: { kind: "pane", locator: "8" },
      }),
    ).toBeNull();
  });

  it("does not offer Reveal for copy results or destinations without the capability", () => {
    const stageOnly = parseDestination({
      ...DESTINATION,
      capabilities: {
        ...DESTINATION.capabilities,
        actions: ["copy", "stage"],
      },
    });

    expect(
      revealDestinationForResult(
        { phase: "result", operationId: OPERATION_ID, result: { status: "copied" } },
        DESTINATION,
      ),
    ).toBeNull();
    expect(
      revealDestinationForResult(
        {
          phase: "result",
          operationId: OPERATION_ID,
          result: {
            status: "dispatched-unverified",
            destination: receiptForDestination(stageOnly),
          },
        },
        stageOnly,
      ),
    ).toBeNull();
  });
});

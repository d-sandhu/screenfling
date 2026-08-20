import { describe, expect, it } from "vitest";

import { parseDestination } from "../shared/domain";
import { DestinationRegistry } from "./destination-registry";

import type {
  AdapterStageRequest,
  AdapterStageResult,
  DestinationAdapter,
} from "./destination-adapter";
import type { Destination } from "../shared/domain";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_OPERATION_ID = "a6f35ec1-15d7-4c64-9843-0b97a10d20ef";

function destination(id: string, adapter = "instrumented"): Destination {
  return parseDestination({
    id,
    adapter,
    endpoint: { scope: "local", instanceId: "generation-a" },
    surface: { kind: "pane", locator: id },
    context: { cwd: "/same/path", observedAt: "2026-08-20T16:00:00.000Z" },
    capabilities: {
      address: "exact",
      imageInput: "clipboard-key",
      textInput: "paste",
      readBack: "none",
      verification: ["target-live"],
      actions: ["copy", "stage"],
    },
  });
}

class InstrumentedAdapter implements DestinationAdapter {
  readonly id: string;
  discovered: readonly Destination[];
  readonly staged: AdapterStageRequest[] = [];
  stageResult: AdapterStageResult = { status: "dispatched-unverified" };

  constructor(id = "instrumented", discovered: readonly Destination[] = [destination("pane-7")]) {
    this.id = id;
    this.discovered = discovered;
  }

  async discover(): Promise<readonly Destination[]> {
    return this.discovered;
  }

  async stageIfCurrent(request: AdapterStageRequest): Promise<AdapterStageResult> {
    this.staged.push(request);
    return this.stageResult;
  }
}

class PendingDiscoveryAdapter extends InstrumentedAdapter {
  pending = true;
  #finish: ((destinations: readonly Destination[]) => void) | null = null;

  override async discover(): Promise<readonly Destination[]> {
    if (!this.pending) return super.discover();
    return new Promise((resolve) => {
      this.#finish = resolve;
    });
  }

  finish(): void {
    this.#finish?.(this.discovered);
  }
}

describe("destination registry", () => {
  it("binds exact runtime-validated discovery to one operation", async () => {
    const adapter = new InstrumentedAdapter();
    const registry = new DestinationRegistry([adapter]);

    await expect(registry.discover(OPERATION_ID)).resolves.toEqual([destination("pane-7")]);
    await expect(registry.stage(OPERATION_ID, "pane-7", "literal note")).resolves.toEqual({
      status: "dispatched-unverified",
      destination: {
        id: "pane-7",
        adapter: "instrumented",
        surface: { kind: "pane", locator: "pane-7" },
      },
    });
    expect(adapter.staged).toEqual([{ destination: destination("pane-7"), note: "literal note" }]);
  });

  it("consumes a discovery before dispatch so duplicate Stage requests fail stale", async () => {
    const adapter = new InstrumentedAdapter();
    const registry = new DestinationRegistry([adapter]);
    await registry.discover(OPERATION_ID);

    await registry.stage(OPERATION_ID, "pane-7", null);
    await expect(registry.stage(OPERATION_ID, "pane-7", null)).resolves.toEqual({
      status: "failed",
      reason: "target-stale",
    });
    expect(adapter.staged).toHaveLength(1);
  });

  it("rejects a destination discovered for another workflow", async () => {
    const adapter = new InstrumentedAdapter();
    const registry = new DestinationRegistry([adapter]);
    await registry.discover(OPERATION_ID);

    await expect(registry.stage(OTHER_OPERATION_ID, "pane-7", null)).resolves.toEqual({
      status: "failed",
      reason: "target-stale",
    });
    expect(adapter.staged).toEqual([]);
  });

  it("fails all discovery closed on ambiguous destination IDs", async () => {
    const first = new InstrumentedAdapter("first", [destination("same", "first")]);
    const second = new InstrumentedAdapter("second", [destination("same", "second")]);
    const registry = new DestinationRegistry([first, second]);

    await expect(registry.discover(OPERATION_ID)).resolves.toEqual([]);
    await expect(registry.stage(OPERATION_ID, "same", null)).resolves.toEqual({
      status: "failed",
      reason: "target-stale",
    });
  });

  it("rejects duplicate destination IDs returned by one adapter", async () => {
    const adapter = new InstrumentedAdapter("instrumented", [
      destination("same"),
      destination("same"),
    ]);
    const registry = new DestinationRegistry([adapter]);

    await expect(registry.discover(OPERATION_ID)).resolves.toEqual([]);
  });

  it("omits malformed adapter discovery instead of trusting its static type", async () => {
    const adapter = new InstrumentedAdapter();
    adapter.discovered = [{ ...destination("pane-7"), adapter: "wrong" }];
    const registry = new DestinationRegistry([adapter]);

    await expect(registry.discover(OPERATION_ID)).resolves.toEqual([]);
  });

  it("clears an operation without disturbing a newer discovery", async () => {
    const registry = new DestinationRegistry([new InstrumentedAdapter()]);
    await registry.discover(OPERATION_ID);
    await registry.discover(OTHER_OPERATION_ID);
    registry.clear(OPERATION_ID);

    await expect(registry.stage(OTHER_OPERATION_ID, "pane-7", null)).resolves.toEqual({
      status: "dispatched-unverified",
      destination: {
        id: "pane-7",
        adapter: "instrumented",
        surface: { kind: "pane", locator: "pane-7" },
      },
    });
  });

  it("does not restore a discovery that completes after its workflow was cleared", async () => {
    const adapter = new PendingDiscoveryAdapter();
    const registry = new DestinationRegistry([adapter]);
    const pending = registry.discover(OPERATION_ID);
    registry.clear(OPERATION_ID);
    adapter.finish();

    await expect(pending).resolves.toEqual([]);
    await expect(registry.stage(OPERATION_ID, "pane-7", null)).resolves.toEqual({
      status: "failed",
      reason: "target-stale",
    });
  });

  it("invalidates the previous snapshot while a newer discovery is pending", async () => {
    const adapter = new PendingDiscoveryAdapter();
    adapter.pending = false;
    const registry = new DestinationRegistry([adapter]);
    await registry.discover(OPERATION_ID);

    adapter.pending = true;
    const refresh = registry.discover(OPERATION_ID);
    await expect(registry.stage(OPERATION_ID, "pane-7", null)).resolves.toEqual({
      status: "failed",
      reason: "target-stale",
    });
    expect(adapter.staged).toEqual([]);

    adapter.finish();
    await expect(refresh).resolves.toEqual([]);
  });

  it("rejects duplicate compiled adapter IDs", () => {
    expect(() => {
      new DestinationRegistry([new InstrumentedAdapter(), new InstrumentedAdapter()]);
    }).toThrow("Destination adapter IDs must be unique.");
  });
});

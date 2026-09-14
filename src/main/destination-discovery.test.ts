import { expect, it } from "vitest";

import { DestinationRegistry } from "./destination-registry";
import type { DestinationAdapter } from "./destination-adapter";

const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_OPERATION_ID = "a6f35ec1-15d7-4c64-9843-0b97a10d20ef";


it("uses a single diagnosed discovery and keeps the result scoped to its operation", async () => {
  let reads = 0;
  const adapter = {
    id: "instrumented",
    discover: async () => { throw new Error("Do not run a duplicate probe."); },
    discoverWithStatus: async () => {
      reads += 1;
      return { destinations: [], status: "selectors-rejected" as const };
    },
    stageIfCurrent: async () => ({ status: "failed" as const }),
  } satisfies DestinationAdapter;
  const registry = new DestinationRegistry([adapter]);
  expect(await registry.discover(OPERATION_ID)).toEqual([]);
  expect(reads).toBe(1);
  expect(registry.discoveryStatus(OPERATION_ID)).toBe("selectors-rejected");
  expect(registry.discoveryStatus(OTHER_OPERATION_ID)).toBe("instance-unavailable");
  registry.clear(OPERATION_ID);
  expect(registry.discoveryStatus(OPERATION_ID)).toBe("instance-unavailable");
  const unconfigured = new DestinationRegistry([]);
  expect(await unconfigured.discover(OPERATION_ID)).toEqual([]);
  expect(unconfigured.discoveryStatus(OPERATION_ID)).toBe("not-configured");
});

import { describe, expect, it } from "vitest";

import { LatestValueRelay } from "./latest-value-relay";

describe("latest value relay", () => {
  it("replays a value published before the renderer subscribes", () => {
    const relay = new LatestValueRelay<string>();
    const received: string[] = [];
    relay.publish("frozen-snapshot");

    relay.subscribe((value) => received.push(value));

    expect(received).toEqual(["frozen-snapshot"]);
  });

  it("replays the latest value after a strict-mode unsubscribe and resubscribe", () => {
    const relay = new LatestValueRelay<number>();
    const first: number[] = [];
    const second: number[] = [];
    relay.publish(1);
    relay.publish(2);

    const unsubscribe = relay.subscribe((value) => first.push(value));
    unsubscribe();
    relay.subscribe((value) => second.push(value));

    expect(first).toEqual([2]);
    expect(second).toEqual([2]);
  });

  it("prevents competing listeners from receiving privileged data", () => {
    const relay = new LatestValueRelay<string>();
    relay.subscribe(() => undefined);

    expect(() => relay.subscribe(() => undefined)).toThrow("already active");
  });
});

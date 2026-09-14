import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SUPPORTED_WEZTERM_VERSION,
  WEZTERM_INSPECTION_TIMEOUT_MS,
  WezTermAdapter,
} from "./wezterm-adapter";

import type { BoundedProcessRequest, BoundedProcessResult } from "./bounded-process";

const GENERATION = "a".repeat(64);
const ROOT = process.platform === "win32" ? "C:\\synthetic" : "/synthetic";
const TIMEOUT = WEZTERM_INSPECTION_TIMEOUT_MS;
const pane = {
  window_id: 1,
  tab_id: 2,
  pane_id: 7,
  workspace: "default",
  size: { rows: 40, cols: 120 },
  title: "synthetic",
  cwd: null,
};

function success(text: string): BoundedProcessResult {
  return { status: "success", stdout: new TextEncoder().encode(text) };
}

class InspectionFixture {
  reads = 0;
  stallRead = 0;
  readonly dispatched: BoundedProcessRequest[] = [];
  readonly adapter = new WezTermAdapter(
    {
      executable: join(ROOT, "wezterm"),
      configFile: join(ROOT, "config.lua"),
      socketPath: join(ROOT, "mux.sock"),
      imagePasteInput: Uint8Array.from([22]),
    },
    {
      now: () => new Date("2026-09-13T00:00:00.000Z"),
      readGeneration: async () => {
        this.reads += 1;
        if (this.reads === this.stallRead) {
          return new Promise<string>((resolve) => {
            setTimeout(() => resolve(GENERATION), TIMEOUT * 2);
          });
        }
        return GENERATION;
      },
      runProcess: async (request) => {
        if (request.beforeSpawn !== undefined && !(await request.beforeSpawn())) {
          return { status: "failed", reason: "guard-rejected" };
        }
        this.dispatched.push(request);
        if (request.arguments.includes("--version")) {
          return success(`wezterm ${SUPPORTED_WEZTERM_VERSION}`);
        }
        return success(request.arguments.includes("list") ? JSON.stringify([pane]) : "");
      },
    },
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WezTerm selector inspection deadlines", () => {
  it.each([1, 2, 3, 4, 5])(
    "bounds discovery inspection %i without late route exposure",
    async (read) => {
      const fixture = new InspectionFixture();
      fixture.stallRead = read;
      const result = fixture.adapter.discover();
      await vi.advanceTimersByTimeAsync(TIMEOUT);
      await expect(result).resolves.toEqual([]);
      const dispatched = fixture.dispatched.length;
      await vi.runAllTimersAsync();
      expect(fixture.dispatched).toHaveLength(dispatched);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["stage", "reveal"])(
    "refuses %s when its initial revalidation stalls",
    async (action) => {
      const fixture = new InspectionFixture();
      const [destination] = await fixture.adapter.discover();
      if (destination === undefined) throw new Error("Expected synthetic destination.");
      fixture.stallRead = fixture.reads + 1;
      const dispatched = fixture.dispatched.length;
      const result =
        action === "stage"
          ? fixture.adapter.stageIfCurrent({ destination, note: null })
          : fixture.adapter.revealIfCurrent({ destination });
      await vi.advanceTimersByTimeAsync(TIMEOUT);
      await expect(result).resolves.toEqual({
        status: action === "stage" ? "failed" : "unavailable",
      });
      await vi.runAllTimersAsync();
      expect(fixture.dispatched).toHaveLength(dispatched);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["stage", "reveal"])(
    "never dispatches %s after its final guard expires",
    async (action) => {
      const fixture = new InspectionFixture();
      const [destination] = await fixture.adapter.discover();
      if (destination === undefined) throw new Error("Expected synthetic destination.");
      // Revalidation reads five times; the sixth read guards the side effect itself.
      fixture.stallRead = fixture.reads + 6;
      const result =
        action === "stage"
          ? fixture.adapter.stageIfCurrent({ destination, note: null })
          : fixture.adapter.revealIfCurrent({ destination });
      await vi.advanceTimersByTimeAsync(TIMEOUT);
      await expect(result).resolves.toEqual({ status: "stale" });
      await vi.runAllTimersAsync();
      expect(
        fixture.dispatched.some(
          (request) =>
            request.arguments.includes("send-text") || request.arguments.includes("activate-pane"),
        ),
      ).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("permits a fresh discovery after a timed-out read has been discarded", async () => {
    const fixture = new InspectionFixture();
    fixture.stallRead = 1;
    const old = fixture.adapter.discover();
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await expect(old).resolves.toEqual([]);
    await expect(fixture.adapter.discover()).resolves.toHaveLength(1);
    const dispatched = fixture.dispatched.length;
    await vi.runAllTimersAsync();
    expect(fixture.dispatched).toHaveLength(dispatched);
    expect(vi.getTimerCount()).toBe(0);
  });
});

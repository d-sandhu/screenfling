import { describe, expect, it } from "vitest";

import { registerCaptureLifecycle } from "./capture-lifecycle";

import type { CaptureLifecycleRegistrations } from "./capture-lifecycle";

type ListenerSet = {
  displayAdded: (displayId: string) => void;
  displayMetricsChanged: (displayId: string, changedMetrics: readonly string[]) => void;
  displayRemoved: (displayId: string) => void;
  resumed: () => void;
  suspended: () => void;
};

function createRegistrations(listeners: ListenerSet): CaptureLifecycleRegistrations {
  return {
    displayAdded: (listener) => {
      listeners.displayAdded = listener;
    },
    displayMetricsChanged: (listener) => {
      listeners.displayMetricsChanged = listener;
    },
    displayRemoved: (listener) => {
      listeners.displayRemoved = listener;
    },
    resumed: (listener) => {
      listeners.resumed = listener;
    },
    suspended: (listener) => {
      listeners.suspended = listener;
    },
  };
}

describe("capture lifecycle registration", () => {
  it("ignores work-area-only changes but retains geometry, unknown, and power invalidation", () => {
    const listeners: ListenerSet = {
      displayAdded: () => undefined,
      displayMetricsChanged: () => undefined,
      displayRemoved: () => undefined,
      resumed: () => undefined,
      suspended: () => undefined,
    };
    const displayChanges: string[] = [];
    let environmentChanges = 0;
    registerCaptureLifecycle(createRegistrations(listeners), {
      captureEnvironmentChanged: () => {
        environmentChanges += 1;
        return { phase: "idle" };
      },
      displayChanged: (displayId) => {
        displayChanges.push(displayId);
        return { phase: "idle" };
      },
    });

    listeners.displayAdded("added");
    listeners.displayRemoved("removed");
    listeners.displayMetricsChanged("metrics-changed", ["bounds"]);
    listeners.displayMetricsChanged("work-area-only", ["workArea"]);
    listeners.displayMetricsChanged("scale-changed", ["scaleFactor"]);
    listeners.displayMetricsChanged("rotation-changed", ["rotation"]);
    listeners.displayMetricsChanged("mixed-change", ["workArea", "bounds"]);
    listeners.displayMetricsChanged("unspecified-change", []);
    listeners.displayMetricsChanged("unknown-change", ["futureMetric"]);
    listeners.suspended();
    listeners.resumed();

    expect(displayChanges).toEqual([
      "added", "removed", "metrics-changed", "scale-changed", "rotation-changed",
      "mixed-change", "unspecified-change", "unknown-change",
    ]);
    expect(environmentChanges).toBe(2);
  });
});

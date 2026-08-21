import { describe, expect, it } from "vitest";

import { registerCaptureLifecycle } from "./capture-lifecycle";

import type { CaptureLifecycleRegistrations } from "./capture-lifecycle";

type ListenerSet = {
  displayAdded: (displayId: string) => void;
  displayMetricsChanged: (displayId: string) => void;
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
  it("routes every display and power event to the capture controller", () => {
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
    listeners.displayMetricsChanged("metrics-changed");
    listeners.suspended();
    listeners.resumed();

    expect(displayChanges).toEqual(["added", "removed", "metrics-changed"]);
    expect(environmentChanges).toBe(2);
  });
});

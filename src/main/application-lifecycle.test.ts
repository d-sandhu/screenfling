import { describe, expect, it, vi } from "vitest";

import { ApplicationLifecycle } from "./application-lifecycle";

import type { WorkflowSnapshot } from "../shared/workflow";

function createHarness(phase: WorkflowSnapshot["phase"] = "idle") {
  const surfaces = {
    phase: () => phase,
    showMain: vi.fn(),
    showOverlay: vi.fn(),
    recreateMain: vi.fn(),
    stop: vi.fn(),
  };
  return { lifecycle: new ApplicationLifecycle(surfaces), surfaces };
}

describe("application surface lifecycle", () => {
  it.each([
    "idle",
    "editing",
    "target-selected",
    "writing-clipboard",
    "staging",
    "result",
  ] as const)("reopens the existing %s workflow on explicit activation", (phase) => {
    const { lifecycle, surfaces } = createHarness(phase);
    lifecycle.activate();
    expect(surfaces.showMain).toHaveBeenCalledOnce();
    expect(surfaces.showOverlay).not.toHaveBeenCalled();
    expect(surfaces.recreateMain).not.toHaveBeenCalled();
    expect(surfaces.phase()).toBe(phase);
  });

  it("does not reveal either surface while a snapshot is being prepared", () => {
    const { lifecycle, surfaces } = createHarness("snapshotting");
    lifecycle.activate();
    expect(surfaces.showMain).not.toHaveBeenCalled();
    expect(surfaces.showOverlay).not.toHaveBeenCalled();
  });

  it("returns to the existing ready overlay instead of opening the main window", () => {
    const { lifecycle, surfaces } = createHarness("selecting");
    lifecycle.activate();
    expect(surfaces.showOverlay).toHaveBeenCalledOnce();
    expect(surfaces.showMain).not.toHaveBeenCalled();
  });

  it.each(["snapshotting", "editing", "staging", "result"] as const)(
    "replaces a crashed main renderer without resetting %s",
    (phase) => {
      const { lifecycle, surfaces } = createHarness(phase);
      lifecycle.mainRendererGone();
      expect(surfaces.recreateMain).toHaveBeenCalledOnce();
      expect(surfaces.stop).not.toHaveBeenCalled();
      expect(surfaces.showOverlay).not.toHaveBeenCalled();
      expect(surfaces.phase()).toBe(phase);
    },
  );

  it("stops once instead of entering a renderer restart loop", () => {
    const { lifecycle, surfaces } = createHarness();
    lifecycle.mainRendererGone();
    lifecycle.mainRendererGone();
    lifecycle.mainRendererGone();
    lifecycle.activate();
    expect(surfaces.recreateMain).toHaveBeenCalledOnce();
    expect(surfaces.stop).toHaveBeenCalledOnce();
    expect(surfaces.showMain).not.toHaveBeenCalled();
  });

  it("stops safely when creating the replacement window fails", () => {
    const { lifecycle, surfaces } = createHarness();
    surfaces.recreateMain.mockImplementationOnce(() => {
      throw new Error("Synthetic window creation failure");
    });
    lifecycle.mainRendererGone();
    lifecycle.mainRendererGone();
    expect(surfaces.recreateMain).toHaveBeenCalledOnce();
    expect(surfaces.stop).toHaveBeenCalledOnce();
  });

  it("does not reopen windows during quit", () => {
    const { lifecycle, surfaces } = createHarness();
    lifecycle.beginQuit();
    lifecycle.mainRendererGone();
    lifecycle.activate();
    expect(surfaces.recreateMain).not.toHaveBeenCalled();
    expect(surfaces.showMain).not.toHaveBeenCalled();
    expect(surfaces.stop).not.toHaveBeenCalled();
  });
});

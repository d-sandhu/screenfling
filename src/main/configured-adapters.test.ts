import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createConfiguredAdapters } from "./configured-adapters";

const FIXTURE_ROOT = process.platform === "win32" ? "C:\\screenfling" : "/screenfling";
const COMPLETE_ENVIRONMENT = {
  SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE: join(FIXTURE_ROOT, "bin", "wezterm"),
  SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE: join(FIXTURE_ROOT, "config", "wezterm.lua"),
  SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET: join(FIXTURE_ROOT, "run", "wezterm.sock"),
  SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX: "16",
};

describe("compiled adapter configuration", () => {
  it("enables WezTerm only through a complete explicit macOS experiment", () => {
    expect(createConfiguredAdapters(COMPLETE_ENVIRONMENT, "darwin")).toHaveLength(1);
    expect(createConfiguredAdapters(COMPLETE_ENVIRONMENT, "win32")).toEqual([]);
  });

  it("fails closed when any selector is absent or the input bytes are unsafe", () => {
    expect(
      createConfiguredAdapters(
        {
          SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE:
            COMPLETE_ENVIRONMENT.SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE,
          SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE:
            COMPLETE_ENVIRONMENT.SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE,
          SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX:
            COMPLETE_ENVIRONMENT.SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX,
        },
        "darwin",
      ),
    ).toEqual([]);
    expect(
      createConfiguredAdapters(
        { ...COMPLETE_ENVIRONMENT, SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX: "0d" },
        "darwin",
      ),
    ).toEqual([]);
    expect(
      createConfiguredAdapters(
        { ...COMPLETE_ENVIRONMENT, SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX: "not-hex" },
        "darwin",
      ),
    ).toEqual([]);
  });
});

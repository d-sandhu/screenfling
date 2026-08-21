import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_SHORTCUT_CONFIGURATION } from "../../shared/shortcut";
import { ShortcutSettings, shortcutUpdateMessage } from "./shortcut-settings";

import type { ShortcutStatus, ShortcutUpdateResult } from "../../shared/shortcut";

const REGISTERED_STATUS: ShortcutStatus = {
  accelerator: "CommandOrControl+Shift+9",
  cleanupRequired: false,
  configuration: DEFAULT_SHORTCUT_CONFIGURATION,
  configurationState: "saved",
  registered: true,
};

describe("shortcut settings", () => {
  it("renders a portable, keyboard-accessible shortcut editor", () => {
    const markup = renderToStaticMarkup(
      createElement(ShortcutSettings, {
        message: null,
        onReset: () => undefined,
        onSave: () => undefined,
        pending: false,
        status: REGISTERED_STATUS,
      }),
    );

    expect(markup).toContain('aria-label="Configure global capture shortcut"');
    expect(markup).toContain("⌘/Ctrl");
    expect(markup).toContain("Edit");
    expect(markup).toContain("Modifiers");
    expect(markup).toContain("Key");
    expect(markup).toContain("Save shortcut");
    expect(markup).toContain("Reset to default");
    expect(markup).not.toContain(">CommandOrControl<");
  });

  it("explains an unavailable registration without claiming a known conflict owner", () => {
    const markup = renderToStaticMarkup(
      createElement(ShortcutSettings, {
        message: null,
        onReset: () => undefined,
        onSave: () => undefined,
        pending: false,
        status: { ...REGISTERED_STATUS, registered: false },
      }),
    );

    expect(markup).toContain("It may already be in use");
    expect(markup).not.toContain("is already in use");
    expect(markup).toContain(
      '<button class="button button--primary" type="submit">Save shortcut</button>',
    );
  });
});

describe("shortcut update feedback", () => {
  it.each([
    [{ outcome: "updated", status: REGISTERED_STATUS }, "Shortcut saved."],
    [
      {
        outcome: "updated",
        status: { ...REGISTERED_STATUS, cleanupRequired: true },
      },
      "Shortcut saved, but ScreenFling could not release the previous binding. Restart ScreenFling before relying on the change.",
    ],
    [{ outcome: "unchanged", status: REGISTERED_STATUS }, "That shortcut is already active."],
    [
      { outcome: "rejected", reason: "unavailable", status: REGISTERED_STATUS },
      "ScreenFling could not register that shortcut. It may already be in use.",
    ],
    [
      { outcome: "rejected", reason: "persistence-failed", status: REGISTERED_STATUS },
      "The shortcut could not be saved. The previous shortcut is still active.",
    ],
    [
      { outcome: "rejected", reason: "busy", status: REGISTERED_STATUS },
      "Another shortcut change is still finishing. Try again.",
    ],
  ] satisfies readonly (readonly [ShortcutUpdateResult, string])[])(
    "maps a typed result to honest user feedback",
    (result, message) => {
      expect(shortcutUpdateMessage(result)).toBe(message);
    },
  );
});

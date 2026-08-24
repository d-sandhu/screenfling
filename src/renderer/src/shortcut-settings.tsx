import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_SHORTCUT_CONFIGURATION,
  SHORTCUT_KEYS,
  SHORTCUT_MODIFIERS,
  shortcutConfigurationSchema,
} from "../../shared/shortcut";

import type {
  ShortcutConfiguration,
  ShortcutStatus,
  ShortcutUpdateResult,
} from "../../shared/shortcut";

function modifierLabel(modifiers: ShortcutConfiguration["modifiers"]): string {
  switch (modifiers) {
    case "CommandOrControl+Alt":
      return "⌘/Ctrl + Alt";
    case "CommandOrControl+Alt+Shift":
      return "⌘/Ctrl + Alt + ⇧";
    case "CommandOrControl+Shift":
      return "⌘/Ctrl + ⇧";
  }
}

function ShortcutKeys({ configuration }: { readonly configuration: ShortcutConfiguration }) {
  const modifierParts = modifierLabel(configuration.modifiers).split(" + ");
  return (
    <span className="shortcut" aria-hidden="true">
      {modifierParts.map((part) => (
        <kbd key={part}>{part}</kbd>
      ))}
      <kbd>{configuration.key}</kbd>
    </span>
  );
}

function statusMessage(status: ShortcutStatus, message: string | null): string | null {
  if (message !== null) return message;
  if (status.cleanupRequired) {
    return "ScreenFling could not verify shortcut cleanup. Restart ScreenFling before relying on a global shortcut.";
  }
  if (!status.registered) {
    return "ScreenFling could not register this shortcut. It may already be in use.";
  }
  if (status.configurationState === "invalid") {
    return "The saved shortcut was invalid. ScreenFling is using the default until you save.";
  }
  if (status.configurationState === "unreadable") {
    return "The saved shortcut could not be read. ScreenFling is using the default until you save.";
  }
  return null;
}

export function shortcutUpdateMessage(result: ShortcutUpdateResult): string {
  if (result.status.cleanupRequired) {
    return result.outcome === "updated"
      ? "Shortcut saved, but ScreenFling could not release the previous binding. Restart ScreenFling before relying on the change."
      : "ScreenFling could not verify shortcut cleanup. Restart ScreenFling before relying on a global shortcut.";
  }
  if (result.outcome === "updated") return "Shortcut saved.";
  if (result.outcome === "unchanged") return "That shortcut is already active.";
  switch (result.reason) {
    case "busy":
      return "Another shortcut change is still finishing. Try again.";
    case "persistence-failed":
      return result.status.registered
        ? "The shortcut could not be saved. The previous shortcut is still active."
        : "The shortcut could not be saved. No global shortcut is active; Capture region still works.";
    case "unavailable":
      return "ScreenFling could not register that shortcut. It may already be in use.";
  }
}

function sameConfiguration(left: ShortcutConfiguration, right: ShortcutConfiguration): boolean {
  return left.key === right.key && left.modifiers === right.modifiers;
}

export function ShortcutSettings({
  message,
  onReset,
  onSave,
  pending,
  status,
}: {
  readonly message: string | null;
  readonly onReset: () => void;
  readonly onSave: (configuration: ShortcutConfiguration) => void;
  readonly pending: boolean;
  readonly status: ShortcutStatus | null;
}) {
  const [draft, setDraft] = useState<ShortcutConfiguration>(
    status?.configuration ?? DEFAULT_SHORTCUT_CONFIGURATION,
  );
  const summary = useRef<HTMLElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (status !== null) setDraft(status.configuration);
  }, [status]);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    summary.current?.focus();
  }, [pending]);

  if (status === null) return <span className="shortcut">Checking shortcut…</span>;

  const feedback = statusMessage(status, message);
  const unchanged =
    status.registered &&
    status.configurationState === "saved" &&
    sameConfiguration(draft, status.configuration);
  const alreadyDefault =
    status.configurationState === "saved" &&
    sameConfiguration(draft, DEFAULT_SHORTCUT_CONFIGURATION);

  return (
    <details className="shortcut-settings">
      <summary aria-label="Configure global capture shortcut" ref={summary}>
        {status.registered ? (
          <ShortcutKeys configuration={status.configuration} />
        ) : (
          <span className="shortcut shortcut--warning">Shortcut unavailable</span>
        )}
        <span className="shortcut-settings__edit">Edit</span>
      </summary>
      <form
        className="shortcut-settings__panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <fieldset disabled={pending}>
          <legend>Capture shortcut</legend>
          <p>Choose a portable shortcut that works on macOS and Windows.</p>
          <div className="shortcut-settings__fields">
            <label>
              <span>Modifiers</span>
              <select
                name="shortcut-modifiers"
                onChange={(event) => {
                  const next = shortcutConfigurationSchema.safeParse({
                    ...draft,
                    modifiers: event.currentTarget.value,
                  });
                  if (next.success) setDraft(next.data);
                }}
                value={draft.modifiers}
              >
                {SHORTCUT_MODIFIERS.map((modifiers) => (
                  <option key={modifiers} value={modifiers}>
                    {modifierLabel(modifiers)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Key</span>
              <select
                name="shortcut-key"
                onChange={(event) => {
                  const next = shortcutConfigurationSchema.safeParse({
                    ...draft,
                    key: event.currentTarget.value,
                  });
                  if (next.success) setDraft(next.data);
                }}
                value={draft.key}
              >
                {SHORTCUT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {feedback === null ? null : (
            <p className="shortcut-settings__feedback" role="status">
              {feedback}
            </p>
          )}
          <div className="shortcut-settings__actions">
            <button className="button button--primary" disabled={unchanged} type="submit">
              {pending ? "Saving…" : "Save shortcut"}
            </button>
            <button
              className="text-button"
              disabled={alreadyDefault}
              onClick={() => {
                setDraft(DEFAULT_SHORTCUT_CONFIGURATION);
                onReset();
              }}
              type="button"
            >
              Reset to default
            </button>
          </div>
        </fieldset>
      </form>
    </details>
  );
}

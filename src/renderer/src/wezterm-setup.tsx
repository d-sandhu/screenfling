import { useEffect, useState } from "react";

import "./connection-setup.css";

import { wezTermSetupConfigurationSchema } from "../../shared/wezterm-setup";

import type { ScreenFlingBridge } from "../../shared/bridge";
import type {
  WezTermSetupConfiguration,
  WezTermSetupOutcome,
  WezTermSetupSnapshot,
} from "../../shared/wezterm-setup";

const emptyConfiguration: WezTermSetupConfiguration = {
  executable: "",
  configFile: "",
  socketPath: "",
  imageInputHex: "",
};
const messages: Record<WezTermSetupOutcome, string> = {
  saved: "Saved locally. Restart ScreenFling to use this connection. The current route is unchanged.",
  busy: "Finish the current capture or connection change, then try again.",
  unavailable:
    "No safe exact panes were found. Start WezTerm, check all three paths and their permissions, and use the pinned version 20240203-110809-5046fc22. Nothing was staged.",
  failed: "The connection could not be saved. Your previous settings are unchanged.",
  "environment-override": "Environment settings are active. Open ScreenFling normally to change the saved connection.",
  unsupported: "This connection is available on macOS only. Copy still works.",
};
const fields = [
  ["executable", "WezTerm executable", "/Applications/WezTerm.app/Contents/MacOS/wezterm"],
  ["configFile", "WezTerm configuration file", "/Users/you/.wezterm.lua"],
  ["socketPath", "Exact mux socket", "Paste the full socket path from the target WezTerm instance"],
  ["imageInputHex", "Image attachment key (hex bytes)", "16 for Ctrl+V, only if your agent uses it to attach images"],
] as const;

export function WezTermSetupPanel({ bridge }: { readonly bridge: ScreenFlingBridge }) {
  const [snapshot, setSnapshot] = useState<WezTermSetupSnapshot | null>(null);
  const [configuration, setConfiguration] = useState(emptyConfiguration);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void bridge
      .getWezTermSetup()
      .then((next) => {
        if (!current) return;
        setSnapshot(next);
        setConfiguration(next.configuration ?? emptyConfiguration);
        if (next.source === "invalid") {
          setMessage("Saved connection settings could not be read safely. Reconnect below. Copy still works.");
        }
      })
      .catch(() => {
        if (current) setMessage("Connection settings are unavailable. Copy still works.");
      });
    return () => {
      current = false;
    };
  }, [bridge]);

  if (snapshot !== null && !snapshot.supported) return null;
  const environmentOverride = snapshot?.source === "environment";
  const valid = wezTermSetupConfigurationSchema.safeParse(configuration).success;

  const save = (next: WezTermSetupConfiguration | null) => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    void bridge
      .saveWezTermSetup(next)
      .then(async (outcome) => {
        setMessage(messages[outcome]);
        const updated = await bridge.getWezTermSetup();
        setSnapshot(updated);
        if (outcome === "saved") setConfiguration(updated.configuration ?? emptyConfiguration);
      })
      .catch(() => setMessage(messages.failed))
      .finally(() => setPending(false));
  };

  const restart = () => {
    if (pending) return;
    setPending(true);
    void bridge
      .restartForWezTermSetup()
      .then((restarting) => {
        if (!restarting) setMessage(messages.busy);
      })
      .catch(() => setMessage("Restart could not be requested. Quit and reopen ScreenFling."))
      .finally(() => setPending(false));
  };

  return (
    <details className="connection-setup">
      <summary>Connect WezTerm · optional</summary>
      <p className="empty-state">
        Experimental exact-pane routing. Copy needs no setup. Only connect an executable and configuration you trust.
      </p>
      {environmentOverride ? (
        <p role="status">{messages["environment-override"]}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && confirmed) save(configuration);
          }}
        >
          <fieldset disabled={pending || snapshot === null}>
            <legend>One local WezTerm instance</legend>
            <div className="connection-fields">
              {fields.map(([key, label, placeholder]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    type="text"
                    required
                    maxLength={key === "imageInputHex" ? 128 : 4_096}
                    placeholder={placeholder}
                    value={configuration[key]}
                    onChange={(event) => {
                      setConfiguration({ ...configuration, [key]: event.currentTarget.value });
                      setConfirmed(false);
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="empty-state">
              In the target WezTerm instance, run <code>echo "$WEZTERM_UNIX_SOCKET"</code> to find its socket. Use absolute paths; do not enter ~. The socket may change after WezTerm restarts.
            </p>
            <label className="connection-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
              />
              I verified that this key attaches an image in my agent without submitting.
            </label>
            <p className="empty-state">Check and save only discovers panes. It never tests the key by sending input.</p>
            <div className="actions">
              <button className="button button--secondary button--compact" type="submit" disabled={!valid || !confirmed}>
                {pending ? "Checking…" : "Check and save"}
              </button>
              {snapshot?.configuration === null ? null : (
                <button className="text-button" type="button" onClick={() => save(null)}>Disconnect after restart</button>
              )}
            </div>
          </fieldset>
        </form>
      )}
      {message === null ? null : <p className="result-feedback" role="status">{message}</p>}
      {snapshot?.restartRequired ? (
        <button className="button button--primary button--compact" type="button" disabled={pending} onClick={restart}>
          Restart ScreenFling
        </button>
      ) : null}
    </details>
  );
}

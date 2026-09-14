import { useEffect, useState } from "react";

import "./connection-setup.css";

import { wezTermSetupConfigurationSchema } from "../../shared/wezterm-setup";

import type { ScreenFlingBridge } from "../../shared/bridge";
import type {
  WezTermConnectionStatus,
  WezTermFileField,
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
const messages = {
  ready: "Exact panes found. Nothing was sent or saved. This does not verify the agent's image binding.",
  saved: "Saved locally. The active connection changes only after you restart ScreenFling.",
  busy: "Finish the current capture or connection change, then try again.",
  "invalid-configuration": "Correct the highlighted fields. Use absolute paths and non-submitting key bytes.",
  "selectors-rejected": "Path checks failed or the connection changed. Check the executable, configuration, socket, ownership and permissions. ScreenFling will not relax these checks.",
  "executable-unavailable": "The configured executable did not return a usable version. Choose the WezTerm executable inside WezTerm.app, not the app folder.",
  "unsupported-version": "This WezTerm version is not supported by the experimental adapter. It currently requires 20240203-110809-5046fc22. Copy still works.",
  "instance-unavailable": "The configured instance did not return a usable pane list. Start that WezTerm instance and check its current socket path. Copy still works.",
  "no-panes": "WezTerm responded, but this instance has no panes. Open a local pane in that instance, then check again.",
  unavailable: "No safe exact panes were found. Check the connection before saving. Nothing was sent.",
  failed: "The connection could not be saved. Your previous settings are unchanged.",
  "environment-override": "Environment settings are active. Open ScreenFling normally to change the saved connection.",
  unsupported: "This connection is available on macOS only. Copy still works.",
} satisfies Record<WezTermSetupOutcome | WezTermConnectionStatus, string>;
const fields = [
  ["executable", "WezTerm executable", "/Applications/WezTerm.app/Contents/MacOS/wezterm"],
  ["configFile", "WezTerm configuration file", "/Users/you/.wezterm.lua"],
  ["socketPath", "Exact mux socket", "Paste the full socket path from the target WezTerm instance"],
  ["imageInputHex", "Image attachment key (hex bytes)", "16 for Ctrl+V, only if your agent attaches images with it"],
] as const;

export function WezTermSetupPanel({ bridge }: { readonly bridge: ScreenFlingBridge }) {
  const [snapshot, setSnapshot] = useState<WezTermSetupSnapshot | null>(null);
  const [configuration, setConfiguration] = useState(emptyConfiguration);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<"checking" | "saving" | "choosing" | "restarting" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    void bridge.getWezTermSetup().then((next) => {
      if (!current) return;
      setSnapshot(next);
      setConfiguration(next.configuration ?? emptyConfiguration);
      setMessage(next.source === "invalid"
        ? "Saved connection settings could not be read safely. Reconnect below. Copy still works."
        : null);
    }).catch(() => {
      if (current) setMessage("Connection settings are unavailable. Copy still works.");
    });
    return () => { current = false; };
  }, [bridge, reload]);

  if (snapshot !== null && !snapshot.supported) return null;
  const validation = wezTermSetupConfigurationSchema.safeParse(configuration);
  const valid = validation.success;
  const environmentOverride = snapshot?.source === "environment";

  const changeField = (field: keyof WezTermSetupConfiguration, value: string) => {
    setConfiguration((previous) => ({ ...previous, [field]: value }));
    setConfirmed(false);
    setMessage(null);
  };
  const choose = (field: WezTermFileField) => {
    if (pending !== null) return;
    setPending("choosing");
    void bridge.chooseWezTermFile(field).then((path) => {
      if (path !== null) changeField(field, path);
    }).catch(() => setMessage("File selection failed. You can still enter the full path manually."))
      .finally(() => setPending(null));
  };
  const check = () => {
    if (pending !== null || !valid) return;
    setPending("checking");
    setMessage(null);
    void bridge.checkWezTermSetup(configuration).then((status) => setMessage(messages[status]))
      .catch(() => setMessage("The connection check failed. Nothing was saved or sent."))
      .finally(() => setPending(null));
  };
  const save = (next: WezTermSetupConfiguration | null) => {
    if (pending !== null) return;
    setPending("saving");
    setMessage(null);
    void bridge.saveWezTermSetup(next).then(async (outcome) => {
      setMessage(messages[outcome]);
      if (outcome !== "saved") return;
      setConfiguration(next ?? emptyConfiguration);
      setConfirmed(false);
      try { setSnapshot(await bridge.getWezTermSetup()); }
      catch { setMessage("Saved locally, but status could not be refreshed. Quit and reopen ScreenFling to apply it."); }
    }).catch(() => setMessage("Save status is unavailable. Restart ScreenFling and check the saved connection before using Stage."))
      .finally(() => setPending(null));
  };
  const restart = () => {
    if (pending !== null) return;
    setPending("restarting");
    void bridge.restartApplication().then((restarting) => {
      if (!restarting) { setMessage(messages.busy); setPending(null); }
    }).catch(() => {
      setMessage("Restart could not be requested. Quit and reopen ScreenFling.");
      setPending(null);
    });
  };

  return (
    <details className="connection-setup">
      <summary>Connect WezTerm · optional</summary>
      <p className="empty-state">
        Experimental exact-pane routing. Copy needs no setup. Only connect an executable and configuration you trust.
      </p>
      {snapshot === null ? null : (
        <p className="connection-state">
          {snapshot.restartRequired
            ? snapshot.activeConfiguration === null
              ? "Saved change pending. Copy-only mode is still active until restart."
              : "Saved change pending. The previous connection is still active until restart."
            : snapshot.activeConfiguration === null
              ? "No connection is active. Copy only is available."
              : "Connection configured. A live pane must still be selected for each capture."}
        </p>
      )}
      {environmentOverride ? <p role="status">{messages["environment-override"]}</p> : (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (valid && confirmed) save(configuration);
        }}>
          <fieldset disabled={pending !== null || snapshot === null}>
            <legend>One local WezTerm instance</legend>
            <div className="connection-fields">
              {fields.map(([key, label, placeholder]) => {
                const issue = valid || configuration[key].length === 0
                  ? undefined : validation.error.issues.find((item) => item.path[0] === key);
                return (
                  <div className="connection-field" key={key}>
                    <label htmlFor={`connection-${key}`}>{label}</label>
                    <div className="connection-input">
                      <input
                        id={`connection-${key}`}
                        autoComplete="off" spellCheck={false} type="text" required
                        maxLength={key === "imageInputHex" ? 128 : 4_096}
                        placeholder={placeholder} value={configuration[key]}
                        aria-invalid={issue !== undefined}
                        aria-describedby={issue === undefined ? undefined : `connection-${key}-error`}
                        onChange={(event) => changeField(key, event.currentTarget.value)}
                      />
                      {key === "executable" || key === "configFile" ? (
                        <button className="text-button" type="button" aria-label={`Browse for ${label.toLowerCase()}`} onClick={() => choose(key)}>Browse</button>
                      ) : null}
                    </div>
                    {issue === undefined ? null : <span id={`connection-${key}-error`} className="connection-error">{issue.message}</span>}
                  </div>
                );
              })}
            </div>
            <p className="empty-state">
              In the target WezTerm instance, run <code>echo "$WEZTERM_UNIX_SOCKET"</code> to find its socket. Use absolute paths, not ~. Recheck the socket after WezTerm restarts.
            </p>
            <label className="connection-confirm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
              I verified that this key attaches an image in my agent without submitting.
            </label>
            <p className="empty-state">Check only discovers panes. Save rechecks them before saving locally. Neither action sends input.</p>
            <div className="actions">
              <button className="button button--secondary button--compact" type="button" disabled={!valid} onClick={check}>
                {pending === "checking" ? "Checking…" : "Check connection"}
              </button>
              <button className="button button--primary button--compact" type="submit" disabled={!valid || !confirmed}>
                {pending === "saving" ? "Saving…" : "Save connection"}
              </button>
              {snapshot !== null && (snapshot.configuration !== null || snapshot.source === "invalid") ? (
                <button className="text-button" type="button" onClick={() => save(null)}>Disconnect after restart</button>
              ) : null}
            </div>
          </fieldset>
        </form>
      )}
      {message === null ? null : <p className="result-feedback" role="status">{message}</p>}
      {snapshot === null && message !== null ? <button className="text-button" type="button" onClick={() => { setMessage(null); setReload((value) => value + 1); }}>Retry connection settings</button> : null}
      {snapshot?.restartRequired ? (
        <button className="button button--primary button--compact" type="button" disabled={pending !== null} onClick={restart}>Restart ScreenFling</button>
      ) : null}
    </details>
  );
}

import type { DestinationDiscoveryStatus } from "../../shared/destination-discovery";
import type { Destination, DestinationReceipt } from "../../shared/domain";
import { supportsStage } from "../../shared/domain";

export function destinationName(destination: Destination | DestinationReceipt): string {
  const adapter = destination.adapter === "wezterm" ? "WezTerm" : destination.adapter;
  return `${adapter} · ${destination.surface.kind} ${destination.surface.locator}`;
}

function destinationContext(destination: Destination): string {
  return (
    destination.context?.worktree ??
    destination.context?.repoRoot ??
    destination.context?.cwd ??
    "Context unavailable"
  );
}

function destinationEvidence(destination: Destination): string {
  if (!supportsStage(destination, false)) return "Copy only";
  return destination.capabilities.verification.includes("image-attached")
    ? "Verifiable"
    : "Unverified";
}

const statusMessages = {
  "not-configured": "No connection is active. After copying, use Connect WezTerm on the start screen.",
  "invalid-configuration": "Connection settings are invalid. Correct them on the start screen after copying.",
  "selectors-rejected": "The connection changed or its path permissions were rejected. Check the exact connection on the start screen after copying.",
  "executable-unavailable": "The configured WezTerm executable is unavailable. Check its path on the start screen after copying.",
  "unsupported-version": "The configured WezTerm version is unsupported. Check the version on the start screen after copying.",
  "instance-unavailable": "The configured WezTerm instance is unavailable. Start that instance and Refresh, or check its current socket on the start screen.",
  "no-panes": "WezTerm is reachable, but this instance has no panes. Open a pane in that instance, then Refresh.",
  busy: "The connection check was interrupted. Refresh when the current action finishes.",
  unsupported: "Exact destination routing is unavailable on this platform.",
  ready: "No supported exact destination is available. Refresh to check again.",
} satisfies Record<DestinationDiscoveryStatus, string>;

export function DestinationPicker({
  destinations,
  loading,
  onRefresh,
  onSelect,
  selectedId,
  status = "not-configured",
}: {
  readonly destinations: readonly Destination[];
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onSelect: (destinationId: string) => void;
  readonly selectedId: string | null;
  readonly status?: DestinationDiscoveryStatus;
}) {
  return (
    <fieldset className="destination-picker">
      <legend>Exact destination</legend>
      <button className="text-button" disabled={loading} onClick={onRefresh} type="button">
        {loading ? "Checking…" : "Refresh"}
      </button>
      {destinations.length === 0 ? (
        <p className="empty-state" role="status">
          {loading
            ? "Looking for configured exact panes…"
            : `${statusMessages[status]} Copy only still works.`}
        </p>
      ) : (
        <div className="destination-list">
          {destinations.map((destination) => (
            <label
              className={`destination ${selectedId === destination.id ? "destination--selected" : ""}`}
              key={destination.id}
            >
              <input
                checked={selectedId === destination.id}
                name="destination"
                onChange={() => onSelect(destination.id)}
                type="radio"
                value={destination.id}
              />
              <span className="destination__body">
                <span className="destination__title">{destinationName(destination)}</span>
                {destination.context?.title === undefined ? null : (
                  <span className="destination__context" dir="auto" title={destination.context.title}>
                    {destination.context.title}
                  </span>
                )}
                <span className="destination__context" title={destinationContext(destination)}>
                  {destinationContext(destination)}
                </span>
              </span>
              <span className="destination__evidence">{destinationEvidence(destination)}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

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

export function DestinationPicker({
  destinations,
  loading,
  onRefresh,
  onSelect,
  selectedId,
}: {
  readonly destinations: readonly Destination[];
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onSelect: (destinationId: string) => void;
  readonly selectedId: string | null;
}) {
  return (
    <fieldset className="destination-picker">
      <legend>Exact destination</legend>
      <button className="text-button" disabled={loading} onClick={onRefresh} type="button">
        {loading ? "Checking…" : "Refresh"}
      </button>
      {destinations.length === 0 ? (
        <p className="empty-state">
          {loading
            ? "Looking for configured exact panes…"
            : "No supported exact destination is available. Copy only still works."}
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

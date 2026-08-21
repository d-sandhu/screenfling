import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { CaptureDragTracker, selectionFromDrag } from "./capture-drag";
import { deliveryCopy } from "./delivery-copy";
import { DestinationPicker } from "./destination-picker";
import "./styles.css";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { ShortcutStatus } from "../../shared/bridge";
import type { CaptureDraft, CaptureOverlaySnapshot } from "../../shared/capture";
import type { Destination } from "../../shared/domain";
import type { WorkflowSnapshot } from "../../shared/workflow";
import type { CaptureDrag, CapturePoint } from "./capture-drag";
import type { UiCopy } from "./delivery-copy";
import { MAX_NOTE_LENGTH, supportsStage } from "../../shared/domain";

function useJpegUrl(bytes: Uint8Array | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (bytes === undefined) {
      setUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "image/jpeg" }));
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [bytes]);

  return url;
}

function operationIdOf(snapshot: WorkflowSnapshot): string | null {
  return snapshot.phase === "idle" ? null : snapshot.operationId;
}

function CaptureOverlay() {
  const bridge = window.captureOverlay;
  const [snapshot, setSnapshot] = useState<CaptureOverlaySnapshot | null>(null);
  const [drag, setDrag] = useState<CaptureDrag | null>(null);
  const [dragTracker] = useState(() => new CaptureDragTracker());
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);
  const readyOperation = useRef<string | null>(null);
  const imageUrl = useJpegUrl(snapshot?.preview);

  const failOverlay = () => {
    if (snapshot === null || submitting.current) return;
    submitting.current = true;
    void bridge?.failed({ operationId: snapshot.operationId }).catch(() => {
      submitting.current = false;
    });
  };

  useEffect(() => {
    if (bridge === undefined) return;
    return bridge.onSnapshot((nextSnapshot) => {
      submitting.current = false;
      readyOperation.current = null;
      dragTracker.cancel();
      setDrag(null);
      setMessage(null);
      setSnapshot(nextSnapshot);
    });
  }, [bridge, dragTracker]);

  useEffect(() => {
    if (bridge === undefined || snapshot === null) return;
    const cancel = () => {
      if (submitting.current) return;
      submitting.current = true;
      void bridge.cancel({ operationId: snapshot.operationId }).catch(() => {
        submitting.current = false;
        setMessage("Could not close capture. Press Escape again.");
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bridge, snapshot]);

  if (bridge === undefined) {
    return <RendererFailure message="The secure capture bridge is unavailable." />;
  }

  if (snapshot === null || imageUrl === null) {
    return (
      <main className="overlay overlay--loading" aria-live="polite">
        Preparing frozen screen…
      </main>
    );
  }

  const clampPoint = (event: ReactPointerEvent<HTMLElement>): CapturePoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || submitting.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = clampPoint(event);
    setDrag(dragTracker.begin(point));
    setMessage(null);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const nextDrag = dragTracker.move(clampPoint(event));
    if (nextDrag !== null) setDrag(nextDrag);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const completed = dragTracker.complete(clampPoint(event));
    if (completed === null) return;
    const { selection } = completed;
    if (selection.width < 3 || selection.height < 3) {
      setDrag(null);
      setMessage("Drag to select an area.");
      return;
    }

    submitting.current = true;
    setDrag(completed.drag);
    void bridge.completeSelection({ operationId: snapshot.operationId, selection }).catch(() => {
      submitting.current = false;
      setDrag(null);
      setMessage("That area could not be captured. Try again.");
    });
  };

  const selection = drag === null ? null : selectionFromDrag(drag);

  return (
    <main
      className="overlay"
      onPointerCancel={() => {
        dragTracker.cancel();
        setDrag(null);
      }}
      onPointerDown={beginDrag}
      onPointerMove={updateDrag}
      onPointerUp={finishDrag}
    >
      <img
        alt=""
        className="overlay__image"
        draggable={false}
        onError={failOverlay}
        onLoad={() => {
          if (readyOperation.current === snapshot.operationId) return;
          readyOperation.current = snapshot.operationId;
          void bridge.ready({ operationId: snapshot.operationId }).catch(() => {
            readyOperation.current = null;
            failOverlay();
          });
        }}
        src={imageUrl}
      />
      {selection === null ? <div className="overlay__shade" /> : null}
      {selection === null ? null : (
        <div
          className="selection"
          style={{
            height: selection.height,
            transform: `translate(${selection.x}px, ${selection.y}px)`,
            width: selection.width,
          }}
        >
          <span className="selection__size">
            {Math.round(selection.width)} × {Math.round(selection.height)}
          </span>
        </div>
      )}
      <div className="overlay__instruction" role="status">
        <span>{message ?? "Drag to capture"}</span>
        <kbd>Esc</kbd>
      </div>
    </main>
  );
}

function phaseCopy(snapshot: WorkflowSnapshot): UiCopy {
  switch (snapshot.phase) {
    case "idle":
      return {
        detail: "Select a region, review it, then copy only when you choose.",
        title: "Capture visual context",
      };
    case "snapshotting":
      return { detail: "Freezing the display under your pointer.", title: "Preparing capture" };
    case "selecting":
      return { detail: "Drag across the frozen screen. Escape cancels.", title: "Select an area" };
    case "editing":
      return {
        detail:
          "Review the exact pixels, add optional context, then choose Copy or one exact target.",
        title: "Ready to hand off",
      };
    case "target-selected":
      return { detail: "Locking the selected route for this operation.", title: "Target selected" };
    case "writing-clipboard":
      return { detail: "Writing and checking the image clipboard.", title: "Verifying copy" };
    case "staging":
      return {
        detail: "Dispatching once to the selected exact pane without Enter or focus changes.",
        title: "Staging input",
      };
    case "result":
      return deliveryCopy(snapshot.result);
    default:
      return { detail: "Finishing the current operation.", title: "Working" };
  }
}

function ShortcutHint({ status }: { readonly status: ShortcutStatus | null }) {
  if (status === null) return <span className="shortcut">Checking shortcut…</span>;
  if (!status.registered)
    return <span className="shortcut shortcut--warning">Shortcut unavailable</span>;

  const parts = status.accelerator.replace("CommandOrControl", "⌘").split("+");
  return (
    <span className="shortcut" aria-label={`${status.accelerator} global shortcut`}>
      {parts.map((part) => (
        <kbd key={part}>{part === "Shift" ? "⇧" : part}</kbd>
      ))}
    </span>
  );
}

function CapturePreview({ draft }: { readonly draft: CaptureDraft }) {
  const imageUrl = useJpegUrl(draft.preview);
  if (imageUrl === null) return <div className="preview preview--loading" />;

  return (
    <figure className="preview">
      <img alt="Selected screen region" draggable={false} src={imageUrl} />
      <figcaption>
        {draft.pixels.width} × {draft.pixels.height} px
      </figcaption>
    </figure>
  );
}

function ScreenFlingApp() {
  const bridge = window.screenFling;
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [shortcut, setShortcut] = useState<ShortcutStatus | null>(null);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [destinations, setDestinations] = useState<readonly Destination[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discoverySequence = useRef(0);

  useEffect(() => {
    if (bridge === undefined) return;
    let current = true;
    const unsubscribe = bridge.onWorkflowSnapshot((nextSnapshot) => {
      if (current) setSnapshot(nextSnapshot);
    });
    void Promise.all([bridge.getSnapshot(), bridge.getShortcutStatus()])
      .then(([nextSnapshot, nextShortcut]) => {
        if (!current) return;
        setSnapshot(nextSnapshot);
        setShortcut(nextShortcut);
      })
      .catch(() => {
        if (current) setError("ScreenFling could not connect to its secure main process.");
      });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [bridge]);

  const editingOperationId = snapshot?.phase === "editing" ? snapshot.operationId : null;
  const focusResultAction = useCallback((button: HTMLButtonElement | null) => {
    button?.focus();
  }, []);

  useEffect(() => {
    if (bridge === undefined || editingOperationId === null) {
      setDraft(null);
      return;
    }
    let current = true;
    void bridge
      .getCaptureDraft({ operationId: editingOperationId })
      .then((nextDraft) => {
        if (current) setDraft(nextDraft);
      })
      .catch(() => {
        if (current) setError("The captured pixels are no longer available.");
      });
    return () => {
      current = false;
    };
  }, [bridge, editingOperationId]);

  const discoverDestinations = useCallback(() => {
    if (bridge === undefined || editingOperationId === null) return;
    const sequence = ++discoverySequence.current;
    setDestinationsLoading(true);
    setError(null);
    void bridge
      .discoverDestinations({ operationId: editingOperationId })
      .then((nextDestinations) => {
        if (discoverySequence.current !== sequence) return;
        setDestinations(nextDestinations);
        setSelectedDestinationId((selected) => {
          return nextDestinations.some((destination) => destination.id === selected)
            ? selected
            : null;
        });
      })
      .catch(() => {
        if (discoverySequence.current !== sequence) return;
        setDestinations([]);
        setSelectedDestinationId(null);
        setError("Destinations could not be refreshed. Copy remains available.");
      })
      .finally(() => {
        if (discoverySequence.current === sequence) setDestinationsLoading(false);
      });
  }, [bridge, editingOperationId]);

  useEffect(() => {
    discoverySequence.current += 1;
    setDestinations([]);
    setSelectedDestinationId(null);
    setNote("");
    if (editingOperationId !== null) discoverDestinations();
  }, [discoverDestinations, editingOperationId]);

  if (bridge === undefined) {
    return <RendererFailure message="The secure ScreenFling bridge is unavailable." />;
  }

  if (snapshot === null) {
    return <main className="app app--loading">Opening ScreenFling…</main>;
  }

  const copy = phaseCopy(snapshot);
  const operationId = operationIdOf(snapshot);
  const isActive = snapshot.phase !== "idle" && snapshot.phase !== "result";
  const selectedDestination = destinations.find(
    (destination) => destination.id === selectedDestinationId,
  );
  const stageSupported =
    selectedDestination !== undefined && supportsStage(selectedDestination, note.length > 0);
  const canCancel =
    isActive &&
    snapshot.phase !== "target-selected" &&
    snapshot.phase !== "writing-clipboard" &&
    snapshot.phase !== "staging";

  const runAction = (action: () => Promise<WorkflowSnapshot>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    void action()
      .then(setSnapshot)
      .catch(() => setError("That action could not be completed safely."))
      .finally(() => setPending(false));
  };

  const dismiss = () => {
    if (snapshot.phase !== "result") return;
    runAction(() => bridge.dismissResult({ operationId: snapshot.operationId }));
  };

  return (
    <main className="app">
      <header className="app__header">
        <div className="brand" aria-label="ScreenFling">
          <span className="brand__mark" aria-hidden="true">
            SF
          </span>
          <span>ScreenFling</span>
          <span className="alpha">alpha</span>
        </div>
        <ShortcutHint status={shortcut} />
      </header>

      <section className="workspace">
        <div className="workspace__copy" aria-atomic="true" aria-live="polite">
          <p className="eyebrow">Local visual handoff</p>
          <h1>{copy.title}</h1>
          <p className="summary">{copy.detail}</p>
        </div>

        {snapshot.phase === "editing" ? (
          <div className="review-layout">
            {draft === null ? (
              <div
                className="preview preview--loading"
                aria-label="Loading capture preview"
                role="status"
              />
            ) : (
              <CapturePreview draft={draft} />
            )}
            <div className="handoff">
              <DestinationPicker
                destinations={destinations}
                loading={destinationsLoading}
                onRefresh={discoverDestinations}
                onSelect={setSelectedDestinationId}
                selectedId={selectedDestinationId}
              />
              <label className="note-field">
                <span className="field-heading">
                  <span>Optional note</span>
                  <span id="note-counter">
                    {Array.from(note).length}/{MAX_NOTE_LENGTH}
                  </span>
                </span>
                <input
                  aria-describedby="note-counter"
                  autoComplete="off"
                  name="note"
                  onChange={(event) => {
                    const nextNote = event.currentTarget.value;
                    if (Array.from(nextNote).length <= MAX_NOTE_LENGTH) setNote(nextNote);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                  placeholder="What should the agent notice?"
                  spellCheck
                  type="text"
                  value={note}
                />
              </label>
              <div className="actions actions--review">
                <button
                  className="button button--primary"
                  disabled={pending || destinationsLoading || draft === null || !stageSupported}
                  onClick={() => {
                    if (selectedDestinationId === null) return;
                    runAction(() =>
                      bridge.stageCapture({
                        operationId: snapshot.operationId,
                        destinationId: selectedDestinationId,
                        note: note.length === 0 ? null : note,
                      }),
                    );
                  }}
                  type="button"
                >
                  {selectedDestinationId !== null && !stageSupported
                    ? "Stage unavailable"
                    : "Stage, don’t send"}
                </button>
                <button
                  className="button button--secondary"
                  disabled={pending || draft === null}
                  onClick={() =>
                    runAction(() => bridge.copyCapture({ operationId: snapshot.operationId }))
                  }
                  type="button"
                >
                  Copy only
                </button>
                <button
                  className="text-button text-button--cancel"
                  disabled={pending}
                  onClick={() =>
                    runAction(() => bridge.cancelOperation({ operationId: snapshot.operationId }))
                  }
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {snapshot.phase === "idle" ? (
          <button
            className="button button--primary button--capture"
            disabled={pending}
            onClick={() => runAction(() => bridge.startCapture())}
            type="button"
          >
            <span>Capture region</span>
            <span aria-hidden="true">↗</span>
          </button>
        ) : null}

        {canCancel && operationId !== null && snapshot.phase !== "editing" ? (
          <button
            className="button button--secondary button--compact"
            disabled={pending}
            onClick={() => runAction(() => bridge.cancelOperation({ operationId }))}
            type="button"
          >
            Cancel capture
          </button>
        ) : null}

        {snapshot.phase === "result" ? (
          <div className="actions">
            <button
              className="button button--primary"
              disabled={pending}
              onClick={dismiss}
              ref={focusResultAction}
              type="button"
            >
              Done
            </button>
          </div>
        ) : null}

        {error === null ? null : (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <footer className="app__footer">
        <span className={`status-dot ${isActive ? "status-dot--active" : ""}`} />
        <span>
          {isActive
            ? "Operation in progress · no automatic submission"
            : "Nothing is sent automatically"}
        </span>
      </footer>
    </main>
  );
}

function RendererFailure({ message }: { readonly message: string }) {
  return (
    <main className="failure">
      <p className="eyebrow">ScreenFling stopped</p>
      <h1>Secure bridge unavailable</h1>
      <p className="summary">{message}</p>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("ScreenFling renderer root is missing.");

const isCaptureSurface = new URLSearchParams(window.location.search).get("surface") === "capture";

createRoot(rootElement).render(
  <StrictMode>{isCaptureSurface ? <CaptureOverlay /> : <ScreenFlingApp />}</StrictMode>,
);

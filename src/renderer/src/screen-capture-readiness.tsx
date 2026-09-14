import type { ScreenCaptureReadinessSnapshot } from "../../shared/screen-capture-readiness";

type ReadinessCopy = {
  readonly detail: string;
  readonly tone: "neutral" | "positive" | "warning" | "fault";
  readonly title: string;
};

function readinessCopy(readiness: ScreenCaptureReadinessSnapshot): ReadinessCopy {
  if (readiness.platform !== "macos") {
    return {
      detail:
        "macOS Screen Recording permission does not apply here. Capture remains available and reports failures.",
      title: "Checked during capture",
      tone: "neutral",
    };
  }
  switch (readiness.status) {
    case "granted":
      return {
        detail:
          "macOS reports access is granted. ScreenFling still validates the display and pixels during capture.",
        title: "Permission reported granted",
        tone: "positive",
      };
    case "not-determined":
      return {
        detail:
          "Screen Recording has not been confirmed. Your first capture may ask macOS for access.",
        title: "Permission not confirmed",
        tone: "warning",
      };
    case "denied":
      return {
        detail:
          "Allow ScreenFling in System Settings → Privacy & Security → Screen & System Audio Recording, then restart ScreenFling.",
        title: "Permission is off",
        tone: "fault",
      };
    case "restricted":
      return {
        detail:
          "This Mac restricts Screen Recording. Check System Settings → Privacy & Security → Screen & System Audio Recording, then restart ScreenFling.",
        title: "Permission is restricted",
        tone: "fault",
      };
    case "unknown":
      return {
        detail:
          "macOS did not report a known status. Capture remains available and reports any failure.",
        title: "Status unavailable",
        tone: "warning",
      };
  }
}

export function ScreenCaptureReadiness({
  onRefresh,
  onOpenSettings,
  onRestart,
  recoveryPending,
  refreshState,
  readiness,
}: {
  readonly onRefresh: () => void;
  readonly onOpenSettings: () => void;
  readonly onRestart: () => void;
  readonly recoveryPending: boolean;
  readonly refreshState: "checking" | "idle" | "failed";
  readonly readiness: ScreenCaptureReadinessSnapshot | null;
}) {
  if (readiness === null) {
    return (
      <section className="permission-readiness permission-readiness--loading" aria-live="polite">
        <span className="permission-readiness__label">Screen Recording</span>
        <span>{refreshState === "failed" ? "Screen Recording status could not be checked. Capture is still available." : "Checking Screen Recording…"}</span>
        {refreshState === "failed" ? <button className="text-button" type="button" onClick={onRefresh}>Check again</button> : null}
      </section>
    );
  }

  const copy = readinessCopy(readiness);
  return (
    <section
      className={`permission-readiness permission-readiness--${copy.tone}`}
      aria-atomic="true"
      aria-live="polite"
    >
      <span className="permission-readiness__indicator" aria-hidden="true" />
      <div className="permission-readiness__copy">
        <span className="permission-readiness__label">Screen Recording</span>
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
      </div>
      <button
        className="text-button"
        disabled={refreshState === "checking" || recoveryPending}
        onClick={onRefresh}
        type="button"
      >
        {refreshState === "checking" ? "Checking…" : "Check again"}
      </button>
      {readiness.platform === "macos" && readiness.status !== "granted" ? (
        <div className="permission-recovery">
          <button className="text-button" type="button" disabled={recoveryPending} onClick={onOpenSettings}>Open System Settings</button>
          <button className="text-button" type="button" disabled={recoveryPending} onClick={onRestart}>Restart ScreenFling</button>
        </div>
      ) : null}
    </section>
  );
}

function focusCapture(button: HTMLButtonElement | null): void {
  button?.focus();
}

export function IdleCaptureActions({
  onRefresh,
  onOpenSettings,
  onRestart,
  recoveryPending,
  onStartCapture,
  readiness,
  refreshState,
  startState,
}: {
  readonly onRefresh: () => void;
  readonly onOpenSettings: () => void;
  readonly onRestart: () => void;
  readonly recoveryPending: boolean;
  readonly onStartCapture: () => void;
  readonly readiness: ScreenCaptureReadinessSnapshot | null;
  readonly refreshState: "checking" | "idle" | "failed";
  readonly startState: "idle" | "starting";
}) {
  return (
    <>
      <ScreenCaptureReadiness
        onRefresh={onRefresh}
        onOpenSettings={onOpenSettings}
        onRestart={onRestart}
        recoveryPending={recoveryPending}
        readiness={readiness}
        refreshState={refreshState}
      />
      <button
        className="button button--primary button--capture"
        disabled={startState === "starting"}
        ref={startState === "idle" ? focusCapture : null}
        onClick={onStartCapture}
        type="button"
      >
        <span>Capture region</span>
        <span aria-hidden="true">↗</span>
      </button>
    </>
  );
}

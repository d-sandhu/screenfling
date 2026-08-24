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
  refreshState,
  readiness,
}: {
  readonly onRefresh: () => void;
  readonly refreshState: "checking" | "idle";
  readonly readiness: ScreenCaptureReadinessSnapshot | null;
}) {
  if (readiness === null) {
    return (
      <section className="permission-readiness permission-readiness--loading" aria-live="polite">
        <span className="permission-readiness__label">Screen Recording</span>
        <span>Checking Screen Recording…</span>
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
        disabled={refreshState === "checking"}
        onClick={onRefresh}
        type="button"
      >
        {refreshState === "checking" ? "Checking…" : "Check again"}
      </button>
    </section>
  );
}

export function IdleCaptureActions({
  onRefresh,
  onStartCapture,
  readiness,
  refreshState,
  startState,
}: {
  readonly onRefresh: () => void;
  readonly onStartCapture: () => void;
  readonly readiness: ScreenCaptureReadinessSnapshot | null;
  readonly refreshState: "checking" | "idle";
  readonly startState: "idle" | "starting";
}) {
  return (
    <>
      <ScreenCaptureReadiness
        onRefresh={onRefresh}
        readiness={readiness}
        refreshState={refreshState}
      />
      <button
        className="button button--primary button--capture"
        disabled={startState === "starting"}
        onClick={onStartCapture}
        type="button"
      >
        <span>Capture region</span>
        <span aria-hidden="true">↗</span>
      </button>
    </>
  );
}

import type { CaptureController } from "./capture-controller";

type DisplayChangedListener = (displayId: string) => void;
type DisplayMetricsChangedListener = (displayId: string, changedMetrics: readonly string[]) => void;
type EnvironmentChangedListener = () => void;

export type CaptureLifecycleRegistrations = {
  readonly displayAdded: (listener: DisplayChangedListener) => void;
  readonly displayMetricsChanged: (listener: DisplayMetricsChangedListener) => void;
  readonly displayRemoved: (listener: DisplayChangedListener) => void;
  readonly resumed: (listener: EnvironmentChangedListener) => void;
  readonly suspended: (listener: EnvironmentChangedListener) => void;
};

type CaptureLifecycleController = Pick<
  CaptureController,
  "captureEnvironmentChanged" | "displayChanged"
>;

export function registerCaptureLifecycle(
  registrations: CaptureLifecycleRegistrations,
  controller: CaptureLifecycleController,
): void {
  registrations.displayAdded((displayId) => controller.displayChanged(displayId));
  registrations.displayRemoved((displayId) => controller.displayChanged(displayId));
  registrations.displayMetricsChanged((displayId, changedMetrics) => {
    // Capture uses full display bounds, not the work area reserved by the Dock/taskbar.
    // Empty or unfamiliar notifications still invalidate; ignore only this known non-geometry change.
    if (changedMetrics.length > 0 && changedMetrics.every((metric) => metric === "workArea")) return;
    controller.displayChanged(displayId);
  });
  registrations.suspended(() => controller.captureEnvironmentChanged());
  registrations.resumed(() => controller.captureEnvironmentChanged());
}

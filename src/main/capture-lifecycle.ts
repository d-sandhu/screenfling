import type { CaptureController } from "./capture-controller";

type DisplayChangedListener = (displayId: string) => void;
type EnvironmentChangedListener = () => void;

export type CaptureLifecycleRegistrations = {
  readonly displayAdded: (listener: DisplayChangedListener) => void;
  readonly displayMetricsChanged: (listener: DisplayChangedListener) => void;
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
  registrations.displayMetricsChanged((displayId) => controller.displayChanged(displayId));
  registrations.suspended(() => controller.captureEnvironmentChanged());
  registrations.resumed(() => controller.captureEnvironmentChanged());
}

import type { CaptureOverlayBridge, ScreenFlingBridge } from "./shared/bridge";

declare global {
  interface Window {
    readonly captureOverlay?: CaptureOverlayBridge;
    readonly screenFling?: ScreenFlingBridge;
  }
}

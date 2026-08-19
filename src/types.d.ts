import type { ScreenFlingBridge } from "./shared/bridge";

declare global {
  interface Window {
    readonly screenFling: ScreenFlingBridge;
  }
}

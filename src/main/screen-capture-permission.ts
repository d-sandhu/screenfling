import { screenCapturePermissionStatusSchema } from "../shared/screen-capture-readiness";

import type {
  ScreenCapturePermissionStatus,
  ScreenCaptureReadinessSnapshot,
} from "../shared/screen-capture-readiness";

export type ScreenCapturePermissionPolicy = "allowed" | "attempt" | "blocked";

export function screenCapturePermissionPolicy(
  status: ScreenCapturePermissionStatus,
  platform: NodeJS.Platform,
): ScreenCapturePermissionPolicy {
  if (platform !== "darwin") return "allowed";
  return status === "denied" || status === "restricted" ? "blocked" : "attempt";
}

type PermissionStatusReader = () => string;

function otherPlatform(platform: NodeJS.Platform): "windows" | "linux" | "other" {
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "other";
}

export function readScreenCaptureReadiness(
  platform: NodeJS.Platform,
  readStatus: PermissionStatusReader,
): ScreenCaptureReadinessSnapshot {
  if (platform !== "darwin") {
    return { platform: otherPlatform(platform), status: "not-applicable", version: 1 };
  }
  try {
    const status = readStatus();
    return {
      platform: "macos",
      status: screenCapturePermissionStatusSchema.catch("unknown").parse(status),
      version: 1,
    };
  } catch {
    return { platform: "macos", status: "unknown", version: 1 };
  }
}

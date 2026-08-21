export type ScreenCapturePermissionStatus =
  "not-determined" | "granted" | "denied" | "restricted" | "unknown";

export type ScreenCapturePermissionPolicy = "allowed" | "attempt" | "blocked";

export function screenCapturePermissionPolicy(
  status: ScreenCapturePermissionStatus,
  platform: NodeJS.Platform,
): ScreenCapturePermissionPolicy {
  if (platform !== "darwin") return "allowed";
  return status === "denied" || status === "restricted" ? "blocked" : "attempt";
}

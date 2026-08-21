import type { DeliveryResult } from "../../shared/workflow";

export type UiCopy = {
  readonly detail: string;
  readonly title: string;
};

type FailureReason = Extract<DeliveryResult, { readonly status: "failed" }>["reason"];

export function failureCopy(reason: FailureReason): UiCopy {
  const details = {
    "capture-failed": "The display changed or ScreenFling could not read its pixels.",
    "clipboard-failed":
      "ScreenFling could not verify the image on the clipboard, so Stage stopped.",
    "dispatch-failed":
      "ScreenFling could not confirm the destination operation. The image remains on your clipboard.",
    "permission-blocked":
      "Screen Recording access is off for ScreenFling. Enable it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart ScreenFling.",
    "target-stale":
      "The selected destination changed before Stage. The image remains on your clipboard.",
    unexpected: "ScreenFling stopped safely before delivering anything.",
  } as const;
  return { detail: details[reason], title: "Capture stopped" };
}

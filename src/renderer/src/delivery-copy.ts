import type { DeliveryResult, RevealResult } from "../../shared/workflow";
import { destinationName } from "./destination-picker";

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
      "ScreenFling could not confirm the destination operation. The image remains on your clipboard for manual paste.",
    "permission-blocked":
      "Screen Recording access is off for ScreenFling. Enable it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart ScreenFling.",
    "target-stale":
      "The selected destination changed before Stage. The image remains on your clipboard for manual paste.",
    unsupported:
      "This destination does not support the requested Stage action. The image remains on your clipboard for manual paste.",
    unexpected: "ScreenFling stopped safely before delivering anything.",
  } as const;
  return { detail: details[reason], title: "Capture stopped" };
}

export function deliveryCopy(result: DeliveryResult): UiCopy {
  if (result.status === "copied") {
    return { detail: "The selected image is verified on your clipboard.", title: "Copied" };
  }
  if (result.status === "cancelled") {
    return { detail: "Nothing was copied or sent.", title: "Capture cancelled" };
  }
  if (result.status === "failed") return failureCopy(result.reason);
  if (result.status === "dispatched-unverified") {
    return {
      detail: `Input was dispatched to ${destinationName(result.destination)} without submission. Attachment could not be verified; the image remains on your clipboard for manual paste.`,
      title: "Staged — unverified",
    };
  }
  if (result.status === "staged-verified") {
    return {
      detail: `${destinationName(result.destination)} verified the staged input without submitting it.`,
      title: "Stage verified",
    };
  }
  return {
    detail: `${destinationName(result.destination)} verified the submitted turn.`,
    title: "Send verified",
  };
}

export function revealCopy(result: RevealResult): UiCopy {
  switch (result.status) {
    case "revealed":
      return {
        detail:
          "WezTerm accepted the exact-pane activation request. ScreenFling cannot verify operating-system foreground or visibility.",
        title: "Reveal requested",
      };
    case "stale":
      return {
        detail:
          "The exact destination changed, so ScreenFling did not activate a fallback. Stage result is unchanged.",
        title: "Reveal stopped",
      };
    case "unavailable":
      return {
        detail:
          "The exact destination could not be reached, and no window fallback was attempted. Stage result is unchanged.",
        title: "Reveal unavailable",
      };
    case "unsupported":
      return {
        detail: "This destination does not support exact Reveal. Stage result is unchanged.",
        title: "Reveal unavailable",
      };
    case "failed":
      return {
        detail: "The activation request did not complete cleanly. Stage result is unchanged.",
        title: "Reveal failed",
      };
  }
}

import { supportsReveal } from "../../shared/domain";

import type { Destination } from "../../shared/domain";
import type { WorkflowSnapshot } from "../../shared/workflow";

export function revealDestinationForResult(
  snapshot: WorkflowSnapshot,
  candidate: Destination | null,
): Destination | null {
  if (snapshot.phase !== "result" || candidate === null || !supportsReveal(candidate)) return null;
  const result = snapshot.result;
  if (
    result.status !== "dispatched-unverified" &&
    result.status !== "staged-verified" &&
    result.status !== "sent-verified"
  ) {
    return null;
  }
  const receipt = result.destination;
  return receipt.id === candidate.id &&
    receipt.adapter === candidate.adapter &&
    receipt.surface.kind === candidate.surface.kind &&
    receipt.surface.locator === candidate.surface.locator
    ? candidate
    : null;
}

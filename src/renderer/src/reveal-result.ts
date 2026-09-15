import { supportsReveal } from "../../shared/domain";

import type { Destination, DestinationReceipt } from "../../shared/domain";
import type { WorkflowSnapshot } from "../../shared/workflow";

export function revealDestinationForResult(
  snapshot: WorkflowSnapshot,
  candidate: Destination | null,
): DestinationReceipt | null {
  if (snapshot.phase !== "result" || snapshot.revealAvailable !== true) return null;
  if (candidate !== null && !supportsReveal(candidate)) return null;
  const result = snapshot.result;
  if (
    result.status !== "dispatched-unverified" &&
    result.status !== "staged-verified" &&
    result.status !== "sent-verified"
  ) {
    return null;
  }
  const receipt = result.destination;
  // Reopening the renderer loses its local selection, not main's exact lease.
  // An explicit action still goes through main's one-shot revalidation.
  return candidate === null || (
    receipt.id === candidate.id &&
    receipt.adapter === candidate.adapter &&
    receipt.surface.kind === candidate.surface.kind &&
    receipt.surface.locator === candidate.surface.locator
  ) ? receipt : null;
}

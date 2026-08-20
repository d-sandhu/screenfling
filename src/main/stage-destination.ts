import { adapterStageResultSchema } from "./destination-adapter";

import type {
  AdapterStageRequest,
  AdapterStageResult,
  DestinationAdapter,
} from "./destination-adapter";
import { destinationSchema, noteSchema, receiptForDestination } from "../shared/domain";

import type { Destination, Note } from "../shared/domain";
import type { DeliveryResult } from "../shared/workflow";

export type StageDeliveryResult = Extract<
  DeliveryResult,
  | { readonly status: "dispatched-unverified" }
  | { readonly status: "staged-verified" }
  | { readonly status: "failed" }
>;

function cannotStage(destination: Destination, note: Note | null): boolean {
  return (
    destination.capabilities.address !== "exact" ||
    !destination.capabilities.actions.includes("stage") ||
    !destination.capabilities.verification.includes("target-live") ||
    (note !== null && destination.capabilities.textInput === "none")
  );
}

function mapAdapterResult(
  result: AdapterStageResult,
  destination: Destination,
): StageDeliveryResult {
  if (result.status === "dispatched-unverified") {
    return { ...result, destination: receiptForDestination(destination) };
  }
  if (result.status === "staged-verified") {
    const canVerifyStage =
      destination.capabilities.verification.includes("composer-ready") &&
      destination.capabilities.verification.includes("image-attached") &&
      destination.capabilities.readBack !== "none";
    return canVerifyStage
      ? { ...result, destination: receiptForDestination(destination) }
      : { status: "failed", reason: "dispatch-failed" };
  }
  if (result.status === "stale") {
    return { status: "failed", reason: "target-stale" };
  }
  if (result.status === "permission-blocked") {
    return { status: "failed", reason: "permission-blocked" };
  }
  return { status: "failed", reason: "dispatch-failed" };
}

export async function stageDestination(
  adapter: DestinationAdapter,
  selected: Destination,
  note: Note | null,
): Promise<StageDeliveryResult> {
  const parsedDestination = destinationSchema.safeParse(selected);
  const parsedNote = note === null ? null : noteSchema.safeParse(note);
  if (!parsedDestination.success || (parsedNote !== null && !parsedNote.success)) {
    return { status: "failed", reason: "dispatch-failed" };
  }

  const destination = parsedDestination.data;
  const safeNote = parsedNote === null ? null : parsedNote.data;
  if (destination.adapter !== adapter.id || cannotStage(destination, safeNote)) {
    return { status: "failed", reason: "dispatch-failed" };
  }

  const request: AdapterStageRequest = { destination, note: safeNote };
  try {
    const result = adapterStageResultSchema.safeParse(await adapter.stageIfCurrent(request));
    if (!result.success) {
      return { status: "failed", reason: "dispatch-failed" };
    }
    return mapAdapterResult(result.data, destination);
  } catch {
    return { status: "failed", reason: "dispatch-failed" };
  }
}

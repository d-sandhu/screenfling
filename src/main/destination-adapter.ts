import { z } from "zod";

import type { Destination, Note } from "../shared/domain";
import type { RevealResult } from "../shared/workflow";

export type AdapterRevealRequest = {
  readonly destination: Destination;
};

export type AdapterStageRequest = {
  readonly destination: Destination;
  readonly note: Note | null;
};

export const adapterStageResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("dispatched-unverified") }),
    z.strictObject({ status: z.literal("staged-verified") }),
    z.strictObject({ status: z.literal("stale") }),
    z.strictObject({ status: z.literal("permission-blocked") }),
    z.strictObject({ status: z.literal("failed") }),
  ])
  .readonly();

export type AdapterStageResult = z.infer<typeof adapterStageResultSchema>;

export type DestinationAdapter = {
  readonly id: string;
  readonly discover: () => Promise<readonly Destination[]>;
  /** Revalidate the exact route immediately before the side effect, or return stale. */
  readonly stageIfCurrent: (request: AdapterStageRequest) => Promise<AdapterStageResult>;
  /** Activate only the exact retained route, without sending input. */
  readonly revealIfCurrent?: (request: AdapterRevealRequest) => Promise<RevealResult>;
};

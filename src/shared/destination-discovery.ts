import { z } from "zod";

import { destinationListSchema } from "./domain";
import { wezTermConnectionStatusSchema } from "./wezterm-setup";

export const destinationDiscoveryStatusSchema = wezTermConnectionStatusSchema.or(z.literal("not-configured"));
export const destinationDiscoverySchema = z.strictObject({
  destinations: destinationListSchema,
  status: destinationDiscoveryStatusSchema,
});
export type DestinationDiscovery = z.infer<typeof destinationDiscoverySchema>;
export type DestinationDiscoveryStatus = z.infer<typeof destinationDiscoveryStatusSchema>;

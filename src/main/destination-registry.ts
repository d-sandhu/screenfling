import {
  destinationIdSchema,
  destinationListSchema,
  operationIdSchema,
  noteSchema,
  supportsReveal,
} from "../shared/domain";
import { revealResultSchema } from "../shared/workflow";
import { stageDestination } from "./stage-destination";

import type { Destination, Note } from "../shared/domain";
import type { DestinationAdapter } from "./destination-adapter";
import type { StageDeliveryResult } from "./stage-destination";
import type { RevealResult } from "../shared/workflow";

type DiscoverySnapshot = {
  readonly destinations: ReadonlyMap<string, Destination>;
  readonly operationId: string;
};

type RevealLease = {
  readonly destination: Destination;
  readonly operationId: string;
};

function adapterIdsAreUnique(adapters: readonly DestinationAdapter[]): boolean {
  const adapterIds = adapters.map((adapter) => adapter.id);
  return new Set(adapterIds).size === adapterIds.length;
}

export class DestinationRegistry {
  readonly #adapters: ReadonlyMap<string, DestinationAdapter>;
  #discovery: DiscoverySnapshot | null = null;
  #pendingOperationId: string | null = null;
  #revealLease: RevealLease | null = null;
  #revision = 0;

  constructor(adapters: readonly DestinationAdapter[]) {
    if (!adapterIdsAreUnique(adapters)) throw new Error("Destination adapter IDs must be unique.");
    const entries = adapters.map(
      (adapter) => [destinationIdSchema.parse(adapter.id), adapter] as const,
    );
    this.#adapters = new Map(entries);
  }

  async discover(operationId: string): Promise<readonly Destination[]> {
    const safeOperationId = operationIdSchema.parse(operationId);
    const revision = ++this.#revision;
    this.#discovery = null;
    this.#pendingOperationId = safeOperationId;
    this.#revealLease = null;
    const discovered: Destination[] = [];
    const destinationIds = new Set<string>();

    for (const adapter of this.#adapters.values()) {
      try {
        const candidates = destinationListSchema.safeParse(await adapter.discover());
        if (!candidates.success) continue;
        const candidateIds = candidates.data.map((destination) => destination.id);
        const matching =
          new Set(candidateIds).size === candidateIds.length &&
          candidates.data.every((destination) => {
            return destination.adapter === adapter.id && !destinationIds.has(destination.id);
          });
        if (!matching) {
          if (this.#revision === revision) {
            this.#discovery = null;
            this.#pendingOperationId = null;
          }
          return [];
        }
        for (const destination of candidates.data) {
          destinationIds.add(destination.id);
          discovered.push(destination);
        }
      } catch {
        continue;
      }
    }

    if (this.#revision !== revision) return [];
    const destinationsResult = destinationListSchema.safeParse(discovered);
    if (!destinationsResult.success) {
      this.#discovery = null;
      this.#pendingOperationId = null;
      return [];
    }
    const destinations = destinationsResult.data;
    this.#discovery = {
      destinations: new Map(destinations.map((destination) => [destination.id, destination])),
      operationId: safeOperationId,
    };
    this.#pendingOperationId = null;
    return destinations;
  }

  async stage(
    operationId: string,
    destinationId: string,
    note: Note | null,
  ): Promise<StageDeliveryResult> {
    const safeOperationId = operationIdSchema.parse(operationId);
    const safeDestinationId = destinationIdSchema.parse(destinationId);
    const safeNote = note === null ? null : noteSchema.parse(note);
    const discovery = this.#discovery;
    this.#revision += 1;
    const revision = this.#revision;
    this.#discovery = null;
    this.#pendingOperationId = null;
    this.#revealLease = null;
    if (discovery === null || discovery.operationId !== safeOperationId) {
      return { status: "failed", reason: "target-stale" };
    }
    const destination = discovery.destinations.get(safeDestinationId);
    if (destination === undefined) return { status: "failed", reason: "target-stale" };
    const adapter = this.#adapters.get(destination.adapter);
    if (adapter === undefined) return { status: "failed", reason: "dispatch-failed" };
    this.#pendingOperationId = safeOperationId;
    const result = await stageDestination(adapter, destination, safeNote);
    if (this.#revision === revision) {
      this.#pendingOperationId = null;
      if (result.status === "dispatched-unverified" || result.status === "staged-verified") {
        this.#revealLease = { destination, operationId: safeOperationId };
      }
    }
    return result;
  }

  async reveal(operationId: string, destinationId: string): Promise<RevealResult> {
    const safeOperationId = operationIdSchema.parse(operationId);
    const safeDestinationId = destinationIdSchema.parse(destinationId);
    const lease = this.#revealLease;
    if (
      lease === null ||
      lease.operationId !== safeOperationId ||
      lease.destination.id !== safeDestinationId
    ) {
      return { status: "stale" };
    }
    this.#revealLease = null;
    if (!supportsReveal(lease.destination)) return { status: "unsupported" };
    const adapter = this.#adapters.get(lease.destination.adapter);
    if (adapter?.revealIfCurrent === undefined) return { status: "unsupported" };
    try {
      const result = revealResultSchema.safeParse(
        await adapter.revealIfCurrent({ destination: lease.destination }),
      );
      return result.success ? result.data : { status: "failed" };
    } catch {
      return { status: "failed" };
    }
  }

  clear(operationId: string): void {
    const safeOperationId = operationIdSchema.parse(operationId);
    if (
      this.#discovery?.operationId !== safeOperationId &&
      this.#pendingOperationId !== safeOperationId &&
      this.#revealLease?.operationId !== safeOperationId
    ) {
      return;
    }
    this.#revision += 1;
    this.#discovery = null;
    this.#pendingOperationId = null;
    this.#revealLease = null;
  }
}

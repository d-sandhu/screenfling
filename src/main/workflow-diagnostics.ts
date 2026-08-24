import { operationIdSchema } from "../shared/domain";
import {
  diagnosticDeliveryOutcomeSchema,
  diagnosticsSnapshotSchema,
  diagnosticTriggerSchema,
  MAX_DIAGNOSTIC_TIMING_SAMPLES,
} from "../shared/diagnostics";
import { revealResultSchema } from "../shared/workflow";

import type {
  DiagnosticDeliveryOutcome,
  DiagnosticsSnapshot,
  DiagnosticTrigger,
} from "../shared/diagnostics";
import type { RevealResult } from "../shared/workflow";

type DiagnosticPhase =
  | "editing"
  | "main-hidden"
  | "overlay-prepared"
  | "selecting"
  | "selection-complete"
  | "snapshot-ready"
  | "startup-joined";

type ActiveMeasurement = {
  readonly operationId: string;
  readonly startedAt: number;
  readonly trigger: DiagnosticTrigger;
  editingRecorded: boolean;
  mainHiddenAt: number | null;
  overlayPreparedAt: number | null;
  selectingRecorded: boolean;
  selectionCompletedAt: number | null;
  snapshotReadyAt: number | null;
  startupJoinedAt: number | null;
};

type DeliveryCounters = {
  cancelled: number;
  copied: number;
  dispatchedUnverified: number;
  failures: {
    captureFailed: number;
    clipboardFailed: number;
    dispatchFailed: number;
    permissionBlocked: number;
    targetStale: number;
    unexpected: number;
    unsupported: number;
  };
  sentVerified: number;
  stagedVerified: number;
};

type TimingSamples = {
  buttonToSelecting: number[];
  mainHiddenToOverlayPrepared: number[];
  mainHiddenToSnapshotReady: number[];
  selectionToEditing: number[];
  selectionToResult: number[];
  shortcutToSelecting: number[];
  startToMainHidden: number[];
  startupJoinedToSelecting: number[];
};

function increment(value: number): number {
  return Math.min(value + 1, Number.MAX_SAFE_INTEGER);
}

function summarize(samples: readonly number[]) {
  if (samples.length === 0) {
    return { count: 0, maximum: null, median: null, minimum: null, p95: null };
  }

  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (fraction: number): number => {
    const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
    const value = ordered[index];
    if (value === undefined) throw new Error("A non-empty timing sample lost its percentile.");
    return value;
  };
  const maximum = ordered.at(-1);
  const minimum = ordered[0];
  if (maximum === undefined || minimum === undefined) {
    throw new Error("A non-empty timing sample lost its bounds.");
  }

  return {
    count: ordered.length,
    maximum,
    median: percentile(0.5),
    minimum,
    p95: percentile(0.95),
  };
}

export class WorkflowDiagnostics {
  readonly #clock: () => number;
  readonly #delivery: DeliveryCounters = {
    cancelled: 0,
    copied: 0,
    dispatchedUnverified: 0,
    failures: {
      captureFailed: 0,
      clipboardFailed: 0,
      dispatchFailed: 0,
      permissionBlocked: 0,
      targetStale: 0,
      unexpected: 0,
      unsupported: 0,
    },
    sentVerified: 0,
    stagedVerified: 0,
  };
  readonly #reveal = {
    failed: 0,
    revealed: 0,
    stale: 0,
    unavailable: 0,
    unsupported: 0,
  };
  readonly #samples: TimingSamples = {
    buttonToSelecting: [],
    mainHiddenToOverlayPrepared: [],
    mainHiddenToSnapshotReady: [],
    selectionToEditing: [],
    selectionToResult: [],
    shortcutToSelecting: [],
    startToMainHidden: [],
    startupJoinedToSelecting: [],
  };
  readonly #starts = { button: 0, shortcut: 0 };
  #active: ActiveMeasurement | null = null;

  constructor(clock: () => number) {
    this.#clock = clock;
  }

  begin(operationId: string, triggerInput: DiagnosticTrigger): void {
    const parsedOperationId = operationIdSchema.parse(operationId);
    const trigger = diagnosticTriggerSchema.parse(triggerInput);
    this.#starts[trigger] = increment(this.#starts[trigger]);
    this.#active = {
      operationId: parsedOperationId,
      startedAt: this.#clock(),
      trigger,
      editingRecorded: false,
      mainHiddenAt: null,
      overlayPreparedAt: null,
      selectingRecorded: false,
      selectionCompletedAt: null,
      snapshotReadyAt: null,
      startupJoinedAt: null,
    };
  }

  mark(operationId: string, phase: DiagnosticPhase): void {
    const parsedOperationId = operationIdSchema.parse(operationId);
    const active = this.#active;
    if (active === null || active.operationId !== parsedOperationId) return;

    const now = this.#clock();
    switch (phase) {
      case "main-hidden":
        if (active.mainHiddenAt !== null || !Number.isFinite(now)) return;
        active.mainHiddenAt = now;
        this.#recordDuration("startToMainHidden", active.startedAt, now);
        return;
      case "overlay-prepared":
        if (
          active.overlayPreparedAt !== null ||
          active.mainHiddenAt === null ||
          !Number.isFinite(now)
        ) {
          return;
        }
        active.overlayPreparedAt = now;
        this.#recordDuration("mainHiddenToOverlayPrepared", active.mainHiddenAt, now);
        return;
      case "snapshot-ready":
        if (
          active.snapshotReadyAt !== null ||
          active.mainHiddenAt === null ||
          !Number.isFinite(now)
        ) {
          return;
        }
        active.snapshotReadyAt = now;
        this.#recordDuration("mainHiddenToSnapshotReady", active.mainHiddenAt, now);
        return;
      case "startup-joined":
        if (active.startupJoinedAt !== null || !Number.isFinite(now)) return;
        active.startupJoinedAt = now;
        return;
      case "selecting": {
        if (active.selectingRecorded) return;
        active.selectingRecorded = true;
        const key = active.trigger === "button" ? "buttonToSelecting" : "shortcutToSelecting";
        this.#recordDuration(key, active.startedAt, now);
        if (active.startupJoinedAt !== null) {
          this.#recordDuration("startupJoinedToSelecting", active.startupJoinedAt, now);
        }
        return;
      }
      case "selection-complete":
        if (active.selectionCompletedAt === null && Number.isFinite(now)) {
          active.selectionCompletedAt = now;
        }
        return;
      case "editing":
        if (active.editingRecorded || active.selectionCompletedAt === null) return;
        active.editingRecorded = true;
        this.#recordDuration("selectionToEditing", active.selectionCompletedAt, now);
    }
  }

  finish(operationId: string, outcomeInput: DiagnosticDeliveryOutcome): void {
    const parsedOperationId = operationIdSchema.parse(operationId);
    const outcome = diagnosticDeliveryOutcomeSchema.parse(outcomeInput);
    const active = this.#active;
    if (active === null || active.operationId !== parsedOperationId) return;

    if (active.selectionCompletedAt !== null) {
      this.#recordDuration("selectionToResult", active.selectionCompletedAt, this.#clock());
    }
    this.#recordDelivery(outcome);
    this.#active = null;
  }

  recordReveal(resultInput: RevealResult): void {
    const result = revealResultSchema.parse(resultInput);
    this.#reveal[result.status] = increment(this.#reveal[result.status]);
  }

  snapshot(): DiagnosticsSnapshot {
    return diagnosticsSnapshotSchema.parse({
      version: 2,
      starts: { ...this.#starts },
      delivery: {
        ...this.#delivery,
        failures: { ...this.#delivery.failures },
      },
      reveal: { ...this.#reveal },
      timingsMs: {
        buttonToSelecting: summarize(this.#samples.buttonToSelecting),
        mainHiddenToOverlayPrepared: summarize(this.#samples.mainHiddenToOverlayPrepared),
        mainHiddenToSnapshotReady: summarize(this.#samples.mainHiddenToSnapshotReady),
        selectionToEditing: summarize(this.#samples.selectionToEditing),
        selectionToResult: summarize(this.#samples.selectionToResult),
        shortcutToSelecting: summarize(this.#samples.shortcutToSelecting),
        startToMainHidden: summarize(this.#samples.startToMainHidden),
        startupJoinedToSelecting: summarize(this.#samples.startupJoinedToSelecting),
      },
    });
  }

  #recordDelivery(outcome: DiagnosticDeliveryOutcome): void {
    switch (outcome.status) {
      case "cancelled":
        this.#delivery.cancelled = increment(this.#delivery.cancelled);
        return;
      case "copied":
        this.#delivery.copied = increment(this.#delivery.copied);
        return;
      case "dispatched-unverified":
        this.#delivery.dispatchedUnverified = increment(this.#delivery.dispatchedUnverified);
        return;
      case "failed": {
        const failureKey = {
          "capture-failed": "captureFailed",
          "clipboard-failed": "clipboardFailed",
          "dispatch-failed": "dispatchFailed",
          "permission-blocked": "permissionBlocked",
          "target-stale": "targetStale",
          unexpected: "unexpected",
          unsupported: "unsupported",
        } as const;
        const key = failureKey[outcome.reason];
        this.#delivery.failures[key] = increment(this.#delivery.failures[key]);
        return;
      }
      case "sent-verified":
        this.#delivery.sentVerified = increment(this.#delivery.sentVerified);
        return;
      case "staged-verified":
        this.#delivery.stagedVerified = increment(this.#delivery.stagedVerified);
    }
  }

  #recordDuration(key: keyof TimingSamples, startedAt: number, finishedAt: number): void {
    const duration = finishedAt - startedAt;
    if (!Number.isFinite(duration) || duration < 0) return;
    const samples = this.#samples[key];
    samples.push(duration);
    if (samples.length > MAX_DIAGNOSTIC_TIMING_SAMPLES) samples.shift();
  }
}

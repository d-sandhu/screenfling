import type { DipSelectionInput } from "../../shared/capture";

export type CapturePoint = {
  readonly x: number;
  readonly y: number;
};

export type CaptureDrag = {
  readonly current: CapturePoint;
  readonly start: CapturePoint;
};

export type CompletedCaptureDrag = {
  readonly drag: CaptureDrag;
  readonly selection: DipSelectionInput;
};

export function selectionFromDrag(drag: CaptureDrag): DipSelectionInput {
  return {
    x: Math.min(drag.start.x, drag.current.x),
    y: Math.min(drag.start.y, drag.current.y),
    width: Math.abs(drag.current.x - drag.start.x),
    height: Math.abs(drag.current.y - drag.start.y),
  };
}

export class CaptureDragTracker {
  #drag: CaptureDrag | null = null;

  begin(point: CapturePoint): CaptureDrag {
    const drag = { current: point, start: point };
    this.#drag = drag;
    return drag;
  }

  cancel(): void {
    this.#drag = null;
  }

  complete(point: CapturePoint): CompletedCaptureDrag | null {
    const drag = this.#withCurrent(point);
    if (drag === null) return null;
    this.#drag = null;
    return { drag, selection: selectionFromDrag(drag) };
  }

  move(point: CapturePoint): CaptureDrag | null {
    const drag = this.#withCurrent(point);
    if (drag !== null) this.#drag = drag;
    return drag;
  }

  #withCurrent(point: CapturePoint): CaptureDrag | null {
    if (this.#drag === null) return null;
    return { current: point, start: this.#drag.start };
  }
}

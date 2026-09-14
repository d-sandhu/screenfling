import type { WorkflowSnapshot } from "../shared/workflow";

export type ApplicationSurfaces = {
  readonly phase: () => WorkflowSnapshot["phase"];
  readonly showMain: () => void;
  readonly showOverlay: () => void;
  readonly recreateMain: () => void;
  readonly stop: () => void;
};

export class ApplicationLifecycle {
  readonly #surfaces: ApplicationSurfaces;
  #quitting = false;
  #recoveryUsed = false;

  constructor(surfaces: ApplicationSurfaces) {
    this.#surfaces = surfaces;
  }

  activate(): void {
    if (this.#quitting) return;
    const phase = this.#surfaces.phase();
    // Never expose a prepared window before the frozen image is ready.
    if (phase === "snapshotting") return;
    if (phase === "selecting") this.#surfaces.showOverlay();
    else this.#surfaces.showMain();
  }

  mainRendererGone(): void {
    if (this.#quitting) return;
    if (!this.#recoveryUsed) {
      this.#recoveryUsed = true;
      try {
        // Replace only the presentation surface, never replay a workflow action.
        this.#surfaces.recreateMain();
        return;
      } catch {
        // A failed replacement has the same bounded stop path as a repeated crash.
      }
    }
    this.#quitting = true;
    this.#surfaces.stop();
  }

  beginQuit(): void {
    this.#quitting = true;
  }
}

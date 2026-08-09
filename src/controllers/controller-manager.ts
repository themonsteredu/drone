import type {
  AdapterMatch,
  ControllerAdapter,
  DetectionContext,
  DeviceInfo,
} from "./types";

export interface RankedAdapter {
  adapter: ControllerAdapter;
  match: AdapterMatch;
}

/**
 * Keeps input adapters independent from simulator/UI consumers. Candidate
 * matches are reported but never promoted to a confirmed product model.
 */
export class ControllerManager {
  private readonly adapters = new Map<string, ControllerAdapter>();
  private activeAdapterId: string | null = null;

  register(adapter: ControllerAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregister(adapterId: string): void {
    this.adapters.delete(adapterId);
    if (this.activeAdapterId === adapterId) this.activeAdapterId = null;
  }

  setActive(adapterId: string | null): void {
    if (adapterId !== null && !this.adapters.has(adapterId)) {
      throw new Error(`Unknown controller adapter: ${adapterId}`);
    }
    this.activeAdapterId = adapterId;
  }

  getActive(): ControllerAdapter | null {
    return this.activeAdapterId
      ? (this.adapters.get(this.activeAdapterId) ?? null)
      : null;
  }

  getAdapters(): ControllerAdapter[] {
    return [...this.adapters.values()];
  }

  detect(
    deviceInfo: DeviceInfo,
    context: DetectionContext = {},
  ): RankedAdapter[] {
    return this.getAdapters()
      .map((adapter) => ({
        adapter,
        match: adapter.matches(deviceInfo, context),
      }))
      .filter(({ match }) => match.confidence !== "none")
      .sort((left, right) => right.match.score - left.match.score);
  }

  isReady(adapter = this.getActive()): boolean {
    return adapter?.getDiagnostics().inputActive.status === "pass";
  }
}

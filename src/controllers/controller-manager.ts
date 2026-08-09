import type {
  AdapterMatch,
  ControllerAdapter,
  DetectionContext,
  DeviceInfo,
  ControllerState,
} from "./types";

export interface RankedAdapter {
  adapter: ControllerAdapter;
  match: AdapterMatch;
}

export type ControllerStateProjector = (
  state: ControllerState,
) => ControllerState;

/**
 * Keeps input adapters independent from simulator/UI consumers. Candidate
 * matches are reported but never promoted to a confirmed product model.
 */
export class ControllerManager {
  private readonly adapters = new Map<string, ControllerAdapter>();
  private activeAdapterId: string | null = null;
  private stateProjector: ControllerStateProjector | null = null;

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

  setStateProjector(projector: ControllerStateProjector | null): void {
    this.stateProjector = projector;
  }

  /** Stable UI/simulator boundary for the projected Common ControllerState. */
  getState(adapter = this.getActive()): ControllerState | null {
    if (!adapter) return null;
    const state = adapter.getState();
    return this.stateProjector ? this.stateProjector(state) : state;
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

  isReady(
    adapter = this.getActive(),
    state: ControllerState | null = this.getState(adapter),
  ): boolean {
    return Boolean(
      adapter &&
        state?.connected &&
        state.mappingStatus === "mapped" &&
        adapter.getDiagnostics().inputActive.status === "pass",
    );
  }
}

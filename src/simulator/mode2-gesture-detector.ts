import type { ControllerState } from "../controllers/types";

/**
 * Protocol-neutral BYROBOT Mode 2 gestures. This module consumes only the
 * semantic Common ControllerState contract; raw axis indices and 0x70 bits
 * remain the responsibility of ControllerAdapter/ControllerProfile.
 */
export const MODE2_GESTURE_PHASE = {
  READY: "READY",
  ARMING: "ARMING",
  ARMED: "ARMED",
} as const;

export type Mode2GesturePhase =
  (typeof MODE2_GESTURE_PHASE)[keyof typeof MODE2_GESTURE_PHASE];

export interface Mode2GestureBindings {
  /**
   * Stable semantic button ID supplied by a verified ControllerProfile or a
   * user mapping for the physical L button. Null deliberately disables the
   * emergency chord; this module never guesses a product-specific 0x70 bit.
   */
  emergencyButtonId: string | null;
}

export interface Mode2GestureConfig {
  armingHoldMs: number;
  /** Required magnitude for the two downward (vertical) stick axes. */
  armingDownThreshold: number;
  /** Required magnitude for the two inward (horizontal) stick axes. */
  armingInwardThreshold: number;
  /** Brief packet/analog jitter tolerated without losing the whole hold. */
  armingReleaseGraceMs: number;
  /** Throttle must be this low while the bound L button is held. */
  emergencyThrottleThreshold: number;
}

export interface Mode2GestureSnapshot {
  phase: Mode2GesturePhase;
  armingGestureActive: boolean;
  armingHeldMs: number;
  armingProgress: number;
  armingStarted: boolean;
  armed: boolean;
  emergencyChordActive: boolean;
  emergencyActivated: boolean;
}

export const DEFAULT_MODE2_GESTURE_BINDINGS: Readonly<Mode2GestureBindings> =
  Object.freeze({ emergencyButtonId: null });

export const DEFAULT_MODE2_GESTURE_CONFIG: Readonly<Mode2GestureConfig> =
  Object.freeze({
    armingHoldMs: 3000,
    // A diagonal stick does not report the same magnitude on both axes on
    // every BYROBOT controller. Keep the vertical threshold deliberate while
    // allowing the shorter horizontal travel observed on real hardware.
    armingDownThreshold: 0.4,
    armingInwardThreshold: 0.25,
    armingReleaseGraceMs: 650,
    emergencyThrottleThreshold: -0.75,
  });

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedMappedState(
  state: ControllerState | null | undefined,
): state is Extract<ControllerState, { mappingStatus: "mapped" }> {
  return Boolean(
    state &&
      state.connected &&
      state.mappingStatus === "mapped" &&
      Number.isFinite(state.throttle) &&
      Number.isFinite(state.yaw) &&
      Number.isFinite(state.pitch) &&
      Number.isFinite(state.roll),
  );
}

export function resolveMode2GestureConfig(
  overrides: Partial<Mode2GestureConfig> = {},
): Mode2GestureConfig {
  const merged = { ...DEFAULT_MODE2_GESTURE_CONFIG, ...overrides };
  return {
    armingHoldMs: Math.max(0, finiteOr(merged.armingHoldMs, 3000)),
    armingDownThreshold: clamp(
      Math.abs(finiteOr(merged.armingDownThreshold, 0.4)),
      0.2,
      1,
    ),
    armingInwardThreshold: clamp(
      Math.abs(finiteOr(merged.armingInwardThreshold, 0.25)),
      0.2,
      1,
    ),
    armingReleaseGraceMs: clamp(
      finiteOr(merged.armingReleaseGraceMs, 650),
      0,
      1_000,
    ),
    emergencyThrottleThreshold: clamp(
      finiteOr(merged.emergencyThrottleThreshold, -0.75),
      -1,
      -0.2,
    ),
  };
}

/**
 * Mode 2 inward/down start gesture:
 * - left stick about 5 o'clock: throttle down + positive semantic yaw
 * - right stick about 7 o'clock: pitch down + negative semantic roll after
 *   the verified BYROBOT Roll polarity correction
 */
export function isMode2ArmingGestureActive(
  state: ControllerState | null | undefined,
  settings: Partial<Mode2GestureConfig> = {},
): boolean {
  if (!normalizedMappedState(state)) return false;
  const config = resolveMode2GestureConfig(settings);
  return (
    state.throttle <= -config.armingDownThreshold &&
    state.yaw >= config.armingInwardThreshold &&
    state.pitch <= -config.armingDownThreshold &&
    state.roll <= -config.armingInwardThreshold
  );
}

export function isMode2EmergencyChordActive(
  state: ControllerState | null | undefined,
  bindings: Mode2GestureBindings = DEFAULT_MODE2_GESTURE_BINDINGS,
  settings: Partial<Mode2GestureConfig> = {},
): boolean {
  if (!normalizedMappedState(state)) return false;
  const buttonId = bindings.emergencyButtonId?.trim();
  if (!buttonId || state.buttons[buttonId] !== true) return false;
  return (
    state.throttle <=
    resolveMode2GestureConfig(settings).emergencyThrottleThreshold
  );
}

function readySnapshot(): Mode2GestureSnapshot {
  return {
    phase: MODE2_GESTURE_PHASE.READY,
    armingGestureActive: false,
    armingHeldMs: 0,
    armingProgress: 0,
    armingStarted: false,
    armed: false,
    emergencyChordActive: false,
    emergencyActivated: false,
  };
}

/** Stateful one-shot detector used by FlightController and student guidance. */
export class Mode2GestureDetector {
  private phase: Mode2GesturePhase = MODE2_GESTURE_PHASE.READY;
  private armingStartedAt: number | null = null;
  private armingLastActiveAt: number | null = null;
  private emergencyWasActive = false;
  private snapshot: Mode2GestureSnapshot = readySnapshot();

  observe(
    state: ControllerState | null | undefined,
    now: number,
    bindings: Mode2GestureBindings = DEFAULT_MODE2_GESTURE_BINDINGS,
    settings: Partial<Mode2GestureConfig> = {},
  ): Mode2GestureSnapshot {
    const config = resolveMode2GestureConfig(settings);
    const observedAt = Math.max(0, finiteOr(now, 0));
    const armingGestureActive = isMode2ArmingGestureActive(state, config);
    const emergencyChordActive = isMode2EmergencyChordActive(
      state,
      bindings,
      config,
    );
    const emergencyActivated =
      emergencyChordActive && !this.emergencyWasActive;
    this.emergencyWasActive = emergencyChordActive;

    let armingStarted = false;
    let justArmed = false;

    if (this.phase !== MODE2_GESTURE_PHASE.ARMED) {
      if (armingGestureActive) {
        this.armingLastActiveAt = observedAt;
      }
      const releaseWithinGrace = Boolean(
        !armingGestureActive &&
          this.phase === MODE2_GESTURE_PHASE.ARMING &&
          this.armingLastActiveAt !== null &&
          observedAt - this.armingLastActiveAt <= config.armingReleaseGraceMs,
      );
      if (!armingGestureActive && !releaseWithinGrace) {
        this.phase = MODE2_GESTURE_PHASE.READY;
        this.armingStartedAt = null;
        this.armingLastActiveAt = null;
      } else {
        if (
          this.armingStartedAt === null ||
          observedAt < this.armingStartedAt
        ) {
          this.armingStartedAt = observedAt;
          armingStarted = true;
        }
        this.phase = MODE2_GESTURE_PHASE.ARMING;
        if (
          armingGestureActive &&
          observedAt - this.armingStartedAt >= config.armingHoldMs
        ) {
          this.phase = MODE2_GESTURE_PHASE.ARMED;
          justArmed = true;
        }
      }
    }

    const armingHeldMs =
      this.armingStartedAt === null
        ? 0
        : Math.max(0, observedAt - this.armingStartedAt);
    const armingProgress =
      this.phase === MODE2_GESTURE_PHASE.ARMED
        ? 1
        : config.armingHoldMs === 0
          ? armingGestureActive
            ? 1
            : 0
          : clamp(armingHeldMs / config.armingHoldMs, 0, 1);

    this.snapshot = {
      phase: this.phase,
      armingGestureActive,
      armingHeldMs,
      armingProgress,
      armingStarted,
      armed: justArmed,
      emergencyChordActive,
      emergencyActivated,
    };
    return this.getSnapshot();
  }

  reset(): Mode2GestureSnapshot {
    this.phase = MODE2_GESTURE_PHASE.READY;
    this.armingStartedAt = null;
    this.armingLastActiveAt = null;
    this.emergencyWasActive = false;
    this.snapshot = readySnapshot();
    return this.getSnapshot();
  }

  getSnapshot(): Mode2GestureSnapshot {
    return { ...this.snapshot };
  }
}

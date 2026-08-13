import type { ControllerState } from "../controllers/types";
import {
  FLIGHT_PHASE,
  applyFlightCollisionResponse,
  applyFlightWorldForce,
  applyFlightCommand,
  createInitialFlightState,
  neutralizeFlightMotion,
  stepFlightState,
  type FlightCommand,
  type FlightControlInput,
  type FlightPhase,
  type FlightState,
  type FlightVector3,
} from "./flight-model";
import type { SimulatorPreferences } from "./settings";
import {
  DEFAULT_MODE2_GESTURE_BINDINGS,
  Mode2GestureDetector,
  type Mode2GestureBindings,
  type Mode2GestureSnapshot,
} from "./mode2-gesture-detector";

// Serial polling requests Joystick and Button in turn. A classroom USB link
// can occasionally delay a response while the sticks are held still, so keep
// a bounded 1.2 second window without allowing a single sample to complete a
// three-second arming hold.
export const INPUT_STALE_AFTER_MS = 1_200;

const ZERO_INPUT: Readonly<FlightControlInput> = {
  throttle: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  active: false,
};

export interface FlightActionAvailability {
  start: boolean;
  takeoff: boolean;
  land: boolean;
  reset: boolean;
  emergency: boolean;
}

function cloneState(state: FlightState): FlightState {
  return {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
    tilt: { ...state.tilt },
    smoothedInput: { ...state.smoothedInput },
  };
}

export function getFlightActionAvailability(
  phase: FlightPhase,
  emergencyLatched = false,
): FlightActionAvailability {
  const airborne =
    phase === FLIGHT_PHASE.TAKEOFF ||
    phase === FLIGHT_PHASE.FLIGHT ||
    phase === FLIGHT_PHASE.LANDING ||
    phase === FLIGHT_PHASE.EMERGENCY;
  return {
    start:
      !emergencyLatched &&
      (phase === FLIGHT_PHASE.READY ||
        phase === FLIGHT_PHASE.ARMING ||
        phase === FLIGHT_PHASE.STOP),
    takeoff:
      phase === FLIGHT_PHASE.ARMED || phase === FLIGHT_PHASE.START,
    land: phase === FLIGHT_PHASE.TAKEOFF || phase === FLIGHT_PHASE.FLIGHT,
    reset: !airborne,
    // Keep the safety action visible, but enable it only after motor start.
    // This avoids creating an emergency latch from an accidental ground tap.
    emergency:
      phase === FLIGHT_PHASE.ARMED ||
      phase === FLIGHT_PHASE.START ||
      airborne,
  };
}

/**
 * Protocol-neutral coordinator between Common ControllerState and physics.
 * It owns stale/disconnect safety and flight commands, but no rendering or
 * BYROBOT packet knowledge.
 */
export class FlightController {
  private state: FlightState = createInitialFlightState();
  private input: FlightControlInput = { ...ZERO_INPUT };
  private controllerState: ControllerState | null = null;
  private controlsEnabled = false;
  private inputUpdatedAt: number | null = null;
  private inputWasFresh = false;
  private preferences: SimulatorPreferences;
  private readonly mode2GestureDetector = new Mode2GestureDetector();
  private mode2Bindings: Mode2GestureBindings = {
    ...DEFAULT_MODE2_GESTURE_BINDINGS,
  };

  constructor(preferences: SimulatorPreferences) {
    this.preferences = preferences;
  }

  setPreferences(preferences: SimulatorPreferences): void {
    this.preferences = preferences;
  }

  /**
   * Binds the logical L button after a ControllerProfile or user mapping has
   * identified it. Null keeps emergency detection disabled rather than
   * guessing a product-specific 0x70 bit.
   */
  setMode2Bindings(bindings: Mode2GestureBindings): void {
    this.mode2Bindings = {
      emergencyButtonId: bindings.emergencyButtonId?.trim() || null,
    };
  }

  setControllerState(
    controllerState: ControllerState,
    controlsEnabled: boolean,
    inputUpdatedAt: number | null,
  ): void {
    const wasEnabled = this.controlsEnabled;
    this.controlsEnabled = controlsEnabled;
    this.inputUpdatedAt = inputUpdatedAt;
    this.controllerState = {
      ...controllerState,
      buttons: { ...controllerState.buttons },
      rawAxes: controllerState.rawAxes
        ? [...controllerState.rawAxes]
        : undefined,
      rawButtons: controllerState.rawButtons
        ? [...controllerState.rawButtons]
        : undefined,
    };
    if (controllerState.mappingStatus === "mapped" && controlsEnabled) {
      this.input = {
        throttle: controllerState.throttle,
        yaw: controllerState.yaw,
        pitch: controllerState.pitch,
        roll: controllerState.roll,
        active: true,
      };
    } else {
      this.input = { ...ZERO_INPUT };
    }

    if (wasEnabled && !controlsEnabled) this.resetInputSession();
  }

  dispatch(command: FlightCommand): FlightState {
    this.state = applyFlightCommand(this.state, command);
    if (command === "reset") this.mode2GestureDetector.reset();
    return this.getState();
  }

  step(
    elapsedSeconds: number,
    now: number,
    pageVisible: boolean,
  ): FlightState {
    const inputIsFresh = Boolean(
      pageVisible &&
        this.controlsEnabled &&
        this.inputUpdatedAt !== null &&
        now - this.inputUpdatedAt <= INPUT_STALE_AFTER_MS,
    );
    if (!inputIsFresh && this.inputWasFresh) this.neutralize();
    this.inputWasFresh = inputIsFresh;

    // The gesture consumes semantic ControllerState values, so it remains
    // valid for both the default profile and a user-owned axis mapping. A
    // persisted custom mapping must never silently disable stick arming.
    const gesture = this.mode2GestureDetector.observe(
      inputIsFresh ? this.controllerState : null,
      now,
      this.mode2Bindings,
    );
    if (
      this.state.phase === FLIGHT_PHASE.READY &&
      gesture.phase === FLIGHT_PHASE.ARMING
    ) {
      this.state = applyFlightCommand(this.state, "begin-arming");
    }
    if (
      this.state.phase === FLIGHT_PHASE.ARMING &&
      gesture.phase === FLIGHT_PHASE.READY
    ) {
      this.state = applyFlightCommand(this.state, "cancel-arming");
    }
    if (gesture.armed) {
      this.state = applyFlightCommand(this.state, "arm");
    }
    if (
      gesture.emergencyActivated &&
      getFlightActionAvailability(
        this.state.phase,
        this.state.emergencyLatched,
      ).emergency
    ) {
      this.state = applyFlightCommand(this.state, "emergency");
    }

    const previousPhase = this.state.phase;
    this.state = stepFlightState(
      this.state,
      inputIsFresh ? this.input : ZERO_INPUT,
      elapsedSeconds,
      {
        speedLevel: this.preferences.speedLevel,
        headless: this.preferences.headless,
        stabilization: this.preferences.stabilization,
        deadZone: this.preferences.deadZone,
        expo: this.preferences.expo,
        sensitivity: this.preferences.sensitivity,
      },
    );
    if (
      previousPhase !== FLIGHT_PHASE.READY &&
      this.state.phase === FLIGHT_PHASE.READY
    ) {
      this.mode2GestureDetector.reset();
    }
    return this.getState();
  }

  neutralize(): FlightState {
    this.state = neutralizeFlightMotion(this.state);
    this.inputWasFresh = false;
    return this.getState();
  }

  /** Applies a world-space acceleration such as data-defined mission wind. */
  applyWorldForce(
    force: Readonly<FlightVector3>,
    elapsedSeconds: number,
  ): FlightState {
    this.state = applyFlightWorldForce(
      this.state,
      force,
      elapsedSeconds,
    );
    return this.getState();
  }

  applyCollisionResponse(): FlightState {
    this.state = applyFlightCollisionResponse(this.state);
    return this.getState();
  }

  resetInputSession(): FlightState {
    this.input = { ...ZERO_INPUT };
    this.controllerState = null;
    this.controlsEnabled = false;
    this.inputUpdatedAt = null;
    this.mode2GestureDetector.reset();
    if (
      this.state.phase === FLIGHT_PHASE.ARMING ||
      this.state.phase === FLIGHT_PHASE.ARMED
    ) {
      this.state = applyFlightCommand(this.state, "reset");
    }
    return this.neutralize();
  }

  getState(): FlightState {
    return cloneState(this.state);
  }

  getMode2GestureState(): Mode2GestureSnapshot {
    return this.mode2GestureDetector.getSnapshot();
  }
}

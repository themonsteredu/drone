import type { ControllerState } from "../controllers/types";
import {
  FLIGHT_PHASE,
  applyFlightCommand,
  createInitialFlightState,
  neutralizeFlightMotion,
  stepFlightState,
  type FlightCommand,
  type FlightControlInput,
  type FlightPhase,
  type FlightState,
} from "./flight-model";
import type { SimulatorPreferences } from "./settings";

export const INPUT_STALE_AFTER_MS = 500;

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
      (phase === FLIGHT_PHASE.READY || phase === FLIGHT_PHASE.STOP),
    takeoff: phase === FLIGHT_PHASE.START,
    land: phase === FLIGHT_PHASE.TAKEOFF || phase === FLIGHT_PHASE.FLIGHT,
    reset: !airborne,
    // Keep the safety action visible, but enable it only after motor start.
    // This avoids creating an emergency latch from an accidental ground tap.
    emergency: phase === FLIGHT_PHASE.START || airborne,
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
  private controlsEnabled = false;
  private inputUpdatedAt: number | null = null;
  private inputWasFresh = false;
  private preferences: SimulatorPreferences;

  constructor(preferences: SimulatorPreferences) {
    this.preferences = preferences;
  }

  setPreferences(preferences: SimulatorPreferences): void {
    this.preferences = preferences;
  }

  setControllerState(
    controllerState: ControllerState,
    controlsEnabled: boolean,
    inputUpdatedAt: number | null,
  ): void {
    const wasEnabled = this.controlsEnabled;
    this.controlsEnabled = controlsEnabled;
    this.inputUpdatedAt = inputUpdatedAt;
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

    if (wasEnabled && !controlsEnabled) this.neutralize();
  }

  dispatch(command: FlightCommand): FlightState {
    this.state = applyFlightCommand(this.state, command);
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
    return this.getState();
  }

  neutralize(): FlightState {
    this.state = neutralizeFlightMotion(this.state);
    this.inputWasFresh = false;
    return this.getState();
  }

  resetInputSession(): FlightState {
    this.input = { ...ZERO_INPUT };
    this.controlsEnabled = false;
    this.inputUpdatedAt = null;
    return this.neutralize();
  }

  getState(): FlightState {
    return cloneState(this.state);
  }
}

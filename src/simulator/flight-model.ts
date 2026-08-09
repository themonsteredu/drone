export type FlightMode =
  | "landed"
  | "taking_off"
  | "flying"
  | "landing"
  | "emergency";

export type FlightCommand = "takeoff" | "land" | "emergency" | "reset";

export interface FlightVector3 {
  x: number;
  y: number;
  z: number;
}

export interface FlightAxes {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface FlightControlInput extends FlightAxes {
  /** False means that a disconnected, stale, or unmapped controller is neutral. */
  active?: boolean;
  command?: FlightCommand | null;
}

export interface FlightTilt {
  /** Positive pitch means nose-down (forward) visual tilt. */
  pitch: number;
  /** Positive roll means right-side-down visual tilt. */
  roll: number;
}

export interface FlightState {
  mode: FlightMode;
  /** World coordinates: +Y is up and +Z is forward when yaw is zero. */
  position: FlightVector3;
  velocity: FlightVector3;
  /** Radians, positive clockwise when viewed from above. */
  yaw: number;
  yawRate: number;
  tilt: FlightTilt;
  smoothedInput: FlightAxes;
}

export interface FlightModelConfig {
  deadZone: number;
  inputResponseRate: number;
  horizontalVelocityResponseRate: number;
  verticalVelocityResponseRate: number;
  yawRateResponseRate: number;
  tiltResponseRate: number;
  maxHorizontalSpeed: number;
  maxVerticalSpeed: number;
  maxYawRate: number;
  maxTilt: number;
  takeoffHeight: number;
  takeoffSpeed: number;
  landingSpeed: number;
  emergencyDescentSpeed: number;
  maxElapsedSeconds: number;
  maxSubstepSeconds: number;
}

export const DEFAULT_DEAD_ZONE = 0.1;

export const DEFAULT_FLIGHT_CONFIG: Readonly<FlightModelConfig> = {
  deadZone: DEFAULT_DEAD_ZONE,
  inputResponseRate: 9,
  horizontalVelocityResponseRate: 4.5,
  verticalVelocityResponseRate: 5,
  yawRateResponseRate: 5.5,
  tiltResponseRate: 8,
  maxHorizontalSpeed: 3,
  maxVerticalSpeed: 2,
  maxYawRate: Math.PI,
  maxTilt: Math.PI / 10,
  takeoffHeight: 1.4,
  takeoffSpeed: 1.1,
  landingSpeed: 0.75,
  emergencyDescentSpeed: 2.5,
  // Prevent a background-tab resume from moving the drone several metres.
  maxElapsedSeconds: 0.25,
  // Fixed upper bound makes integration stable and nearly frame-rate invariant.
  maxSubstepSeconds: 1 / 120,
};

const ZERO_AXES: Readonly<FlightAxes> = {
  throttle: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
};

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampUnit(value: number): number {
  return clamp(finiteOrZero(value), -1, 1);
}

/**
 * Hard, symmetric and idempotent dead zone. Values at exactly the threshold
 * remain valid because the product requirement says values *below* 0.10 are
 * ignored. Smoothing removes the small discontinuity at the boundary.
 */
export function applyDeadZone(
  value: number,
  deadZone = DEFAULT_DEAD_ZONE,
): number {
  const normalized = clampUnit(value);
  const threshold = clamp(finiteOrZero(deadZone), 0, 1);
  return Math.abs(normalized) < threshold ? 0 : normalized;
}

export function conditionFlightInput(
  input: FlightControlInput,
  deadZone = DEFAULT_DEAD_ZONE,
): FlightAxes {
  if (input.active === false) return { ...ZERO_AXES };
  return {
    throttle: applyDeadZone(input.throttle, deadZone),
    yaw: applyDeadZone(input.yaw, deadZone),
    pitch: applyDeadZone(input.pitch, deadZone),
    roll: applyDeadZone(input.roll, deadZone),
  };
}

/** Exact exponential approach for a constant target over dt seconds. */
export function exponentialSmoothing(
  current: number,
  target: number,
  responseRate: number,
  dtSeconds: number,
): number {
  const dt = Math.max(0, finiteOrZero(dtSeconds));
  const rate = Math.max(0, finiteOrZero(responseRate));
  if (dt === 0 || rate === 0) return finiteOrZero(current);
  const alpha = 1 - Math.exp(-rate * dt);
  return finiteOrZero(current) + (finiteOrZero(target) - finiteOrZero(current)) * alpha;
}

export function createInitialFlightState(): FlightState {
  return {
    mode: "landed",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    yawRate: 0,
    tilt: { pitch: 0, roll: 0 },
    smoothedInput: { ...ZERO_AXES },
  };
}

function cloneFlightState(state: FlightState): FlightState {
  return {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
    tilt: { ...state.tilt },
    smoothedInput: { ...state.smoothedInput },
  };
}

/**
 * Immediately removes residual input and motion without teleporting or
 * changing the current flight mode. Intended for controller disconnect/stale
 * input handling, where an exponential coast would otherwise feel like drift.
 */
export function neutralizeFlightMotion(state: FlightState): FlightState {
  return {
    ...cloneFlightState(state),
    velocity: { x: 0, y: 0, z: 0 },
    yawRate: 0,
    tilt: { pitch: 0, roll: 0 },
    smoothedInput: { ...ZERO_AXES },
  };
}

function stoppedState(state: FlightState, mode: FlightMode): FlightState {
  return {
    ...neutralizeFlightMotion(state),
    mode,
  };
}

export function applyFlightCommand(
  state: FlightState,
  command: FlightCommand | null | undefined,
): FlightState {
  if (!command) return cloneFlightState(state);
  if (command === "reset") return createInitialFlightState();
  if (command === "emergency") {
    // Emergency is latched. Horizontal motion and yaw stop immediately; the
    // subsequent simulation steps perform a controlled rapid descent.
    return stoppedState(state, "emergency");
  }
  if (state.mode === "emergency") return cloneFlightState(state);

  if (command === "takeoff" && state.mode === "landed") {
    return { ...cloneFlightState(state), mode: "taking_off" };
  }
  if (
    command === "land" &&
    (state.mode === "taking_off" || state.mode === "flying")
  ) {
    return { ...cloneFlightState(state), mode: "landing" };
  }
  return cloneFlightState(state);
}

function wrapYaw(yaw: number): number {
  const fullTurn = Math.PI * 2;
  return ((yaw + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function smoothAxes(
  current: FlightAxes,
  target: FlightAxes,
  responseRate: number,
  dt: number,
): FlightAxes {
  return {
    throttle: exponentialSmoothing(current.throttle, target.throttle, responseRate, dt),
    yaw: exponentialSmoothing(current.yaw, target.yaw, responseRate, dt),
    pitch: exponentialSmoothing(current.pitch, target.pitch, responseRate, dt),
    roll: exponentialSmoothing(current.roll, target.roll, responseRate, dt),
  };
}

function stepFlightSubstate(
  state: FlightState,
  targetInput: FlightAxes,
  dt: number,
  config: FlightModelConfig,
): FlightState {
  const next = cloneFlightState(state);
  const acceptsManualControl = state.mode === "flying";
  const desiredInput = acceptsManualControl ? targetInput : ZERO_AXES;
  next.smoothedInput = smoothAxes(
    state.smoothedInput,
    desiredInput,
    config.inputResponseRate,
    dt,
  );

  let targetVerticalSpeed = 0;
  if (state.mode === "taking_off") targetVerticalSpeed = config.takeoffSpeed;
  else if (state.mode === "landing") targetVerticalSpeed = -config.landingSpeed;
  else if (state.mode === "emergency") {
    targetVerticalSpeed = -config.emergencyDescentSpeed;
  } else if (acceptsManualControl) {
    targetVerticalSpeed = next.smoothedInput.throttle * config.maxVerticalSpeed;
  }

  const forwardX = Math.sin(state.yaw);
  const forwardZ = Math.cos(state.yaw);
  const rightX = Math.cos(state.yaw);
  const rightZ = -Math.sin(state.yaw);
  const targetForwardSpeed = acceptsManualControl
    ? next.smoothedInput.pitch * config.maxHorizontalSpeed
    : 0;
  const targetRightSpeed = acceptsManualControl
    ? next.smoothedInput.roll * config.maxHorizontalSpeed
    : 0;
  const targetVelocityX =
    forwardX * targetForwardSpeed + rightX * targetRightSpeed;
  const targetVelocityZ =
    forwardZ * targetForwardSpeed + rightZ * targetRightSpeed;
  const targetYawRate = acceptsManualControl
    ? next.smoothedInput.yaw * config.maxYawRate
    : 0;

  next.velocity = {
    x: exponentialSmoothing(
      state.velocity.x,
      targetVelocityX,
      config.horizontalVelocityResponseRate,
      dt,
    ),
    y: exponentialSmoothing(
      state.velocity.y,
      targetVerticalSpeed,
      config.verticalVelocityResponseRate,
      dt,
    ),
    z: exponentialSmoothing(
      state.velocity.z,
      targetVelocityZ,
      config.horizontalVelocityResponseRate,
      dt,
    ),
  };
  next.yawRate = exponentialSmoothing(
    state.yawRate,
    targetYawRate,
    config.yawRateResponseRate,
    dt,
  );

  // Trapezoidal integration is stable while remaining inexpensive enough for
  // requestAnimationFrame. Fixed-size internal substeps make the result nearly
  // independent of display refresh rate.
  next.position = {
    x: state.position.x + ((state.velocity.x + next.velocity.x) / 2) * dt,
    y: state.position.y + ((state.velocity.y + next.velocity.y) / 2) * dt,
    z: state.position.z + ((state.velocity.z + next.velocity.z) / 2) * dt,
  };
  next.yaw = wrapYaw(
    state.yaw + ((state.yawRate + next.yawRate) / 2) * dt,
  );
  next.tilt = {
    pitch: exponentialSmoothing(
      state.tilt.pitch,
      acceptsManualControl ? next.smoothedInput.pitch * config.maxTilt : 0,
      config.tiltResponseRate,
      dt,
    ),
    roll: exponentialSmoothing(
      state.tilt.roll,
      acceptsManualControl ? next.smoothedInput.roll * config.maxTilt : 0,
      config.tiltResponseRate,
      dt,
    ),
  };

  if (state.mode === "taking_off" && next.position.y >= config.takeoffHeight) {
    next.position.y = config.takeoffHeight;
    next.velocity.y = 0;
    next.mode = "flying";
  }

  if (next.position.y <= 0) {
    next.position.y = 0;
    if (state.mode === "landing" || state.mode === "flying") {
      return stoppedState(next, "landed");
    }
    if (state.mode === "emergency") {
      return stoppedState(next, "emergency");
    }
    if (state.mode === "landed") return stoppedState(next, "landed");
  }

  return next;
}

/**
 * Advances one deterministic simulator frame without mutating its arguments.
 * Controller contract: throttle +up, yaw +clockwise, pitch +forward, roll
 * +right. A command is consumed once by this call.
 */
export function stepFlightState(
  state: FlightState,
  input: FlightControlInput,
  dtSeconds: number,
  config: FlightModelConfig = DEFAULT_FLIGHT_CONFIG,
): FlightState {
  let next = applyFlightCommand(state, input.command);
  const elapsed = clamp(
    finiteOrZero(dtSeconds),
    0,
    Math.max(0, finiteOrZero(config.maxElapsedSeconds)),
  );
  if (elapsed === 0) return next;

  const targetInput = conditionFlightInput(input, config.deadZone);
  const maximumSubstep = Math.max(
    1 / 1000,
    finiteOrZero(config.maxSubstepSeconds),
  );
  const substepCount = Math.max(1, Math.ceil(elapsed / maximumSubstep));
  const substep = elapsed / substepCount;
  for (let index = 0; index < substepCount; index += 1) {
    next = stepFlightSubstate(next, targetInput, substep, config);
  }
  return next;
}

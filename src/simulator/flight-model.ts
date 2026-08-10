/**
 * Protocol-neutral flight controls and deterministic simulator physics.
 *
 * The controller/adapter boundary owns hardware-specific axis direction. This
 * module therefore has one stable semantic contract:
 *
 * - throttle +1: up
 * - yaw +1: clockwise
 * - pitch +1: forward
 * - roll +1: aircraft-right
 */

export const FLIGHT_PHASE = {
  READY: "READY",
  ARMING: "ARMING",
  ARMED: "ARMED",
  // Legacy screen-command phases are retained for teacher tools and existing
  // saved classroom flows. Student Mode 2 uses READY -> ARMING -> ARMED.
  START: "START",
  TAKEOFF: "TAKEOFF",
  FLIGHT: "FLIGHT",
  LANDING: "LANDING",
  STOP: "STOP",
  EMERGENCY: "EMERGENCY",
} as const;

export type FlightPhase = (typeof FLIGHT_PHASE)[keyof typeof FLIGHT_PHASE];

/**
 * Compatibility display value retained for the existing simulator UI. New
 * code should use `FlightState.phase`, which represents the full state machine.
 */
export type FlightMode =
  | "landed"
  | "taking_off"
  | "flying"
  | "landing"
  | "emergency";

export type FlightCommand =
  | "begin-arming"
  | "cancel-arming"
  | "arm"
  | "start"
  | "takeoff"
  | "land"
  | "emergency"
  | "stop"
  | "reset";

export type FlightSpeedLevel = "beginner" | "normal" | "high";

export const FLIGHT_SPEED_SCALE: Readonly<Record<FlightSpeedLevel, number>> = {
  beginner: 0.35,
  normal: 0.65,
  high: 1,
};

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
  /** Full educational flight state machine. */
  phase: FlightPhase;
  /** Legacy display state; use `phase` for transitions and behavior. */
  mode: FlightMode;
  /** World coordinates: +Y is up and +Z is forward when yaw is zero. */
  position: FlightVector3;
  velocity: FlightVector3;
  /** Radians, positive clockwise when viewed from above. */
  yaw: number;
  yawRate: number;
  tilt: FlightTilt;
  smoothedInput: FlightAxes;
  /** Heading captured when takeoff begins; used by headless mode. */
  takeoffYaw: number;
  /** Normalized animation signal. Rendering remains a DroneVisual concern. */
  rotorSpeed: number;
  /** Requires reset after an emergency has completed. */
  emergencyLatched: boolean;
  /** Low-throttle time accumulated only while touching the landing area. */
  groundLowThrottleSeconds: number;
}

export interface FlightModelConfig {
  /** Raw stick values at or inside this radius become zero. */
  deadZone: number;
  /** 0 is linear, 1 is cubic. Endpoints always remain +/-1. */
  expo: number;
  /** Additional user sensitivity before the selected speed level is applied. */
  sensitivity: number;
  speedLevel: FlightSpeedLevel;
  /** Uses the takeoff heading instead of current aircraft yaw for pitch/roll. */
  headless: boolean;
  stabilization: boolean;
  /** Positive throttle at which accidental yaw suppression may engage. */
  ascentYawSuppressionThrottle: number;
  /** Raw yaw up to this magnitude is treated as accidental during ascent. */
  ascentYawSuppressionLimit: number;
  inputResponseRate: number;
  horizontalVelocityResponseRate: number;
  verticalVelocityResponseRate: number;
  yawRateResponseRate: number;
  tiltResponseRate: number;
  stabilizedHorizontalDecelerationRate: number;
  directHorizontalDecelerationRate: number;
  stabilizedVerticalDecelerationRate: number;
  directVerticalDecelerationRate: number;
  stabilizedYawDecelerationRate: number;
  directYawDecelerationRate: number;
  stabilizedTiltReturnRate: number;
  directTiltReturnRate: number;
  nonFlightHorizontalResponseRate: number;
  maxHorizontalSpeed: number;
  maxVerticalSpeed: number;
  maxYawRate: number;
  maxTilt: number;
  /** Raw semantic throttle required to leave the ground after arming. */
  takeoffThrottleThreshold: number;
  /** Raw semantic throttle considered an intentional landing command. */
  landingThrottleThreshold: number;
  /** Height at which a held low throttle may disarm after touchdown. */
  landingDetectionHeight: number;
  landingDisarmHoldSeconds: number;
  takeoffHeight: number;
  takeoffSpeed: number;
  landingSpeed: number;
  emergencyDescentSpeed: number;
  landingSlowdownHeight: number;
  groundSnapHeight: number;
  rotorResponseRate: number;
  maxElapsedSeconds: number;
  maxSubstepSeconds: number;
}

export const DEFAULT_DEAD_ZONE = 0.1;
export const DEFAULT_EXPO = 0.45;
export const DEFAULT_SPEED_LEVEL: FlightSpeedLevel = "normal";

export const DEFAULT_FLIGHT_CONFIG: Readonly<FlightModelConfig> = {
  deadZone: DEFAULT_DEAD_ZONE,
  expo: DEFAULT_EXPO,
  sensitivity: 1,
  speedLevel: DEFAULT_SPEED_LEVEL,
  headless: false,
  stabilization: true,
  ascentYawSuppressionThrottle: 0.45,
  ascentYawSuppressionLimit: 0.2,
  inputResponseRate: 10,
  horizontalVelocityResponseRate: 4.8,
  verticalVelocityResponseRate: 5.2,
  yawRateResponseRate: 5.5,
  tiltResponseRate: 8,
  stabilizedHorizontalDecelerationRate: 6,
  directHorizontalDecelerationRate: 1.35,
  stabilizedVerticalDecelerationRate: 6.5,
  directVerticalDecelerationRate: 1.8,
  stabilizedYawDecelerationRate: 7,
  directYawDecelerationRate: 1.8,
  stabilizedTiltReturnRate: 9,
  directTiltReturnRate: 1.5,
  nonFlightHorizontalResponseRate: 8,
  maxHorizontalSpeed: 3,
  maxVerticalSpeed: 2,
  maxYawRate: Math.PI,
  maxTilt: Math.PI / 10,
  takeoffThrottleThreshold: 0.22,
  landingThrottleThreshold: -0.55,
  landingDetectionHeight: 0.12,
  landingDisarmHoldSeconds: 0.65,
  takeoffHeight: 1.4,
  takeoffSpeed: 1.1,
  landingSpeed: 0.72,
  // Emergency means safe, stabilized landing in the educational simulator.
  emergencyDescentSpeed: 0.95,
  landingSlowdownHeight: 0.45,
  groundSnapHeight: 0.012,
  rotorResponseRate: 5,
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

function positiveRate(value: number): number {
  return Math.max(0, finiteOrZero(value));
}

function isSpeedLevel(value: unknown): value is FlightSpeedLevel {
  return value === "beginner" || value === "normal" || value === "high";
}

/**
 * Resolves partial UI settings against safe defaults. The public step function
 * accepts partial settings so callers do not need to copy physics constants.
 */
export function resolveFlightModelConfig(
  overrides: Partial<FlightModelConfig> = {},
): FlightModelConfig {
  const merged = { ...DEFAULT_FLIGHT_CONFIG, ...overrides };
  return {
    ...merged,
    deadZone: clamp(finiteOrZero(merged.deadZone), 0, 0.95),
    expo: clamp(finiteOrZero(merged.expo), 0, 1),
    sensitivity: clamp(finiteOrZero(merged.sensitivity), 0, 2),
    speedLevel: isSpeedLevel(merged.speedLevel)
      ? merged.speedLevel
      : DEFAULT_SPEED_LEVEL,
    ascentYawSuppressionThrottle: clampUnit(
      merged.ascentYawSuppressionThrottle,
    ),
    ascentYawSuppressionLimit: clamp(
      Math.abs(finiteOrZero(merged.ascentYawSuppressionLimit)),
      0,
      1,
    ),
    inputResponseRate: positiveRate(merged.inputResponseRate),
    horizontalVelocityResponseRate: positiveRate(
      merged.horizontalVelocityResponseRate,
    ),
    verticalVelocityResponseRate: positiveRate(
      merged.verticalVelocityResponseRate,
    ),
    yawRateResponseRate: positiveRate(merged.yawRateResponseRate),
    tiltResponseRate: positiveRate(merged.tiltResponseRate),
    stabilizedHorizontalDecelerationRate: positiveRate(
      merged.stabilizedHorizontalDecelerationRate,
    ),
    directHorizontalDecelerationRate: positiveRate(
      merged.directHorizontalDecelerationRate,
    ),
    stabilizedVerticalDecelerationRate: positiveRate(
      merged.stabilizedVerticalDecelerationRate,
    ),
    directVerticalDecelerationRate: positiveRate(
      merged.directVerticalDecelerationRate,
    ),
    stabilizedYawDecelerationRate: positiveRate(
      merged.stabilizedYawDecelerationRate,
    ),
    directYawDecelerationRate: positiveRate(
      merged.directYawDecelerationRate,
    ),
    stabilizedTiltReturnRate: positiveRate(merged.stabilizedTiltReturnRate),
    directTiltReturnRate: positiveRate(merged.directTiltReturnRate),
    nonFlightHorizontalResponseRate: positiveRate(
      merged.nonFlightHorizontalResponseRate,
    ),
    maxHorizontalSpeed: positiveRate(merged.maxHorizontalSpeed),
    maxVerticalSpeed: positiveRate(merged.maxVerticalSpeed),
    maxYawRate: positiveRate(merged.maxYawRate),
    maxTilt: positiveRate(merged.maxTilt),
    takeoffThrottleThreshold: clamp(
      finiteOrZero(merged.takeoffThrottleThreshold),
      0.05,
      0.95,
    ),
    landingThrottleThreshold: clamp(
      finiteOrZero(merged.landingThrottleThreshold),
      -1,
      -0.05,
    ),
    landingDetectionHeight: positiveRate(merged.landingDetectionHeight),
    landingDisarmHoldSeconds: positiveRate(
      merged.landingDisarmHoldSeconds,
    ),
    takeoffHeight: positiveRate(merged.takeoffHeight),
    takeoffSpeed: positiveRate(merged.takeoffSpeed),
    landingSpeed: positiveRate(merged.landingSpeed),
    emergencyDescentSpeed: positiveRate(merged.emergencyDescentSpeed),
    landingSlowdownHeight: positiveRate(merged.landingSlowdownHeight),
    groundSnapHeight: positiveRate(merged.groundSnapHeight),
    rotorResponseRate: positiveRate(merged.rotorResponseRate),
    maxElapsedSeconds: positiveRate(merged.maxElapsedSeconds),
    maxSubstepSeconds: positiveRate(merged.maxSubstepSeconds),
  };
}

/**
 * Legacy hard dead-zone helper retained for existing diagnostics/tests. New
 * flight control uses `applyRescaledDeadZone` so full stick still reaches 1.
 */
export function applyDeadZone(
  value: number,
  deadZone = DEFAULT_DEAD_ZONE,
): number {
  const normalized = clampUnit(value);
  const threshold = clamp(finiteOrZero(deadZone), 0, 1);
  return Math.abs(normalized) < threshold ? 0 : normalized;
}

/**
 * Removes the center range and rescales the remainder back to 0..1. Thus a
 * larger dead zone never reduces the maximum available output.
 */
export function applyRescaledDeadZone(
  value: number,
  deadZone = DEFAULT_DEAD_ZONE,
): number {
  const normalized = clampUnit(value);
  const threshold = clamp(finiteOrZero(deadZone), 0, 0.95);
  const magnitude = Math.abs(normalized);
  if (magnitude <= threshold) return 0;
  const rescaled = (magnitude - threshold) / (1 - threshold);
  return Math.sign(normalized) * clamp(rescaled, 0, 1);
}

/** Linear-to-cubic expo blend; +/-1 remains +/-1 for every expo value. */
export function applyExpoCurve(value: number, expo = DEFAULT_EXPO): number {
  const normalized = clampUnit(value);
  const amount = clamp(finiteOrZero(expo), 0, 1);
  return clampUnit(
    (1 - amount) * normalized + amount * normalized * normalized * normalized,
  );
}

/**
 * Compatibility conditioner used by earlier diagnostics. It intentionally
 * keeps its historical hard-dead-zone behavior.
 */
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

/**
 * Student-facing control pipeline: dead zone -> full-range rescale -> expo ->
 * sensitivity -> speed level. Accidental yaw suppression uses raw stick values
 * so an intentional diagonal command remains available immediately.
 */
export function conditionFlightControls(
  input: FlightControlInput,
  settings: Partial<FlightModelConfig> = {},
): FlightAxes {
  if (input.active === false) return { ...ZERO_AXES };
  const config = resolveFlightModelConfig(settings);
  const rawThrottle = clampUnit(input.throttle);
  const rawYaw = clampUnit(input.yaw);

  const shape = (value: number): number =>
    clampUnit(
      applyExpoCurve(
        applyRescaledDeadZone(value, config.deadZone),
        config.expo,
      ) * config.sensitivity,
    );

  const scale = FLIGHT_SPEED_SCALE[config.speedLevel];
  const suppressAscentYaw =
    rawThrottle >= config.ascentYawSuppressionThrottle &&
    Math.abs(rawYaw) <= config.ascentYawSuppressionLimit;

  return {
    throttle: shape(rawThrottle) * scale,
    yaw: (suppressAscentYaw ? 0 : shape(rawYaw)) * scale,
    pitch: shape(input.pitch) * scale,
    roll: shape(input.roll) * scale,
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
  return (
    finiteOrZero(current) +
    (finiteOrZero(target) - finiteOrZero(current)) * alpha
  );
}

function legacyModeForPhase(
  phase: FlightPhase,
  emergencyLatched: boolean,
): FlightMode {
  if (phase === FLIGHT_PHASE.TAKEOFF) return "taking_off";
  if (phase === FLIGHT_PHASE.FLIGHT) return "flying";
  if (phase === FLIGHT_PHASE.LANDING) return "landing";
  if (phase === FLIGHT_PHASE.EMERGENCY || emergencyLatched) return "emergency";
  return "landed";
}

function phaseFromLegacyMode(mode: FlightMode): FlightPhase {
  if (mode === "taking_off") return FLIGHT_PHASE.TAKEOFF;
  if (mode === "flying") return FLIGHT_PHASE.FLIGHT;
  if (mode === "landing") return FLIGHT_PHASE.LANDING;
  if (mode === "emergency") return FLIGHT_PHASE.EMERGENCY;
  return FLIGHT_PHASE.READY;
}

function isFlightPhase(value: unknown): value is FlightPhase {
  return Object.values(FLIGHT_PHASE).includes(value as FlightPhase);
}

export function createInitialFlightState(): FlightState {
  return {
    phase: FLIGHT_PHASE.READY,
    mode: "landed",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    yawRate: 0,
    tilt: { pitch: 0, roll: 0 },
    smoothedInput: { ...ZERO_AXES },
    takeoffYaw: 0,
    rotorSpeed: 0,
    emergencyLatched: false,
    groundLowThrottleSeconds: 0,
  };
}

function normalizeFlightState(state: FlightState): FlightState {
  let phase = isFlightPhase(state.phase)
    ? state.phase
    : phaseFromLegacyMode(state.mode);
  const emergencyLatched = Boolean(state.emergencyLatched);
  const expectedMode = legacyModeForPhase(phase, emergencyLatched);

  // Supports older callers/tests that create a state by overriding `mode`.
  // A completed, latched emergency intentionally has phase STOP + mode emergency.
  if (
    state.mode !== expectedMode &&
    !(phase === FLIGHT_PHASE.STOP && emergencyLatched)
  ) {
    phase = phaseFromLegacyMode(state.mode);
  }

  return {
    ...state,
    phase,
    mode: legacyModeForPhase(phase, emergencyLatched),
    position: { ...state.position },
    velocity: { ...state.velocity },
    yaw: finiteOrZero(state.yaw),
    yawRate: finiteOrZero(state.yawRate),
    tilt: { ...state.tilt },
    smoothedInput: { ...state.smoothedInput },
    takeoffYaw: Number.isFinite(state.takeoffYaw)
      ? state.takeoffYaw
      : finiteOrZero(state.yaw),
    rotorSpeed: clamp(finiteOrZero(state.rotorSpeed), 0, 1),
    emergencyLatched,
    groundLowThrottleSeconds: Math.max(
      0,
      finiteOrZero(state.groundLowThrottleSeconds),
    ),
  };
}

function cloneFlightState(state: FlightState): FlightState {
  return normalizeFlightState(state);
}

function withPhase(state: FlightState, phase: FlightPhase): FlightState {
  const next = cloneFlightState(state);
  next.phase = phase;
  next.mode = legacyModeForPhase(phase, next.emergencyLatched);
  return next;
}

/**
 * Immediately removes residual input and motion without teleporting or
 * changing the current flight phase. Intended for controller disconnect/stale
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

/**
 * Applies a mission-neutral world-space acceleration (for example a gentle
 * wind zone) without giving MissionSystem access to mutable flight state.
 * It affects airborne manual flight only and is bounded for classroom safety.
 */
export function applyFlightWorldForce(
  state: FlightState,
  force: Readonly<FlightVector3>,
  elapsedSeconds: number,
  settings: Partial<FlightModelConfig> = {},
): FlightState {
  const current = cloneFlightState(state);
  if (current.phase !== FLIGHT_PHASE.FLIGHT) return current;

  const config = resolveFlightModelConfig(settings);
  const dt = clamp(finiteOrZero(elapsedSeconds), 0, config.maxElapsedSeconds);
  if (dt === 0) return current;

  // Mission definitions express this value as m/s². A bad definition cannot
  // accelerate a classroom drone without bound.
  const maximumAcceleration = 3;
  const acceleration = {
    x: clamp(finiteOrZero(force.x), -maximumAcceleration, maximumAcceleration),
    y: clamp(finiteOrZero(force.y), -maximumAcceleration, maximumAcceleration),
    z: clamp(finiteOrZero(force.z), -maximumAcceleration, maximumAcceleration),
  };
  let velocityX = current.velocity.x + acceleration.x * dt;
  let velocityZ = current.velocity.z + acceleration.z * dt;
  const planarSpeed = Math.hypot(velocityX, velocityZ);
  const maximumPlanarSpeed = config.maxHorizontalSpeed * 1.35;
  if (maximumPlanarSpeed <= 0) {
    velocityX = 0;
    velocityZ = 0;
  } else if (planarSpeed > maximumPlanarSpeed) {
    const scale = maximumPlanarSpeed / planarSpeed;
    velocityX *= scale;
    velocityZ *= scale;
  }

  return {
    ...current,
    velocity: {
      x: velocityX,
      y: clamp(
        current.velocity.y + acceleration.y * dt,
        -config.maxVerticalSpeed * 1.25,
        config.maxVerticalSpeed * 1.25,
      ),
      z: velocityZ,
    },
  };
}

/**
 * Classroom-safe collision response: remove most horizontal momentum and let
 * the existing stabilization loop level the aircraft. Mission scoring remains
 * outside FlightPhysics and receives only the collision event.
 */
export function applyFlightCollisionResponse(
  state: FlightState,
  retainedVelocity = 0.22,
): FlightState {
  const current = cloneFlightState(state);
  if (current.phase !== FLIGHT_PHASE.FLIGHT) return current;
  const retention = clamp(finiteOrZero(retainedVelocity), 0, 1);
  return {
    ...current,
    velocity: {
      x: current.velocity.x * retention,
      y: current.velocity.y * Math.max(retention, 0.5),
      z: current.velocity.z * retention,
    },
    yawRate: current.yawRate * 0.5,
  };
}

function stoppedState(
  state: FlightState,
  phase: FlightPhase,
): FlightState {
  return withPhase(neutralizeFlightMotion(state), phase);
}

export function applyFlightCommand(
  state: FlightState,
  command: FlightCommand | null | undefined,
): FlightState {
  const current = cloneFlightState(state);
  if (!command) return current;
  if (command === "reset") return createInitialFlightState();

  if (command === "emergency") {
    const emergency = stoppedState(current, FLIGHT_PHASE.EMERGENCY);
    emergency.emergencyLatched = true;
    emergency.mode = "emergency";
    if (emergency.position.y <= 0) {
      emergency.position.y = 0;
      emergency.phase = FLIGHT_PHASE.STOP;
    }
    return emergency;
  }

  if (current.emergencyLatched) return current;

  if (
    command === "begin-arming" &&
    current.phase === FLIGHT_PHASE.READY
  ) {
    return withPhase(current, FLIGHT_PHASE.ARMING);
  }

  if (
    command === "cancel-arming" &&
    current.phase === FLIGHT_PHASE.ARMING
  ) {
    return withPhase(current, FLIGHT_PHASE.READY);
  }

  if (
    command === "arm" &&
    (current.phase === FLIGHT_PHASE.READY ||
      current.phase === FLIGHT_PHASE.ARMING)
  ) {
    return withPhase(current, FLIGHT_PHASE.ARMED);
  }

  if (
    command === "start" &&
    (current.phase === FLIGHT_PHASE.READY ||
      current.phase === FLIGHT_PHASE.STOP)
  ) {
    return withPhase(current, FLIGHT_PHASE.START);
  }

  if (
    command === "takeoff" &&
    (current.phase === FLIGHT_PHASE.ARMED ||
      current.phase === FLIGHT_PHASE.START)
  ) {
    const takeoff = withPhase(current, FLIGHT_PHASE.TAKEOFF);
    takeoff.takeoffYaw = current.yaw;
    return takeoff;
  }

  if (
    command === "land" &&
    (current.phase === FLIGHT_PHASE.TAKEOFF ||
      current.phase === FLIGHT_PHASE.FLIGHT)
  ) {
    return withPhase(current, FLIGHT_PHASE.LANDING);
  }

  if (
    command === "stop" &&
    current.position.y <= 0 &&
    (current.phase === FLIGHT_PHASE.READY ||
      current.phase === FLIGHT_PHASE.START ||
      current.phase === FLIGHT_PHASE.STOP)
  ) {
    return stoppedState(current, FLIGHT_PHASE.STOP);
  }

  return current;
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
    throttle: exponentialSmoothing(
      current.throttle,
      target.throttle,
      responseRate,
      dt,
    ),
    yaw: exponentialSmoothing(current.yaw, target.yaw, responseRate, dt),
    pitch: exponentialSmoothing(current.pitch, target.pitch, responseRate, dt),
    roll: exponentialSmoothing(current.roll, target.roll, responseRate, dt),
  };
}

function isNearZero(value: number): boolean {
  return Math.abs(value) < 1e-8;
}

function snapSettledVelocity(
  value: number,
  target: number,
  stabilization: boolean,
): number {
  return stabilization && isNearZero(target) && Math.abs(value) < 0.004
    ? 0
    : value;
}

function targetRotorSpeed(phase: FlightPhase): number {
  if (phase === FLIGHT_PHASE.ARMED || phase === FLIGHT_PHASE.START) return 0.62;
  if (phase === FLIGHT_PHASE.TAKEOFF || phase === FLIGHT_PHASE.FLIGHT) return 1;
  if (phase === FLIGHT_PHASE.LANDING) return 0.76;
  if (phase === FLIGHT_PHASE.EMERGENCY) return 0.8;
  return 0;
}

function descentSpeedForHeight(
  height: number,
  maximumSpeed: number,
  slowdownHeight: number,
): number {
  if (slowdownHeight <= 0) return maximumSpeed;
  const nearGroundScale = clamp(height / slowdownHeight, 0.28, 1);
  return maximumSpeed * nearGroundScale;
}

function stepFlightSubstate(
  state: FlightState,
  targetInput: FlightAxes,
  manualTakeoffRequested: boolean,
  landingThrottleLow: boolean,
  dt: number,
  config: FlightModelConfig,
): FlightState {
  const current = cloneFlightState(state);
  const next = cloneFlightState(current);
  const acceptsManualControl = current.phase === FLIGHT_PHASE.FLIGHT;
  const acceptsArmedThrottle =
    current.phase === FLIGHT_PHASE.ARMED && manualTakeoffRequested;
  const desiredInput = acceptsManualControl
    ? targetInput
    : acceptsArmedThrottle
      ? { ...ZERO_AXES, throttle: Math.max(0, targetInput.throttle) }
      : ZERO_AXES;
  next.smoothedInput = smoothAxes(
    current.smoothedInput,
    desiredInput,
    config.inputResponseRate,
    dt,
  );

  let targetVerticalSpeed = 0;
  if (current.phase === FLIGHT_PHASE.TAKEOFF) {
    targetVerticalSpeed = config.takeoffSpeed;
  } else if (current.phase === FLIGHT_PHASE.LANDING) {
    targetVerticalSpeed = -descentSpeedForHeight(
      current.position.y,
      config.landingSpeed,
      config.landingSlowdownHeight,
    );
  } else if (current.phase === FLIGHT_PHASE.EMERGENCY) {
    targetVerticalSpeed = -descentSpeedForHeight(
      current.position.y,
      config.emergencyDescentSpeed,
      config.landingSlowdownHeight,
    );
  } else if (acceptsManualControl || acceptsArmedThrottle) {
    targetVerticalSpeed =
      next.smoothedInput.throttle * config.maxVerticalSpeed;
  }

  // Headless mode deliberately affects translation only; yaw still rotates the
  // aircraft and the red front marker normally.
  const movementYaw = config.headless ? current.takeoffYaw : current.yaw;
  const forwardX = Math.sin(movementYaw);
  const forwardZ = Math.cos(movementYaw);
  const rightX = Math.cos(movementYaw);
  const rightZ = -Math.sin(movementYaw);
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

  // Deceleration mode is selected from the user's current stick intent rather
  // than the already-smoothed target. Otherwise an exponentially decaying
  // target would postpone stabilization for several seconds after release.
  const hasHorizontalCommand =
    !isNearZero(desiredInput.pitch) || !isNearZero(desiredInput.roll);
  const hasVerticalCommand = !isNearZero(desiredInput.throttle);
  const hasYawCommand = !isNearZero(desiredInput.yaw);
  const horizontalResponseRate = acceptsManualControl
    ? hasHorizontalCommand
      ? config.horizontalVelocityResponseRate
      : config.stabilization
        ? config.stabilizedHorizontalDecelerationRate
        : config.directHorizontalDecelerationRate
    : config.nonFlightHorizontalResponseRate;
  const verticalResponseRate =
    acceptsManualControl && !hasVerticalCommand
      ? config.stabilization
        ? config.stabilizedVerticalDecelerationRate
        : config.directVerticalDecelerationRate
      : config.verticalVelocityResponseRate;
  const yawResponseRate =
    acceptsManualControl && !hasYawCommand
      ? config.stabilization
        ? config.stabilizedYawDecelerationRate
        : config.directYawDecelerationRate
      : config.yawRateResponseRate;

  next.velocity = {
    x: exponentialSmoothing(
      current.velocity.x,
      targetVelocityX,
      horizontalResponseRate,
      dt,
    ),
    y: exponentialSmoothing(
      current.velocity.y,
      targetVerticalSpeed,
      verticalResponseRate,
      dt,
    ),
    z: exponentialSmoothing(
      current.velocity.z,
      targetVelocityZ,
      horizontalResponseRate,
      dt,
    ),
  };
  next.yawRate = exponentialSmoothing(
    current.yawRate,
    targetYawRate,
    yawResponseRate,
    dt,
  );

  next.velocity.x = snapSettledVelocity(
    next.velocity.x,
    targetVelocityX,
    config.stabilization,
  );
  next.velocity.y = snapSettledVelocity(
    next.velocity.y,
    targetVerticalSpeed,
    config.stabilization,
  );
  next.velocity.z = snapSettledVelocity(
    next.velocity.z,
    targetVelocityZ,
    config.stabilization,
  );
  next.yawRate = snapSettledVelocity(
    next.yawRate,
    targetYawRate,
    config.stabilization,
  );

  // Trapezoidal integration is stable while remaining inexpensive enough for
  // requestAnimationFrame. Fixed-size substeps reduce refresh-rate dependence.
  next.position = {
    x: current.position.x + ((current.velocity.x + next.velocity.x) / 2) * dt,
    y: current.position.y + ((current.velocity.y + next.velocity.y) / 2) * dt,
    z: current.position.z + ((current.velocity.z + next.velocity.z) / 2) * dt,
  };
  next.yaw = wrapYaw(
    current.yaw + ((current.yawRate + next.yawRate) / 2) * dt,
  );

  const targetPitchTilt = acceptsManualControl
    ? config.stabilization && isNearZero(desiredInput.pitch)
      ? 0
      : next.smoothedInput.pitch * config.maxTilt
    : 0;
  const targetRollTilt = acceptsManualControl
    ? config.stabilization && isNearZero(desiredInput.roll)
      ? 0
      : next.smoothedInput.roll * config.maxTilt
    : 0;
  const tiltIsReturning =
    !acceptsManualControl ||
    (isNearZero(desiredInput.pitch) && isNearZero(desiredInput.roll));
  const tiltRate = tiltIsReturning
    ? config.stabilization
      ? config.stabilizedTiltReturnRate
      : config.directTiltReturnRate
    : config.tiltResponseRate;
  next.tilt = {
    pitch: exponentialSmoothing(
      current.tilt.pitch,
      targetPitchTilt,
      tiltRate,
      dt,
    ),
    roll: exponentialSmoothing(
      current.tilt.roll,
      targetRollTilt,
      tiltRate,
      dt,
    ),
  };
  next.rotorSpeed = clamp(
    exponentialSmoothing(
      current.rotorSpeed,
      targetRotorSpeed(current.phase),
      config.rotorResponseRate,
      dt,
    ),
    0,
    1,
  );

  const nearLandingSurface =
    next.position.y <= config.landingDetectionHeight;
  next.groundLowThrottleSeconds =
    current.phase === FLIGHT_PHASE.FLIGHT &&
    landingThrottleLow &&
    nearLandingSurface
      ? current.groundLowThrottleSeconds + dt
      : 0;

  if (
    current.phase === FLIGHT_PHASE.ARMED &&
    manualTakeoffRequested &&
    next.position.y > config.groundSnapHeight
  ) {
    next.takeoffYaw = current.yaw;
    next.groundLowThrottleSeconds = 0;
    return withPhase(next, FLIGHT_PHASE.FLIGHT);
  }

  if (
    current.phase === FLIGHT_PHASE.TAKEOFF &&
    next.position.y >= config.takeoffHeight
  ) {
    next.position.y = config.takeoffHeight;
    next.velocity.y = 0;
    return withPhase(next, FLIGHT_PHASE.FLIGHT);
  }

  const descending =
    current.phase === FLIGHT_PHASE.LANDING ||
    current.phase === FLIGHT_PHASE.EMERGENCY;
  const touchesGround =
    next.position.y <= 0 ||
    (descending &&
      next.position.y <= config.groundSnapHeight &&
      next.velocity.y <= 0);

  if (touchesGround) {
    next.position.y = 0;
    next.velocity.y = 0;
    if (current.phase === FLIGHT_PHASE.LANDING) {
      next.groundLowThrottleSeconds = 0;
      return stoppedState(next, FLIGHT_PHASE.READY);
    }
    if (current.phase === FLIGHT_PHASE.EMERGENCY) {
      return stoppedState(next, FLIGHT_PHASE.STOP);
    }
    if (
      current.phase === FLIGHT_PHASE.FLIGHT &&
      landingThrottleLow &&
      next.groundLowThrottleSeconds >= config.landingDisarmHoldSeconds
    ) {
      next.groundLowThrottleSeconds = 0;
      return stoppedState(next, FLIGHT_PHASE.READY);
    }
    if (current.phase === FLIGHT_PHASE.STOP) {
      return stoppedState(next, FLIGHT_PHASE.STOP);
    }
  }

  next.mode = legacyModeForPhase(next.phase, next.emergencyLatched);
  return next;
}

/**
 * Advances one deterministic simulator frame without mutating its arguments.
 * A command is consumed once by this call. Controller contract: throttle +up,
 * yaw +clockwise, pitch +forward, roll +aircraft-right.
 */
export function stepFlightState(
  state: FlightState,
  input: FlightControlInput,
  dtSeconds: number,
  settings: Partial<FlightModelConfig> = {},
): FlightState {
  const config = resolveFlightModelConfig(settings);
  let next = applyFlightCommand(state, input.command);
  const elapsed = clamp(
    finiteOrZero(dtSeconds),
    0,
    config.maxElapsedSeconds,
  );
  if (elapsed === 0) return next;

  const targetInput = conditionFlightControls(input, config);
  // Thresholds intentionally use raw normalized ControllerState semantics, so
  // takeoff/landing behavior is independent of speed level, expo, and user
  // sensitivity. The shaped value still controls the actual vertical speed.
  const inputActive = input.active !== false;
  const rawThrottle = clampUnit(input.throttle);
  const manualTakeoffRequested =
    inputActive && rawThrottle >= config.takeoffThrottleThreshold;
  const landingThrottleLow =
    inputActive && rawThrottle <= config.landingThrottleThreshold;
  const maximumSubstep = Math.max(1 / 1000, config.maxSubstepSeconds);
  const substepCount = Math.max(1, Math.ceil(elapsed / maximumSubstep));
  const substep = elapsed / substepCount;
  for (let index = 0; index < substepCount; index += 1) {
    next = stepFlightSubstate(
      next,
      targetInput,
      manualTakeoffRequested,
      landingThrottleLow,
      substep,
      config,
    );
  }
  return next;
}

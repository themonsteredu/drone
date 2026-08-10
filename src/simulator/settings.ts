export type FlightSpeedLevel = "beginner" | "normal" | "high";
export type ControllerControlMode = "byrobot" | "custom";
export type SimulatorSemanticAxis = "throttle" | "yaw" | "pitch" | "roll";

export interface CustomAxisBinding {
  axisIndex: number;
  inverted: boolean;
}

export type CustomAxisMapping = Record<
  SimulatorSemanticAxis,
  CustomAxisBinding
>;

export interface SimulatorPreferences {
  version: 2;
  speedLevel: FlightSpeedLevel;
  controlMode: ControllerControlMode;
  headless: boolean;
  stabilization: boolean;
  deadZone: number;
  sensitivity: number;
  expo: number;
  customAxisMapping: CustomAxisMapping;
}

export const SIMULATOR_PREFERENCES_STORAGE_KEY =
  "byrobot-drone-simulator-preferences-v2";
export const LEGACY_SIMULATOR_PREFERENCES_STORAGE_KEY =
  "byrobot-drone-simulator-preferences-v1";

export const SPEED_LEVEL_SCALE: Readonly<Record<FlightSpeedLevel, number>> = {
  beginner: 0.35,
  normal: 0.65,
  high: 1,
};

/**
 * The default custom mapping mirrors the verified Coding/E input order. Roll
 * is inverted because the current hardware test established that its raw
 * right-stick X sign is opposite the simulator's semantic `roll + = right`
 * contract. Current hardware testing also established that left-stick X must
 * be inverted for semantic `yaw + = clockwise`. Pitch and throttle retain
 * their previously verified signs.
 */
export const DEFAULT_CUSTOM_AXIS_MAPPING: Readonly<CustomAxisMapping> = {
  throttle: { axisIndex: 1, inverted: false },
  yaw: { axisIndex: 0, inverted: true },
  pitch: { axisIndex: 3, inverted: false },
  roll: { axisIndex: 2, inverted: true },
};

export const DEFAULT_SIMULATOR_PREFERENCES: Readonly<SimulatorPreferences> = {
  version: 2,
  speedLevel: "normal",
  controlMode: "byrobot",
  headless: false,
  stabilization: true,
  deadZone: 0.1,
  sensitivity: 1,
  expo: 0.45,
  customAxisMapping: DEFAULT_CUSTOM_AXIS_MAPPING,
};

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isAxisBinding(value: unknown): value is CustomAxisBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CustomAxisBinding>;
  return (
    Number.isInteger(candidate.axisIndex) &&
    (candidate.axisIndex ?? -1) >= 0 &&
    (candidate.axisIndex ?? 99) <= 15 &&
    typeof candidate.inverted === "boolean"
  );
}

function cloneAxisMapping(mapping: CustomAxisMapping): CustomAxisMapping {
  return {
    throttle: { ...mapping.throttle },
    yaw: { ...mapping.yaw },
    pitch: { ...mapping.pitch },
    roll: { ...mapping.roll },
  };
}

export function createDefaultSimulatorPreferences(): SimulatorPreferences {
  return {
    ...DEFAULT_SIMULATOR_PREFERENCES,
    customAxisMapping: cloneAxisMapping(DEFAULT_CUSTOM_AXIS_MAPPING),
  };
}

/** Strict, versioned localStorage parser. Invalid or old data is ignored. */
export function parseSimulatorPreferences(
  value: unknown,
): SimulatorPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SimulatorPreferences>;
  if (
    candidate.version !== 2 ||
    !["beginner", "normal", "high"].includes(candidate.speedLevel ?? "") ||
    !["byrobot", "custom"].includes(candidate.controlMode ?? "") ||
    typeof candidate.headless !== "boolean" ||
    typeof candidate.stabilization !== "boolean" ||
    !finiteInRange(candidate.deadZone, 0, 0.3) ||
    !finiteInRange(candidate.sensitivity, 0.5, 1.5) ||
    !finiteInRange(candidate.expo, 0, 0.8) ||
    !candidate.customAxisMapping ||
    !isAxisBinding(candidate.customAxisMapping.throttle) ||
    !isAxisBinding(candidate.customAxisMapping.yaw) ||
    !isAxisBinding(candidate.customAxisMapping.pitch) ||
    !isAxisBinding(candidate.customAxisMapping.roll)
  ) {
    return null;
  }

  const axisIndices = Object.values(candidate.customAxisMapping).map(
    (binding) => binding.axisIndex,
  );
  if (new Set(axisIndices).size !== axisIndices.length) return null;

  return {
    version: 2,
    speedLevel: candidate.speedLevel as FlightSpeedLevel,
    controlMode: candidate.controlMode as ControllerControlMode,
    headless: candidate.headless,
    stabilization: candidate.stabilization,
    deadZone: candidate.deadZone,
    sensitivity: candidate.sensitivity,
    expo: candidate.expo,
    customAxisMapping: cloneAxisMapping(candidate.customAxisMapping),
  };
}

const LEGACY_DEFAULT_AXIS_MAPPING: Readonly<CustomAxisMapping> = {
  throttle: { axisIndex: 1, inverted: false },
  yaw: { axisIndex: 0, inverted: false },
  pitch: { axisIndex: 3, inverted: false },
  roll: { axisIndex: 2, inverted: true },
};

function sameAxisMapping(
  left: CustomAxisMapping,
  right: Readonly<CustomAxisMapping>,
): boolean {
  return (["throttle", "yaw", "pitch", "roll"] as const).every(
    (axis) =>
      left[axis].axisIndex === right[axis].axisIndex &&
      left[axis].inverted === right[axis].inverted,
  );
}

/**
 * Migrates the previous defaults without overwriting an intentional custom
 * mapping. Only the exact legacy default receives the hardware-tested Yaw fix.
 */
export function migrateLegacySimulatorPreferences(
  value: unknown,
): SimulatorPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Omit<
    Partial<SimulatorPreferences>,
    "version"
  > & { version?: unknown };
  const upgraded = parseSimulatorPreferences({ ...candidate, version: 2 });
  if (!upgraded || candidate.version !== 1) return null;
  return {
    ...upgraded,
    customAxisMapping: sameAxisMapping(
      upgraded.customAxisMapping,
      LEGACY_DEFAULT_AXIS_MAPPING,
    )
      ? cloneAxisMapping(DEFAULT_CUSTOM_AXIS_MAPPING)
      : cloneAxisMapping(upgraded.customAxisMapping),
  };
}

export function axisAssignmentsFromPreferences(
  preferences: SimulatorPreferences,
  axisCount: number,
): Array<SimulatorSemanticAxis | null> {
  const assignments: Array<SimulatorSemanticAxis | null> = Array.from(
    { length: Math.max(0, axisCount) },
    () => null,
  );
  for (const control of ["throttle", "yaw", "pitch", "roll"] as const) {
    const { axisIndex } = preferences.customAxisMapping[control];
    if (axisIndex < assignments.length) assignments[axisIndex] = control;
  }
  return assignments;
}

export function invertedAxesFromPreferences(
  preferences: SimulatorPreferences,
): number[] {
  return Object.values(preferences.customAxisMapping)
    .filter((binding) => binding.inverted)
    .map((binding) => binding.axisIndex);
}

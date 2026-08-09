import {
  normalizeControllerValue,
  type ControllerState,
} from "./types";

export type SemanticControl = "throttle" | "yaw" | "pitch" | "roll";

export type AxisControlAssignment = readonly (
  | SemanticControl
  | null
)[];

export interface AxisCalibration {
  index: number;
  rawCurrent: number | null;
  observedMinimum: number | null;
  observedMaximum: number | null;
  center: number | null;
  normalizedValue: number | null;
  inverted: boolean;
  deadZone: number;
  assignedControl: SemanticControl | null;
}

export function createAxisCalibration(index: number): AxisCalibration {
  return {
    index,
    rawCurrent: null,
    observedMinimum: null,
    observedMaximum: null,
    center: null,
    normalizedValue: null,
    inverted: false,
    deadZone: 0.1,
    assignedControl: null,
  };
}

/**
 * Creates an explicit, adapter-selected profile for a documented stick order.
 * The simulator still consumes a mapped ControllerState and never reads packet
 * payloads directly. Product adapters can supply a different assignment later.
 */
export function createFixedAxisProfile(
  rawAxes: number[],
  assignments: AxisControlAssignment,
  options: {
    deadZone?: number;
    invertedAxes?: readonly number[];
  } = {},
): AxisCalibration[] {
  const deadZone = Math.max(0, Math.min(0.95, options.deadZone ?? 0.1));
  const inverted = new Set(options.invertedAxes ?? []);

  return rawAxes.map((rawCurrent, index) => {
    const axis: AxisCalibration = {
      index,
      rawCurrent,
      observedMinimum: -1,
      observedMaximum: 1,
      center: 0,
      normalizedValue: null,
      inverted: inverted.has(index),
      deadZone,
      assignedControl: assignments[index] ?? null,
    };
    axis.normalizedValue = normalizeCalibratedAxis(axis);
    return axis;
  });
}

export function normalizeCalibratedAxis(
  axis: AxisCalibration,
): number | null {
  const { rawCurrent, observedMinimum, observedMaximum, center } = axis;
  if (
    rawCurrent === null ||
    observedMinimum === null ||
    observedMaximum === null ||
    center === null ||
    !(observedMinimum < center && center < observedMaximum)
  ) {
    return null;
  }

  const range =
    rawCurrent >= center
      ? observedMaximum - center
      : center - observedMinimum;
  if (range <= 0) return null;

  let value = normalizeControllerValue((rawCurrent - center) / range);
  const magnitude = Math.abs(value);
  // A hard dead zone matches the simulator contract and is idempotent if the
  // flight safety layer applies the same threshold again.
  if (magnitude < axis.deadZone) value = 0;

  return normalizeControllerValue(axis.inverted ? -value : value);
}

export function observeRawAxes(
  calibrations: AxisCalibration[],
  rawAxes: number[],
  recordRange: boolean,
): AxisCalibration[] {
  return rawAxes.map((rawCurrent, index) => {
    const current = calibrations[index] ?? createAxisCalibration(index);
    const next: AxisCalibration = {
      ...current,
      rawCurrent,
      observedMinimum: recordRange
        ? Math.min(current.observedMinimum ?? rawCurrent, rawCurrent)
        : current.observedMinimum,
      observedMaximum: recordRange
        ? Math.max(current.observedMaximum ?? rawCurrent, rawCurrent)
        : current.observedMaximum,
    };
    next.normalizedValue = normalizeCalibratedAxis(next);
    return next;
  });
}

export function saveAxisCenters(
  calibrations: AxisCalibration[],
): AxisCalibration[] {
  return calibrations.map((axis) => {
    const next = { ...axis, center: axis.rawCurrent };
    next.normalizedValue = normalizeCalibratedAxis(next);
    return next;
  });
}

export function resetAxisCalibrations(axisCount: number): AxisCalibration[] {
  return Array.from({ length: axisCount }, (_, index) =>
    createAxisCalibration(index),
  );
}

/**
 * Projects adapter raw axes through the user-owned calibration profile. Until
 * all four semantic controls are assigned and normalized, their values remain
 * null and the state is explicitly unidentified.
 */
export function projectMappedControllerState(
  source: ControllerState,
  calibrations: AxisCalibration[],
): ControllerState {
  const values: Record<SemanticControl, number | null> = {
    throttle: null,
    yaw: null,
    pitch: null,
    roll: null,
  };

  for (const axis of calibrations) {
    if (axis.assignedControl && axis.normalizedValue !== null) {
      values[axis.assignedControl] = axis.normalizedValue;
    }
  }

  if (
    values.throttle !== null &&
    values.yaw !== null &&
    values.pitch !== null &&
    values.roll !== null
  ) {
    return {
      ...source,
      mappingStatus: "mapped",
      throttle: values.throttle,
      yaw: values.yaw,
      pitch: values.pitch,
      roll: values.roll,
      buttons: { ...source.buttons },
      buttonTransitions: source.buttonTransitions?.map((entry) => ({ ...entry })),
      rawAxes: source.rawAxes ? [...source.rawAxes] : [],
      rawButtons: source.rawButtons ? [...source.rawButtons] : [],
    };
  }

  return {
    ...source,
    mappingStatus: "unidentified",
    throttle: null,
    yaw: null,
    pitch: null,
    roll: null,
    buttons: { ...source.buttons },
    buttonTransitions: source.buttonTransitions?.map((entry) => ({ ...entry })),
    rawAxes: source.rawAxes ? [...source.rawAxes] : [],
    rawButtons: source.rawButtons ? [...source.rawButtons] : [],
  };
}

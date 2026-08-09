import { normalizeControllerValue } from "./types";

export type SemanticControl = "throttle" | "yaw" | "pitch" | "roll";

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
    deadZone: 0.05,
    assignedControl: null,
  };
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
  if (magnitude <= axis.deadZone) value = 0;
  else {
    value =
      Math.sign(value) *
      ((magnitude - axis.deadZone) / Math.max(1 - axis.deadZone, 0.001));
  }

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

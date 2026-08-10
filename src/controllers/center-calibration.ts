export type CenterCalibrationStatus =
  | "idle"
  | "waiting-neutral"
  | "sampling"
  | "complete";

export interface CenterCalibrationState {
  status: CenterCalibrationStatus;
  axisCount: number;
  startedAt: number | null;
  sampleCount: number;
  sums: number[];
  centers: number[];
}

export interface CenterCalibrationOptions {
  sampleDurationMs: number;
  minimumSamples: number;
  neutralLimit: number;
}

export const DEFAULT_CENTER_CALIBRATION_OPTIONS: Readonly<CenterCalibrationOptions> = {
  sampleDurationMs: 900,
  minimumSamples: 4,
  neutralLimit: 0.32,
};

export function createCenterCalibrationState(
  axisCount = 0,
): CenterCalibrationState {
  return {
    status: axisCount > 0 ? "waiting-neutral" : "idle",
    axisCount,
    startedAt: null,
    sampleCount: 0,
    sums: Array.from({ length: axisCount }, () => 0),
    centers: Array.from({ length: axisCount }, () => 0),
  };
}

export function restartCenterCalibration(
  axisCount: number,
): CenterCalibrationState {
  return createCenterCalibrationState(Math.max(0, axisCount));
}

/**
 * Automatic centering must advance only when a newly accepted joystick packet
 * arrives. The diagnostics UI refreshes more often than some controllers send
 * data, so sampling a cached rawAxes value on every refresh would manufacture
 * samples and could finish calibration after the input stream stopped.
 */
export function isNewCenterCalibrationSample(
  lastAcceptedAt: number | null,
  nextAcceptedAt: number | null,
): nextAcceptedAt is number {
  return (
    nextAcceptedAt !== null &&
    Number.isFinite(nextAcceptedAt) &&
    nextAcceptedAt !== lastAcceptedAt
  );
}

/**
 * Samples only while every stick is near neutral. A student holding a stick
 * during connection therefore cannot accidentally save an extreme position
 * as the center. The returned state is immutable and easy to unit test.
 */
export function observeCenterCalibration(
  state: CenterCalibrationState,
  rawAxes: readonly number[],
  observedAt: number,
  options: Partial<CenterCalibrationOptions> = {},
): CenterCalibrationState {
  const config = { ...DEFAULT_CENTER_CALIBRATION_OPTIONS, ...options };
  if (rawAxes.length === 0) return createCenterCalibrationState();
  if (state.status === "complete" && state.axisCount === rawAxes.length) {
    return state;
  }

  const finiteAxes = rawAxes.map((value) =>
    Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0,
  );
  const neutral = finiteAxes.every(
    (value) => Math.abs(value) <= config.neutralLimit,
  );
  if (!neutral) {
    return {
      ...createCenterCalibrationState(finiteAxes.length),
      status: "waiting-neutral",
    };
  }

  const compatible = state.axisCount === finiteAxes.length;
  const startedAt = compatible && state.startedAt !== null
    ? state.startedAt
    : observedAt;
  const sums = compatible
    ? state.sums.map((sum, index) => sum + finiteAxes[index])
    : [...finiteAxes];
  const sampleCount = compatible ? state.sampleCount + 1 : 1;
  const elapsed = Math.max(0, observedAt - startedAt);
  const complete =
    elapsed >= config.sampleDurationMs &&
    sampleCount >= config.minimumSamples;
  const centers = complete
    ? sums.map((sum) => sum / sampleCount)
    : Array.from({ length: finiteAxes.length }, () => 0);

  return {
    status: complete ? "complete" : "sampling",
    axisCount: finiteAxes.length,
    startedAt,
    sampleCount,
    sums,
    centers,
  };
}

export function centerCalibrationProgress(
  state: CenterCalibrationState,
  now: number,
  durationMs = DEFAULT_CENTER_CALIBRATION_OPTIONS.sampleDurationMs,
): number {
  if (state.status === "complete") return 1;
  if (state.startedAt === null || durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, (now - state.startedAt) / durationMs));
}

import { clamp } from "./geometry";
import type { BatteryConfig, BatteryState, ExperienceEvent } from "./types";

export const DEFAULT_BATTERY_CONFIG: Readonly<BatteryConfig> = {
  capacityPercent: 100,
  idleDrainPerSecond: 0.025,
  movementDrainPerSecond: 0.07,
  throttleDrainPerSecond: 0.055,
  speedMultipliers: {
    beginner: 0.8,
    normal: 1,
    high: 1.25,
  },
  lowThresholdPercent: 20,
};

export interface BatteryStepInput {
  elapsedSeconds: number;
  speedLevel: "beginner" | "normal" | "high";
  /** Horizontal motion demand, normalized to 0..1. */
  movementMagnitude: number;
  /** Absolute vertical demand, normalized to 0..1. */
  throttleMagnitude: number;
  atSeconds: number;
}

export interface BatteryStepResult {
  state: BatteryState;
  events: readonly ExperienceEvent[];
}

export function createBatteryState(
  initialPercent = DEFAULT_BATTERY_CONFIG.capacityPercent,
  config: BatteryConfig = DEFAULT_BATTERY_CONFIG,
): BatteryState {
  const percent = clamp(initialPercent, 0, config.capacityPercent);
  return {
    percent,
    low: percent <= config.lowThresholdPercent,
    depleted: percent <= 0,
  };
}

export function stepBattery(
  previous: BatteryState,
  input: BatteryStepInput,
  config: BatteryConfig = DEFAULT_BATTERY_CONFIG,
): BatteryStepResult {
  const elapsed = clamp(input.elapsedSeconds, 0, 5);
  const speedMultiplier = config.speedMultipliers[input.speedLevel];
  const drainPerSecond =
    config.idleDrainPerSecond +
    config.movementDrainPerSecond * clamp(input.movementMagnitude, 0, 1) * speedMultiplier +
    config.throttleDrainPerSecond * clamp(input.throttleMagnitude, 0, 1) * speedMultiplier;
  const percent = clamp(previous.percent - drainPerSecond * elapsed, 0, config.capacityPercent);
  const low = percent <= config.lowThresholdPercent;
  const depleted = percent <= 0;
  const events: ExperienceEvent[] = [];

  if (!previous.low && low) {
    events.push({ type: "batteryLow", atSeconds: input.atSeconds, percent });
  }
  if (!previous.depleted && depleted) {
    events.push({ type: "batteryDepleted", atSeconds: input.atSeconds });
  }

  return { state: { percent, low, depleted }, events };
}


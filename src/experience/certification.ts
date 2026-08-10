import { clamp } from "./geometry";

export const CERTIFICATION_TIME_LIMIT_SECONDS = 90;
export const CERTIFICATION_PASS_SCORE = 70;

export const CERTIFICATION_SCORE_WEIGHTS = {
  gates: 30,
  collisionFree: 20,
  stability: 20,
  landing: 20,
  time: 10,
} as const;

export interface CertificationAttemptMetrics {
  gatesPassed: number;
  requiredGates?: number;
  collisions: number;
  /** Fraction of sampled flight time considered stable, from 0 to 1. */
  stableFlightRatio: number;
  /** Landing assessment value: 100, 80, 60, 40 or 0. */
  landingAccuracyScore: number;
  elapsedSeconds: number;
  armed: boolean;
  tookOff: boolean;
  yawTurnCompleted: boolean;
  altitudeChangeCompleted: boolean;
  landed: boolean;
  emergencyActivated: boolean;
}

export interface CertificationScore {
  breakdown: {
    gates: number;
    collisionFree: number;
    stability: number;
    landing: number;
    time: number;
  };
  total: number;
  requirementsMet: boolean;
  qualified: boolean;
  message: "운항 자격 획득" | "다시 도전";
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Full time points through 60s, then a gentle linear decrease to zero at 90s. */
export function calculateCertificationTimePoints(elapsedSeconds: number): number {
  if (elapsedSeconds <= 60) {
    return CERTIFICATION_SCORE_WEIGHTS.time;
  }
  if (elapsedSeconds >= CERTIFICATION_TIME_LIMIT_SECONDS) {
    return 0;
  }
  return (
    CERTIFICATION_SCORE_WEIGHTS.time *
    ((CERTIFICATION_TIME_LIMIT_SECONDS - elapsedSeconds) /
      (CERTIFICATION_TIME_LIMIT_SECONDS - 60))
  );
}

export function calculateCertificationScore(
  metrics: CertificationAttemptMetrics,
): CertificationScore {
  const requiredGates = Math.max(1, Math.floor(metrics.requiredGates ?? 3));
  const completedGates = clamp(Math.floor(metrics.gatesPassed), 0, requiredGates);
  const breakdown = {
    gates: roundScore(
      CERTIFICATION_SCORE_WEIGHTS.gates * (completedGates / requiredGates),
    ),
    collisionFree: roundScore(
      Math.max(0, CERTIFICATION_SCORE_WEIGHTS.collisionFree - Math.max(0, metrics.collisions) * 5),
    ),
    stability: roundScore(
      CERTIFICATION_SCORE_WEIGHTS.stability * clamp(metrics.stableFlightRatio, 0, 1),
    ),
    landing: roundScore(
      CERTIFICATION_SCORE_WEIGHTS.landing *
        (clamp(metrics.landingAccuracyScore, 0, 100) / 100),
    ),
    time: roundScore(calculateCertificationTimePoints(Math.max(0, metrics.elapsedSeconds))),
  };
  const total = roundScore(Object.values(breakdown).reduce((sum, value) => sum + value, 0));
  const requirementsMet =
    metrics.armed &&
    metrics.tookOff &&
    completedGates === requiredGates &&
    metrics.yawTurnCompleted &&
    metrics.altitudeChangeCompleted &&
    metrics.landed &&
    !metrics.emergencyActivated &&
    metrics.landingAccuracyScore > 0 &&
    metrics.elapsedSeconds <= CERTIFICATION_TIME_LIMIT_SECONDS;
  const qualified = requirementsMet && total >= CERTIFICATION_PASS_SCORE;

  return {
    breakdown,
    total,
    requirementsMet,
    qualified,
    message: qualified ? "운항 자격 획득" : "다시 도전",
  };
}

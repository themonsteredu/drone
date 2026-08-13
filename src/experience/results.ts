import { clamp } from "./geometry";
import type { MissionDefinition } from "./types";
import type { MissionRuntimeState } from "./missions";

export type ActivityProfileLabel =
  | "안전 운항형"
  | "정밀 조종형"
  | "신속 대응형"
  | "탐색 전문형"
  | "균형 성장형";

export interface ResultCategory {
  score: number;
  stars: 1 | 2 | 3 | 4 | 5;
}

export interface ExperienceResult {
  missionId: string;
  title: string;
  completed: boolean;
  totalScore: number;
  safety: ResultCategory;
  stability: ResultCategory;
  landing: ResultCategory;
  objective: ResultCategory;
  time: ResultCategory;
  profileLabel: ActivityProfileLabel;
  profileReason: string;
  careerMessage: string;
}

function rounded(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

export function scoreToStars(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  return 1;
}

function category(score: number): ResultCategory {
  const normalized = rounded(score);
  return { score: normalized, stars: scoreToStars(normalized) };
}

function calculateTimeScore(elapsedSeconds: number, limitSeconds: number): number {
  if (limitSeconds <= 0) return 0;
  const ratio = elapsedSeconds / limitSeconds;
  if (ratio <= 0.6) return 100;
  if (ratio >= 1) return 0;
  return 100 * ((1 - ratio) / 0.4);
}

function selectProfile(
  mission: MissionDefinition,
  scores: {
    safety: number;
    stability: number;
    landing: number;
    objective: number;
    time: number;
  },
  completed: boolean,
): { label: ActivityProfileLabel; reason: string } {
  if (mission.kind === "disaster_search" && completed && scores.objective >= 100) {
    return {
      label: "탐색 전문형",
      reason: "모든 탐색 지점을 직접 확인하고 안전하게 복귀했습니다.",
    };
  }
  if (scores.landing >= 80 && scores.landing >= Math.max(scores.safety, scores.stability, scores.time)) {
    return {
      label: "정밀 조종형",
      reason: "착륙 지점에 기체를 정밀하게 맞추는 능력이 돋보였습니다.",
    };
  }
  if (scores.time >= 85 && scores.time > Math.max(scores.safety, scores.stability)) {
    return {
      label: "신속 대응형",
      reason: "안전한 범위 안에서 임무 경로를 빠르게 완수했습니다.",
    };
  }
  if (scores.safety >= 80 && scores.safety >= scores.stability) {
    return {
      label: "안전 운항형",
      reason: "충돌과 긴급 상황을 줄이며 안전을 우선해 운항했습니다.",
    };
  }
  return {
    label: "균형 성장형",
    reason: "여러 운항 능력을 고르게 연습하며 다음 도전을 준비했습니다.",
  };
}

export function calculateMissionResult(
  mission: MissionDefinition,
  state: MissionRuntimeState,
): ExperienceResult {
  if (mission.id !== state.missionId) {
    throw new Error(`Mission state ${state.missionId} does not match ${mission.id}`);
  }

  const requiredTargets = mission.targets.filter((target) => target.required);
  const completedTargets = requiredTargets.filter((target) => state.foundTargetIds.includes(target.id));
  const targetObjectiveScore = requiredTargets.length
    ? (completedTargets.length / requiredTargets.length) * 100
    : state.status === "COMPLETED"
      ? 100
      : 0;
  const objectiveScore = mission.kind === "medical_delivery"
    ? (targetObjectiveScore * 0.55 + state.payloadIntegrityPercent * 0.3 + (state.handoverCompleted ? 15 : 0))
    : targetObjectiveScore;
  const safetyScore =
    100 -
    state.collisionCount * mission.scoringRules.collisionPenaltyPercent -
    state.emergencyActivations * mission.scoringRules.emergencyPenaltyPercent -
    state.corridorViolationCount * 4;
  const stabilityScore = state.stabilitySampleCount
    ? (state.stabilitySampleTotal / state.stabilitySampleCount) * 100
    : 0;
  const landingScore = state.landingAssessment?.score ?? 0;
  const timeScore = calculateTimeScore(state.elapsedSeconds, mission.timeLimitSeconds);
  const scores = {
    safety: rounded(safetyScore),
    stability: rounded(stabilityScore),
    landing: rounded(landingScore),
    objective: rounded(objectiveScore),
    time: rounded(timeScore),
  };
  const rules = mission.scoringRules;
  const totalWeight =
    rules.safetyWeight +
    rules.stabilityWeight +
    rules.landingWeight +
    rules.objectiveWeight +
    rules.timeWeight;
  const weightedTotal = totalWeight
    ? (scores.safety * rules.safetyWeight +
        scores.stability * rules.stabilityWeight +
        scores.landing * rules.landingWeight +
        scores.objective * rules.objectiveWeight +
        scores.time * rules.timeWeight) /
      totalWeight
    : 0;
  const profile = selectProfile(mission, scores, state.status === "COMPLETED");

  return {
    missionId: mission.id,
    title: "항공모빌리티 운항 결과",
    completed: state.status === "COMPLETED",
    totalScore: rounded(weightedTotal),
    safety: category(scores.safety),
    stability: category(scores.stability),
    landing: category(scores.landing),
    objective: category(scores.objective),
    time: category(scores.time),
    profileLabel: profile.label,
    profileReason: profile.reason,
    careerMessage:
      mission.kind === "medical_delivery"
        ? "재난 의료물류 운항 담당자는 육상 접근이 어려운 곳에도 필요한 물품이 제때 도착하도록 항로, 기상, 화물 상태와 착륙 안전을 함께 판단합니다."
        : "재난 항공수색 운항 담당자는 현장 위험을 살피며 수색 순서와 비행 경로를 정하고, 정확한 위치 정보를 구조팀에 전달합니다.",
  };
}

import { createBatteryState, stepBattery } from "./battery";
import {
  assessLanding,
  clamp,
  distance3,
  isPointInsideVolume,
  segmentIntersectsObstacle,
} from "./geometry";
import { createLandingZone } from "./training";
import type {
  BatteryState,
  ExperienceEvent,
  LandingAssessment,
  MissionDefinition,
  MissionOperationPhase,
  Vector3,
  WindZoneDefinition,
} from "./types";

const DEFAULT_SCORING_RULES = {
  safetyWeight: 25,
  stabilityWeight: 20,
  landingWeight: 25,
  objectiveWeight: 20,
  timeWeight: 10,
  collisionPenaltyPercent: 15,
  emergencyPenaltyPercent: 30,
} as const;

export const MEDICAL_DELIVERY_MISSION: MissionDefinition = {
  id: "medical-delivery",
  kind: "medical_delivery",
  title: "응급 의약품 운송",
  description: "도로가 끊긴 고립 지역의 임시 응급진료소까지 의약품을 안전하게 운송합니다.",
  briefing: "응급실 요청을 확인하고 경로를 판단한 뒤 의약품을 안전하게 인계하세요.",
  roleTitle: "재난 의료물류 운항 담당자",
  dispatchLabel: "고립 마을 임시 진료소 · 의약품 긴급 요청",
  plans: [
    {
      id: "medical-safe",
      label: "안전 우회 항로",
      summary: "산사태 구간과 강풍 중심부를 피해 하천 외곽으로 우회합니다.",
      badge: "교육 추천",
      distanceLabel: "비행거리 34m",
      durationLabel: "예상 2분 20초",
      energyLabel: "배터리 보통",
      riskLabel: "위험도 낮음",
      waypoints: [
        { x: 0, y: 1.8, z: 0 },
        { x: 4.8, y: 2.4, z: 7 },
        { x: 4.8, y: 2.8, z: 17 },
        { x: 8, y: 1.6, z: 24 },
      ],
      corridorRadius: 4.3,
      recommended: true,
    },
    {
      id: "medical-fast",
      label: "신속 직선 항로",
      summary: "거리는 짧지만 강풍 구역을 직접 통과합니다.",
      badge: "빠른 대응",
      distanceLabel: "비행거리 26m",
      durationLabel: "예상 1분 40초",
      energyLabel: "배터리 절약",
      riskLabel: "강풍 보정 필요",
      waypoints: [
        { x: 0, y: 1.8, z: 0 },
        { x: 2.5, y: 2.6, z: 11.5 },
        { x: 8, y: 1.6, z: 24 },
      ],
      corridorRadius: 3.4,
    },
  ],
  preflightChecklist: ["기상·강풍 구역 확인", "의약품 보관함 잠금", "임시 진료소 착륙장 확인"],
  payload: {
    label: "응급 의약품 보관함",
    detail: "저온 보관 · 충격 주의",
    handlingNote: "급가속과 충돌을 줄여 화물 상태를 유지하세요.",
  },
  startPosition: { x: 0, y: 0, z: 0 },
  targets: [
    {
      id: "hospital-b",
      label: "임시 응급진료소 착륙장",
      position: { x: 8, y: 0, z: 24 },
      activationRadius: 1.4,
      action: "landing",
      required: true,
    },
  ],
  timeLimitSeconds: 180,
  batteryStartPercent: 100,
  windZones: [
    {
      id: "medical-crosswind",
      label: "강풍 주의 구역",
      volume: {
        shape: "box",
        min: { x: -2.5, y: 0.4, z: 10 },
        max: { x: 5.5, y: 4.5, z: 15.5 },
      },
      force: { x: 0.42, y: 0, z: 0 },
      pulse: { amplitude: 0.16, frequencyHz: 0.22 },
    },
  ],
  obstacles: [
    {
      id: "medical-building-1",
      label: "산사태 암반 1",
      volume: {
        shape: "box",
        min: { x: -6, y: 0, z: 6 },
        max: { x: -2.8, y: 6.5, z: 10 },
      },
    },
    {
      id: "medical-building-2",
      label: "산사태 암반 2",
      volume: {
        shape: "box",
        min: { x: 6, y: 0, z: 10 },
        max: { x: 10.5, y: 7.5, z: 15 },
      },
    },
    {
      id: "medical-building-3",
      label: "계곡 암반",
      volume: {
        shape: "box",
        min: { x: -1, y: 0, z: 18 },
        max: { x: 3.5, y: 6, z: 22 },
      },
    },
  ],
  landingZone: createLandingZone("hospital-b-pad", "임시 응급진료소 착륙장", 8, 24),
  scoringRules: DEFAULT_SCORING_RULES,
};

export const DISASTER_SEARCH_MISSION: MissionDefinition = {
  id: "disaster-search",
  kind: "disaster_search",
  title: "재난지역 탐색",
  description: "재난 지역의 세 목표 지점을 확인하고 안전하게 복귀합니다.",
  briefing: "수색 계획을 정하고 구조 신호 세 곳을 확인한 뒤 지휘소로 복귀하세요.",
  roleTitle: "재난 항공수색 운항 담당자",
  dispatchLabel: "현장 지휘소 · 구조 신호 위치 확인 요청",
  plans: [
    {
      id: "search-sweep",
      label: "안전 순환 수색",
      summary: "1번부터 3번까지 넓게 돌며 시야를 확보합니다.",
      badge: "교육 추천",
      distanceLabel: "수색거리 43m",
      durationLabel: "예상 3분",
      energyLabel: "배터리 보통",
      riskLabel: "시야 확보 우수",
      waypoints: [
        { x: 0, y: 1.8, z: 0 },
        { x: -5, y: 2.2, z: 8 },
        { x: 5.5, y: 2.5, z: 13 },
        { x: -1, y: 2.2, z: 20 },
        { x: 0, y: 1.5, z: 0 },
      ],
      corridorRadius: 4.6,
      recommended: true,
    },
    {
      id: "search-direct",
      label: "신속 지그재그 수색",
      summary: "목표 사이를 곧게 연결해 빠르게 확인합니다.",
      badge: "숙련 운항",
      distanceLabel: "수색거리 36m",
      durationLabel: "예상 2분 20초",
      energyLabel: "배터리 절약",
      riskLabel: "잔해 주의",
      waypoints: [
        { x: 0, y: 1.8, z: 0 },
        { x: -5, y: 2, z: 8 },
        { x: 5.5, y: 2.3, z: 13 },
        { x: -1, y: 2, z: 20 },
        { x: 0, y: 1.5, z: 0 },
      ],
      corridorRadius: 3.5,
    },
  ],
  preflightChecklist: ["수색 순서 확인", "촬영·확인 기능 점검", "복귀 착륙장 확인"],
  startPosition: { x: 0, y: 0, z: 0 },
  targets: [
    {
      id: "search-target-1",
      label: "탐색 지점 1",
      position: { x: -5, y: 1.2, z: 8 },
      activationRadius: 1.8,
      action: "mission_action",
      required: true,
    },
    {
      id: "search-target-2",
      label: "탐색 지점 2",
      position: { x: 5.5, y: 1.5, z: 13 },
      activationRadius: 1.8,
      action: "mission_action",
      required: true,
    },
    {
      id: "search-target-3",
      label: "탐색 지점 3",
      position: { x: -1, y: 1, z: 20 },
      activationRadius: 1.8,
      action: "mission_action",
      required: true,
    },
  ],
  timeLimitSeconds: 210,
  batteryStartPercent: 100,
  windZones: [],
  obstacles: [
    {
      id: "search-rubble-1",
      label: "잔해 구역 1",
      volume: {
        shape: "box",
        min: { x: -2.5, y: 0, z: 5 },
        max: { x: 1, y: 4.5, z: 8.5 },
      },
    },
    {
      id: "search-rubble-2",
      label: "잔해 구역 2",
      volume: {
        shape: "box",
        min: { x: 2, y: 0, z: 16 },
        max: { x: 5.5, y: 5.5, z: 19 },
      },
    },
  ],
  landingZone: createLandingZone("search-return-pad", "복귀 착륙장", 0, 0),
  scoringRules: {
    ...DEFAULT_SCORING_RULES,
    safetyWeight: 20,
    landingWeight: 20,
    objectiveWeight: 30,
  },
};

export const MISSION_DEFINITIONS: readonly MissionDefinition[] = [
  MEDICAL_DELIVERY_MISSION,
  DISASTER_SEARCH_MISSION,
] as const;

export function getMissionDefinition(missionId: string): MissionDefinition | undefined {
  return MISSION_DEFINITIONS.find((mission) => mission.id === missionId);
}

export function findNearbyMissionTarget(
  mission: MissionDefinition,
  position: Vector3,
  foundTargetIds: readonly string[] = [],
) {
  const found = new Set(foundTargetIds);
  return mission.targets.find(
    (target) =>
      target.action === "mission_action" &&
      !found.has(target.id) &&
      distance3(position, target.position) <= target.activationRadius,
  );
}

export function getWindForce(
  zone: WindZoneDefinition,
  position: Vector3,
  atSeconds: number,
): Vector3 {
  if (!isPointInsideVolume(position, zone.volume)) {
    return { x: 0, y: 0, z: 0 };
  }
  const pulseScale = zone.pulse
    ? 1 + zone.pulse.amplitude * Math.sin(atSeconds * Math.PI * 2 * zone.pulse.frequencyHz)
    : 1;
  return {
    x: zone.force.x * pulseScale,
    y: zone.force.y * pulseScale,
    z: zone.force.z * pulseScale,
  };
}

export function combineWindForces(
  zones: readonly WindZoneDefinition[],
  position: Vector3,
  atSeconds: number,
): Vector3 {
  return zones.reduce<Vector3>(
    (combined, zone) => {
      const force = getWindForce(zone, position, atSeconds);
      return {
        x: combined.x + force.x,
        y: combined.y + force.y,
        z: combined.z + force.z,
      };
    },
    { x: 0, y: 0, z: 0 },
  );
}

export type MissionRuntimeStatus = "ACTIVE" | "RETURNING" | "COMPLETED" | "EXPIRED";

export interface MissionRuntimeState {
  missionId: string;
  status: MissionRuntimeStatus;
  operationPhase: MissionOperationPhase;
  selectedPlanId?: string;
  preflightConfirmed: boolean;
  payloadIntegrityPercent: number;
  handoverCompleted: boolean;
  corridorViolationCount: number;
  outsideSelectedCorridor: boolean;
  elapsedSeconds: number;
  previousPosition: Vector3;
  foundTargetIds: readonly string[];
  activeWindZoneIds: readonly string[];
  activeObstacleIds: readonly string[];
  collisionCount: number;
  collisionCooldownUntil: Readonly<Record<string, number>>;
  battery: BatteryState;
  stabilitySampleTotal: number;
  stabilitySampleCount: number;
  emergencyActivations: number;
  landingAssessment?: LandingAssessment;
}

export interface MissionStepInput {
  elapsedSeconds: number;
  position: Vector3;
  speedLevel: "beginner" | "normal" | "high";
  movementMagnitude: number;
  throttleMagnitude: number;
  missionActionPressed?: boolean;
  landed?: boolean;
  emergencyActivated?: boolean;
  /** Grounded READY/ARMING states observe the scene but cannot collide. */
  collisionEnabled?: boolean;
  /** 0 is unstable and 1 is fully stable for this sample. */
  stabilitySample?: number;
}

export interface MissionStepResult {
  state: MissionRuntimeState;
  events: readonly ExperienceEvent[];
  windForce: Vector3;
}

export function createMissionRuntimeState(
  mission: MissionDefinition,
): MissionRuntimeState {
  return {
    missionId: mission.id,
    status: "ACTIVE",
    operationPhase: "BRIEFING",
    preflightConfirmed: false,
    payloadIntegrityPercent: 100,
    handoverCompleted: false,
    corridorViolationCount: 0,
    outsideSelectedCorridor: false,
    elapsedSeconds: 0,
    previousPosition: { ...mission.startPosition },
    foundTargetIds: [],
    activeWindZoneIds: [],
    activeObstacleIds: [],
    collisionCount: 0,
    collisionCooldownUntil: {},
    battery: createBatteryState(mission.batteryStartPercent),
    stabilitySampleTotal: 0,
    stabilitySampleCount: 0,
    emergencyActivations: 0,
  };
}

export function selectMissionPlan(
  mission: MissionDefinition,
  previous: MissionRuntimeState,
  planId: string,
): MissionRuntimeState {
  if (!mission.plans.some((plan) => plan.id === planId)) return previous;
  return {
    ...previous,
    selectedPlanId: planId,
    operationPhase: "PREFLIGHT",
  };
}

export function confirmMissionPreflight(
  mission: MissionDefinition,
  previous: MissionRuntimeState,
): MissionRuntimeState {
  if (!previous.selectedPlanId || previous.missionId !== mission.id) return previous;
  return {
    ...previous,
    preflightConfirmed: true,
    operationPhase: "FLIGHT",
  };
}

function pointToSegmentDistance(
  point: Vector3,
  start: Vector3,
  end: Vector3,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}

function isInsideSelectedCorridor(
  mission: MissionDefinition,
  state: MissionRuntimeState,
  position: Vector3,
): boolean {
  const plan = mission.plans.find((candidate) => candidate.id === state.selectedPlanId);
  if (!plan || plan.waypoints.length < 2 || position.y <= 0.15) return true;
  for (let index = 1; index < plan.waypoints.length; index += 1) {
    if (pointToSegmentDistance(position, plan.waypoints[index - 1], plan.waypoints[index]) <= plan.corridorRadius) {
      return true;
    }
  }
  return false;
}

export function stepMission(
  mission: MissionDefinition,
  previous: MissionRuntimeState,
  input: MissionStepInput,
): MissionStepResult {
  if (mission.id !== previous.missionId) {
    throw new Error(`Mission state ${previous.missionId} does not match ${mission.id}`);
  }
  if (previous.status === "COMPLETED" || previous.status === "EXPIRED") {
    return {
      state: previous,
      events: [],
      windForce: combineWindForces(mission.windZones, input.position, previous.elapsedSeconds),
    };
  }

  if (!previous.preflightConfirmed) {
    return {
      state: { ...previous, previousPosition: { ...input.position } },
      events: [],
      windForce: { x: 0, y: 0, z: 0 },
    };
  }

  // Mission time remains a real stopwatch even if rendering briefly pauses.
  const delta = Number.isFinite(input.elapsedSeconds) ? Math.max(0, input.elapsedSeconds) : 0;
  const elapsedSeconds = previous.elapsedSeconds + delta;
  const events: ExperienceEvent[] = [];
  const foundTargetIds = new Set(previous.foundTargetIds);
  const activeWindZoneIds = new Set<string>();
  const previousWindZoneIds = new Set(previous.activeWindZoneIds);
  const activeObstacleIds = new Set<string>();
  const previousObstacleIds = new Set(previous.activeObstacleIds);
  const collisionCooldownUntil = { ...previous.collisionCooldownUntil };
  let collisionCount = previous.collisionCount;
  let emergencyActivations = previous.emergencyActivations;
  let landingAssessment = previous.landingAssessment;
  let status: MissionRuntimeStatus = previous.status;
  let operationPhase = previous.operationPhase;
  let payloadIntegrityPercent = previous.payloadIntegrityPercent;
  let handoverCompleted = previous.handoverCompleted;
  let corridorViolationCount = previous.corridorViolationCount;
  const outsideSelectedCorridor = !isInsideSelectedCorridor(mission, previous, input.position);
  if (outsideSelectedCorridor && !previous.outsideSelectedCorridor) {
    corridorViolationCount += 1;
  }

  for (const zone of mission.windZones) {
    if (isPointInsideVolume(input.position, zone.volume)) {
      activeWindZoneIds.add(zone.id);
      if (!previousWindZoneIds.has(zone.id)) {
        events.push({ type: "windEntered", atSeconds: elapsedSeconds, windZoneId: zone.id });
      }
    } else if (previousWindZoneIds.has(zone.id)) {
      events.push({ type: "windExited", atSeconds: elapsedSeconds, windZoneId: zone.id });
    }
  }

  for (const obstacle of mission.obstacles) {
    const inside = isPointInsideVolume(input.position, obstacle.volume);
    if (inside) activeObstacleIds.add(obstacle.id);
    if (
      input.collisionEnabled !== false &&
      !previousObstacleIds.has(obstacle.id) &&
      segmentIntersectsObstacle(previous.previousPosition, input.position, obstacle) &&
      elapsedSeconds >= (collisionCooldownUntil[obstacle.id] ?? 0)
    ) {
      collisionCount += 1;
      if (mission.kind === "medical_delivery") {
        payloadIntegrityPercent = Math.max(0, payloadIntegrityPercent - 15);
      }
      collisionCooldownUntil[obstacle.id] = elapsedSeconds + 0.75;
      events.push({
        type: "collision",
        atSeconds: elapsedSeconds,
        colliderId: obstacle.id,
        colliderKind: "obstacle",
      });
    }
  }

  if (input.missionActionPressed) {
    events.push({ type: "missionActionPressed", atSeconds: elapsedSeconds });
    if (
      mission.kind === "medical_delivery" &&
      operationPhase === "HANDOVER" &&
      landingAssessment?.success
    ) {
      handoverCompleted = true;
      operationPhase = "COMPLETED";
      status = "COMPLETED";
      for (const target of mission.targets.filter((candidate) => candidate.action === "landing")) {
        foundTargetIds.add(target.id);
      }
      events.push({ type: "missionCompleted", atSeconds: elapsedSeconds, missionId: mission.id });
    }
    const target = findNearbyMissionTarget(mission, input.position, [...foundTargetIds]);
    if (target) {
      foundTargetIds.add(target.id);
      const total = mission.targets.filter(
        (candidate) => candidate.required && candidate.action === "mission_action",
      ).length;
      const count = mission.targets.filter(
        (candidate) => foundTargetIds.has(candidate.id) && candidate.action === "mission_action",
      ).length;
      events.push({ type: "targetFound", atSeconds: elapsedSeconds, targetId: target.id, count, total });
    }
  }

  if (input.emergencyActivated) {
    emergencyActivations += 1;
    events.push({ type: "emergencyActivated", atSeconds: elapsedSeconds });
  }

  const requiredActionTargets = mission.targets.filter(
    (target) => target.required && target.action === "mission_action",
  );
  const actionTargetsComplete = requiredActionTargets.every((target) => foundTargetIds.has(target.id));
  if (mission.kind === "disaster_search" && actionTargetsComplete && status === "ACTIVE") {
    status = "RETURNING";
    operationPhase = "RETURNING";
  }

  if (input.landed) {
    landingAssessment = assessLanding(input.position, mission.landingZone);
    events.push({ type: "landed", atSeconds: elapsedSeconds, assessment: landingAssessment });
    const medicalReadyForHandover = mission.kind === "medical_delivery" && landingAssessment.success;
    const searchComplete =
      mission.kind === "disaster_search" && actionTargetsComplete && landingAssessment.success;
    if (medicalReadyForHandover && elapsedSeconds < mission.timeLimitSeconds) {
      operationPhase = "HANDOVER";
    } else if (elapsedSeconds < mission.timeLimitSeconds && searchComplete) {
      status = "COMPLETED";
      operationPhase = "COMPLETED";
      for (const target of mission.targets.filter((candidate) => candidate.action === "landing")) {
        foundTargetIds.add(target.id);
      }
      events.push({ type: "missionCompleted", atSeconds: elapsedSeconds, missionId: mission.id });
    }
  }

  if (elapsedSeconds >= mission.timeLimitSeconds && status !== "COMPLETED") {
    status = "EXPIRED";
  }

  const batteryStep = stepBattery(previous.battery, {
    elapsedSeconds: delta,
    speedLevel: input.speedLevel,
    movementMagnitude: input.movementMagnitude,
    throttleMagnitude: input.throttleMagnitude,
    atSeconds: elapsedSeconds,
  });
  events.push(...batteryStep.events);

  const stabilitySample = clamp(input.stabilitySample ?? 1, 0, 1);
  const state: MissionRuntimeState = {
    missionId: previous.missionId,
    status,
    operationPhase,
    selectedPlanId: previous.selectedPlanId,
    preflightConfirmed: previous.preflightConfirmed,
    payloadIntegrityPercent,
    handoverCompleted,
    corridorViolationCount,
    outsideSelectedCorridor,
    elapsedSeconds,
    previousPosition: { ...input.position },
    foundTargetIds: [...foundTargetIds],
    activeWindZoneIds: [...activeWindZoneIds],
    activeObstacleIds: [...activeObstacleIds],
    collisionCount,
    collisionCooldownUntil,
    battery: batteryStep.state,
    stabilitySampleTotal: previous.stabilitySampleTotal + stabilitySample,
    stabilitySampleCount: previous.stabilitySampleCount + 1,
    emergencyActivations,
    landingAssessment,
  };

  return {
    state,
    events,
    windForce: combineWindForces(mission.windZones, input.position, elapsedSeconds),
  };
}

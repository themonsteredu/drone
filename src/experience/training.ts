import type {
  CourseDefinition,
  LandingBand,
  LandingZoneDefinition,
  TutorialStepDefinition,
} from "./types";

export const STANDARD_LANDING_BANDS: readonly LandingBand[] = [
  { maxRadius: 0.45, score: 100, label: "중앙" },
  { maxRadius: 0.9, score: 80, label: "안쪽" },
  { maxRadius: 1.45, score: 60, label: "중간" },
  { maxRadius: 2.2, score: 40, label: "가장자리" },
] as const;

export function createLandingZone(
  id: string,
  label: string,
  x: number,
  z: number,
): LandingZoneDefinition {
  return {
    id,
    label,
    center: { x, y: 0, z },
    bands: STANDARD_LANDING_BANDS,
    maxHeight: 0.18,
  };
}

/** One instruction is presented at a time; every criterion is flight-action based. */
export const MODE2_TUTORIAL_STEPS: readonly TutorialStepDefinition[] = [
  {
    id: "arming",
    order: 1,
    title: "시동 걸기",
    instruction: "양쪽 스틱을 아래쪽 바깥으로 벌려 2초 동안 유지하세요.",
    successMessage: "시동 완료",
    criterion: { kind: "flight_event", event: "armed" },
  },
  {
    id: "takeoff",
    order: 2,
    title: "이륙",
    instruction: "왼쪽 스로틀을 천천히 올려 약 1m 높이까지 이륙하세요.",
    successMessage: "이륙 성공",
    criterion: { kind: "minimum_altitude", meters: 1 },
  },
  {
    id: "yaw-right",
    order: 3,
    title: "오른쪽 회전",
    instruction: "왼쪽 스틱을 오른쪽으로 움직여 기체를 오른쪽으로 돌려 보세요.",
    successMessage: "회전 성공",
    criterion: { kind: "yaw_delta", radians: Math.PI / 3, direction: "right" },
  },
  {
    id: "forward",
    order: 4,
    title: "전진",
    instruction: "빨간 앞방향 선을 따라 오른쪽 스틱을 위로 움직여 주황색 ‘전진 목표’까지 이동하세요.",
    successMessage: "전진 성공",
    criterion: {
      kind: "body_relative_distance",
      direction: "forward",
      meters: 2.5,
    },
  },
  {
    id: "roll-right",
    order: 5,
    title: "오른쪽 이동",
    instruction: "오른쪽 스틱을 오른쪽으로 움직여 착륙 지점 위로 이동하세요.",
    successMessage: "좌우 이동 성공",
    criterion: {
      kind: "body_relative_distance",
      direction: "right",
      meters: 2.2,
    },
  },
  {
    id: "landing",
    order: 6,
    title: "착륙",
    instruction: "스로틀을 천천히 낮춰 착륙 패드에 착륙하세요.",
    successMessage: "착륙 완료",
    criterion: { kind: "flight_event", event: "landed" },
  },
] as const;

export const BASIC_TRAINING_COURSE: CourseDefinition = {
  id: "basic-flight-training",
  title: "기초 비행 훈련장",
  description: "큰 링부터 차례로 통과하고 마지막 착륙 패드에 착륙합니다.",
  startPosition: { x: 0, y: 0, z: 0 },
  gates: [
    {
      id: "training-gate-1",
      label: "첫 번째 링",
      order: 1,
      center: { x: 0, y: 2.7, z: 5 },
      normal: { x: 0, y: 0, z: 1 },
      innerRadius: 1.6,
      outerRadius: 1.9,
      halfThickness: 0.18,
    },
    {
      id: "training-gate-2",
      label: "두 번째 링",
      order: 2,
      center: { x: 2.2, y: 2.5, z: 10 },
      normal: { x: 0, y: 0, z: 1 },
      innerRadius: 1.3,
      outerRadius: 1.6,
      halfThickness: 0.18,
    },
    {
      id: "training-gate-3",
      label: "방향 전환 링",
      order: 3,
      center: { x: 5, y: 2.35, z: 14 },
      normal: { x: 1, y: 0, z: 0 },
      innerRadius: 1.15,
      outerRadius: 1.45,
      halfThickness: 0.18,
    },
  ],
  // The pylons mark the corridor rather than block it. They sit well outside
  // the gate line so a student steering between rings is never squeezed, and
  // they stop below the raised gates so the course reads as open from behind.
  obstacles: [
    {
      id: "training-pylon-left",
      label: "왼쪽 안전 표지",
      volume: {
        shape: "box",
        min: { x: -5.4, y: 0, z: 7.2 },
        max: { x: -4.85, y: 6.5, z: 7.75 },
      },
    },
    {
      id: "training-pylon-right",
      label: "오른쪽 안전 표지",
      volume: {
        shape: "box",
        min: { x: 7.4, y: 0, z: 7.2 },
        max: { x: 7.95, y: 6.5, z: 7.75 },
      },
    },
  ],
  landingZone: createLandingZone("training-landing", "훈련 착륙장", 8, 14),
};

export const CERTIFICATION_COURSE: CourseDefinition = {
  ...BASIC_TRAINING_COURSE,
  id: "air-mobility-certification",
  title: "항공모빌리티 조종 자격시험",
  description: "90초 안에 세 개의 링, 방향 전환, 고도 변경과 정밀 착륙을 수행합니다.",
  gates: BASIC_TRAINING_COURSE.gates.map((gate) => ({
    ...gate,
    id: gate.id.replace("training", "exam"),
    innerRadius: Math.max(0.95, gate.innerRadius - 0.15),
    outerRadius: Math.max(1.25, gate.outerRadius - 0.15),
  })),
  landingZone: createLandingZone("exam-landing", "시험 착륙장", 8, 14),
};

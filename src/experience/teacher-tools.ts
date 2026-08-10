import type { ExperienceProgressState } from "./experience-state";

export type TeacherShortcutId =
  | "reset_training"
  | "start_certification"
  | "start_medical_mission"
  | "start_disaster_search"
  | "reset_battery"
  | "reset_drone_position";

export interface TeacherShortcutDefinition {
  id: TeacherShortcutId;
  label: string;
}

export const TEACHER_SHORTCUTS: readonly TeacherShortcutDefinition[] = [
  { id: "reset_training", label: "훈련 단계 초기화" },
  { id: "start_certification", label: "자격시험 바로 시작" },
  { id: "start_medical_mission", label: "응급 의약품 운송 바로 시작" },
  { id: "start_disaster_search", label: "재난지역 탐색 바로 시작" },
  { id: "reset_battery", label: "배터리 초기화" },
  { id: "reset_drone_position", label: "드론 위치 초기화" },
] as const;

export interface TeacherShortcutEffects {
  resetCourse: boolean;
  resetFlight: boolean;
  resetBattery: boolean;
  resetDronePosition: boolean;
}

export interface TeacherShortcutResult {
  state: ExperienceProgressState;
  effects: TeacherShortcutEffects;
}

const NO_EFFECTS: TeacherShortcutEffects = {
  resetCourse: false,
  resetFlight: false,
  resetBattery: false,
  resetDronePosition: false,
};

/**
 * Returns explicit effects instead of importing or mutating flight physics.
 * The UI/integration shell decides how to perform a position or battery reset.
 */
export function applyTeacherShortcut(
  state: ExperienceProgressState,
  shortcut: TeacherShortcutId,
): TeacherShortcutResult {
  const revision = state.sessionRevision + 1;
  switch (shortcut) {
    case "reset_training":
      return {
        state: {
          ...state,
          stage: "TRAINING",
          tutorialStepIndex: 0,
          trainingCompleted: false,
          selectedMissionId: undefined,
          lastResult: undefined,
          sessionRevision: revision,
        },
        effects: {
          resetCourse: true,
          resetFlight: true,
          resetBattery: true,
          resetDronePosition: true,
        },
      };
    case "start_certification":
      return {
        state: {
          ...state,
          stage: "CERTIFICATION",
          trainingCompleted: true,
          selectedMissionId: undefined,
          lastResult: undefined,
          sessionRevision: revision,
        },
        effects: { ...NO_EFFECTS, resetCourse: true, resetFlight: true, resetDronePosition: true },
      };
    case "start_medical_mission":
    case "start_disaster_search":
      return {
        state: {
          ...state,
          stage: "MISSION",
          qualified: true,
          selectedMissionId:
            shortcut === "start_medical_mission" ? "medical-delivery" : "disaster-search",
          lastResult: undefined,
          sessionRevision: revision,
        },
        effects: {
          resetCourse: false,
          resetFlight: true,
          resetBattery: true,
          resetDronePosition: true,
        },
      };
    case "reset_battery":
      return { state, effects: { ...NO_EFFECTS, resetBattery: true } };
    case "reset_drone_position":
      return {
        state,
        effects: { ...NO_EFFECTS, resetFlight: true, resetDronePosition: true },
      };
    default:
      return { state, effects: NO_EFFECTS };
  }
}


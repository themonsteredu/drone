import type { CertificationScore } from "./certification";
import type { ExperienceResult } from "./results";
import type { ExperienceStage } from "./types";

export interface ExperienceProgressState {
  stage: ExperienceStage;
  controllerReady: boolean;
  tutorialStepIndex: number;
  trainingCompleted: boolean;
  qualified: boolean;
  selectedMissionId?: string;
  lastCertification?: CertificationScore;
  lastResult?: ExperienceResult;
  sessionRevision: number;
}

export type ExperienceProgressAction =
  | { type: "start" }
  | { type: "controllerReady" }
  | { type: "controllerUnavailable" }
  | { type: "beginTutorial" }
  | { type: "tutorialStepCompleted"; totalSteps: number }
  | { type: "trainingCompleted" }
  | { type: "certificationCompleted"; score: CertificationScore }
  | { type: "openMissionSelection" }
  | { type: "selectMission"; missionId: string }
  | { type: "missionCompleted"; result: ExperienceResult }
  | { type: "restart" };

export function createInitialExperienceProgress(): ExperienceProgressState {
  return {
    stage: "START",
    controllerReady: false,
    tutorialStepIndex: 0,
    trainingCompleted: false,
    qualified: false,
    sessionRevision: 0,
  };
}

/** Explicit transition reducer used by the student flow; invalid actions are harmless. */
export function reduceExperienceProgress(
  state: ExperienceProgressState,
  action: ExperienceProgressAction,
): ExperienceProgressState {
  switch (action.type) {
    case "start":
      return state.stage === "START" ? { ...state, stage: "CONNECTING" } : state;
    case "controllerReady":
      return {
        ...state,
        controllerReady: true,
        stage: state.stage === "CONNECTING" ? "CONTROL_GUIDE" : state.stage,
      };
    case "controllerUnavailable":
      return state.controllerReady ? { ...state, controllerReady: false } : state;
    case "beginTutorial":
      return state.controllerReady ? { ...state, stage: "TUTORIAL", tutorialStepIndex: 0 } : state;
    case "tutorialStepCompleted": {
      if (state.stage !== "TUTORIAL") return state;
      const nextIndex = state.tutorialStepIndex + 1;
      return nextIndex >= Math.max(1, action.totalSteps)
        ? { ...state, tutorialStepIndex: nextIndex, stage: "TRAINING" }
        : { ...state, tutorialStepIndex: nextIndex };
    }
    case "trainingCompleted":
      return state.stage === "TRAINING"
        ? { ...state, trainingCompleted: true, stage: "CERTIFICATION" }
        : state;
    case "certificationCompleted":
      return state.stage === "CERTIFICATION"
        ? {
            ...state,
            lastCertification: action.score,
            qualified: action.score.qualified,
            stage: action.score.qualified ? "QUALIFIED" : "CERTIFICATION",
          }
        : state;
    case "openMissionSelection":
      return state.qualified ? { ...state, stage: "MISSION_SELECT" } : state;
    case "selectMission":
      return state.qualified
        ? { ...state, selectedMissionId: action.missionId, stage: "MISSION", lastResult: undefined }
        : state;
    case "missionCompleted":
      return state.stage === "MISSION" ? { ...state, lastResult: action.result, stage: "RESULT" } : state;
    case "restart":
      return {
        ...createInitialExperienceProgress(),
        sessionRevision: state.sessionRevision + 1,
      };
    default:
      return state;
  }
}

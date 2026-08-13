import { isPointInsideVolume } from "./geometry";
import type {
  TutorialStepDefinition,
  Vector3,
} from "./types";

export interface TutorialObservation {
  position: Vector3;
  yaw: number;
  flightPhase: string;
}

export interface TutorialRuntimeState {
  stepIndex: number;
  baselinePosition: Vector3;
  baselineYaw: number;
  previousFlightPhase: string;
  completed: boolean;
}

export function createTutorialRuntimeState(
  observation: TutorialObservation,
): TutorialRuntimeState {
  return {
    stepIndex: 0,
    baselinePosition: { ...observation.position },
    baselineYaw: observation.yaw,
    previousFlightPhase: observation.flightPhase,
    completed: false,
  };
}

function wrappedAngleDelta(current: number, baseline: number): number {
  const fullTurn = Math.PI * 2;
  return ((current - baseline + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

export function tutorialCriterionSatisfied(
  step: TutorialStepDefinition,
  state: TutorialRuntimeState,
  observation: TutorialObservation,
): boolean {
  const criterion = step.criterion;
  if (criterion.kind === "minimum_altitude") {
    return observation.position.y >= criterion.meters;
  }
  if (criterion.kind === "yaw_delta") {
    // The criterion is written in the student's left/right terms, so it is
    // judged on the heading they see rather than on internal yaw. The scene
    // views the aircraft from behind and puts world +X on the viewer's left,
    // which makes a turn the student calls "right" decrease internal yaw.
    // Kept in step with `studentHeadingRadians` in simulator/flight-model.ts;
    // the experience domain stays free of simulator imports.
    const delta = -wrappedAngleDelta(observation.yaw, state.baselineYaw);
    return criterion.direction === "right"
      ? delta >= criterion.radians
      : delta <= -criterion.radians;
  }
  if (criterion.kind === "position_delta") {
    return (
      observation.position[criterion.axis] -
        state.baselinePosition[criterion.axis] >=
      criterion.meters
    );
  }
  if (criterion.kind === "body_relative_distance") {
    const deltaX = observation.position.x - state.baselinePosition.x;
    const deltaZ = observation.position.z - state.baselinePosition.z;
    const projectedDistance =
      criterion.direction === "forward"
        ? deltaX * Math.sin(state.baselineYaw) +
          deltaZ * Math.cos(state.baselineYaw)
        : deltaX * Math.cos(state.baselineYaw) -
          deltaZ * Math.sin(state.baselineYaw);
    return projectedDistance >= criterion.meters;
  }
  if (criterion.kind === "enter_volume") {
    return isPointInsideVolume(observation.position, criterion.volume);
  }
  if (criterion.event === "armed") {
    return observation.flightPhase === "ARMED";
  }
  if (criterion.event === "takeoff") {
    return (
      (state.previousFlightPhase === "ARMED" ||
        state.previousFlightPhase === "TAKEOFF") &&
      observation.flightPhase === "FLIGHT"
    );
  }
  return (
    observation.position.y <= 0.02 &&
    (state.previousFlightPhase === "FLIGHT" ||
      state.previousFlightPhase === "LANDING") &&
    observation.flightPhase === "READY"
  );
}

export interface TutorialStepUpdate {
  state: TutorialRuntimeState;
  stepCompleted: boolean;
  completedStep?: TutorialStepDefinition;
}

export function stepTutorial(
  steps: readonly TutorialStepDefinition[],
  previous: TutorialRuntimeState,
  observation: TutorialObservation,
): TutorialStepUpdate {
  if (previous.completed) {
    return { state: previous, stepCompleted: false };
  }
  const step = steps[previous.stepIndex];
  const satisfied = step
    ? tutorialCriterionSatisfied(step, previous, observation)
    : true;
  const nextIndex = satisfied ? previous.stepIndex + 1 : previous.stepIndex;
  const completed = nextIndex >= steps.length;
  return {
    state: {
      stepIndex: nextIndex,
      baselinePosition: satisfied
        ? { ...observation.position }
        : { ...previous.baselinePosition },
      baselineYaw: satisfied ? observation.yaw : previous.baselineYaw,
      previousFlightPhase: observation.flightPhase,
      completed,
    },
    stepCompleted: Boolean(step && satisfied),
    completedStep: step && satisfied ? step : undefined,
  };
}

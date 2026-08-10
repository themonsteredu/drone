import type {
  ControllerButtonTransition,
  ControllerState,
} from "../types";
import type {
  ControllerOperation,
  ControllerProfile,
  ProfileSemanticControl,
  VerifiedControllerInputChordGesture,
} from "./types";

const OPERATION_PRIORITY: readonly ControllerOperation[] = [
  "emergency",
  "missionAction",
  "landing",
  "takeoff",
  "start",
];

interface ChordRuntimeState {
  activeSince: number | null;
  triggered: boolean;
}

export interface ControllerGestureRuntime {
  readonly buttonDownAt: Map<string, number>;
  readonly chords: Map<ControllerOperation, ChordRuntimeState>;
}

export function createControllerGestureRuntime(): ControllerGestureRuntime {
  return { buttonDownAt: new Map(), chords: new Map() };
}

export function resetControllerGestureRuntime(
  runtime: ControllerGestureRuntime,
): void {
  runtime.buttonDownAt.clear();
  runtime.chords.clear();
}

export function observeProfileButtonGestures(
  profile: ControllerProfile,
  events: readonly ControllerButtonTransition[],
  runtime: ControllerGestureRuntime,
): ControllerOperation[] {
  const operations = new Set<ControllerOperation>();
  for (const event of events) {
    if (event.phase === "down") runtime.buttonDownAt.set(event.buttonId, event.at);
    for (const operation of OPERATION_PRIORITY) {
      const gesture = profile.defaultOperationGestures[operation];
      if (
        !gesture ||
        gesture.kind !== "button" ||
        gesture.buttonId !== event.buttonId
      ) {
        continue;
      }
      if (gesture.trigger === "down" && event.phase === "down") {
        operations.add(operation);
      }
      if (gesture.trigger === "long-press" && event.phase === "up") {
        const startedAt = runtime.buttonDownAt.get(event.buttonId);
        const minimumDurationMs = Math.max(
          0,
          gesture.minimumDurationMs ?? 700,
        );
        if (
          startedAt !== undefined &&
          event.at - startedAt >= minimumDurationMs
        ) {
          operations.add(operation);
        }
      }
    }
    if (event.phase === "up") runtime.buttonDownAt.delete(event.buttonId);
  }
  return OPERATION_PRIORITY.filter((operation) => operations.has(operation));
}

function axisValue(
  state: ControllerState,
  control: ProfileSemanticControl,
): number | null {
  if (state.mappingStatus !== "mapped") return null;
  return state[control];
}

function chordIsActive(
  gesture: VerifiedControllerInputChordGesture,
  state: ControllerState,
): boolean {
  if (!state.connected || state.mappingStatus !== "mapped") return false;
  const buttonsMatch = gesture.buttons.every(
    (buttonId) => state.buttons[buttonId] === true,
  );
  const axesMatch = gesture.axes.every((condition) => {
    const value = axisValue(state, condition.control);
    if (value === null) return false;
    const minimum = condition.minimum ?? -1;
    const maximum = condition.maximum ?? 1;
    return value >= minimum && value <= maximum;
  });
  return buttonsMatch && axesMatch;
}

/**
 * Evaluates verified button chords, stick combinations, or mixed gestures.
 * One command is emitted per activation; returning to neutral rearms it.
 */
export function observeProfileInputChords(
  profile: ControllerProfile,
  state: ControllerState,
  now: number,
  runtime: ControllerGestureRuntime,
): ControllerOperation[] {
  const operations: ControllerOperation[] = [];
  for (const operation of OPERATION_PRIORITY) {
    const gesture = profile.defaultOperationGestures[operation];
    if (!gesture || gesture.kind !== "input-chord") continue;
    const previous = runtime.chords.get(operation) ?? {
      activeSince: null,
      triggered: false,
    };
    if (!chordIsActive(gesture, state)) {
      runtime.chords.set(operation, { activeSince: null, triggered: false });
      continue;
    }
    const activeSince = previous.activeSince ?? now;
    const minimumDurationMs = Math.max(0, gesture.minimumDurationMs);
    const triggered =
      previous.triggered || now - activeSince >= minimumDurationMs;
    runtime.chords.set(operation, { activeSince, triggered });
    if (!previous.triggered && triggered) operations.push(operation);
  }
  return operations;
}

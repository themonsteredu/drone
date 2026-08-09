export type MappableButtonAction =
  | "start"
  | "takeoff"
  | "land"
  | "emergency";

export interface ControllerButtonBinding {
  /** Scopes mappings so another controller cannot trigger them accidentally. */
  sourceId: string;
  /** Adapter-provided stable key such as button_bit_0 or button_1. */
  buttonId: string;
}

export type ControllerButtonMappings = Record<
  MappableButtonAction,
  ControllerButtonBinding | null
>;

export interface ButtonCaptureState {
  action: MappableButtonAction;
  sourceId: string;
  previousButtons: Record<string, boolean>;
}

export type ButtonCaptureOutcome =
  | "waiting"
  | "mapped"
  | "ambiguous"
  | "source_changed";

export interface ButtonCaptureUpdate {
  capture: ButtonCaptureState | null;
  mappings: ControllerButtonMappings;
  outcome: ButtonCaptureOutcome;
  captured: ControllerButtonBinding | null;
  /** Rising edges consumed by capture must not also execute a flight action. */
  consumedButtonIds: string[];
}

const ACTION_PRIORITY: readonly MappableButtonAction[] = [
  "emergency",
  "land",
  "takeoff",
  "start",
];

function cloneButtons(
  buttons: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(buttons).map(([buttonId, pressed]) => [
      buttonId,
      pressed === true,
    ]),
  );
}

function cloneBinding(
  binding: ControllerButtonBinding | null,
): ControllerButtonBinding | null {
  return binding ? { ...binding } : null;
}

function cloneMappings(
  mappings: ControllerButtonMappings,
): ControllerButtonMappings {
  return {
    start: cloneBinding(mappings.start),
    takeoff: cloneBinding(mappings.takeoff),
    land: cloneBinding(mappings.land),
    emergency: cloneBinding(mappings.emergency),
  };
}

function bindingsEqual(
  left: ControllerButtonBinding | null,
  right: ControllerButtonBinding,
): boolean {
  return Boolean(
    left &&
      left.sourceId === right.sourceId &&
      left.buttonId === right.buttonId,
  );
}

export function createEmptyButtonMappings(): ControllerButtonMappings {
  return { start: null, takeoff: null, land: null, emergency: null };
}

export function findRisingButtons(
  previous: Readonly<Record<string, boolean>>,
  current: Readonly<Record<string, boolean>>,
): string[] {
  return Object.keys(current)
    .filter((buttonId) => current[buttonId] === true && previous[buttonId] !== true)
    .sort();
}

/**
 * Assigns one button and removes the same source/button binding from any other
 * action. No product-specific bit value is embedded here.
 */
export function assignButtonMapping(
  mappings: ControllerButtonMappings,
  action: MappableButtonAction,
  binding: ControllerButtonBinding | null,
): ControllerButtonMappings {
  const next = cloneMappings(mappings);
  if (binding) {
    for (const candidate of ACTION_PRIORITY) {
      if (candidate !== action && bindingsEqual(next[candidate], binding)) {
        next[candidate] = null;
      }
    }
  }
  next[action] = cloneBinding(binding);
  return next;
}

/**
 * The currently pressed snapshot becomes the baseline. Consequently a button
 * that was held before capture must be released and pressed again.
 */
export function beginButtonCapture(
  action: MappableButtonAction,
  sourceId: string,
  currentButtons: Readonly<Record<string, boolean>>,
): ButtonCaptureState {
  return {
    action,
    sourceId,
    previousButtons: cloneButtons(currentButtons),
  };
}

export function updateButtonCapture(
  capture: ButtonCaptureState,
  mappings: ControllerButtonMappings,
  sourceId: string,
  currentButtons: Readonly<Record<string, boolean>>,
): ButtonCaptureUpdate {
  if (sourceId !== capture.sourceId) {
    return {
      capture: null,
      mappings: cloneMappings(mappings),
      outcome: "source_changed",
      captured: null,
      consumedButtonIds: [],
    };
  }

  const rising = findRisingButtons(capture.previousButtons, currentButtons);
  const nextCapture: ButtonCaptureState = {
    ...capture,
    previousButtons: cloneButtons(currentButtons),
  };
  if (rising.length === 0) {
    return {
      capture: nextCapture,
      mappings: cloneMappings(mappings),
      outcome: "waiting",
      captured: null,
      consumedButtonIds: [],
    };
  }
  if (rising.length !== 1) {
    return {
      capture: nextCapture,
      mappings: cloneMappings(mappings),
      outcome: "ambiguous",
      captured: null,
      consumedButtonIds: rising,
    };
  }

  const captured = { sourceId, buttonId: rising[0] };
  return {
    capture: null,
    mappings: assignButtonMapping(mappings, capture.action, captured),
    outcome: "mapped",
    captured,
    consumedButtonIds: rising,
  };
}

/**
 * Resolves one-shot mapped actions from false-to-true edges. Capture callers
 * pass consumedButtonIds so a mapping gesture never also flies the drone.
 */
export function resolveMappedButtonActions(
  mappings: ControllerButtonMappings,
  sourceId: string,
  previousButtons: Readonly<Record<string, boolean>>,
  currentButtons: Readonly<Record<string, boolean>>,
  consumedButtonIds: readonly string[] = [],
): MappableButtonAction[] {
  const consumed = new Set(consumedButtonIds);
  const rising = new Set(
    findRisingButtons(previousButtons, currentButtons).filter(
      (buttonId) => !consumed.has(buttonId),
    ),
  );
  return ACTION_PRIORITY.filter((action) => {
    const binding = mappings[action];
    return Boolean(
      binding &&
        binding.sourceId === sourceId &&
        rising.has(binding.buttonId),
    );
  });
}

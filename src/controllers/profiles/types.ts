export type ControllerProfileId =
  | "byrobot-smart-controller"
  | "byrobot-prc95"
  | "byrobot-battle-drone"
  | "byrobot-generic"
  | "gamepad-generic";

export type ControllerOperation =
  | "start"
  | "takeoff"
  | "landing"
  | "emergency"
  | "missionAction";

export type ProfileSemanticControl =
  | "throttle"
  | "yaw"
  | "pitch"
  | "roll";

export type PhysicalStickAxis =
  | "left-x"
  | "left-y"
  | "right-x"
  | "right-y";

export interface ControllerAxisBinding {
  rawAxisIndex: number;
  physicalAxis: PhysicalStickAxis;
  control: ProfileSemanticControl;
  inverted: boolean;
}

/**
 * A protocol guard prevents a product name or matching case shape from being
 * treated as proof that its payload has the documented layout.
 */
export interface AxisPresetRequirement {
  codecId: string;
  dataType: number;
  payloadLength: number;
  axisCount: number;
}

export interface ControllerAxisPreset {
  id: string;
  label: string;
  rawAxisOrder: readonly PhysicalStickAxis[];
  bindings: readonly ControllerAxisBinding[];
  requirement: AxisPresetRequirement;
  verification: {
    status: "verified";
    scope: "protocol-and-hardware";
    summary: string;
    sourceUrls: readonly string[];
  };
}

export interface VerifiedControllerButtonGesture {
  kind: "button";
  buttonId: string;
  trigger: "down" | "long-press";
  /** Product-specific hold threshold; required by future long-press profiles. */
  minimumDurationMs?: number;
  verification: {
    status: "verified";
    model: string;
    sourceUrl: string;
    summary: string;
  };
}

export interface VerifiedControllerAxisCondition {
  control: ProfileSemanticControl;
  minimum?: number;
  maximum?: number;
}

/**
 * Expresses verified stick combinations, multi-button chords, and mixed
 * throttle+button operations without placing device values in simulator code.
 */
export interface VerifiedControllerInputChordGesture {
  kind: "input-chord";
  buttons: readonly string[];
  axes: readonly VerifiedControllerAxisCondition[];
  minimumDurationMs: number;
  verification: {
    status: "verified";
    model: string;
    sourceUrl: string;
    summary: string;
  };
}

export type VerifiedControllerOperationGesture =
  | VerifiedControllerButtonGesture
  | VerifiedControllerInputChordGesture;

export type DefaultControllerOperationGestures = Readonly<
  Record<ControllerOperation, VerifiedControllerOperationGesture | null>
>;

/**
 * Official manuals sometimes identify a physical control but do not link it
 * to the value emitted by the USB 0x70 packet. Such information is useful to a
 * human during discovery, but must never become an executable default.
 */
export interface NonExecutableOperationHint {
  operation: ControllerOperation;
  executable: false;
  status: "physical-control-only";
  instructionKo: string;
  sourceUrl: string;
  missingEvidence: string;
}

export interface ControllerProfile {
  id: ControllerProfileId;
  label: string;
  adapterIds: readonly string[];
  modelVerification: "verified" | "candidate" | "unverified";
  modelNote: string;
  /** Usable only after its protocol requirement matches at runtime. */
  conditionalAxisPreset: ControllerAxisPreset;
  defaultOperationGestures: DefaultControllerOperationGestures;
  operationHints: readonly NonExecutableOperationHint[];
  supportsUserAxisMapping: true;
  supportsUserButtonMapping: true;
}

export interface ControllerProfileRuntimeContext {
  codecId?: string;
  dataType?: number;
  payloadLength?: number;
  axisCount?: number;
}

export interface UserControllerButtonGesture {
  kind: "button";
  buttonId: string;
  trigger: "down";
  origin: "user";
  capturedAt: number;
}

export interface ControllerProfileUserMappings {
  /** When present, all four semantic controls must be assigned exactly once. */
  axes?: readonly ControllerAxisBinding[];
  operations?: Partial<
    Record<ControllerOperation, UserControllerButtonGesture | null>
  >;
}

export type ResolvedControllerOperationGesture =
  | VerifiedControllerOperationGesture
  | UserControllerButtonGesture;

export interface ResolvedControllerProfile {
  profileId: ControllerProfileId;
  axisSource:
    | "verified-protocol-preset"
    | "user"
    | "unavailable"
    | "invalid-user-mapping";
  axisBindings: readonly ControllerAxisBinding[];
  operations: Readonly<
    Record<ControllerOperation, ResolvedControllerOperationGesture | null>
  >;
  operationSources: Readonly<
    Record<ControllerOperation, "verified-default" | "user" | "unavailable">
  >;
}

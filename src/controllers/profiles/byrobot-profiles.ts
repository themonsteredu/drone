import type {
  ControllerAxisBinding,
  ControllerAxisPreset,
  ControllerOperation,
  ControllerProfile,
  ControllerProfileId,
  ControllerProfileRuntimeContext,
  ControllerProfileUserMappings,
  DefaultControllerOperationGestures,
  PhysicalStickAxis,
  ResolvedControllerOperationGesture,
  ResolvedControllerProfile,
  VerifiedControllerOperationGesture,
} from "./types";

export const OFFICIAL_BYROBOT_JOYSTICK_STRUCT_URL =
  "https://dev.byrobot.co.kr/documents/kr/products/e_drone/protocol/05_structs/";
export const OFFICIAL_BATTLE_DRONE_MANUAL_URL =
  "https://dev.byrobot.co.kr/documents/kr/products/battle_drone/manual/user/";

export const BYROBOT_STRICT_INPUT_CODEC_ID =
  "coding-e-drone-controller-input-v1";

const OPERATIONS: readonly ControllerOperation[] = [
  "start",
  "takeoff",
  "landing",
  "emergency",
  "missionAction",
];

/**
 * This is intentionally all-null. A physical button label is not enough to
 * infer its 0x70 buttonId/bit, and no supported product currently has that
 * complete official mapping recorded in this project.
 */
export const UNVERIFIED_DEFAULT_OPERATIONS: DefaultControllerOperationGestures =
  Object.freeze({
    start: null,
    takeoff: null,
    landing: null,
    emergency: null,
    missionAction: null,
  });

/**
 * Verified 0x71 raw order: LX, LY, RX, RY. The current classroom controller
 * reports right-stick X with the opposite sign to the simulator's semantic
 * `roll + = aircraft-right` contract, so Roll alone is inverted here. Keeping
 * the correction at the product profile boundary means FlightPhysics remains
 * controller-agnostic and future controller profiles can choose their own
 * polarity.
 *
 * Keep this table in step with tests/axis-preset-contract.test.mjs, which
 * checks the four physical stick directions and the Mode 2 start gesture.
 */
export const BYROBOT_STRICT_JOYSTICK_AXIS_PRESET: ControllerAxisPreset =
  Object.freeze({
    id: "byrobot-strict-0x71-mode2-classroom-v3",
    label: "BYROBOT 기본 조종 (검증된 0x71 입력)",
    rawAxisOrder: Object.freeze([
      "left-x",
      "left-y",
      "right-x",
      "right-y",
    ] satisfies readonly PhysicalStickAxis[]),
    bindings: Object.freeze([
      Object.freeze({
        rawAxisIndex: 0,
        physicalAxis: "left-x",
        control: "yaw",
        inverted: false,
      }),
      Object.freeze({
        rawAxisIndex: 1,
        physicalAxis: "left-y",
        control: "throttle",
        inverted: false,
      }),
      Object.freeze({
        rawAxisIndex: 2,
        physicalAxis: "right-x",
        control: "roll",
        // Locked after physical-controller verification: right stick right
        // must move the aircraft right. Do not change without a new hardware
        // polarity test for this exact codec/profile.
        inverted: true,
      }),
      Object.freeze({
        rawAxisIndex: 3,
        physicalAxis: "right-y",
        control: "pitch",
        inverted: false,
      }),
    ] satisfies readonly ControllerAxisBinding[]),
    requirement: Object.freeze({
      codecId: BYROBOT_STRICT_INPUT_CODEC_ID,
      dataType: 0x71,
      payloadLength: 8,
      axisCount: 4,
    }),
    verification: Object.freeze({
      status: "verified",
      scope: "protocol-and-hardware",
      summary:
        "The official joystick structure supplies left/right X/Y in an 8-byte payload; classroom hardware testing confirmed that right-stick X requires a Roll-only sign correction.",
      sourceUrls: Object.freeze([OFFICIAL_BYROBOT_JOYSTICK_STRUCT_URL]),
    }),
  });

function createProfile(
  id: ControllerProfileId,
  label: string,
  adapterIds: readonly string[],
  modelVerification: ControllerProfile["modelVerification"],
  modelNote: string,
  operationHints: ControllerProfile["operationHints"] = [],
): ControllerProfile {
  return Object.freeze({
    id,
    label,
    adapterIds: Object.freeze([...adapterIds]),
    modelVerification,
    modelNote,
    conditionalAxisPreset: BYROBOT_STRICT_JOYSTICK_AXIS_PRESET,
    defaultOperationGestures: UNVERIFIED_DEFAULT_OPERATIONS,
    operationHints: Object.freeze([...operationHints]),
    supportsUserAxisMapping: true,
    supportsUserButtonMapping: true,
  });
}

export const SMART_CONTROLLER_PROFILE = createProfile(
  "byrobot-smart-controller",
  "바이로봇 스마트 조종기",
  ["byrobot-smart-controller"],
  "unverified",
  "The current product adapter is hint-matched; its USB/product identity and executable operation button values are not verified.",
);

export const PRC95_PROFILE = createProfile(
  "byrobot-prc95",
  "PRC-95 계열 조종기",
  ["byrobot-prc95"],
  "unverified",
  "The PRC-95 family name has not been linked to an official protocol identifier or operation button values.",
);

export const BATTLE_DRONE_PROFILE = createProfile(
  "byrobot-battle-drone",
  "바이로봇 배틀드론 조종기",
  ["byrobot-battle-drone"],
  "candidate",
  "The adapter can identify an official model number, but the manual's physical button number has not been linked to a USB 0x70 button bit.",
  [
    Object.freeze({
      operation: "takeoff",
      executable: false,
      status: "physical-control-only",
      instructionKo: "대기 상태에서 조종기 1번 버튼을 길게 누름",
      sourceUrl: OFFICIAL_BATTLE_DRONE_MANUAL_URL,
      missingEvidence:
        "The official manual does not map physical button 1 to a 0x70 buttonId/bit.",
    }),
    Object.freeze({
      operation: "landing",
      executable: false,
      status: "physical-control-only",
      instructionKo: "비행 상태에서 조종기 1번 버튼을 길게 누름",
      sourceUrl: OFFICIAL_BATTLE_DRONE_MANUAL_URL,
      missingEvidence:
        "The official manual does not map physical button 1 to a 0x70 buttonId/bit.",
    }),
    Object.freeze({
      operation: "emergency",
      executable: false,
      status: "physical-control-only",
      instructionKo: "스로틀 아래 방향과 조종기 1번 버튼의 공식 강제 정지 조작 확인 필요",
      sourceUrl: OFFICIAL_BATTLE_DRONE_MANUAL_URL,
      missingEvidence:
        "The physical gesture is documented, but neither its 0x70 bit nor a safe simulator emergency-landing binding is verified.",
    }),
  ],
);

export const GENERIC_BYROBOT_PROFILE = createProfile(
  "byrobot-generic",
  "바이로봇 조종기(모델 미확인)",
  ["byrobot-serial-generic-coding-e-candidate"],
  "unverified",
  "A valid strict input codec can enable axes, but it must not establish a product model or default operation buttons.",
);

export const GENERIC_GAMEPAD_PROFILE = createProfile(
  "gamepad-generic",
  "Gamepad 사용자 설정",
  ["gamepad-generic"],
  "unverified",
  "Gamepad axis and button layouts vary by device, so user mapping is required unless a future adapter supplies a verified profile.",
);

export const BYROBOT_CONTROLLER_PROFILES: readonly ControllerProfile[] =
  Object.freeze([
    SMART_CONTROLLER_PROFILE,
    PRC95_PROFILE,
    BATTLE_DRONE_PROFILE,
    GENERIC_BYROBOT_PROFILE,
  ]);

export function selectControllerProfile(adapterId: string): ControllerProfile {
  if (adapterId === "gamepad-generic" || adapterId.startsWith("gamepad-")) {
    return GENERIC_GAMEPAD_PROFILE;
  }
  return (
    BYROBOT_CONTROLLER_PROFILES.find((profile) =>
      profile.adapterIds.includes(adapterId),
    ) ?? GENERIC_BYROBOT_PROFILE
  );
}

export function profileAxisRequirementMatches(
  profile: ControllerProfile,
  context: ControllerProfileRuntimeContext,
): boolean {
  const requirement = profile.conditionalAxisPreset.requirement;
  return (
    context.codecId === requirement.codecId &&
    context.dataType === requirement.dataType &&
    context.payloadLength === requirement.payloadLength &&
    context.axisCount === requirement.axisCount
  );
}

function cloneAxes(
  axes: readonly ControllerAxisBinding[],
): ControllerAxisBinding[] {
  return axes.map((axis) => ({ ...axis }));
}

function cloneVerifiedGesture(
  gesture: VerifiedControllerOperationGesture,
): VerifiedControllerOperationGesture {
  if (gesture.kind === "input-chord") {
    return {
      ...gesture,
      buttons: [...gesture.buttons],
      axes: gesture.axes.map((condition) => ({ ...condition })),
      verification: { ...gesture.verification },
    };
  }
  return {
    ...gesture,
    verification: { ...gesture.verification },
  };
}

function hasCompleteUserAxisMapping(
  axes: readonly ControllerAxisBinding[],
): boolean {
  if (axes.length !== 4) return false;
  const indices = new Set(axes.map((axis) => axis.rawAxisIndex));
  const physicalAxes = new Set(axes.map((axis) => axis.physicalAxis));
  const controls = new Set(axes.map((axis) => axis.control));
  return (
    indices.size === 4 &&
    [...indices].every((index) => Number.isInteger(index) && index >= 0) &&
    physicalAxes.size === 4 &&
    controls.size === 4 &&
    ["throttle", "yaw", "pitch", "roll"].every((control) =>
      controls.has(control as ControllerAxisBinding["control"]),
    )
  );
}

/**
 * Resolves settings without reading packets or simulator state. The eventual
 * projector remains the only layer that turns raw axes into ControllerState.
 */
export function resolveControllerProfile(
  profile: ControllerProfile,
  context: ControllerProfileRuntimeContext,
  userMappings: ControllerProfileUserMappings = {},
): ResolvedControllerProfile {
  let axisSource: ResolvedControllerProfile["axisSource"];
  let axisBindings: ControllerAxisBinding[];

  if (userMappings.axes !== undefined) {
    if (hasCompleteUserAxisMapping(userMappings.axes)) {
      axisSource = "user";
      axisBindings = cloneAxes(userMappings.axes);
    } else {
      axisSource = "invalid-user-mapping";
      axisBindings = [];
    }
  } else if (profileAxisRequirementMatches(profile, context)) {
    axisSource = "verified-protocol-preset";
    axisBindings = cloneAxes(profile.conditionalAxisPreset.bindings);
  } else {
    axisSource = "unavailable";
    axisBindings = [];
  }

  const operations = {} as Record<
    ControllerOperation,
    ResolvedControllerOperationGesture | null
  >;
  const operationSources = {} as Record<
    ControllerOperation,
    "verified-default" | "user" | "unavailable"
  >;

  for (const operation of OPERATIONS) {
    const userGesture = userMappings.operations?.[operation];
    if (userGesture !== undefined) {
      operations[operation] = userGesture ? { ...userGesture } : null;
      operationSources[operation] = userGesture ? "user" : "unavailable";
      continue;
    }
    const defaultGesture = profile.defaultOperationGestures[operation];
    operations[operation] = defaultGesture
      ? cloneVerifiedGesture(defaultGesture)
      : null;
    operationSources[operation] = defaultGesture
      ? "verified-default"
      : "unavailable";
  }

  return {
    profileId: profile.id,
    axisSource,
    axisBindings,
    operations,
    operationSources,
  };
}

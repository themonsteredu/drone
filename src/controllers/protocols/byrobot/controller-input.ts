import type { ByrobotPacket } from "./types";

export const BYROBOT_DATA_TYPE_BUTTON = 0x70;
export const BYROBOT_DATA_TYPE_JOYSTICK = 0x71;

export const BYROBOT_BUTTON_PAYLOAD_LENGTH = 3;
export const BYROBOT_JOYSTICK_PAYLOAD_LENGTH = 8;

export interface ByrobotJoystickBlock {
  x: number;
  y: number;
  direction: number;
  directionName: string;
  event: number;
  eventName: string;
}

export interface ByrobotJoystickInput {
  left: ByrobotJoystickBlock;
  right: ByrobotJoystickBlock;
  rawPayload: number[];
  axesWithinDocumentedRange: boolean;
  receivedAt: number;
}

export interface ByrobotButtonInput {
  button: number;
  event: number;
  eventName: string;
  rawPayload: number[];
  receivedAt: number;
}

export type ByrobotInputDecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export interface ByrobotControllerInputCodec {
  readonly id: string;
  readonly label: string;
  decodeJoystick(
    packet: ByrobotPacket,
  ): ByrobotInputDecodeResult<ByrobotJoystickInput>;
  decodeButton(
    packet: ByrobotPacket,
  ): ByrobotInputDecodeResult<ByrobotButtonInput>;
}

export interface ByrobotInputEvidence {
  joystickSeen: boolean;
  joystickDecoded: boolean;
  joystickChangedEver: boolean;
  buttonSeen: boolean;
  buttonDecoded: boolean;
  buttonInteractionEver: boolean;
  buttonChangedEver: boolean;
}

export interface ByrobotControllerInputSnapshot {
  codecId: string;
  codecLabel: string;
  latestJoystick: ByrobotJoystickInput | null;
  /** Timestamp of the latest joystick sample accepted for ControllerState. */
  latestAcceptedJoystickAt: number | null;
  latestButton: ByrobotButtonInput | null;
  joystickPacketCount: number;
  buttonPacketCount: number;
  joystickUnsupportedReason: string | null;
  buttonUnsupportedReason: string | null;
  latestJoystickChanged: boolean;
  latestButtonChanged: boolean;
  latestButtonChangedMask: number;
  evidence: ByrobotInputEvidence;
}

export function isByrobotControllerInputActive(
  evidence: ByrobotInputEvidence,
): boolean {
  return (
    evidence.joystickDecoded &&
    evidence.joystickChangedEver &&
    evidence.buttonDecoded &&
    evidence.buttonInteractionEver &&
    evidence.buttonChangedEver
  );
}

const JOYSTICK_DIRECTION_NAMES: Readonly<Record<number, string>> = {
  0x00: "NONE",
  0x10: "VT",
  0x20: "VM",
  0x40: "VB",
  0x01: "HL",
  0x02: "HM",
  0x04: "HR",
  0x11: "TL",
  0x12: "TM",
  0x14: "TR",
  0x21: "ML",
  0x22: "CN",
  0x24: "MR",
  0x41: "BL",
  0x42: "BM",
  0x44: "BR",
};

const JOYSTICK_EVENT_NAMES: Readonly<Record<number, string>> = {
  0: "NONE",
  1: "IN",
  2: "STAY",
  3: "OUT",
  4: "END_OF_TYPE",
};

const BUTTON_EVENT_NAMES: Readonly<Record<number, string>> = {
  0: "NONE",
  1: "DOWN",
  2: "PRESS",
  3: "UP",
  4: "END_CONTINUE_PRESS",
};

function enumName(
  names: Readonly<Record<number, string>>,
  value: number,
): string {
  return names[value] ?? `UNKNOWN(0x${value.toString(16).toUpperCase().padStart(2, "0")})`;
}

function signedInt8(value: number): number {
  return value > 0x7f ? value - 0x100 : value;
}

function decodeJoystickBlock(
  payload: Uint8Array,
  offset: number,
): ByrobotJoystickBlock {
  const direction = payload[offset + 2];
  const event = payload[offset + 3];
  return {
    x: signedInt8(payload[offset]),
    y: signedInt8(payload[offset + 1]),
    direction,
    directionName: enumName(JOYSTICK_DIRECTION_NAMES, direction),
    event,
    eventName: enumName(JOYSTICK_EVENT_NAMES, event),
  };
}

export function decodeOfficialJoystickPacket(
  packet: ByrobotPacket,
): ByrobotInputDecodeResult<ByrobotJoystickInput> {
  if (packet.profile !== "device-addressed") {
    return { ok: false, reason: `Unsupported protocol profile: ${packet.profile}` };
  }
  if (packet.dataType !== BYROBOT_DATA_TYPE_JOYSTICK) {
    return {
      ok: false,
      reason: `Expected DataType 0x71, received 0x${packet.dataType.toString(16).toUpperCase().padStart(2, "0")}`,
    };
  }
  if (packet.from !== 0x20 || packet.to !== 0x70) {
    return {
      ok: false,
      reason: `0x71 source/target mismatch; expected Controller 0x20 → Base 0x70, received ${formatAddress(packet.from)} → ${formatAddress(packet.to)}`,
    };
  }
  if (packet.payload.length !== BYROBOT_JOYSTICK_PAYLOAD_LENGTH) {
    return {
      ok: false,
      reason: `0x71 received · unsupported payload length ${packet.payload.length}; official Coding/E-Drone layout is 8 bytes`,
    };
  }

  const left = decodeJoystickBlock(packet.payload, 0);
  const right = decodeJoystickBlock(packet.payload, 4);
  const axesWithinDocumentedRange = [left.x, left.y, right.x, right.y].every(
    (value) => value >= -100 && value <= 100,
  );

  return {
    ok: true,
    value: {
      left,
      right,
      rawPayload: Array.from(packet.payload),
      axesWithinDocumentedRange,
      receivedAt: packet.receivedAt,
    },
  };
}

export function decodeOfficialButtonPacket(
  packet: ByrobotPacket,
): ByrobotInputDecodeResult<ByrobotButtonInput> {
  if (packet.profile !== "device-addressed") {
    return { ok: false, reason: `Unsupported protocol profile: ${packet.profile}` };
  }
  if (packet.dataType !== BYROBOT_DATA_TYPE_BUTTON) {
    return {
      ok: false,
      reason: `Expected DataType 0x70, received 0x${packet.dataType.toString(16).toUpperCase().padStart(2, "0")}`,
    };
  }
  if (packet.from !== 0x20 || packet.to !== 0x70) {
    return {
      ok: false,
      reason: `0x70 source/target mismatch; expected Controller 0x20 → Base 0x70, received ${formatAddress(packet.from)} → ${formatAddress(packet.to)}`,
    };
  }
  if (packet.payload.length !== BYROBOT_BUTTON_PAYLOAD_LENGTH) {
    return {
      ok: false,
      reason: `0x70 received · unsupported payload length ${packet.payload.length}; official Coding/E-Drone layout is 3 bytes`,
    };
  }

  const button = packet.payload[0] | (packet.payload[1] << 8);
  const event = packet.payload[2];
  return {
    ok: true,
    value: {
      button,
      event,
      eventName: enumName(BUTTON_EVENT_NAMES, event),
      rawPayload: Array.from(packet.payload),
      receivedAt: packet.receivedAt,
    },
  };
}

export const CODING_E_DRONE_CONTROLLER_INPUT_CODEC: ByrobotControllerInputCodec = {
  id: "coding-e-drone-controller-input-v1",
  label: "Official Coding/E-Drone 8-byte controller input profile",
  decodeJoystick: decodeOfficialJoystickPacket,
  decodeButton: decodeOfficialButtonPacket,
};

function formatAddress(value: number | undefined): string {
  return value === undefined
    ? "Unknown"
    : `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function rawOnlyReason(dataType: number): ByrobotInputDecodeResult<never> {
  return {
    ok: false,
    reason: `DataType 0x${dataType.toString(16).toUpperCase().padStart(2, "0")} received · no verified controller input codec selected for this product adapter`,
  };
}

/** Safe default for product placeholders whose payload layout is unverified. */
export const RAW_ONLY_CONTROLLER_INPUT_CODEC: ByrobotControllerInputCodec = {
  id: "raw-only-unverified-controller",
  label: "Raw only · product input layout unverified",
  decodeJoystick: (packet) => rawOnlyReason(packet.dataType),
  decodeButton: (packet) => rawOnlyReason(packet.dataType),
};

function cloneJoystick(
  value: ByrobotJoystickInput | null,
): ByrobotJoystickInput | null {
  if (!value) return null;
  return {
    ...value,
    left: { ...value.left },
    right: { ...value.right },
    rawPayload: [...value.rawPayload],
  };
}

function cloneButton(value: ByrobotButtonInput | null): ByrobotButtonInput | null {
  return value ? { ...value, rawPayload: [...value.rawPayload] } : null;
}

/**
 * Session-scoped evidence reducer. It only observes CRC-valid packets emitted by
 * the existing stream parser; telemetry and unrelated DataTypes cannot activate
 * controller input.
 */
export class ByrobotControllerInputTracker {
  private latestJoystick: ByrobotJoystickInput | null = null;
  private validJoystickBaseline: ByrobotJoystickInput | null = null;
  private latestAcceptedJoystickAt: number | null = null;
  private latestButton: ByrobotButtonInput | null = null;
  private joystickPacketCount = 0;
  private buttonPacketCount = 0;
  private joystickUnsupportedReason: string | null = null;
  private buttonUnsupportedReason: string | null = null;
  private latestJoystickChanged = false;
  private latestButtonChanged = false;
  private latestButtonChangedMask = 0;
  private evidence: ByrobotInputEvidence = {
    joystickSeen: false,
    joystickDecoded: false,
    joystickChangedEver: false,
    buttonSeen: false,
    buttonDecoded: false,
    buttonInteractionEver: false,
    buttonChangedEver: false,
  };

  constructor(
    private readonly codec: ByrobotControllerInputCodec =
      CODING_E_DRONE_CONTROLLER_INPUT_CODEC,
  ) {}

  observe(packet: ByrobotPacket): void {
    if (packet.dataType === BYROBOT_DATA_TYPE_JOYSTICK) {
      this.observeJoystick(packet);
    } else if (packet.dataType === BYROBOT_DATA_TYPE_BUTTON) {
      this.observeButton(packet);
    }
  }

  reset(): void {
    this.latestJoystick = null;
    this.validJoystickBaseline = null;
    this.latestAcceptedJoystickAt = null;
    this.latestButton = null;
    this.joystickPacketCount = 0;
    this.buttonPacketCount = 0;
    this.joystickUnsupportedReason = null;
    this.buttonUnsupportedReason = null;
    this.latestJoystickChanged = false;
    this.latestButtonChanged = false;
    this.latestButtonChangedMask = 0;
    this.evidence = {
      joystickSeen: false,
      joystickDecoded: false,
      joystickChangedEver: false,
      buttonSeen: false,
      buttonDecoded: false,
      buttonInteractionEver: false,
      buttonChangedEver: false,
    };
  }

  snapshot(): ByrobotControllerInputSnapshot {
    return {
      codecId: this.codec.id,
      codecLabel: this.codec.label,
      latestJoystick: cloneJoystick(this.latestJoystick),
      latestAcceptedJoystickAt: this.latestAcceptedJoystickAt,
      latestButton: cloneButton(this.latestButton),
      joystickPacketCount: this.joystickPacketCount,
      buttonPacketCount: this.buttonPacketCount,
      joystickUnsupportedReason: this.joystickUnsupportedReason,
      buttonUnsupportedReason: this.buttonUnsupportedReason,
      latestJoystickChanged: this.latestJoystickChanged,
      latestButtonChanged: this.latestButtonChanged,
      latestButtonChangedMask: this.latestButtonChangedMask,
      evidence: { ...this.evidence },
    };
  }

  private observeJoystick(packet: ByrobotPacket): void {
    this.joystickPacketCount += 1;
    this.evidence.joystickSeen = true;
    const decoded = this.codec.decodeJoystick(packet);
    if (!decoded.ok) {
      this.joystickUnsupportedReason = decoded.reason;
      this.latestJoystickChanged = false;
      return;
    }

    const next = decoded.value;
    if (!next.axesWithinDocumentedRange) {
      this.joystickUnsupportedReason =
        "0x71 axes are outside the documented -100…+100 range; state not updated";
      this.latestJoystickChanged = false;
      this.latestJoystick = next;
      return;
    }

    const previous = this.validJoystickBaseline;
    this.latestJoystickChanged = Boolean(
      previous &&
        (previous.left.x !== next.left.x ||
          previous.left.y !== next.left.y ||
          previous.right.x !== next.right.x ||
          previous.right.y !== next.right.y),
    );
    this.latestJoystick = next;
    this.validJoystickBaseline = next;
    this.latestAcceptedJoystickAt = next.receivedAt;
    this.joystickUnsupportedReason = null;
    this.evidence.joystickDecoded = true;
    if (this.latestJoystickChanged) this.evidence.joystickChangedEver = true;
  }

  private observeButton(packet: ByrobotPacket): void {
    this.buttonPacketCount += 1;
    this.evidence.buttonSeen = true;
    const decoded = this.codec.decodeButton(packet);
    if (!decoded.ok) {
      this.buttonUnsupportedReason = decoded.reason;
      this.latestButtonChanged = false;
      return;
    }

    const next = decoded.value;
    const previous = this.latestButton;
    this.latestButtonChangedMask = previous ? previous.button ^ next.button : 0;
    this.latestButtonChanged = Boolean(
      previous &&
        (previous.button !== next.button || previous.event !== next.event),
    );
    this.latestButton = next;
    this.buttonUnsupportedReason = null;
    this.evidence.buttonDecoded = true;
    if (this.latestButtonChanged) this.evidence.buttonChangedEver = true;

    // A documented non-None button event is direct evidence of interaction even
    // when firmware emits no idle baseline packet before the first press.
    if (next.button !== 0 && next.event >= 1 && next.event <= 4) {
      this.evidence.buttonInteractionEver = true;
    }
  }
}

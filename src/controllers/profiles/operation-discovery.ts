import type { ControllerOperation, ControllerProfileId } from "./types";

export const BYROBOT_BUTTON_DATA_TYPE = 0x70;
export const BYROBOT_JOYSTICK_DATA_TYPE = 0x71;
export const DEFAULT_OPERATION_DISCOVERY_FRAME_LIMIT = 500;

export type DiscoverableControllerInputDataType =
  | typeof BYROBOT_BUTTON_DATA_TYPE
  | typeof BYROBOT_JOYSTICK_DATA_TYPE;

export interface OperationDiscoveryFrame {
  dataType: DiscoverableControllerInputDataType;
  payload: readonly number[];
  receivedAt: number;
  from?: number;
  to?: number;
}
export interface OperationDiscoverySession {
  schemaVersion: 1;
  captureId: string;
  operation: ControllerOperation;
  sourceId: string;
  profileId: ControllerProfileId;
  controllerModel?: string;
  protocol?: string;
  status: "recording" | "completed" | "cancelled";
  startedAt: number;
  endedAt: number | null;
  frames: readonly OperationDiscoveryFrame[];
  droppedFrameCount: number;
}

export interface OperationDiscoverySummary {
  operation: ControllerOperation;
  frameCount: number;
  buttonPacketCount: number;
  joystickPacketCount: number;
  distinctButtonPayloadCount: number;
  distinctJoystickPayloadCount: number;
  firstReceivedAt: number | null;
  lastReceivedAt: number | null;
}

export interface StartOperationDiscoveryOptions {
  captureId: string;
  operation: ControllerOperation;
  sourceId: string;
  profileId: ControllerProfileId;
  startedAt: number;
  controllerModel?: string;
  protocol?: string;
}

function cloneFrame(frame: OperationDiscoveryFrame): OperationDiscoveryFrame {
  return { ...frame, payload: [...frame.payload] };
}

function validateByte(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${label} must be an integer byte (0..255).`);
  }
}

function validateFrame(frame: OperationDiscoveryFrame): void {
  if (
    frame.dataType !== BYROBOT_BUTTON_DATA_TYPE &&
    frame.dataType !== BYROBOT_JOYSTICK_DATA_TYPE
  ) {
    throw new RangeError("Only BYROBOT Button 0x70 and Joystick 0x71 evidence can be recorded.");
  }
  if (!Number.isFinite(frame.receivedAt) || frame.receivedAt < 0) {
    throw new RangeError("receivedAt must be a non-negative finite timestamp.");
  }
  frame.payload.forEach((value, index) =>
    validateByte(value, `payload[${index}]`),
  );
  if (frame.from !== undefined) validateByte(frame.from, "from");
  if (frame.to !== undefined) validateByte(frame.to, "to");
}

export function startOperationDiscovery(
  options: StartOperationDiscoveryOptions,
): OperationDiscoverySession {
  if (!options.captureId.trim()) throw new Error("captureId is required.");
  if (!options.sourceId.trim()) throw new Error("sourceId is required.");
  if (!Number.isFinite(options.startedAt) || options.startedAt < 0) {
    throw new RangeError("startedAt must be a non-negative finite timestamp.");
  }
  return {
    schemaVersion: 1,
    ...options,
    status: "recording",
    endedAt: null,
    frames: [],
    droppedFrameCount: 0,
  };
}

/**
 * Records an immutable copy of raw packet evidence. It deliberately does not
 * derive button bits, gestures, stick meaning, or flight actions.
 */
export function recordOperationDiscoveryFrame(
  session: OperationDiscoverySession,
  sourceId: string,
  frame: OperationDiscoveryFrame,
  frameLimit = DEFAULT_OPERATION_DISCOVERY_FRAME_LIMIT,
): OperationDiscoverySession {
  if (session.status !== "recording") {
    throw new Error("Operation discovery is not recording.");
  }
  if (sourceId !== session.sourceId) {
    throw new Error("Controller source changed during operation discovery.");
  }
  if (!Number.isInteger(frameLimit) || frameLimit < 1) {
    throw new RangeError("frameLimit must be a positive integer.");
  }
  validateFrame(frame);

  const appended = [...session.frames.map(cloneFrame), cloneFrame(frame)];
  const overflow = Math.max(0, appended.length - frameLimit);
  return {
    ...session,
    frames: appended.slice(overflow),
    droppedFrameCount: session.droppedFrameCount + overflow,
  };
}

export function finishOperationDiscovery(
  session: OperationDiscoverySession,
  endedAt: number,
): OperationDiscoverySession {
  if (session.status !== "recording") {
    throw new Error("Only a recording discovery session can be completed.");
  }
  if (!Number.isFinite(endedAt) || endedAt < session.startedAt) {
    throw new RangeError("endedAt must be at or after startedAt.");
  }
  return {
    ...session,
    status: "completed",
    endedAt,
    frames: session.frames.map(cloneFrame),
  };
}

export function cancelOperationDiscovery(
  session: OperationDiscoverySession,
  endedAt: number,
): OperationDiscoverySession {
  if (session.status !== "recording") {
    throw new Error("Only a recording discovery session can be cancelled.");
  }
  if (!Number.isFinite(endedAt) || endedAt < session.startedAt) {
    throw new RangeError("endedAt must be at or after startedAt.");
  }
  return {
    ...session,
    status: "cancelled",
    endedAt,
    frames: session.frames.map(cloneFrame),
  };
}

function payloadSignature(frame: OperationDiscoveryFrame): string {
  return frame.payload
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/** Counts raw evidence only; no unknown packet value becomes a command. */
export function summarizeOperationDiscovery(
  session: OperationDiscoverySession,
): OperationDiscoverySummary {
  const buttons = session.frames.filter(
    (frame) => frame.dataType === BYROBOT_BUTTON_DATA_TYPE,
  );
  const joysticks = session.frames.filter(
    (frame) => frame.dataType === BYROBOT_JOYSTICK_DATA_TYPE,
  );
  return {
    operation: session.operation,
    frameCount: session.frames.length,
    buttonPacketCount: buttons.length,
    joystickPacketCount: joysticks.length,
    distinctButtonPayloadCount: new Set(buttons.map(payloadSignature)).size,
    distinctJoystickPayloadCount: new Set(joysticks.map(payloadSignature)).size,
    firstReceivedAt: session.frames[0]?.receivedAt ?? null,
    lastReceivedAt: session.frames.at(-1)?.receivedAt ?? null,
  };
}

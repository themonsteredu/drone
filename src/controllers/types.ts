import type { ControllerProfile } from "./profiles";

export type ConnectionMethod = "gamepad" | "serial" | "hid" | "usb";

export type DiagnosticStatus =
  | "idle"
  | "waiting"
  | "pass"
  | "warning"
  | "fail"
  | "unsupported"
  | "not_applicable";

export type ControllerErrorCode =
  | "web_serial_unsupported"
  | "permission_denied"
  | "port_unavailable"
  | "port_already_open"
  | "read_failed"
  | "write_failed"
  | "no_data"
  | "no_start_code"
  | "baud_mismatch_suspected"
  | "crc_error"
  | "unsupported_controller"
  | "adapter_unavailable";

export interface ControllerError {
  code: ControllerErrorCode;
  message: string;
  at: number;
  detail?: string;
}

export interface DeviceInfo {
  method: ConnectionMethod;
  id?: string;
  name?: string;
  productName?: string;
  vendorId?: number;
  productId?: number;
  serialNumber?: string;
}

export interface DetectionContext {
  startCodeSeen?: boolean;
  byrobotPacketValid?: boolean;
  protocolProfile?: string;
  reportedModelNumber?: number;
  modelHint?: "smart-controller" | "prc95" | "battle-drone";
}

export interface AdapterMatch {
  confidence: "none" | "candidate" | "confirmed";
  score: number;
  evidence: string[];
}

export interface DiagnosticStage {
  status: DiagnosticStatus;
  detail: string;
}

export interface ControllerDiagnostics {
  deviceDetected: DiagnosticStage;
  transportOpen: DiagnosticStage;
  dataReceived: DiagnosticStage;
  packetParsed: DiagnosticStage;
  inputActive: DiagnosticStage;
}

export type ControllerButtonTransitionPhase = "down" | "up";

/** Protocol-neutral edge stream shared by Serial and Gamepad adapters. */
export interface ControllerButtonTransition {
  sequence: number;
  observationSequence: number;
  buttonId: string;
  buttonNumber: number;
  phase: ControllerButtonTransitionPhase;
  at: number;
}

interface ControllerStateBase {
  connected: boolean;
  buttons: Record<string, boolean>;
  buttonTransitions?: ControllerButtonTransition[];
  rawAxes?: number[];
  rawButtons?: number[];
  controllerModel?: string;
  protocol?: string;
  updatedAt?: number;
}

export interface UnidentifiedControllerState extends ControllerStateBase {
  mappingStatus: "unidentified";
  throttle: null;
  yaw: null;
  pitch: null;
  roll: null;
}

export interface MappedControllerState extends ControllerStateBase {
  mappingStatus: "mapped";
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export type ControllerState =
  | UnidentifiedControllerState
  | MappedControllerState;

export interface ControllerAdapter {
  readonly id: string;
  readonly name: string;
  readonly connectionMethod: ConnectionMethod;
  /** Optional adapter-owned defaults; consumers must still enforce its guards. */
  readonly controllerProfile?: ControllerProfile;
  matches(deviceInfo: DeviceInfo, context?: DetectionContext): AdapterMatch;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getState(): ControllerState;
  getRawData(): unknown;
  getDiagnostics(): ControllerDiagnostics;
}

export function createUnidentifiedState(
  connected = false,
): UnidentifiedControllerState {
  return {
    connected,
    mappingStatus: "unidentified",
    throttle: null,
    yaw: null,
    pitch: null,
    roll: null,
    buttons: {},
    rawAxes: [],
    rawButtons: [],
  };
}

export function createWaitingDiagnostics(
  method: ConnectionMethod,
): ControllerDiagnostics {
  return {
    deviceDetected: { status: "idle", detail: "장치 선택 대기" },
    transportOpen: {
      status: method === "serial" ? "idle" : "not_applicable",
      detail: method === "serial" ? "연결 대기" : "해당 없음",
    },
    dataReceived: { status: "idle", detail: "데이터 대기" },
    packetParsed: {
      status: method === "serial" ? "idle" : "not_applicable",
      detail: method === "serial" ? "패킷 대기" : "해당 없음",
    },
    inputActive: { status: "idle", detail: "입력 변화 대기" },
  };
}

export function normalizeControllerValue(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

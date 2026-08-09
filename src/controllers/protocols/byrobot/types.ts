export const BYROBOT_START_CODE = [0x0a, 0x55] as const;

export interface ByrobotProtocolProfile {
  id: "device-addressed" | "legacy-link";
  label: string;
  headerLength: number;
  dataTypeOffset: number;
  lengthOffset: number;
  fromOffset?: number;
  toOffset?: number;
  maxPayloadLength: number;
}

/** Coding Drone / E-Drone family profile confirmed in official BYROBOT docs. */
export const DEVICE_ADDRESSED_PROFILE: ByrobotProtocolProfile = {
  id: "device-addressed",
  label: "BYROBOT device-addressed packet",
  headerLength: 4,
  dataTypeOffset: 0,
  lengthOffset: 1,
  fromOffset: 2,
  toOffset: 3,
  maxPayloadLength: 255,
};

/** Legacy Petrone Link has the same start code but no From/To header fields. */
export const LEGACY_LINK_PROFILE: ByrobotProtocolProfile = {
  id: "legacy-link",
  label: "BYROBOT legacy link packet",
  headerLength: 2,
  dataTypeOffset: 0,
  lengthOffset: 1,
  maxPayloadLength: 255,
};

export interface ByrobotPacket {
  profile: ByrobotProtocolProfile["id"];
  startCode: readonly [0x0a, 0x55];
  dataType: number;
  length: number;
  from?: number;
  to?: number;
  payload: Uint8Array;
  receivedCrc: number;
  calculatedCrc: number;
  crcValid: true;
  raw: Uint8Array;
  receivedAt: number;
}

export type ParserIssueCode =
  | "discarded_noise"
  | "invalid_length"
  | "crc_error"
  | "buffer_overflow";

export interface ParserIssue {
  code: ParserIssueCode;
  message: string;
  discardedBytes: number;
  receivedAt: number;
  expectedCrc?: number;
  receivedCrc?: number;
}

export interface ParserFeedResult {
  packets: ByrobotPacket[];
  issues: ParserIssue[];
  bufferedBytes: number;
  discardedBytes: number;
}

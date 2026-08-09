import { crc16Byrobot } from "./crc16";
import { BYROBOT_START_CODE } from "./types";

export const BYROBOT_DATA_TYPE_PING = 0x01;
export const BYROBOT_DEVICE_TYPE_CONTROLLER = 0x20;
export const BYROBOT_DEVICE_TYPE_BASE = 0x70;

export function buildDeviceAddressedPacket(
  dataType: number,
  from: number,
  to: number,
  payload: Uint8Array,
): Uint8Array {
  if (payload.length > 255) {
    throw new RangeError("BYROBOT payload length must fit in one byte.");
  }

  const headerAndPayload = Uint8Array.of(
    dataType & 0xff,
    payload.length,
    from & 0xff,
    to & 0xff,
    ...payload,
  );
  const crc = crc16Byrobot(headerAndPayload);

  return Uint8Array.of(
    ...BYROBOT_START_CODE,
    ...headerAndPayload,
    crc & 0xff,
    (crc >> 8) & 0xff,
  );
}

/**
 * Official BYROBOT input examples ping Controller after opening LINK mode.
 * The zero system-time payload is valid and does not issue a flight command.
 */
export function buildControllerInputActivationPing(): Uint8Array {
  return buildDeviceAddressedPacket(
    BYROBOT_DATA_TYPE_PING,
    BYROBOT_DEVICE_TYPE_BASE,
    BYROBOT_DEVICE_TYPE_CONTROLLER,
    new Uint8Array(8),
  );
}

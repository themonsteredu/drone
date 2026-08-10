export interface RememberedSerialIdentity {
  version: 2;
  usbVendorId?: number;
  usbProductId?: number;
  baudRate?: 9600 | 57600 | 115200;
}

export const SERIAL_IDENTITY_STORAGE_KEY =
  "byrobot-authorized-serial-identity-v2";
export const LEGACY_SERIAL_IDENTITY_STORAGE_KEY =
  "byrobot-authorized-serial-identity-v1";

function sameOptionalNumber(
  left: number | undefined,
  right: number | undefined,
): boolean {
  return left === right;
}

export function serialPortMatchesIdentity(
  port: BrowserSerialPort,
  identity: RememberedSerialIdentity,
): boolean {
  const info = port.getInfo();
  return (
    sameOptionalNumber(info.usbVendorId, identity.usbVendorId) &&
    sameOptionalNumber(info.usbProductId, identity.usbProductId)
  );
}

/**
 * Browsers expose only ports that the origin already has permission to use.
 * If several unrelated ports are authorized, opening one arbitrarily is
 * unsafe; prefer the last BYROBOT identity and otherwise require selection.
 */
export function chooseAuthorizedSerialPort(
  ports: readonly BrowserSerialPort[],
  remembered: RememberedSerialIdentity | null,
): BrowserSerialPort | null {
  if (!remembered) return null;
  const matches = ports.filter((port) =>
    serialPortMatchesIdentity(port, remembered),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function identityFromPort(
  port: BrowserSerialPort,
  baudRate: number,
): RememberedSerialIdentity {
  const info = port.getInfo();
  return {
    version: 2,
    usbVendorId: info.usbVendorId,
    usbProductId: info.usbProductId,
    baudRate: [9600, 57600, 115200].includes(baudRate)
      ? (baudRate as RememberedSerialIdentity["baudRate"])
      : undefined,
  };
}

export function parseRememberedSerialIdentity(
  value: unknown,
): RememberedSerialIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Omit<
    Partial<RememberedSerialIdentity>,
    "version"
  > & { version?: unknown };
  if (candidate.version !== 1 && candidate.version !== 2) return null;
  if (
    candidate.usbVendorId !== undefined &&
    (!Number.isInteger(candidate.usbVendorId) || candidate.usbVendorId < 0)
  ) {
    return null;
  }
  if (
    candidate.usbProductId !== undefined &&
    (!Number.isInteger(candidate.usbProductId) || candidate.usbProductId < 0)
  ) {
    return null;
  }
  if (
    candidate.baudRate !== undefined &&
    ![9600, 57600, 115200].includes(candidate.baudRate)
  ) {
    return null;
  }
  return {
    version: 2,
    usbVendorId: candidate.usbVendorId,
    usbProductId: candidate.usbProductId,
    baudRate:
      candidate.version === 2
        ? candidate.baudRate
        : undefined,
  };
}

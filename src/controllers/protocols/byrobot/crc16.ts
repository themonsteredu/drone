/**
 * BYROBOT's documented CRC implementation:
 * polynomial 0x1021, initial value 0x0000, no reflection/final xor.
 * The wire format stores the result low byte first.
 */
export function crc16Byrobot(bytes: ArrayLike<number>): number {
  let crc = 0x0000;

  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    crc ^= (bytes[byteIndex] & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        crc & 0x8000
          ? ((crc << 1) ^ 0x1021) & 0xffff
          : (crc << 1) & 0xffff;
    }
  }

  return crc;
}

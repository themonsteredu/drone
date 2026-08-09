import { crc16Byrobot } from "./crc16";
import {
  BYROBOT_START_CODE,
  DEVICE_ADDRESSED_PROFILE,
  type ByrobotPacket,
  type ByrobotProtocolProfile,
  type ParserFeedResult,
  type ParserIssue,
} from "./types";

const CRC_LENGTH = 2;
const START_LENGTH = BYROBOT_START_CODE.length;
const MAX_BUFFER_LENGTH = 64 * 1024;

export class ByrobotPacketParser {
  private buffer: number[] = [];

  constructor(
    readonly profile: ByrobotProtocolProfile = DEVICE_ADDRESSED_PROFILE,
  ) {}

  get bufferedBytes(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = [];
  }

  feed(chunk: Uint8Array, receivedAt = Date.now()): ParserFeedResult {
    const packets: ByrobotPacket[] = [];
    const issues: ParserIssue[] = [];
    let discardedBytes = 0;

    this.buffer.push(...chunk);

    if (this.buffer.length > MAX_BUFFER_LENGTH) {
      const overflow = this.buffer.length - MAX_BUFFER_LENGTH;
      this.buffer.splice(0, overflow);
      discardedBytes += overflow;
      issues.push({
        code: "buffer_overflow",
        message: `Stream buffer limit exceeded; discarded ${overflow} bytes.`,
        discardedBytes: overflow,
        receivedAt,
      });
    }

    while (this.buffer.length > 0) {
      const startIndex = this.findStartCode();

      if (startIndex < 0) {
        const preservePrefix =
          this.buffer.at(-1) === BYROBOT_START_CODE[0] ? 1 : 0;
        const noiseLength = this.buffer.length - preservePrefix;
        if (noiseLength > 0) {
          this.buffer.splice(0, noiseLength);
          discardedBytes += noiseLength;
          issues.push({
            code: "discarded_noise",
            message: `Discarded ${noiseLength} bytes before a start code.`,
            discardedBytes: noiseLength,
            receivedAt,
          });
        }
        break;
      }

      if (startIndex > 0) {
        this.buffer.splice(0, startIndex);
        discardedBytes += startIndex;
        issues.push({
          code: "discarded_noise",
          message: `Discarded ${startIndex} leading bytes.`,
          discardedBytes: startIndex,
          receivedAt,
        });
      }

      const minimumHeaderBytes = START_LENGTH + this.profile.headerLength;
      if (this.buffer.length < minimumHeaderBytes) break;

      const payloadLength =
        this.buffer[START_LENGTH + this.profile.lengthOffset];
      if (payloadLength > this.profile.maxPayloadLength) {
        this.buffer.shift();
        discardedBytes += 1;
        issues.push({
          code: "invalid_length",
          message: `Payload length ${payloadLength} exceeds profile limit.`,
          discardedBytes: 1,
          receivedAt,
        });
        continue;
      }

      const frameLength =
        START_LENGTH + this.profile.headerLength + payloadLength + CRC_LENGTH;
      if (this.buffer.length < frameLength) break;

      const raw = Uint8Array.from(this.buffer.slice(0, frameLength));
      const crcOffset = frameLength - CRC_LENGTH;
      const receivedCrc = raw[crcOffset] | (raw[crcOffset + 1] << 8);
      const calculatedCrc = crc16Byrobot(raw.slice(START_LENGTH, crcOffset));

      if (receivedCrc !== calculatedCrc) {
        this.buffer.shift();
        discardedBytes += 1;
        issues.push({
          code: "crc_error",
          message: "CRC mismatch; searching for the next start code.",
          discardedBytes: 1,
          receivedAt,
          expectedCrc: calculatedCrc,
          receivedCrc,
        });
        continue;
      }

      const headerOffset = START_LENGTH;
      const payloadOffset = headerOffset + this.profile.headerLength;
      const packet: ByrobotPacket = {
        profile: this.profile.id,
        startCode: BYROBOT_START_CODE,
        dataType: raw[headerOffset + this.profile.dataTypeOffset],
        length: payloadLength,
        payload: raw.slice(payloadOffset, crcOffset),
        receivedCrc,
        calculatedCrc,
        crcValid: true,
        raw,
        receivedAt,
      };

      if (this.profile.fromOffset !== undefined) {
        packet.from = raw[headerOffset + this.profile.fromOffset];
      }
      if (this.profile.toOffset !== undefined) {
        packet.to = raw[headerOffset + this.profile.toOffset];
      }

      packets.push(packet);
      this.buffer.splice(0, frameLength);
    }

    return {
      packets,
      issues,
      bufferedBytes: this.buffer.length,
      discardedBytes,
    };
  }

  private findStartCode(): number {
    for (let index = 0; index < this.buffer.length - 1; index += 1) {
      if (
        this.buffer[index] === BYROBOT_START_CODE[0] &&
        this.buffer[index + 1] === BYROBOT_START_CODE[1]
      ) {
        return index;
      }
    }
    return -1;
  }
}

import type { ByrobotPacket } from "../protocols/byrobot/types";

export type ChangeStatus = "insufficient" | "yes" | "no";
export type ChangeBasis = "packet" | "raw";

interface Sample {
  at: number;
  signature: string;
}

export interface ChangeSnapshot {
  status: ChangeStatus;
  basis: ChangeBasis;
  sampleCount: number;
}

const WINDOW_MS = 2_000;

function bytesSignature(bytes: ArrayLike<number>): string {
  let signature = "";
  for (let index = 0; index < bytes.length; index += 1) {
    signature += String.fromCharCode(bytes[index] & 0xff);
  }
  return signature;
}

export class DataChangeDetector {
  private rawSamples: Sample[] = [];
  private packetSamples: Sample[] = [];

  observeRaw(bytes: Uint8Array, at: number): void {
    this.rawSamples.push({ at, signature: bytesSignature(bytes) });
    this.prune(at);
  }

  observePacket(packet: ByrobotPacket): void {
    const fields = Uint8Array.of(
      packet.dataType,
      packet.from ?? 0,
      packet.to ?? 0,
      ...packet.payload,
    );
    this.packetSamples.push({
      at: packet.receivedAt,
      signature: bytesSignature(fields),
    });
    this.prune(packet.receivedAt);
  }

  snapshot(now = Date.now()): ChangeSnapshot {
    this.prune(now);
    const recentPackets = this.packetSamples.filter(
      (sample) => now - sample.at <= WINDOW_MS,
    );
    const basis: ChangeBasis = recentPackets.length >= 2 ? "packet" : "raw";
    const samples = basis === "packet" ? recentPackets : this.rawSamples;

    if (samples.length < 2) {
      return { status: "insufficient", basis, sampleCount: samples.length };
    }

    const signatures = new Set(samples.map((sample) => sample.signature));
    return {
      status: signatures.size > 1 ? "yes" : "no",
      basis,
      sampleCount: samples.length,
    };
  }

  reset(): void {
    this.rawSamples = [];
    this.packetSamples = [];
  }

  private prune(now: number): void {
    const oldest = now - WINDOW_MS;
    this.rawSamples = this.rawSamples.filter((sample) => sample.at >= oldest);
    this.packetSamples = this.packetSamples.filter(
      (sample) => sample.at >= oldest,
    );
  }
}

import {
  BYROBOT_DATA_TYPE_BUTTON,
  BYROBOT_DATA_TYPE_JOYSTICK,
} from "../protocols/byrobot/controller-input";
import type { ByrobotPacket } from "../protocols/byrobot/types";

export type PayloadChangeStatus = "insufficient" | "no" | "yes";

export interface DataTypeWindowEntry {
  dataType: number;
  label: string | null;
  packetCount5s: number;
  totalCount: number;
  latestAt: number | null;
  latestPayload: number[];
  previousPayload: number[] | null;
  payloadChange5s: PayloadChangeStatus;
  changedByteIndices: number[];
}

interface Observation {
  dataType: number;
  at: number;
  payload: number[];
  signature: string;
}

const WINDOW_MS = 5_000;
const MAX_RECENT_OBSERVATIONS = 20_000;

function labelFor(dataType: number): string | null {
  if (dataType === BYROBOT_DATA_TYPE_BUTTON) return "BUTTON";
  if (dataType === BYROBOT_DATA_TYPE_JOYSTICK) return "JOYSTICK";
  return null;
}

function changedByteIndices(
  previous: number[] | null,
  latest: number[],
): number[] {
  if (!previous) return [];
  const length = Math.max(previous.length, latest.length);
  const changed: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (previous[index] !== latest[index]) changed.push(index);
  }
  return changed;
}

/** Rolling, per-DataType statistics for CRC-valid packets only. */
export class ByrobotDataTypeMonitor {
  private recent: Observation[] = [];
  private readonly totals = new Map<number, number>();
  private readonly latest = new Map<number, Observation>();
  private readonly previous = new Map<number, Observation>();

  observe(packet: ByrobotPacket): void {
    const observation: Observation = {
      dataType: packet.dataType,
      at: packet.receivedAt,
      payload: Array.from(packet.payload),
      signature: Array.from(packet.payload).join(","),
    };
    const latest = this.latest.get(packet.dataType);
    if (latest) this.previous.set(packet.dataType, latest);
    this.latest.set(packet.dataType, observation);
    this.totals.set(
      packet.dataType,
      (this.totals.get(packet.dataType) ?? 0) + 1,
    );
    this.recent.push(observation);
    this.prune(packet.receivedAt);
    if (this.recent.length > MAX_RECENT_OBSERVATIONS) {
      this.recent.splice(0, this.recent.length - MAX_RECENT_OBSERVATIONS);
    }
  }

  reset(): void {
    this.recent = [];
    this.totals.clear();
    this.latest.clear();
    this.previous.clear();
  }

  snapshot(now = Date.now()): DataTypeWindowEntry[] {
    this.prune(now);
    const dataTypes = new Set<number>([
      ...this.totals.keys(),
      BYROBOT_DATA_TYPE_BUTTON,
      BYROBOT_DATA_TYPE_JOYSTICK,
    ]);

    return [...dataTypes]
      .map((dataType) => {
        const samples = this.recent.filter(
          (sample) => sample.dataType === dataType,
        );
        const signatures = new Set(samples.map((sample) => sample.signature));
        const latest = this.latest.get(dataType);
        const previous = this.previous.get(dataType);
        const latestPayload = latest ? [...latest.payload] : [];
        const previousPayload = previous ? [...previous.payload] : null;

        return {
          dataType,
          label: labelFor(dataType),
          packetCount5s: samples.length,
          totalCount: this.totals.get(dataType) ?? 0,
          latestAt: latest?.at ?? null,
          latestPayload,
          previousPayload,
          payloadChange5s:
            samples.length < 2
              ? "insufficient"
              : signatures.size > 1
                ? "yes"
                : "no",
          changedByteIndices: changedByteIndices(
            previousPayload,
            latestPayload,
          ),
        } satisfies DataTypeWindowEntry;
      })
      .sort((left, right) => {
        if (left.dataType === BYROBOT_DATA_TYPE_JOYSTICK) return -1;
        if (right.dataType === BYROBOT_DATA_TYPE_JOYSTICK) return 1;
        if (left.dataType === BYROBOT_DATA_TYPE_BUTTON) return -1;
        if (right.dataType === BYROBOT_DATA_TYPE_BUTTON) return 1;
        return left.dataType - right.dataType;
      });
  }

  private prune(now: number): void {
    const firstRetained = this.recent.findIndex(
      (sample) => now - sample.at <= WINDOW_MS,
    );
    if (firstRetained === -1) this.recent = [];
    else if (firstRetained > 0) this.recent.splice(0, firstRetained);
  }
}

import {
  SerialConnection,
  controllerError,
  type SerialConnectionOptions,
} from "../connections/serial-connection";
import {
  DataChangeDetector,
  type ChangeSnapshot,
} from "../diagnostics/change-detector";
import { ByrobotPacketParser } from "../protocols/byrobot/parser";
import { buildControllerInputActivationPing } from "../protocols/byrobot/packet";
import {
  BYROBOT_START_CODE,
  DEVICE_ADDRESSED_PROFILE,
  type ByrobotPacket,
  type ParserIssue,
} from "../protocols/byrobot/types";
import {
  createUnidentifiedState,
  createWaitingDiagnostics,
  type AdapterMatch,
  type ControllerAdapter,
  type ControllerDiagnostics,
  type ControllerError,
  type ControllerState,
  type DetectionContext,
  type DeviceInfo,
} from "../types";

export interface RawSerialEntry {
  id: number;
  receivedAt: number;
  bytes: number[];
  length: number;
}

interface ThroughputSample {
  at: number;
  bytes: number;
}

export interface ByrobotSerialSnapshot {
  isOpen: boolean;
  openedAt: number | null;
  baudRate: number;
  totalBytes: number;
  receiveUnitCount: number;
  bytesPerSecond: number;
  lastReceivedAt: number | null;
  startCodeSeen: boolean;
  rawEntries: RawSerialEntry[];
  logPaused: boolean;
  change: ChangeSnapshot;
  packetCount: number;
  crcErrorCount: number;
  discardedBytes: number;
  bufferedBytes: number;
  latestPacket: ByrobotPacket | null;
  latestParserIssue: ParserIssue | null;
  errors: ControllerError[];
  lastWriteAt: number | null;
  activationPingCount: number;
}

type Listener = () => void;

export class ByrobotSerialBaseAdapter implements ControllerAdapter {
  readonly connectionMethod = "serial" as const;

  protected state: ControllerState = createUnidentifiedState(false);
  protected diagnostics = createWaitingDiagnostics("serial");
  protected readonly parser = new ByrobotPacketParser(
    DEVICE_ADDRESSED_PROFILE,
  );

  private readonly connection: SerialConnection;
  private readonly detector = new DataChangeDetector();
  private readonly listeners = new Set<Listener>();
  private rawEntries: RawSerialEntry[] = [];
  private throughput: ThroughputSample[] = [];
  private errors: ControllerError[] = [];
  private latestPacket: ByrobotPacket | null = null;
  private latestParserIssue: ParserIssue | null = null;
  private entryId = 0;
  private totalBytes = 0;
  private receiveUnitCount = 0;
  private packetCount = 0;
  private crcErrorCount = 0;
  private discardedBytes = 0;
  private lastReceivedAt: number | null = null;
  private openedAt: number | null = null;
  private lastWriteAt: number | null = null;
  private activationPingCount = 0;
  private startCodeSeen = false;
  private previousByte: number | null = null;
  private logPaused = false;

  constructor(
    readonly port: BrowserSerialPort,
    readonly baudRate: number,
    readonly id = "byrobot-serial-generic",
    readonly name = "Generic BYROBOT Serial",
  ) {
    this.connection = new SerialConnection(port, {
      onBytes: (bytes, receivedAt) => this.handleBytes(bytes, receivedAt),
      onError: (error) => this.addError(error),
      onUnexpectedClose: () => {
        this.state = { ...this.state, connected: false };
        this.diagnostics.transportOpen = {
          status: "fail",
          detail: "포트 연결이 예기치 않게 종료됨",
        };
        this.emit();
      },
    });
  }

  matches(
    deviceInfo: DeviceInfo,
    context: DetectionContext = {},
  ): AdapterMatch {
    if (deviceInfo.method !== "serial") {
      return { confidence: "none", score: 0, evidence: [] };
    }
    if (context.byrobotPacketValid) {
      return {
        confidence: "confirmed",
        score: 80,
        evidence: ["A complete packet passed BYROBOT length and CRC checks."],
      };
    }
    if (context.startCodeSeen) {
      return {
        confidence: "candidate",
        score: 50,
        evidence: ["0x0A 0x55 start code observed; CRC not confirmed yet."],
      };
    }
    return {
      confidence: "candidate",
      score: 10,
      evidence: ["Serial port selected; protocol evidence not received yet."],
    };
  }

  async connect(): Promise<void> {
    this.resetSession();
    this.diagnostics.deviceDetected = {
      status: "pass",
      detail: "Serial 포트 선택됨",
    };
    this.diagnostics.transportOpen = {
      status: "waiting",
      detail: "포트 여는 중",
    };
    this.emit();

    const options: SerialConnectionOptions = {
      baudRate: this.baudRate,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
    };

    try {
      await this.connection.open(options);
      this.openedAt = Date.now();
      this.state = {
        ...createUnidentifiedState(true),
        controllerModel: "Unknown",
        protocol: "Unknown",
      };
      this.diagnostics.transportOpen = {
        status: "pass",
        detail: `${this.baudRate} baud · 8N1`,
      };
      this.diagnostics.dataReceived = {
        status: "waiting",
        detail: "RAW 데이터 대기",
      };
      this.diagnostics.packetParsed = {
        status: "waiting",
        detail: "BYROBOT 패킷 대기",
      };
      this.diagnostics.inputActive = {
        status: "waiting",
        detail: "검증된 제품 adapter 대기",
      };
      this.emit();
    } catch (error) {
      const normalized = this.asControllerError(error);
      this.addError(normalized);
      this.diagnostics.transportOpen = {
        status: "fail",
        detail: normalized.message,
      };
      throw normalized;
    }
  }

  async disconnect(): Promise<void> {
    await this.connection.close();
    this.state = { ...this.state, connected: false };
    this.diagnostics.transportOpen = {
      status: "idle",
      detail: "연결 해제됨",
    };
    this.emit();
  }

  async sendInputActivationPing(): Promise<Uint8Array> {
    const ping = buildControllerInputActivationPing();
    try {
      await this.connection.write(ping);
      this.activationPingCount += 1;
      this.lastWriteAt = Date.now();
      this.emit();
      return ping;
    } catch (error) {
      const normalized = this.asControllerError(error);
      this.addError(normalized);
      throw normalized;
    }
  }

  setLogPaused(paused: boolean): void {
    this.logPaused = paused;
    this.emit();
  }

  clearRawLog(): void {
    this.rawEntries = [];
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): ControllerState {
    return this.state;
  }

  getRawData(): ByrobotSerialSnapshot {
    return this.getSnapshot();
  }

  getDiagnostics(): ControllerDiagnostics {
    return this.diagnostics;
  }

  getSnapshot(now = Date.now()): ByrobotSerialSnapshot {
    const recent = this.throughput.filter((sample) => now - sample.at <= 1_000);
    return {
      isOpen: this.connection.isOpen,
      openedAt: this.openedAt,
      baudRate: this.baudRate,
      totalBytes: this.totalBytes,
      receiveUnitCount: this.receiveUnitCount,
      bytesPerSecond: recent.reduce((sum, sample) => sum + sample.bytes, 0),
      lastReceivedAt: this.lastReceivedAt,
      startCodeSeen: this.startCodeSeen,
      rawEntries: [...this.rawEntries],
      logPaused: this.logPaused,
      change: this.detector.snapshot(now),
      packetCount: this.packetCount,
      crcErrorCount: this.crcErrorCount,
      discardedBytes: this.discardedBytes,
      bufferedBytes: this.parser.bufferedBytes,
      latestPacket: this.latestPacket,
      latestParserIssue: this.latestParserIssue,
      errors: [...this.errors],
      lastWriteAt: this.lastWriteAt,
      activationPingCount: this.activationPingCount,
    };
  }

  getHealthWarnings(now = Date.now()): ControllerError[] {
    const warnings: ControllerError[] = [];
    if (!this.connection.isOpen) return warnings;

    if (this.totalBytes === 0 && this.openedAt && now - this.openedAt > 4_000) {
      warnings.push(controllerError("no_data"));
    }
    if (this.totalBytes >= 256 && !this.startCodeSeen) {
      warnings.push(controllerError("no_start_code"));
      warnings.push(controllerError("baud_mismatch_suspected"));
    } else if (
      this.totalBytes >= 512 &&
      this.startCodeSeen &&
      this.packetCount === 0
    ) {
      warnings.push(controllerError("baud_mismatch_suspected"));
    }
    if (this.packetCount > 0 && this.state.mappingStatus === "unidentified") {
      warnings.push(controllerError("adapter_unavailable"));
    }
    return warnings;
  }

  protected mapPacket(packet: ByrobotPacket): ControllerState | null {
    // Product adapters must only implement this after their payload is verified.
    void packet;
    return null;
  }

  private handleBytes(bytes: Uint8Array, receivedAt: number): void {
    this.totalBytes += bytes.length;
    this.receiveUnitCount += 1;
    this.lastReceivedAt = receivedAt;
    this.throughput.push({ at: receivedAt, bytes: bytes.length });
    this.throughput = this.throughput.filter(
      (sample) => receivedAt - sample.at <= 1_000,
    );

    const scan =
      this.previousByte === null
        ? bytes
        : Uint8Array.of(this.previousByte, ...bytes);
    for (let index = 0; index < scan.length - 1; index += 1) {
      if (
        scan[index] === BYROBOT_START_CODE[0] &&
        scan[index + 1] === BYROBOT_START_CODE[1]
      ) {
        this.startCodeSeen = true;
        break;
      }
    }
    this.previousByte = bytes.at(-1) ?? this.previousByte;

    if (!this.logPaused) {
      this.rawEntries = [
        ...this.rawEntries,
        {
          id: ++this.entryId,
          receivedAt,
          bytes: Array.from(bytes),
          length: bytes.length,
        },
      ].slice(-100);
    }

    this.detector.observeRaw(bytes, receivedAt);
    const result = this.parser.feed(bytes, receivedAt);
    this.discardedBytes += result.discardedBytes;

    for (const issue of result.issues) {
      this.latestParserIssue = issue;
      if (issue.code === "crc_error") {
        this.crcErrorCount += 1;
        this.addError(controllerError("crc_error"), false);
      }
    }

    for (const packet of result.packets) {
      this.latestPacket = packet;
      this.packetCount += 1;
      this.detector.observePacket(packet);
      const mapped = this.mapPacket(packet);
      if (mapped) this.state = mapped;
    }

    this.state = {
      ...this.state,
      connected: true,
      controllerModel: this.startCodeSeen
        ? "Unknown BYROBOT Controller"
        : "Unknown",
      protocol:
        this.packetCount > 0
          ? DEVICE_ADDRESSED_PROFILE.label
          : this.startCodeSeen
            ? "BYROBOT packet candidate"
            : "Unknown",
      updatedAt: receivedAt,
    };
    this.diagnostics.dataReceived = {
      status: "pass",
      detail: `${this.totalBytes.toLocaleString()} bytes 수신`,
    };
    this.diagnostics.packetParsed =
      this.packetCount > 0
        ? { status: "pass", detail: `${this.packetCount}개 CRC-valid 패킷` }
        : this.startCodeSeen
          ? { status: "waiting", detail: "시작 코드 발견 · 완전한 패킷 대기" }
          : { status: "waiting", detail: "0A 55 시작 코드 대기" };
    this.emit();
  }

  private resetSession(): void {
    this.parser.reset();
    this.detector.reset();
    this.state = createUnidentifiedState(false);
    this.diagnostics = createWaitingDiagnostics("serial");
    this.rawEntries = [];
    this.throughput = [];
    this.errors = [];
    this.latestPacket = null;
    this.latestParserIssue = null;
    this.entryId = 0;
    this.totalBytes = 0;
    this.receiveUnitCount = 0;
    this.packetCount = 0;
    this.crcErrorCount = 0;
    this.discardedBytes = 0;
    this.lastReceivedAt = null;
    this.openedAt = null;
    this.lastWriteAt = null;
    this.activationPingCount = 0;
    this.startCodeSeen = false;
    this.previousByte = null;
  }

  private addError(error: ControllerError, notify = true): void {
    const existingIndex = this.errors.findIndex((item) => item.code === error.code);
    if (existingIndex >= 0) this.errors.splice(existingIndex, 1);
    this.errors = [...this.errors, error].slice(-10);
    if (notify) this.emit();
  }

  private asControllerError(error: unknown): ControllerError {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error
    ) {
      return error as ControllerError;
    }
    return controllerError("port_unavailable", error);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export class GenericByrobotSerialAdapter extends ByrobotSerialBaseAdapter {}

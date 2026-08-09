import {
  SerialConnection,
  controllerError,
  type SerialConnectionOptions,
} from "../connections/serial-connection";
import {
  DataChangeDetector,
  type ChangeSnapshot,
} from "../diagnostics/change-detector";
import {
  ByrobotDataTypeMonitor,
  type DataTypeWindowEntry,
} from "../diagnostics/data-type-monitor";
import {
  ControllerButtonEventJournal,
} from "../diagnostics/button-event-journal";
import {
  BYROBOT_DATA_TYPE_BUTTON,
  BYROBOT_DATA_TYPE_JOYSTICK,
  ByrobotControllerInputTracker,
  CODING_E_DRONE_CONTROLLER_INPUT_CODEC,
  RAW_ONLY_CONTROLLER_INPUT_CODEC,
  isByrobotControllerInputActive,
  type ByrobotControllerInputCodec,
  type ByrobotControllerInputSnapshot,
  type ByrobotButtonInput,
  type ByrobotInputEvidence,
} from "../protocols/byrobot/controller-input";
import { ByrobotPacketParser } from "../protocols/byrobot/parser";
import {
  buildControllerDataRequest,
  buildControllerInputActivationPing,
} from "../protocols/byrobot/packet";
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
  type ControllerButtonTransition,
  type ControllerState,
  type DetectionContext,
  type DeviceInfo,
} from "../types";
import { GENERIC_BYROBOT_PROFILE } from "../profiles";
import type { OperationDiscoveryFrame } from "../profiles/operation-discovery";

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

export interface ControllerInputAcquisitionSnapshot {
  mode: "passive-after-ping" | "request-polling";
  polling: boolean;
  pollingIntervalMs: number | null;
  requestCount: number;
  joystickRequestCount: number;
  buttonRequestCount: number;
  inputPacketsAfterFirstRequest: number;
  lastRequestAt: number | null;
  lastRequestedDataType: number | null;
  requestRecommended: boolean;
}

export interface ControllerInputFrameEntry extends OperationDiscoveryFrame {
  sequence: number;
}

export interface ByrobotSerialSnapshot {
  capturedAt: number;
  adapterId: string;
  adapterName: string;
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
  activationPingLastAt: number | null;
  dataTypeStats: DataTypeWindowEntry[];
  controllerInput: ByrobotControllerInputSnapshot;
  controllerInputFrames: ControllerInputFrameEntry[];
  buttonTransitions: ControllerButtonTransition[];
  inputAcquisition: ControllerInputAcquisitionSnapshot;
}

type Listener = () => void;

export class ByrobotSerialBaseAdapter implements ControllerAdapter {
  readonly connectionMethod = "serial" as const;
  readonly controllerProfile = GENERIC_BYROBOT_PROFILE;

  protected state: ControllerState = createUnidentifiedState(false);
  protected diagnostics = createWaitingDiagnostics("serial");
  protected readonly parser = new ByrobotPacketParser(
    DEVICE_ADDRESSED_PROFILE,
  );

  private readonly connection: SerialConnection;
  private readonly detector = new DataChangeDetector();
  private readonly dataTypeMonitor = new ByrobotDataTypeMonitor();
  private readonly buttonEventJournal = new ControllerButtonEventJournal();
  private readonly inputTracker: ByrobotControllerInputTracker;
  private controllerInputFrames: ControllerInputFrameEntry[] = [];
  private controllerInputFrameSequence = 0;
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
  private activationPingLastAt: number | null = null;
  private inputRequestCount = 0;
  private joystickRequestCount = 0;
  private buttonRequestCount = 0;
  private inputPacketsAfterFirstRequest = 0;
  private lastRequestAt: number | null = null;
  private lastRequestedDataType: number | null = null;
  private inputPollingTimer: ReturnType<typeof setTimeout> | null = null;
  private inputPollingIntervalMs: number | null = null;
  private inputPollingCursor = 0;
  private inputPollingGeneration = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private sessionGeneration = 0;
  private startCodeSeen = false;
  private previousByte: number | null = null;
  private logPaused = false;

  constructor(
    readonly port: BrowserSerialPort,
    readonly baudRate: number,
    readonly id = "byrobot-serial-generic",
    readonly name = "Generic BYROBOT Serial",
    inputCodec: ByrobotControllerInputCodec =
      RAW_ONLY_CONTROLLER_INPUT_CODEC,
  ) {
    this.inputTracker = new ByrobotControllerInputTracker(inputCodec);
    this.connection = new SerialConnection(port, {
      onBytes: (bytes, receivedAt) => this.handleBytes(bytes, receivedAt),
      onError: (error) => this.addError(error),
      onUnexpectedClose: () => {
        this.stopInputRequestPolling(false);
        this.sessionGeneration += 1;
        this.state = { ...this.state, connected: false };
        this.diagnostics.transportOpen = {
          status: "fail",
          detail: "포트 연결이 예기치 않게 종료됨",
        };
        this.diagnostics.inputActive = {
          status: "fail",
          detail: "포트 종료로 입력 검증 중단",
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
        detail: "0x71 stick 변화와 0x70 button 입력 대기",
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
    this.stopInputRequestPolling(false);
    this.sessionGeneration += 1;
    await this.writeQueue.catch(() => undefined);
    await this.connection.close();
    this.state = { ...this.state, connected: false };
    this.diagnostics.transportOpen = {
      status: "idle",
      detail: "연결 해제됨",
    };
    this.diagnostics.inputActive = {
      status: "idle",
      detail: "연결 해제됨",
    };
    this.emit();
  }

  async sendInputActivationPing(): Promise<Uint8Array> {
    const ping = buildControllerInputActivationPing();
    const generation = this.sessionGeneration;
    try {
      await this.enqueueWrite(ping);
      if (generation !== this.sessionGeneration) {
        throw controllerError("port_unavailable");
      }
      this.activationPingCount += 1;
      this.activationPingLastAt = Date.now();
      this.lastWriteAt = this.activationPingLastAt;
      this.emit();
      return ping;
    } catch (error) {
      const normalized = this.asControllerError(error);
      if (generation === this.sessionGeneration) this.addError(normalized);
      throw normalized;
    }
  }

  async requestControllerInputOnce(): Promise<Uint8Array[]> {
    const frames: Uint8Array[] = [];
    const dataTypes = this.getInputRequestDataTypes();
    if (dataTypes.length === 0) throw controllerError("adapter_unavailable");
    for (const dataType of dataTypes) {
      frames.push(await this.sendControllerDataRequest(dataType));
    }
    return frames;
  }

  startInputRequestPolling(intervalMs = 250): void {
    if (!this.connection.isOpen) {
      throw controllerError("port_unavailable");
    }
    if (!Number.isFinite(intervalMs) || intervalMs < 100 || intervalMs > 5_000) {
      throw new RangeError("Request polling interval must be 100…5000 ms.");
    }
    if (this.getInputRequestDataTypes().length === 0) {
      throw controllerError("adapter_unavailable");
    }
    this.stopInputRequestPolling(false);
    this.inputPollingIntervalMs = Math.round(intervalMs);
    this.inputPollingCursor = 0;
    const generation = this.sessionGeneration;
    const pollingGeneration = this.inputPollingGeneration;

    const poll = async () => {
      if (
        this.inputPollingIntervalMs === null ||
        generation !== this.sessionGeneration ||
        pollingGeneration !== this.inputPollingGeneration ||
        !this.connection.isOpen
      ) {
        return;
      }
      const dataTypes = this.getInputRequestDataTypes();
      const dataType = dataTypes[this.inputPollingCursor % dataTypes.length];
      this.inputPollingCursor += 1;
      try {
        await this.sendControllerDataRequest(dataType);
      } catch (error) {
        if (
          generation === this.sessionGeneration &&
          pollingGeneration === this.inputPollingGeneration
        ) {
          this.addError(this.asControllerError(error));
          this.stopInputRequestPolling();
        }
        return;
      }
      if (
        this.inputPollingIntervalMs !== null &&
        generation === this.sessionGeneration &&
        pollingGeneration === this.inputPollingGeneration
      ) {
        this.inputPollingTimer = setTimeout(
          () => void poll(),
          this.inputPollingIntervalMs,
        );
      }
    };

    this.inputPollingTimer = setTimeout(() => void poll(), 0);
    this.emit();
  }

  stopInputRequestPolling(notify = true): void {
    this.inputPollingGeneration += 1;
    if (this.inputPollingTimer) clearTimeout(this.inputPollingTimer);
    this.inputPollingTimer = null;
    this.inputPollingIntervalMs = null;
    if (notify) this.emit();
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
    const controllerInput = this.inputTracker.snapshot();
    return {
      capturedAt: now,
      adapterId: this.id,
      adapterName: this.name,
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
      activationPingLastAt: this.activationPingLastAt,
      dataTypeStats: this.dataTypeMonitor.snapshot(now),
      controllerInput,
      controllerInputFrames: this.controllerInputFrames.map((entry) => ({
        ...entry,
        payload: [...entry.payload],
      })),
      buttonTransitions: this.buttonEventJournal.snapshot(),
      inputAcquisition: {
        mode:
          this.inputPollingIntervalMs === null
            ? "passive-after-ping"
            : "request-polling",
        polling: this.inputPollingIntervalMs !== null,
        pollingIntervalMs: this.inputPollingIntervalMs,
        requestCount: this.inputRequestCount,
        joystickRequestCount: this.joystickRequestCount,
        buttonRequestCount: this.buttonRequestCount,
        inputPacketsAfterFirstRequest: this.inputPacketsAfterFirstRequest,
        lastRequestAt: this.lastRequestAt,
        lastRequestedDataType: this.lastRequestedDataType,
        requestRecommended: Boolean(
          this.connection.isOpen &&
            this.activationPingLastAt &&
            now - this.activationPingLastAt >= 2_000 &&
            !controllerInput.evidence.joystickSeen,
        ),
      },
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
    const evidence = this.inputTracker.snapshot().evidence;
    if (
      (evidence.joystickSeen && !evidence.joystickDecoded) ||
      (evidence.buttonSeen && !evidence.buttonDecoded)
    ) {
      warnings.push(controllerError("adapter_unavailable"));
    }
    return warnings;
  }

  protected mapPacket(packet: ByrobotPacket): ControllerState | null {
    // Product adapters must only implement this after their payload is verified.
    void packet;
    return null;
  }

  /** Product adapters can override the request list or disable polling. */
  protected getInputRequestDataTypes(): readonly number[] {
    return [];
  }

  /** Product adapters can define a different evidence policy if documented. */
  protected isControllerInputActive(evidence: ByrobotInputEvidence): boolean {
    return isByrobotControllerInputActive(evidence);
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
      this.dataTypeMonitor.observe(packet);
      this.handleControllerInputPacket(packet);
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

  private handleControllerInputPacket(packet: ByrobotPacket): void {
    if (
      packet.dataType !== BYROBOT_DATA_TYPE_JOYSTICK &&
      packet.dataType !== BYROBOT_DATA_TYPE_BUTTON
    ) {
      return;
    }

    if (this.inputRequestCount > 0) this.inputPacketsAfterFirstRequest += 1;
    this.controllerInputFrames.push({
      sequence: ++this.controllerInputFrameSequence,
      dataType: packet.dataType,
      payload: Array.from(packet.payload),
      receivedAt: packet.receivedAt,
      from: packet.from,
      to: packet.to,
    });
    this.controllerInputFrames = this.controllerInputFrames.slice(-512);
    this.inputTracker.observe(packet);
    const input = this.inputTracker.snapshot();

    if (
      packet.dataType === BYROBOT_DATA_TYPE_JOYSTICK &&
      input.latestJoystick &&
      input.joystickUnsupportedReason === null
    ) {
      const { left, right } = input.latestJoystick;
      this.state = {
        ...this.state,
        rawAxes: [left.x / 100, left.y / 100, right.x / 100, right.y / 100],
      };
    }

    if (
      packet.dataType === BYROBOT_DATA_TYPE_BUTTON &&
      input.latestButton &&
      input.buttonUnsupportedReason === null
    ) {
      this.applyButtonState(input.latestButton);
    }

    const evidence = input.evidence;
    if (this.isControllerInputActive(evidence)) {
      this.diagnostics.inputActive = {
        status: "pass",
        detail: "0x71 stick 변화 + 0x70 button 상호작용 확인",
      };
    } else {
      const progress = [
        evidence.joystickDecoded
          ? evidence.joystickChangedEver
            ? "Joystick change PASS"
            : "Joystick move WAITING"
          : "0x71 WAITING",
        evidence.buttonDecoded
          ? evidence.buttonInteractionEver && evidence.buttonChangedEver
            ? "Button change PASS"
            : "Button press/change WAITING"
          : "0x70 WAITING",
      ];
      this.diagnostics.inputActive = {
        status: "waiting",
        detail: progress.join(" · "),
      };
    }
  }

  private applyButtonState(input: ByrobotButtonInput): void {
    this.buttonEventJournal.observe(input.button, input.event, input.receivedAt);
    const buttonPressedState = this.buttonEventJournal.pressedSnapshot();
    this.state = {
      ...this.state,
      rawButtons: Array.from({ length: 16 }, (_, index) =>
        (input.button & (1 << index)) !== 0 ? 1 : 0,
      ),
      buttons: Object.fromEntries(
        buttonPressedState.map((pressed, index) => [
          `button_bit_${index}`,
          pressed,
        ]),
      ),
      buttonTransitions: this.buttonEventJournal.snapshot(),
    };
  }

  private async sendControllerDataRequest(dataType: number): Promise<Uint8Array> {
    if (!this.getInputRequestDataTypes().includes(dataType)) {
      throw new RangeError(
        `DataType 0x${dataType.toString(16).toUpperCase()} is not enabled by this adapter request policy.`,
      );
    }
    const frame = buildControllerDataRequest(dataType);
    const generation = this.sessionGeneration;
    await this.enqueueWrite(frame);
    if (generation !== this.sessionGeneration) {
      throw controllerError("port_unavailable");
    }
    const now = Date.now();
    this.inputRequestCount += 1;
    if (dataType === BYROBOT_DATA_TYPE_JOYSTICK) this.joystickRequestCount += 1;
    if (dataType === BYROBOT_DATA_TYPE_BUTTON) this.buttonRequestCount += 1;
    this.lastRequestedDataType = dataType;
    this.lastRequestAt = now;
    this.lastWriteAt = now;
    this.emit();
    return frame;
  }

  private enqueueWrite(frame: Uint8Array): Promise<void> {
    const generation = this.sessionGeneration;
    const pending = this.writeQueue.then(async () => {
      if (generation !== this.sessionGeneration || !this.connection.isOpen) {
        throw controllerError("port_unavailable");
      }
      await this.connection.write(frame);
    });
    this.writeQueue = pending.catch(() => undefined);
    return pending;
  }

  private resetSession(): void {
    this.stopInputRequestPolling(false);
    this.sessionGeneration += 1;
    this.parser.reset();
    this.detector.reset();
    this.dataTypeMonitor.reset();
    this.inputTracker.reset();
    this.buttonEventJournal.reset();
    this.controllerInputFrames = [];
    this.controllerInputFrameSequence = 0;
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
    this.activationPingLastAt = null;
    this.inputRequestCount = 0;
    this.joystickRequestCount = 0;
    this.buttonRequestCount = 0;
    this.inputPacketsAfterFirstRequest = 0;
    this.lastRequestAt = null;
    this.lastRequestedDataType = null;
    this.inputPollingCursor = 0;
    this.writeQueue = Promise.resolve();
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

/**
 * Diagnostics-only candidate for the official Coding/E-Drone input profile.
 * It never confirms a product model; exact address, length, CRC, and axis range
 * still have to match before raw controller state is exposed.
 */
export class GenericByrobotSerialAdapter extends ByrobotSerialBaseAdapter {
  constructor(port: BrowserSerialPort, baudRate: number) {
    super(
      port,
      baudRate,
      "byrobot-serial-generic-coding-e-candidate",
      "Generic BYROBOT Serial · Coding/E input profile candidate",
      CODING_E_DRONE_CONTROLLER_INPUT_CODEC,
    );
  }

  protected override getInputRequestDataTypes(): readonly number[] {
    return [BYROBOT_DATA_TYPE_JOYSTICK, BYROBOT_DATA_TYPE_BUTTON];
  }
}

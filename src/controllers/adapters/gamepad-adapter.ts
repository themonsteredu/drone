import {
  createUnidentifiedState,
  createWaitingDiagnostics,
  type AdapterMatch,
  type ControllerAdapter,
  type ControllerButtonTransition,
  type ControllerDiagnostics,
  type ControllerState,
  type DetectionContext,
  type DeviceInfo,
} from "../types";
import { GENERIC_GAMEPAD_PROFILE } from "../profiles";

export interface GamepadRawSnapshot {
  sampledAt: number;
  id: string;
  index: number;
  mapping: GamepadMappingType;
  timestamp: number;
  axes: number[];
  buttons: Array<{ pressed: boolean; touched: boolean; value: number }>;
  axisChangedEver: boolean;
  buttonChangedEver: boolean;
  lastPressedButtonNumber: number | null;
}

export class GamepadControllerAdapter implements ControllerAdapter {
  readonly id: string;
  readonly name = "Gamepad API Controller";
  readonly connectionMethod = "gamepad" as const;
  readonly controllerProfile = GENERIC_GAMEPAD_PROFILE;

  private state = createUnidentifiedState(false);
  private diagnostics = createWaitingDiagnostics("gamepad");
  private raw: GamepadRawSnapshot | null = null;
  private previousAxes: number[] | null = null;
  private previousButtons: boolean[] | null = null;
  private previousGamepadTimestamp: number | null = null;
  private lastHardwareUpdatedAt: number | null = null;
  private axisChangedEver = false;
  private buttonChangedEver = false;
  private lastPressedButtonNumber: number | null = null;
  private buttonTransitions: ControllerButtonTransition[] = [];
  private buttonTransitionSequence = 0;
  private buttonObservationSequence = 0;

  constructor(readonly gamepadIndex: number) {
    this.id = `gamepad-${gamepadIndex}`;
  }

  matches(
    deviceInfo: DeviceInfo,
    context?: DetectionContext,
  ): AdapterMatch {
    void context;
    return deviceInfo.method === "gamepad"
      ? {
          confidence: "confirmed",
          score: 100,
          evidence: ["Browser exposed the device through Gamepad API."],
        }
      : { confidence: "none", score: 0, evidence: [] };
  }

  async connect(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.getGamepads) {
      throw new Error("Gamepad API is unavailable.");
    }
    const gamepad = navigator.getGamepads()[this.gamepadIndex];
    if (!gamepad) throw new Error("Gamepad is no longer connected.");
    this.update(gamepad);
  }

  update(gamepad: Gamepad): void {
    const sampledAt = Date.now();
    const axes = Array.from(gamepad.axes);
    const buttonStates = gamepad.buttons.map((button) => button.pressed);
    const axisChanged =
      this.previousAxes !== null &&
      axes.some(
        (value, index) =>
          Math.abs(value - (this.previousAxes?.[index] ?? value)) > 0.02,
      );
    const buttonChanged =
      this.previousButtons !== null &&
      buttonStates.some(
          (pressed, index) =>
            pressed !== (this.previousButtons?.[index] ?? pressed),
        );
    const timestampSupported =
      Number.isFinite(gamepad.timestamp) && gamepad.timestamp > 0;
    const browserSnapshotAdvanced =
      !timestampSupported ||
      this.previousGamepadTimestamp === null ||
      gamepad.timestamp !== this.previousGamepadTimestamp ||
      axisChanged ||
      buttonChanged;
    if (browserSnapshotAdvanced) this.lastHardwareUpdatedAt = sampledAt;
    const updatedAt = this.lastHardwareUpdatedAt ?? sampledAt;
    this.axisChangedEver ||= axisChanged;
    this.buttonChangedEver ||= buttonChanged;
    const observationSequence = buttonChanged
      ? ++this.buttonObservationSequence
      : this.buttonObservationSequence;
    buttonStates.forEach((pressed, index) => {
      const previous = this.previousButtons?.[index];
      if (previous === undefined || previous === pressed) return;
      if (pressed) this.lastPressedButtonNumber = index + 1;
      this.buttonTransitions.push({
        sequence: ++this.buttonTransitionSequence,
        observationSequence,
        buttonId: `button_${index + 1}`,
        buttonNumber: index + 1,
        phase: pressed ? "down" : "up",
        at: updatedAt,
      });
    });
    this.buttonTransitions = this.buttonTransitions.slice(-128);

    this.raw = {
      sampledAt,
      id: gamepad.id,
      index: gamepad.index,
      mapping: gamepad.mapping,
      timestamp: gamepad.timestamp,
      axes,
      buttons: gamepad.buttons.map((button) => ({
        pressed: button.pressed,
        touched: button.touched,
        value: button.value,
      })),
      axisChangedEver: this.axisChangedEver,
      buttonChangedEver: this.buttonChangedEver,
      lastPressedButtonNumber: this.lastPressedButtonNumber,
    };
    this.state = {
      ...createUnidentifiedState(true),
      controllerModel: gamepad.id || "Unknown Gamepad",
      protocol: "Gamepad API",
      rawAxes: axes,
      rawButtons: gamepad.buttons.map((button) => button.value),
      buttons: Object.fromEntries(
        buttonStates.map((pressed, index) => [`button_${index + 1}`, pressed]),
      ),
      buttonTransitions: this.buttonTransitions.map((entry) => ({ ...entry })),
      updatedAt,
    };
    this.diagnostics = {
      deviceDetected: { status: "pass", detail: "Gamepad 장치 감지" },
      transportOpen: { status: "not_applicable", detail: "해당 없음" },
      dataReceived: { status: "pass", detail: "Gamepad snapshot 수신" },
      packetParsed: { status: "not_applicable", detail: "해당 없음" },
      inputActive: this.axisChangedEver || this.buttonChangedEver
        ? { status: "pass", detail: "축 또는 버튼 변화 확인" }
        : this.diagnostics.inputActive.status === "pass"
          ? this.diagnostics.inputActive
          : { status: "waiting", detail: "조종기 입력을 움직이세요" },
    };
    this.previousAxes = axes;
    this.previousButtons = buttonStates;
    this.previousGamepadTimestamp = gamepad.timestamp;
  }

  async disconnect(): Promise<void> {
    this.state = createUnidentifiedState(false);
    this.diagnostics = createWaitingDiagnostics("gamepad");
    this.raw = null;
    this.previousAxes = null;
    this.previousButtons = null;
    this.previousGamepadTimestamp = null;
    this.lastHardwareUpdatedAt = null;
    this.axisChangedEver = false;
    this.buttonChangedEver = false;
    this.lastPressedButtonNumber = null;
    this.buttonTransitions = [];
    this.buttonTransitionSequence = 0;
    this.buttonObservationSequence = 0;
  }

  getState(): ControllerState {
    return this.state;
  }

  getRawData(): GamepadRawSnapshot | null {
    return this.raw;
  }

  getDiagnostics(): ControllerDiagnostics {
    return this.diagnostics;
  }
}

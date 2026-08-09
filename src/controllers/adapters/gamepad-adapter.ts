import {
  createUnidentifiedState,
  createWaitingDiagnostics,
  type AdapterMatch,
  type ControllerAdapter,
  type ControllerDiagnostics,
  type ControllerState,
  type DetectionContext,
  type DeviceInfo,
} from "../types";

export interface GamepadRawSnapshot {
  id: string;
  index: number;
  mapping: GamepadMappingType;
  timestamp: number;
  axes: number[];
  buttons: Array<{ pressed: boolean; touched: boolean; value: number }>;
}

export class GamepadControllerAdapter implements ControllerAdapter {
  readonly id: string;
  readonly name = "Gamepad API Controller";
  readonly connectionMethod = "gamepad" as const;

  private state = createUnidentifiedState(false);
  private diagnostics = createWaitingDiagnostics("gamepad");
  private raw: GamepadRawSnapshot | null = null;
  private previousAxes: number[] | null = null;
  private previousButtons: boolean[] | null = null;

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
    const axes = Array.from(gamepad.axes);
    const buttonStates = gamepad.buttons.map((button) => button.pressed);
    const changed =
      this.previousAxes !== null &&
      (axes.some(
        (value, index) =>
          Math.abs(value - (this.previousAxes?.[index] ?? value)) > 0.02,
      ) ||
        buttonStates.some(
          (pressed, index) =>
            pressed !== (this.previousButtons?.[index] ?? pressed),
        ));

    this.raw = {
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
      updatedAt: Date.now(),
    };
    this.diagnostics = {
      deviceDetected: { status: "pass", detail: "Gamepad 장치 감지" },
      transportOpen: { status: "not_applicable", detail: "해당 없음" },
      dataReceived: { status: "pass", detail: "Gamepad snapshot 수신" },
      packetParsed: { status: "not_applicable", detail: "해당 없음" },
      inputActive: changed
        ? { status: "pass", detail: "축 또는 버튼 변화 확인" }
        : this.diagnostics.inputActive.status === "pass"
          ? this.diagnostics.inputActive
          : { status: "waiting", detail: "조종기 입력을 움직이세요" },
    };
    this.previousAxes = axes;
    this.previousButtons = buttonStates;
  }

  async disconnect(): Promise<void> {
    this.state = createUnidentifiedState(false);
    this.diagnostics = createWaitingDiagnostics("gamepad");
    this.raw = null;
    this.previousAxes = null;
    this.previousButtons = null;
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

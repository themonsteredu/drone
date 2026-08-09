"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  normalizeCalibratedAxis,
  observeRawAxes,
  projectMappedControllerState,
  resetAxisCalibrations,
  saveAxisCenters,
  type AxisCalibration,
  type SemanticControl,
} from "../controllers/calibration";
import {
  GenericByrobotSerialAdapter,
  type ByrobotSerialSnapshot,
  type RawSerialEntry,
} from "../controllers/adapters/byrobot-serial-base";
import {
  GamepadControllerAdapter,
  type GamepadRawSnapshot,
} from "../controllers/adapters/gamepad-adapter";
import { ControllerManager } from "../controllers/controller-manager";
import {
  createUnidentifiedState,
  createWaitingDiagnostics,
  type ControllerDiagnostics,
  type ControllerError,
  type ControllerState,
  type DiagnosticStage,
} from "../controllers/types";

type ApiSupport = {
  checked: boolean;
  gamepad: boolean;
  serial: boolean;
  hid: boolean;
  usb: boolean;
  hidDevices: number;
  usbDevices: number;
};

type PortSelection = BrowserSerialPortInfo & {
  selectedAt: number;
};

type GamepadView = GamepadRawSnapshot & {
  diagnostics: ControllerDiagnostics;
  state: ControllerState;
};

const BAUD_RATES = [9600, 57600, 115200] as const;
const CONTROLS: Array<{ value: SemanticControl; label: string }> = [
  { value: "throttle", label: "Throttle" },
  { value: "yaw", label: "Yaw" },
  { value: "pitch", label: "Pitch" },
  { value: "roll", label: "Roll" },
];

const STATUS_LABEL: Record<DiagnosticStage["status"], string> = {
  idle: "WAITING",
  waiting: "WAITING",
  pass: "PASS",
  warning: "WARNING",
  fail: "FAIL",
  unsupported: "UNSUPPORTED",
  not_applicable: "N/A",
};

function formatHex(value: number | undefined, width = 2): string {
  return value === undefined
    ? "Unknown"
    : `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
}

function bytesToHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).toUpperCase().padStart(2, "0"),
  ).join(" ");
}

function bytesToDecimal(bytes: ArrayLike<number>): string {
  return Array.from(bytes).join(" ");
}

function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return `${date.toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}.${date.getMilliseconds().toString().padStart(3, "0")}`;
}

function formatNumber(value: number | null, digits = 3): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatNormalized(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

function formatSignedRaw(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function formatPayloadChange(
  status: "insufficient" | "no" | "yes" | undefined,
): string {
  if (status === "yes") return "YES";
  if (status === "no") return "NO";
  return "INSUFFICIENT";
}

function formatButtonBits(value: number): string {
  return value.toString(2).padStart(16, "0").replace(/(.{4})(?=.)/g, "$1 ");
}

function activeBitLabels(value: number): string {
  const bits = Array.from({ length: 16 }, (_, index) => index).filter(
    (index) => (value & (1 << index)) !== 0,
  );
  return bits.length ? bits.map((index) => `BIT ${index}`).join(", ") : "None";
}

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "알 수 없는 오류가 발생했습니다.";
}

function ApiCard({
  label,
  supported,
  detail,
}: {
  label: string;
  supported: boolean;
  detail: string;
}) {
  return (
    <div className={`api-card ${supported ? "is-supported" : "is-unsupported"}`}>
      <span className="api-card__dot" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <span>{supported ? "SUPPORTED" : "UNSUPPORTED"}</span>
      </div>
      <small>{detail}</small>
    </div>
  );
}

function PipelineStage({
  index,
  label,
  stage,
}: {
  index: number;
  label: string;
  stage: DiagnosticStage;
}) {
  return (
    <li className={`pipeline-stage stage--${stage.status}`}>
      <span className="pipeline-stage__index">{String(index).padStart(2, "0")}</span>
      <div>
        <strong>{label}</strong>
        <small>{stage.detail}</small>
      </div>
      <span className="stage-badge">{STATUS_LABEL[stage.status]}</span>
    </li>
  );
}

function DefinitionRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="definition-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function RawLogRow({ entry }: { entry: RawSerialEntry }) {
  return (
    <article className="raw-entry">
      <header>
        <time dateTime={new Date(entry.receivedAt).toISOString()}>
          {formatTime(entry.receivedAt)}
        </time>
        <span>{entry.length} bytes</span>
      </header>
      <div>
        <b>HEX</b>
        <code>{bytesToHex(entry.bytes)}</code>
      </div>
      <div>
        <b>DECIMAL</b>
        <code>{bytesToDecimal(entry.bytes)}</code>
      </div>
    </article>
  );
}

function SemanticGauge({ label, value }: { label: string; value: number | null }) {
  const position = value === null ? 50 : ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100;
  return (
    <div className={`semantic-gauge ${value === null ? "is-unmapped" : ""}`}>
      <div>
        <span>{label}</span>
        <output aria-live="off">{formatNormalized(value)}</output>
      </div>
      <div
        className="semantic-gauge__track"
        role={value === null ? undefined : "meter"}
        aria-label={value === null ? undefined : label}
        aria-valuemin={value === null ? undefined : -1}
        aria-valuemax={value === null ? undefined : 1}
        aria-valuenow={value ?? undefined}
      >
        <i className="semantic-gauge__center" />
        <i className="semantic-gauge__marker" style={{ left: `${position}%` }} />
      </div>
      <small>−1.0 <span>0</span> +1.0</small>
    </div>
  );
}

function GamepadAxis({ index, value }: { index: number; value: number }) {
  const position = ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100;
  return (
    <div className="gamepad-axis">
      <span>AXIS {index}</span>
      <output aria-live="off">{formatNormalized(value)}</output>
      <div className="gamepad-axis__track">
        <i style={{ left: `${position}%` }} />
      </div>
    </div>
  );
}

function StickField({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const position = ((Math.max(-100, Math.min(100, value)) + 100) / 200) * 100;
  return (
    <div className="stick-field">
      <div>
        <span>{label}</span>
        <output aria-live="off">{formatSignedRaw(value)}</output>
      </div>
      <div className="stick-field__track" aria-hidden="true">
        <i style={{ left: `${position}%` }} />
      </div>
      <small>−100 <span>0</span> +100</small>
    </div>
  );
}

export function ControllerDiagnosticsPage() {
  const [manager] = useState(() => new ControllerManager());

  const [support, setSupport] = useState<ApiSupport>({
    checked: false,
    gamepad: false,
    serial: false,
    hid: false,
    usb: false,
    hidDevices: 0,
    usbDevices: 0,
  });
  const [gamepads, setGamepads] = useState<GamepadView[]>([]);
  const [selectedGamepadIndex, setSelectedGamepadIndex] = useState<number | null>(null);
  const selectedGamepadIndexRef = useRef<number | null>(null);
  const gamepadAdaptersRef = useRef(new Map<number, GamepadControllerAdapter>());

  const [baudRate, setBaudRate] = useState<number>(115200);
  const [portSelection, setPortSelection] = useState<PortSelection | null>(null);
  const portRef = useRef<BrowserSerialPort | null>(null);
  const serialAdapterRef = useRef<GenericByrobotSerialAdapter | null>(null);
  const serialUnsubscribeRef = useRef<(() => void) | null>(null);
  const [serialSnapshot, setSerialSnapshot] = useState<ByrobotSerialSnapshot | null>(null);
  const [serialHealthWarnings, setSerialHealthWarnings] = useState<ControllerError[]>([]);
  const [serialDiagnostics, setSerialDiagnostics] = useState<ControllerDiagnostics>(() =>
    createWaitingDiagnostics("serial"),
  );
  const [serialState, setSerialState] = useState<ControllerState>(() =>
    createUnidentifiedState(false),
  );
  const [serialBusy, setSerialBusy] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [notice, setNotice] = useState(
    "Gamepad를 연결하거나 Serial 장치를 선택해 진단을 시작하세요.",
  );

  const [calibrations, setCalibrations] = useState<AxisCalibration[]>([]);
  const [calibrationOwnerKey, setCalibrationOwnerKey] = useState<string | null>(null);
  const [calibrationStarted, setCalibrationStarted] = useState(false);
  const [recordRange, setRecordRange] = useState(false);
  const calibrationStartedRef = useRef(false);
  const recordRangeRef = useRef(false);
  const calibrationOwnerKeyRef = useRef<string | null>(null);
  const hasSerialSelectionRef = useRef(false);

  useEffect(() => {
    selectedGamepadIndexRef.current = selectedGamepadIndex;
  }, [selectedGamepadIndex]);

  useEffect(() => {
    const serialAdapter = serialAdapterRef.current;
    if (serialSnapshot?.isOpen && serialAdapter) {
      manager.setActive(serialAdapter.id);
      return;
    }
    if (selectedGamepadIndex !== null) {
      const gamepadAdapter = gamepadAdaptersRef.current.get(selectedGamepadIndex);
      if (gamepadAdapter) {
        manager.setActive(gamepadAdapter.id);
        return;
      }
    }
    manager.setActive(null);
  }, [manager, selectedGamepadIndex, serialSnapshot?.isOpen]);

  useEffect(() => {
    let active = true;
    const next: ApiSupport = {
      checked: true,
      gamepad: typeof navigator.getGamepads === "function",
      serial: Boolean(navigator.serial),
      hid: Boolean(navigator.hid),
      usb: Boolean(navigator.usb),
      hidDevices: 0,
      usbDevices: 0,
    };

    Promise.all([
      navigator.hid?.getDevices().catch(() => []) ?? Promise.resolve([]),
      navigator.usb?.getDevices().catch(() => []) ?? Promise.resolve([]),
    ]).then(([hidDevices, usbDevices]) => {
      if (!active) return;
      setSupport({
        ...next,
        hidDevices: hidDevices.length,
        usbDevices: usbDevices.length,
      });
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!support.gamepad) return;

    let animationFrame = 0;
    let lastPoll = 0;
    const adapterMap = gamepadAdaptersRef.current;

    const ensureAdapter = (gamepad: Gamepad) => {
      let adapter = adapterMap.get(gamepad.index);
      if (!adapter) {
        adapter = new GamepadControllerAdapter(gamepad.index);
        adapterMap.set(gamepad.index, adapter);
        manager.register(adapter);
      }
      return adapter;
    };

    const pollGamepads = (time: number) => {
      if (time - lastPoll >= 32) {
        const browserGamepads = Array.from(navigator.getGamepads()).filter(
          (gamepad): gamepad is Gamepad => gamepad !== null,
        );
        const present = new Set(browserGamepads.map((gamepad) => gamepad.index));

        for (const [index, adapter] of adapterMap) {
          if (!present.has(index)) {
            void adapter.disconnect();
            adapterMap.delete(index);
            manager.unregister(adapter.id);
          }
        }

        const views = browserGamepads.map((gamepad) => {
          const adapter = ensureAdapter(gamepad);
          adapter.update(gamepad);
          return {
            ...(adapter.getRawData() as GamepadRawSnapshot),
            diagnostics: adapter.getDiagnostics(),
            state: adapter.getState(),
          };
        });
        setGamepads(views);

        const selected = selectedGamepadIndexRef.current;
        if (views.length === 0 && selected !== null) {
          setSelectedGamepadIndex(null);
        } else if (
          views.length > 0 &&
          (selected === null || !present.has(selected))
        ) {
          setSelectedGamepadIndex(views[0].index);
          if (!hasSerialSelectionRef.current) {
            manager.setActive(`gamepad-${views[0].index}`);
          }
        }
        const calibrationSource =
          views.find((view) => view.index === (selected ?? views[0]?.index)) ?? null;
        if (!hasSerialSelectionRef.current && calibrationSource) {
          const sourceKey = `gamepad:${calibrationSource.index}:${calibrationSource.id}`;
          const sourceChanged = calibrationOwnerKeyRef.current !== sourceKey;
          if (sourceChanged) {
            calibrationOwnerKeyRef.current = sourceKey;
            setCalibrationOwnerKey(sourceKey);
            calibrationStartedRef.current = false;
            recordRangeRef.current = false;
            setCalibrationStarted(false);
            setRecordRange(false);
          }
          setCalibrations((current) =>
            observeRawAxes(
              sourceChanged ? [] : current,
              calibrationSource.axes,
              !sourceChanged &&
                calibrationStartedRef.current &&
                recordRangeRef.current,
            ),
          );
        }
        lastPoll = time;
      }
      animationFrame = requestAnimationFrame(pollGamepads);
    };

    const handleConnected = (event: GamepadEvent) => {
      ensureAdapter(event.gamepad).update(event.gamepad);
      if (selectedGamepadIndexRef.current === null) {
        setSelectedGamepadIndex(event.gamepad.index);
      }
      if (!hasSerialSelectionRef.current) {
        manager.setActive(`gamepad-${event.gamepad.index}`);
      }
      setNotice("Gamepad API 장치를 감지했습니다. 축과 버튼을 움직여 보세요.");
    };
    const handleDisconnected = (event: GamepadEvent) => {
      if (selectedGamepadIndexRef.current === event.gamepad.index) {
        setSelectedGamepadIndex(null);
      }
      setNotice("Gamepad 연결이 해제되었습니다.");
    };

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);
    animationFrame = requestAnimationFrame(pollGamepads);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
      for (const adapter of adapterMap.values()) {
        void adapter.disconnect();
      }
      adapterMap.clear();
    };
  }, [manager, support.gamepad]);

  const syncSerial = useCallback(() => {
    const adapter = serialAdapterRef.current;
    if (!adapter) return;
    const snapshot = adapter.getSnapshot();
    setSerialSnapshot(snapshot);
    hasSerialSelectionRef.current = snapshot.isOpen;
    setSerialHealthWarnings(adapter.getHealthWarnings());
    const diagnostics = adapter.getDiagnostics();
    setSerialDiagnostics({
      ...diagnostics,
      deviceDetected: { ...diagnostics.deviceDetected },
      transportOpen: { ...diagnostics.transportOpen },
      dataReceived: { ...diagnostics.dataReceived },
      packetParsed: { ...diagnostics.packetParsed },
      inputActive: { ...diagnostics.inputActive },
    });
    const state = adapter.getState();
    setSerialState({ ...state });
    if (hasSerialSelectionRef.current && state.rawAxes?.length) {
      const sourceKey = `serial:${adapter.id}:${snapshot.openedAt ?? "opening"}`;
      const sourceChanged = calibrationOwnerKeyRef.current !== sourceKey;
      if (sourceChanged) {
        calibrationOwnerKeyRef.current = sourceKey;
        setCalibrationOwnerKey(sourceKey);
        calibrationStartedRef.current = false;
        recordRangeRef.current = false;
        setCalibrationStarted(false);
        setRecordRange(false);
      }
      setCalibrations((current) =>
        observeRawAxes(
          sourceChanged ? [] : current,
          state.rawAxes ?? [],
          !sourceChanged &&
            calibrationStartedRef.current &&
            recordRangeRef.current,
        ),
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(syncSerial, 250);
    return () => window.clearInterval(timer);
  }, [syncSerial]);

  useEffect(() => {
    return () => {
      serialUnsubscribeRef.current?.();
      const adapter = serialAdapterRef.current;
      if (adapter) void adapter.disconnect();
    };
  }, []);

  const selectSerialPort = async () => {
    setUiError(null);
    if (!navigator.serial) {
      setUiError("Web Serial 미지원: Windows의 최신 Google Chrome에서 HTTPS 주소로 여세요.");
      return;
    }

    try {
      const port = await navigator.serial.requestPort();
      const previousAdapter = serialAdapterRef.current;
      if (previousAdapter) {
        serialUnsubscribeRef.current?.();
        manager.unregister(previousAdapter.id);
        await previousAdapter.disconnect().catch(() => undefined);
      }
      serialAdapterRef.current = null;
      serialUnsubscribeRef.current = null;
      portRef.current = port;
      hasSerialSelectionRef.current = false;
      setSerialSnapshot(null);
      setSerialHealthWarnings([]);
      setSerialState(createUnidentifiedState(false));
      calibrationStartedRef.current = false;
      recordRangeRef.current = false;
      calibrationOwnerKeyRef.current = null;
      setCalibrationStarted(false);
      setRecordRange(false);
      setCalibrationOwnerKey(null);
      setCalibrations([]);
      setPortSelection({ ...port.getInfo(), selectedAt: Date.now() });
      setSerialDiagnostics({
        ...createWaitingDiagnostics("serial"),
        deviceDetected: { status: "pass", detail: "Serial 포트 선택됨" },
      });
      setNotice("Serial 장치를 선택했습니다. baud rate를 확인한 뒤 연결하세요.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        setUiError("포트 선택이 취소되었거나 권한이 허용되지 않았습니다.");
      } else if (error instanceof DOMException && error.name === "NotAllowedError") {
        setUiError("시리얼 포트 권한이 거절되었습니다.");
      } else {
        setUiError(`Serial 장치 선택 실패: ${errorMessage(error)}`);
      }
    }
  };

  const connectSerial = async () => {
    if (!portRef.current) {
      setUiError("먼저 ‘Serial 장치 선택’을 누르세요.");
      return;
    }
    setUiError(null);
    setSerialBusy(true);

    const oldAdapter = serialAdapterRef.current;
    if (oldAdapter) {
      serialUnsubscribeRef.current?.();
      manager.unregister(oldAdapter.id);
    }

    const adapter = new GenericByrobotSerialAdapter(portRef.current, baudRate);
    serialAdapterRef.current = adapter;
    manager.register(adapter);
    manager.setActive(adapter.id);
    let lastUiSync = 0;
    serialUnsubscribeRef.current = adapter.subscribe(() => {
      const now = performance.now();
      if (now - lastUiSync >= 100) {
        lastUiSync = now;
        syncSerial();
      }
    });

    try {
      await adapter.connect();
      hasSerialSelectionRef.current = true;
      setNotice(
        `Serial 포트가 ${baudRate} baud로 열렸습니다. BYROBOT 조종기라면 ‘입력 활성화’를 누르세요.`,
      );
    } catch (error) {
      setUiError(errorMessage(error));
    } finally {
      syncSerial();
      setSerialBusy(false);
    }
  };

  const disconnectSerial = async () => {
    const adapter = serialAdapterRef.current;
    if (!adapter) return;
    setSerialBusy(true);
    setUiError(null);
    try {
      await adapter.disconnect();
      hasSerialSelectionRef.current = false;
      if (selectedGamepadIndex !== null) {
        const gamepadAdapter = gamepadAdaptersRef.current.get(selectedGamepadIndex);
        if (gamepadAdapter) manager.setActive(gamepadAdapter.id);
        calibrationStartedRef.current = false;
        recordRangeRef.current = false;
        calibrationOwnerKeyRef.current = null;
        setCalibrationStarted(false);
        setRecordRange(false);
        setCalibrationOwnerKey(null);
        setCalibrations([]);
      }
      setNotice("Serial 연결을 해제했습니다. 로그와 통계는 화면에 유지됩니다.");
    } catch (error) {
      setUiError(`연결 해제 실패: ${errorMessage(error)}`);
    } finally {
      syncSerial();
      setSerialBusy(false);
    }
  };

  const activateByrobotInput = async () => {
    const adapter = serialAdapterRef.current;
    if (!adapter || !serialSnapshot?.isOpen) return;
    setUiError(null);
    try {
      const frame = await adapter.sendInputActivationPing();
      setNotice(
        `BYROBOT Controller Ping 전송 완료: ${bytesToHex(frame)} · 이제 스틱과 버튼을 움직이세요.`,
      );
      syncSerial();
    } catch (error) {
      setUiError(`입력 활성화 Ping 실패: ${errorMessage(error)}`);
    }
  };

  const requestControllerInputOnce = async () => {
    const adapter = serialAdapterRef.current;
    if (!adapter || !serialSnapshot?.isOpen) return;
    setUiError(null);
    setSerialBusy(true);
    try {
      const frames = await adapter.requestControllerInputOnce();
      setNotice(
        `Controller Request 전송 완료: ${frames.map((frame) => bytesToHex(frame)).join(" / ")} · 0x71/0x70 응답을 확인하세요.`,
      );
    } catch (error) {
      setUiError(`Controller 입력 요청 실패: ${errorMessage(error)}`);
    } finally {
      syncSerial();
      setSerialBusy(false);
    }
  };

  const toggleInputRequestPolling = () => {
    const adapter = serialAdapterRef.current;
    if (!adapter || !serialSnapshot?.isOpen) return;
    setUiError(null);
    try {
      if (serialSnapshot.inputAcquisition.polling) {
        adapter.stopInputRequestPolling();
        setNotice("Controller Request 폴링을 중지했습니다. Push 입력은 계속 감시합니다.");
      } else {
        adapter.startInputRequestPolling(250);
        setNotice(
          "0x71/0x70 진단용 Request 폴링을 시작했습니다. 250ms는 앱의 보수적 진단 간격이며 BYROBOT 공식 권장 주기는 아닙니다.",
        );
      }
      syncSerial();
    } catch (error) {
      setUiError(`Controller Request 폴링 실패: ${errorMessage(error)}`);
    }
  };

  const toggleRawLog = () => {
    const adapter = serialAdapterRef.current;
    if (!adapter) return;
    adapter.setLogPaused(!serialSnapshot?.logPaused);
    syncSerial();
  };

  const clearRawLog = () => {
    serialAdapterRef.current?.clearRawLog();
    syncSerial();
  };

  const copyRawLog = async () => {
    const entries = serialSnapshot?.rawEntries ?? [];
    if (entries.length === 0) {
      setUiError("복사할 RAW 로그가 없습니다.");
      return;
    }
    const text = entries
      .map(
        (entry) =>
          `${formatTime(entry.receivedAt)}  ${entry.length} bytes\nHEX      ${bytesToHex(entry.bytes)}\nDECIMAL  ${bytesToDecimal(entry.bytes)}`,
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`최근 RAW 로그 ${entries.length}개를 클립보드에 복사했습니다.`);
    } catch (error) {
      setUiError(`클립보드 복사 실패: ${errorMessage(error)}`);
    }
  };

  const selectedGamepad =
    gamepads.find((gamepad) => gamepad.index === selectedGamepadIndex) ?? null;
  const gamepadDiagnostics =
    selectedGamepad?.diagnostics ?? createWaitingDiagnostics("gamepad");

  const activeMethod = serialSnapshot?.isOpen
    ? "serial"
    : selectedGamepad
      ? "gamepad"
      : portSelection
        ? "serial"
        : null;
  const activeDiagnostics =
    activeMethod === "serial" ? serialDiagnostics : gamepadDiagnostics;
  const activeRawAxes =
    activeMethod === "serial"
      ? (serialState.rawAxes ?? [])
      : (selectedGamepad?.axes ?? []);
  const activeSourceKey =
    activeMethod === "serial"
      ? `serial:${serialSnapshot?.adapterId ?? "selected"}:${serialSnapshot?.openedAt ?? portSelection?.selectedAt ?? "pending"}`
      : activeMethod === "gamepad" && selectedGamepad
        ? `gamepad:${selectedGamepad.index}:${selectedGamepad.id}`
        : null;
  const activeCalibrations =
    calibrationOwnerKey === activeSourceKey ? calibrations : [];
  const activeAdapterState =
    activeMethod === "serial"
      ? serialState
      : selectedGamepad
        ? selectedGamepad.state
        : createUnidentifiedState(false);
  const commonControllerState = projectMappedControllerState(
    activeAdapterState,
    activeCalibrations,
  );

  useEffect(() => {
    const profile =
      calibrationOwnerKey === activeSourceKey ? calibrations : [];
    manager.setStateProjector((state) =>
      projectMappedControllerState(state, profile),
    );
    return () => manager.setStateProjector(null);
  }, [activeSourceKey, calibrationOwnerKey, calibrations, manager]);
  const mappedValues = {
    throttle: commonControllerState.throttle,
    yaw: commonControllerState.yaw,
    pitch: commonControllerState.pitch,
    roll: commonControllerState.roll,
  };

  const mappingComplete = commonControllerState.mappingStatus === "mapped";
  const inputActive =
    commonControllerState.connected &&
    activeDiagnostics.inputActive.status === "pass";
  const ready =
    inputActive && mappingComplete && commonControllerState.connected;

  let overallStatus = "NOT CONNECTED";
  if (ready) overallStatus = "READY";
  else if (inputActive) overallStatus = "INPUT ACTIVE · MAPPING REQUIRED";
  else if (
    activeMethod === "serial" &&
    portSelection &&
    !serialSnapshot?.isOpen
  ) {
    overallStatus = "DEVICE SELECTED · DISCONNECTED";
  }
  else if (activeMethod === "serial" && serialSnapshot?.change.status === "yes") {
    overallStatus = "RAW DATA CHANGING · MAPPING REQUIRED";
  } else if (activeMethod === "serial" && serialSnapshot?.packetCount) {
    overallStatus = "PACKET VALID · MAPPING REQUIRED";
  } else if (activeMethod === "serial" && serialSnapshot?.totalBytes) {
    overallStatus = "RAW DATA RECEIVED";
  } else if (activeMethod === "serial" && serialSnapshot?.isOpen) {
    overallStatus = "WAITING FOR DATA";
  } else if (activeMethod === "serial" && portSelection) {
    overallStatus = "DEVICE SELECTED";
  } else if (selectedGamepad) {
    overallStatus = "GAMEPAD DETECTED · MOVE INPUT";
  }

  const latestPacket = serialSnapshot?.latestPacket ?? null;
  const controllerInput = serialSnapshot?.controllerInput ?? null;
  const dataTypeRows = serialSnapshot?.dataTypeStats ?? [
    {
      dataType: 0x71,
      label: "JOYSTICK",
      packetCount5s: 0,
      totalCount: 0,
      latestAt: null,
      latestPayload: [],
      previousPayload: null,
      payloadChange5s: "insufficient" as const,
      changedByteIndices: [],
    },
    {
      dataType: 0x70,
      label: "BUTTON",
      packetCount5s: 0,
      totalCount: 0,
      latestAt: null,
      latestPayload: [],
      previousPayload: null,
      payloadChange5s: "insufficient" as const,
      changedByteIndices: [],
    },
  ];
  const serialErrors = serialSnapshot?.errors ?? [];
  const visibleErrors = [...serialErrors, ...serialHealthWarnings].filter(
    (item, index, all) => all.findIndex((candidate) => candidate.code === item.code) === index,
  );

  const detectedController =
    activeMethod === "gamepad"
      ? selectedGamepad?.id || "Unknown Gamepad"
      : latestPacket || serialSnapshot?.startCodeSeen
        ? "Unknown BYROBOT Controller"
        : "Unknown";
  const protocol =
    activeMethod === "gamepad"
      ? "Gamepad API"
      : latestPacket
        ? "BYROBOT device-addressed packet"
        : serialSnapshot?.startCodeSeen
          ? "BYROBOT packet candidate"
          : "Unknown";
  const selectedAdapter =
    activeMethod === "gamepad"
      ? "GamepadControllerAdapter"
      : latestPacket || serialSnapshot?.startCodeSeen
        ? "Generic BYROBOT Serial"
        : "Raw Serial · adapter pending";

  const startCalibration = () => {
    calibrationStartedRef.current = true;
    recordRangeRef.current = false;
    setCalibrationStarted(true);
    setRecordRange(false);
    calibrationOwnerKeyRef.current = activeSourceKey;
    setCalibrationOwnerKey(activeSourceKey);
    setCalibrations(
      observeRawAxes(
        resetAxisCalibrations(activeRawAxes.length),
        activeRawAxes,
        false,
      ),
    );
    setNotice("캘리브레이션을 시작했습니다. 조종기를 중앙에 두고 ‘중앙 저장’을 누르세요.");
  };

  const resetCalibration = () => {
    calibrationStartedRef.current = false;
    recordRangeRef.current = false;
    setCalibrationStarted(false);
    setRecordRange(false);
    calibrationOwnerKeyRef.current = activeSourceKey;
    setCalibrationOwnerKey(activeSourceKey);
    setCalibrations(resetAxisCalibrations(activeRawAxes.length));
    setNotice("캘리브레이션 값을 초기화했습니다.");
  };

  const updateCalibration = (
    index: number,
    update: (axis: AxisCalibration) => AxisCalibration,
  ) => {
    setCalibrations((current) =>
      current.map((axis) => {
        if (axis.index !== index) return axis;
        const next = update(axis);
        next.normalizedValue = normalizeCalibratedAxis(next);
        return next;
      }),
    );
  };

  const assignControl = (index: number, control: SemanticControl | null) => {
    setCalibrations((current) =>
      current.map((axis) => ({
        ...axis,
        assignedControl:
          axis.index === index
            ? control
            : control && axis.assignedControl === control
              ? null
              : axis.assignedControl,
      })),
    );
  };

  const pipelineStages: Array<[string, DiagnosticStage]> = [
    ["DEVICE DETECTED", activeDiagnostics.deviceDetected],
    ["TRANSPORT OPEN", activeDiagnostics.transportOpen],
    ["DATA RECEIVED", activeDiagnostics.dataReceived],
    ["PACKET PARSED", activeDiagnostics.packetParsed],
    ["CONTROLLER INPUT ACTIVE", activeDiagnostics.inputActive],
  ];

  return (
    <main className="diagnostics-shell">
      <header className="site-header">
        <div className="brand-block">
          <span className="brand-mark">BD</span>
          <div>
            <span>BYROBOT LAB</span>
            <strong>CONTROLLER DIAGNOSTICS</strong>
          </div>
        </div>
        <div className={`overall-status ${ready ? "is-ready" : ""}`} role="status" aria-live="polite">
          <span className="status-light" />
          <div>
            <small>{activeMethod ? `ACTIVE SOURCE · ${activeMethod.toUpperCase()}` : "NO ACTIVE SOURCE"}</small>
            <strong>{overallStatus}</strong>
          </div>
        </div>
      </header>

      <section className="page-intro">
        <div>
          <p className="eyebrow">HARDWARE INPUT LAYER / BUILD 02</p>
          <h1>Controller Diagnostics</h1>
          <p>
            장치 선택, 포트 열기, RAW 수신, 패킷 검증, 실제 입력 변화를 각각 분리해
            확인합니다. 장치가 선택되었다는 사실만으로 READY를 표시하지 않습니다.
          </p>
        </div>
        <div className="notice-box">
          <span>SESSION NOTE</span>
          <p>{notice}</p>
        </div>
      </section>

      {(uiError || visibleErrors.length > 0 || !support.serial) && support.checked ? (
        <section className="error-stack" role="alert" aria-label="연결 및 프로토콜 경고">
          {uiError ? <p><strong>UI</strong>{uiError}</p> : null}
          {!support.serial ? (
            <p><strong>WEB SERIAL</strong>미지원 브라우저입니다. Windows Chrome과 HTTPS 또는 localhost가 필요합니다.</p>
          ) : null}
          {visibleErrors.map((error: ControllerError) => (
            <p key={error.code}>
              <strong>{error.code.replaceAll("_", " ").toUpperCase()}</strong>
              {error.message}{error.detail ? ` · ${error.detail}` : ""}
            </p>
          ))}
        </section>
      ) : null}

      <section className="panel pipeline-panel" aria-labelledby="pipeline-title">
        <div className="panel-heading">
          <div>
            <span>INPUT PIPELINE</span>
            <h2 id="pipeline-title">연결 단계</h2>
          </div>
          <small>READY = mapped input change confirmed</small>
        </div>
        <ol className="pipeline-list">
          {pipelineStages.map(([label, stage], index) => (
            <PipelineStage key={label} index={index + 1} label={label} stage={stage} />
          ))}
        </ol>
      </section>

      <div className="two-column-grid">
        <section className="panel" aria-labelledby="connection-title">
          <div className="panel-heading">
            <div>
              <span>A / CONNECTION</span>
              <h2 id="connection-title">연결 및 API 지원</h2>
            </div>
          </div>
          <div className="api-grid">
            <ApiCard label="Gamepad" supported={support.gamepad} detail={`${gamepads.length} device(s) detected`} />
            <ApiCard label="Serial" supported={support.serial} detail={serialSnapshot?.isOpen ? "Port open" : portSelection ? "Port selected" : "No port selected"} />
            <ApiCard label="HID" supported={support.hid} detail={`${support.hidDevices} authorized device(s)`} />
            <ApiCard label="USB" supported={support.usb} detail={`${support.usbDevices} authorized device(s)`} />
          </div>

          <fieldset className="connection-fieldset">
            <legend>WEB SERIAL · WINDOWS CHROME</legend>
            <div className="serial-actions">
              <button type="button" onClick={selectSerialPort} disabled={!support.serial || Boolean(serialSnapshot?.isOpen) || serialBusy}>
                Serial 장치 선택
              </button>
              <label>
                <span>Baud rate</span>
                <select value={baudRate} onChange={(event) => setBaudRate(Number(event.target.value))} disabled={Boolean(serialSnapshot?.isOpen) || serialBusy}>
                  {BAUD_RATES.map((rate) => <option key={rate} value={rate}>{rate}</option>)}
                </select>
              </label>
              <button type="button" onClick={connectSerial} disabled={!portSelection || Boolean(serialSnapshot?.isOpen) || serialBusy}>
                Serial 연결
              </button>
              <button type="button" className="button-danger" onClick={disconnectSerial} disabled={!serialSnapshot?.isOpen || serialBusy}>
                연결 해제
              </button>
            </div>
            <p className="serial-config">
              8 data bits · No parity · 1 stop bit · No flow control
              <span>사용자 요청 기본값 115200 / Coding·E·Battle Drone 공식 문서 권장 57600</span>
            </p>
            <button type="button" className="activation-button" onClick={activateByrobotInput} disabled={!serialSnapshot?.isOpen || serialBusy}>
              BYROBOT 입력 활성화 (Controller Ping)
            </button>
            <p className="field-help">
              공식 입력 예제와 동일한 Base→Controller Ping만 전송합니다. 비행 명령은 보내지 않습니다.
              LINK 화면이 떠도 데이터가 없으면 이 버튼을 누르세요.
            </p>
            <div className="request-actions">
              <button
                type="button"
                onClick={requestControllerInputOnce}
                disabled={!serialSnapshot?.isOpen || serialBusy || Boolean(serialSnapshot?.inputAcquisition.polling)}
              >
                0x71 / 0x70 Request 1회
              </button>
              <button
                type="button"
                className={serialSnapshot?.inputAcquisition.polling ? "button-danger" : ""}
                onClick={toggleInputRequestPolling}
                disabled={!serialSnapshot?.isOpen || serialBusy}
                aria-pressed={serialSnapshot?.inputAcquisition.polling ?? false}
              >
                {serialSnapshot?.inputAcquisition.polling ? "Request 폴링 중지" : "Request 폴링 시작"}
              </button>
            </div>
            <p className={`field-help request-help ${serialSnapshot?.inputAcquisition.requestRecommended ? "is-recommended" : ""}`}>
              {serialSnapshot?.inputAcquisition.requestRecommended
                ? "Ping 후 2초 이상 0x71이 없습니다. Request fallback을 시도할 수 있습니다."
                : "공식 Request(0x04) 구조를 사용합니다. 250ms는 앱 진단 간격이며 공식 권장 주기가 아닙니다."}
            </p>
          </fieldset>

          <fieldset className="connection-fieldset gamepad-selector">
            <legend>GAMEPAD API</legend>
            <label>
              <span>감지된 Gamepad</span>
              <select
                value={selectedGamepadIndex ?? ""}
                onChange={(event) => {
                  const next = event.target.value === "" ? null : Number(event.target.value);
                  setSelectedGamepadIndex(next);
                  if (next !== null && !serialSnapshot?.isOpen) {
                    const adapter = gamepadAdaptersRef.current.get(next);
                    if (adapter) manager.setActive(adapter.id);
                  }
                  if (!portSelection) {
                    calibrationStartedRef.current = false;
                    recordRangeRef.current = false;
                    calibrationOwnerKeyRef.current = null;
                    setCalibrationStarted(false);
                    setRecordRange(false);
                    setCalibrationOwnerKey(null);
                    setCalibrations([]);
                  }
                }}
                disabled={gamepads.length === 0}
              >
                {gamepads.length === 0 ? <option value="">연결된 Gamepad 없음</option> : null}
                {gamepads.map((gamepad) => <option key={gamepad.index} value={gamepad.index}>#{gamepad.index} · {gamepad.id}</option>)}
              </select>
            </label>
            <p className="field-help">브라우저 정책상 장치를 연결한 뒤 버튼을 한 번 눌러야 감지될 수 있습니다.</p>
          </fieldset>
        </section>

        <section className="panel" aria-labelledby="device-title">
          <div className="panel-heading">
            <div>
              <span>B / DEVICE INFORMATION</span>
              <h2 id="device-title">장치 및 자동 탐지</h2>
            </div>
            <span className="candidate-tag">{latestPacket ? "PROTOCOL VALID" : serialSnapshot?.startCodeSeen ? "CANDIDATE" : "UNCONFIRMED"}</span>
          </div>
          <dl className="definition-list">
            <DefinitionRow label="Connection method" value={activeMethod ? activeMethod.toUpperCase() : "Unknown"} />
            <DefinitionRow label="Vendor ID" value={activeMethod === "serial" ? formatHex(portSelection?.usbVendorId, 4) : "Browser descriptor only"} />
            <DefinitionRow label="Product ID" value={activeMethod === "serial" ? formatHex(portSelection?.usbProductId, 4) : "Browser descriptor only"} />
            <DefinitionRow label="Product name" value={activeMethod === "gamepad" ? selectedGamepad?.id || "Unknown" : "Unknown · Web Serial does not expose it"} />
            <DefinitionRow label="Device ID / name" value={activeMethod === "gamepad" ? selectedGamepad?.id || "Unknown" : portSelection ? "User-selected Serial port" : "Unknown"} />
            <DefinitionRow label="Detected controller" value={detectedController} />
            <DefinitionRow label="Selected adapter" value={selectedAdapter} />
            <DefinitionRow label="Protocol" value={protocol} />
            <DefinitionRow label="Baud rate" value={activeMethod === "serial" ? `${baudRate}` : "N/A"} />
            <DefinitionRow label="Activation Ping" value={serialSnapshot ? `${serialSnapshot.activationPingCount} sent · last ${formatTime(serialSnapshot.activationPingLastAt)}` : "Not sent"} />
            <DefinitionRow
              label="Input acquisition"
              value={
                serialSnapshot
                  ? `${serialSnapshot.inputAcquisition.mode.toUpperCase()} · ${serialSnapshot.inputAcquisition.requestCount} request(s)`
                  : "Passive after Ping"
              }
            />
            <DefinitionRow
              label="Last Request"
              value={
                serialSnapshot?.inputAcquisition.lastRequestedDataType !== null &&
                serialSnapshot?.inputAcquisition.lastRequestedDataType !== undefined
                  ? `${formatHex(serialSnapshot.inputAcquisition.lastRequestedDataType)} · ${formatTime(serialSnapshot.inputAcquisition.lastRequestAt)}`
                  : "Not sent"
              }
            />
            <DefinitionRow
              label="Input packets since first Request"
              value={`${serialSnapshot?.inputAcquisition.inputPacketsAfterFirstRequest ?? 0} packet(s)`}
            />
          </dl>
          <div className="detection-note">
            <strong>탐지 원칙</strong>
            <p>
              VID/PID와 외형만으로 모델을 확정하지 않습니다. <code>0A 55</code>는 Candidate,
              완전한 길이와 CRC를 통과한 뒤에만 BYROBOT packet으로 표시합니다.
            </p>
          </div>
        </section>
      </div>

      <section className="panel raw-panel" aria-labelledby="raw-title">
        <div className="panel-heading raw-heading">
          <div>
            <span>C / RAW DATA</span>
            <h2 id="raw-title">RAW SERIAL MONITOR</h2>
          </div>
          <div className="toolbar" aria-label="RAW 로그 도구">
            <button type="button" onClick={clearRawLog} disabled={!serialSnapshot}>로그 지우기</button>
            <button type="button" onClick={toggleRawLog} disabled={!serialSnapshot} aria-pressed={serialSnapshot?.logPaused ?? false}>
              {serialSnapshot?.logPaused ? "계속" : "일시정지"}
            </button>
            <button type="button" onClick={copyRawLog} disabled={!serialSnapshot?.rawEntries.length}>복사</button>
          </div>
        </div>
        <div className="metrics-grid">
          <Metric label="TOTAL BYTES" value={(serialSnapshot?.totalBytes ?? 0).toLocaleString()} />
          <Metric label="BYTES / SEC" value={`${serialSnapshot?.bytesPerSecond ?? 0}`} />
          <Metric label="LAST RECEIVED" value={formatTime(serialSnapshot?.lastReceivedAt)} />
          <Metric label="RECEIVE UNITS" value={`${serialSnapshot?.receiveUnitCount ?? 0}`} />
          <Metric label="VALID PACKETS" value={`${serialSnapshot?.packetCount ?? 0}`} />
          <Metric
            label="DATA CHANGING"
            value={
              serialSnapshot?.change.status === "yes"
                ? "YES"
                : serialSnapshot?.change.status === "no"
                  ? "NO"
                  : "INSUFFICIENT"
            }
            hint={serialSnapshot ? `${serialSnapshot.change.basis.toUpperCase()} basis · heuristic only` : "No samples"}
          />
        </div>
        <p className="raw-disclaimer">
          Data changing은 화면 비교용 휴리스틱입니다. YES여도 제품별 ControllerState 매핑이 검증되기 전에는 INPUT ACTIVE나 READY로 판정하지 않습니다.
        </p>
        <div className="raw-log" tabIndex={0} aria-label="최근 RAW Serial 수신 로그">
          {serialSnapshot?.logPaused ? <div className="paused-banner">DISPLAY PAUSED · 수신/통계/파서는 계속 동작합니다.</div> : null}
          {serialSnapshot?.rawEntries.length ? (
            [...serialSnapshot.rawEntries].reverse().map((entry) => <RawLogRow key={entry.id} entry={entry} />)
          ) : (
            <div className="empty-state">
              <strong>No raw serial bytes received yet</strong>
              <p>포트를 열고 BYROBOT 입력 활성화 Ping을 보낸 뒤 스틱과 버튼을 움직이세요.</p>
            </div>
          )}
        </div>
      </section>

      <section className="panel data-type-panel" aria-labelledby="data-type-title">
        <div className="panel-heading">
          <div>
            <span>D / VALID PACKET ROUTING</span>
            <h2 id="data-type-title">DATA TYPE MONITOR</h2>
          </div>
          <small>ROLLING WINDOW · LAST 5 SECONDS</small>
        </div>
        <div className="data-type-table-wrap" tabIndex={0}>
          <table className="data-type-table">
            <caption className="visually-hidden">
              CRC-valid BYROBOT packet counts grouped by DataType over the latest five seconds
            </caption>
            <thead>
              <tr>
                <th scope="col">DataType</th>
                <th scope="col">Official name</th>
                <th scope="col">Packets / 5s</th>
                <th scope="col">Total</th>
                <th scope="col">Last received</th>
                <th scope="col">Latest payload</th>
                <th scope="col">Payload changing / 5s</th>
              </tr>
            </thead>
            <tbody>
              {dataTypeRows.map((entry) => (
                <tr
                  key={entry.dataType}
                  className={entry.dataType === 0x71 || entry.dataType === 0x70 ? "is-controller-input" : ""}
                >
                  <th scope="row">{formatHex(entry.dataType)}</th>
                  <td>
                    {entry.label ? <strong>{entry.label}</strong> : <span>—</span>}
                  </td>
                  <td><b>{entry.packetCount5s}</b> packets</td>
                  <td>{entry.totalCount}</td>
                  <td>{formatTime(entry.latestAt)}</td>
                  <td>
                    <code>{entry.latestPayload.length ? bytesToHex(entry.latestPayload) : "—"}</code>
                    {entry.changedByteIndices.length ? (
                      <small>changed byte: {entry.changedByteIndices.join(", ")}</small>
                    ) : null}
                  </td>
                  <td>
                    <span className={`change-badge change--${entry.payloadChange5s}`}>
                      {formatPayloadChange(entry.payloadChange5s)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="raw-disclaimer">
          기존 parser가 length와 CRC를 통과시킨 packet만 집계합니다. 서로 다른 DataType끼리는 payload를 비교하지 않습니다.
        </p>
      </section>

      <section className="panel controller-input-panel" aria-labelledby="controller-input-title">
        <div className="panel-heading">
          <div>
            <span>E / OFFICIAL CONTROLLER PAYLOAD</span>
            <h2 id="controller-input-title">BYROBOT CONTROLLER INPUT</h2>
          </div>
          <span className={`candidate-tag ${inputActive ? "is-active" : ""}`}>
            {inputActive ? "INPUT ACTIVE" : "EVIDENCE PENDING"}
          </span>
        </div>

        <div className="input-evidence-grid">
          <span className={controllerInput?.evidence.joystickSeen ? "is-pass" : ""}>
            0x71 SEEN <b>{controllerInput?.evidence.joystickSeen ? "PASS" : "WAITING"}</b>
          </span>
          <span className={controllerInput?.evidence.joystickChangedEver ? "is-pass" : ""}>
            STICK CHANGE <b>{controllerInput?.evidence.joystickChangedEver ? "PASS" : "WAITING"}</b>
          </span>
          <span className={controllerInput?.evidence.buttonSeen ? "is-pass" : ""}>
            0x70 SEEN <b>{controllerInput?.evidence.buttonSeen ? "PASS" : "WAITING"}</b>
          </span>
          <span className={controllerInput?.evidence.buttonChangedEver ? "is-pass" : ""}>
            BUTTON CHANGE <b>{controllerInput?.evidence.buttonChangedEver ? "PASS" : "WAITING"}</b>
          </span>
        </div>

        <div className="controller-input-grid">
          <article className="input-card joystick-card">
            <header>
              <div>
                <span>DATATYPE 0x71</span>
                <h3>JOYSTICK</h3>
              </div>
              <b>{controllerInput?.joystickPacketCount ?? 0} packet(s)</b>
            </header>
            {controllerInput?.latestJoystick ? (
              <>
                <div className="input-payload-row">
                  <span>RAW PAYLOAD</span>
                  <code>{bytesToHex(controllerInput.latestJoystick.rawPayload)}</code>
                  <b className={controllerInput.latestJoystickChanged ? "is-changed" : ""}>
                    LAST SAMPLE {controllerInput.latestJoystickChanged ? "CHANGED" : "SAME"}
                  </b>
                </div>
                {!controllerInput.latestJoystick.axesWithinDocumentedRange ? (
                  <p className="input-layout-warning">
                    축 값이 공식 범위 −100…+100 밖입니다. Common ControllerState에는 반영하지 않았습니다.
                  </p>
                ) : null}
                <div className="stick-grid">
                  <StickField label="Left X" value={controllerInput.latestJoystick.left.x} />
                  <StickField label="Left Y" value={controllerInput.latestJoystick.left.y} />
                  <StickField label="Right X" value={controllerInput.latestJoystick.right.x} />
                  <StickField label="Right Y" value={controllerInput.latestJoystick.right.y} />
                </div>
                <dl className="joystick-events">
                  <DefinitionRow
                    label="Left direction / event"
                    value={`${controllerInput.latestJoystick.left.directionName} (${formatHex(controllerInput.latestJoystick.left.direction)}) · ${controllerInput.latestJoystick.left.eventName} (${controllerInput.latestJoystick.left.event})`}
                  />
                  <DefinitionRow
                    label="Right direction / event"
                    value={`${controllerInput.latestJoystick.right.directionName} (${formatHex(controllerInput.latestJoystick.right.direction)}) · ${controllerInput.latestJoystick.right.eventName} (${controllerInput.latestJoystick.right.event})`}
                  />
                  <DefinitionRow label="Last decoded" value={formatTime(controllerInput.latestJoystick.receivedAt)} />
                </dl>
              </>
            ) : (
              <div className="empty-state compact">
                <strong>0x71 Joystick packet not decoded yet</strong>
                <p>{controllerInput?.joystickUnsupportedReason ?? "Controller Ping 후 스틱을 움직이세요. 0x71이 없으면 Request fallback을 사용하세요."}</p>
              </div>
            )}
            {controllerInput?.joystickUnsupportedReason ? (
              <p className="input-layout-warning">{controllerInput.joystickUnsupportedReason}</p>
            ) : null}
          </article>

          <article className="input-card button-card">
            <header>
              <div>
                <span>DATATYPE 0x70</span>
                <h3>BUTTON</h3>
              </div>
              <b>{controllerInput?.buttonPacketCount ?? 0} packet(s)</b>
            </header>
            {controllerInput?.latestButton ? (
              <>
                <dl className="button-payload">
                  <DefinitionRow label="Raw payload" value={<code>{bytesToHex(controllerInput.latestButton.rawPayload)}</code>} />
                  <DefinitionRow label="Button value" value={`${formatHex(controllerInput.latestButton.button, 4)} · ${controllerInput.latestButton.button}`} />
                  <DefinitionRow label="Binary" value={<code>{formatButtonBits(controllerInput.latestButton.button)}</code>} />
                  <DefinitionRow label="Active bits" value={activeBitLabels(controllerInput.latestButton.button)} />
                  <DefinitionRow label="Event" value={`${controllerInput.latestButton.eventName} (${controllerInput.latestButton.event})`} />
                  <DefinitionRow
                    label="Changed mask"
                    value={`${formatHex(controllerInput.latestButtonChangedMask, 4)} · ${activeBitLabels(controllerInput.latestButtonChangedMask)}`}
                  />
                  <DefinitionRow label="Last decoded" value={formatTime(controllerInput.latestButton.receivedAt)} />
                </dl>
                <p className={controllerInput.latestButtonChanged ? "button-change is-changed" : "button-change"}>
                  LAST SAMPLE {controllerInput.latestButtonChanged ? "CHANGED" : "SAME"}
                </p>
              </>
            ) : (
              <div className="empty-state compact">
                <strong>0x70 Button packet not decoded yet</strong>
                <p>{controllerInput?.buttonUnsupportedReason ?? "버튼을 하나씩 눌러 button bitmask와 event 변화를 확인하세요."}</p>
              </div>
            )}
            {controllerInput?.buttonUnsupportedReason ? (
              <p className="input-layout-warning">{controllerInput.buttonUnsupportedReason}</p>
            ) : null}
          </article>
        </div>
        <p className="raw-disclaimer">
          Codec: {controllerInput?.codecLabel ?? "Official Coding/E-Drone 8-byte profile candidate"}. 정확히 8-byte Joystick / 3-byte Button일 때만 해석하며 제품 모델은 이 구조만으로 확정하지 않습니다.
        </p>
      </section>

      <div className="two-column-grid parsed-state-grid">
        <section className="panel" aria-labelledby="packet-title">
          <div className="panel-heading">
            <div>
              <span>F / PARSED PACKET</span>
              <h2 id="packet-title">최근 CRC-valid 패킷</h2>
            </div>
          </div>
          {latestPacket ? (
            <dl className="definition-list packet-fields">
              <DefinitionRow label="Start code" value="0A 55" />
              <DefinitionRow label="DataType" value={formatHex(latestPacket.dataType)} />
              <DefinitionRow label="Length" value={`${latestPacket.length} bytes`} />
              <DefinitionRow label="From" value={formatHex(latestPacket.from)} />
              <DefinitionRow label="To" value={formatHex(latestPacket.to)} />
              <DefinitionRow label="Payload" value={<code>{bytesToHex(latestPacket.payload) || "(empty)"}</code>} />
              <DefinitionRow label="Received CRC" value={formatHex(latestPacket.receivedCrc, 4)} />
              <DefinitionRow label="Calculated CRC" value={formatHex(latestPacket.calculatedCrc, 4)} />
              <DefinitionRow label="CRC valid" value={<span className="valid-value">YES</span>} />
            </dl>
          ) : (
            <div className="empty-state compact">
              <strong>No complete BYROBOT packet parsed yet</strong>
              <p>{serialSnapshot?.startCodeSeen ? "0A 55 시작 코드는 발견했습니다. 완전한 length와 CRC를 기다립니다." : "시작 코드 0A 55가 아직 발견되지 않았습니다."}</p>
            </div>
          )}
          <div className="parser-stats">
            <span>VALID <b>{serialSnapshot?.packetCount ?? 0}</b></span>
            <span>CRC ERRORS <b>{serialSnapshot?.crcErrorCount ?? 0}</b></span>
            <span>BUFFERED <b>{serialSnapshot?.bufferedBytes ?? 0} B</b></span>
            <span>DISCARDED <b>{serialSnapshot?.discardedBytes ?? 0} B</b></span>
          </div>
          {serialSnapshot?.latestParserIssue ? (
            <p className="parser-issue">Last parser issue: {serialSnapshot.latestParserIssue.message}</p>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="state-title">
          <div className="panel-heading">
            <div>
              <span>G / CONTROLLER STATE</span>
              <h2 id="state-title">Common ControllerState</h2>
            </div>
            <span className={`mapping-tag ${mappingComplete ? "is-mapped" : ""}`}>
              {mappingComplete ? "USER MAPPED" : "UNMAPPED"}
            </span>
          </div>
          {!mappingComplete ? (
            <div className="mapping-warning">
              <strong>Controller input mapping not identified yet</strong>
              <p>실제 채널 순서를 확인하기 전에는 throttle / yaw / pitch / roll을 0으로 꾸며내지 않습니다.</p>
            </div>
          ) : null}
          <div className="semantic-grid">
            <SemanticGauge label="Throttle" value={mappedValues.throttle} />
            <SemanticGauge label="Yaw" value={mappedValues.yaw} />
            <SemanticGauge label="Pitch" value={mappedValues.pitch} />
            <SemanticGauge label="Roll" value={mappedValues.roll} />
          </div>
        </section>
      </div>

      <section className="panel gamepad-panel" aria-labelledby="gamepad-live-title">
        <div className="panel-heading">
          <div>
            <span>GAMEPAD API · PRESERVED INPUT PATH</span>
            <h2 id="gamepad-live-title">Gamepad 실시간 축·버튼·RAW 정보</h2>
          </div>
          <span className="candidate-tag">{selectedGamepad ? "LIVE" : "STANDBY"}</span>
        </div>
        {selectedGamepad ? (
          <>
            <div className="gamepad-raw-info">
              <span>ID <b>{selectedGamepad.id}</b></span>
              <span>INDEX <b>{selectedGamepad.index}</b></span>
              <span>MAPPING <b>{selectedGamepad.mapping || "none"}</b></span>
              <span>TIMESTAMP <b>{selectedGamepad.timestamp.toFixed(1)}</b></span>
            </div>
            <div className="gamepad-live-grid">
              <div className="gamepad-axes">
                {selectedGamepad.axes.map((value, index) => <GamepadAxis key={index} index={index} value={value} />)}
              </div>
              <div className="gamepad-buttons">
                {selectedGamepad.buttons.map((button, index) => (
                  <output key={index} className={button.pressed ? "is-pressed" : ""} aria-live="off">
                    <span>BUTTON {index + 1}</span>
                    <strong>{button.pressed ? "ON" : "OFF"}</strong>
                    <small>{button.value.toFixed(2)}</small>
                  </output>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state compact"><strong>No Gamepad detected</strong><p>USB 조종기를 연결하고 버튼을 한 번 누르세요.</p></div>
        )}
      </section>

      <section className="panel calibration-panel" aria-labelledby="calibration-title">
        <div className="panel-heading calibration-heading">
          <div>
            <span>STICK MAPPING CALIBRATION</span>
            <h2 id="calibration-title">축 캘리브레이션</h2>
          </div>
          <div className="toolbar calibration-actions">
            <button type="button" onClick={startCalibration} disabled={activeRawAxes.length === 0}>캘리브레이션 시작</button>
            <button type="button" onClick={() => setCalibrations((current) => saveAxisCenters(current))} disabled={!calibrationStarted || activeRawAxes.length === 0}>중앙 저장</button>
            <button type="button" onClick={() => setRecordRange((current) => {
              const next = !current;
              recordRangeRef.current = next;
              return next;
            })} disabled={!calibrationStarted || activeRawAxes.length === 0} aria-pressed={recordRange}>
              {recordRange ? "범위 기록 중" : "범위 기록"}
            </button>
            <button type="button" onClick={resetCalibration} disabled={activeRawAxes.length === 0}>초기화</button>
          </div>
        </div>
        {activeRawAxes.length === 0 ? (
          <div className="empty-state compact">
            <strong>Raw axis data is not available</strong>
            <p>Gamepad 축 또는 검증된 제품별 Serial adapter가 rawAxes를 제공하면 활성화됩니다.</p>
          </div>
        ) : (
          <div className="calibration-table-wrap" tabIndex={0}>
            <table className="calibration-table">
              <thead>
                <tr>
                  <th>Axis</th><th>Raw current</th><th>Observed min</th><th>Observed max</th><th>Center</th><th>Normalized</th><th>Inversion</th><th>Dead zone</th><th>Assigned control</th>
                </tr>
              </thead>
              <tbody>
                {activeCalibrations.map((axis) => (
                  <tr key={axis.index}>
                    <th>
                      {activeMethod === "serial"
                        ? (["Left X", "Left Y", "Right X", "Right Y"][axis.index] ?? `AXIS ${axis.index}`)
                        : `AXIS ${axis.index}`}
                      {activeMethod === "serial" ? <small>AXIS {axis.index}</small> : null}
                    </th>
                    <td>{formatNumber(axis.rawCurrent)}</td>
                    <td>{formatNumber(axis.observedMinimum)}</td>
                    <td>{formatNumber(axis.observedMaximum)}</td>
                    <td>{formatNumber(axis.center)}</td>
                    <td className="normalized-cell">{formatNormalized(axis.normalizedValue)}</td>
                    <td>
                      <label className="compact-check"><input type="checkbox" checked={axis.inverted} onChange={(event) => updateCalibration(axis.index, (current) => ({ ...current, inverted: event.target.checked }))} /><span>Invert</span></label>
                    </td>
                    <td>
                      <label className="deadzone-control"><input aria-label={`Axis ${axis.index} dead zone`} type="range" min="0" max="0.3" step="0.01" value={axis.deadZone} onChange={(event) => updateCalibration(axis.index, (current) => ({ ...current, deadZone: Number(event.target.value) }))} /><span>{axis.deadZone.toFixed(2)}</span></label>
                    </td>
                    <td>
                      <select aria-label={`Axis ${axis.index} assigned control`} value={axis.assignedControl ?? ""} onChange={(event) => assignControl(axis.index, (event.target.value || null) as SemanticControl | null)}>
                        <option value="">Unassigned</option>
                        {CONTROLS.map((control) => <option key={control.value} value={control.value}>{control.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="calibration-help">
          기본 채널 배정은 없습니다. 실제 조종기의 순서를 확인한 뒤 사용자가 축을 배정해야 하며, min &lt; center &lt; max가 기록되기 전에는 normalized 값을 만들지 않습니다.
        </p>
      </section>

      <section className="capture-guide" aria-labelledby="capture-title">
        <div>
          <span>HARDWARE VALIDATION HANDOFF</span>
          <h2 id="capture-title">스마트 조종기 테스트 캡처</h2>
        </div>
        <ol>
          <li>LINK 화면과 이 페이지의 DEVICE / SERIAL OPEN 상태가 한 장에 보이게 캡처</li>
          <li>DATA TYPE MONITOR에서 0x71 count와 payload가 보이는 중앙 상태 캡처</li>
          <li>왼쪽 X/Y, 오른쪽 X/Y를 각각 움직여 네 실시간 값과 0x71 Payload changing YES를 캡처</li>
          <li>각 버튼을 하나씩 누르며 0x70 button value, event, changed mask를 캡처</li>
          <li>INPUT ACTIVE 네 evidence가 모두 PASS인 화면과 calibration/mapping 결과 캡처</li>
          <li>Vendor ID, Product ID, baud rate와 사용한 조종기 정확한 제품명/뒷면 라벨 기록</li>
        </ol>
      </section>

      <footer className="site-footer">
        <span>BYROBOT MULTI-CONTROLLER INPUT LAYER</span>
        <span>NO 3D SIMULATOR IN THIS BUILD</span>
      </footer>
    </main>
  );
}

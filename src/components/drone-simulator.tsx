"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ControllerButtonTransition,
  ControllerState,
} from "../controllers/types";
import {
  beginButtonCapture,
  createEmptyButtonMappings,
  resolveMappedButtonActions,
  updateButtonCapture,
  type ButtonCaptureState,
  type ControllerButtonMappings,
  type MappableButtonAction,
} from "../simulator/button-mapping";
import {
  applyFlightCommand,
  createInitialFlightState,
  neutralizeFlightMotion,
  stepFlightState,
  type FlightCommand,
  type FlightControlInput,
  type FlightMode,
  type FlightState,
} from "../simulator/flight-model";

interface DroneSimulatorProps {
  controllerState: ControllerState;
  controlsEnabled: boolean;
  sourceSessionKey: string | null;
  mappingSourceId: string | null;
  inputUpdatedAt: number | null;
}

interface StoredButtonMappings {
  version: 1;
  mappings: ControllerButtonMappings;
}

const BUTTON_MAPPING_STORAGE_KEY = "byrobot-drone-button-mappings-v1";
const INPUT_STALE_AFTER_MS = 500;
const ZERO_INPUT: FlightControlInput = {
  throttle: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  active: false,
};

const MODE_LABEL: Record<FlightMode, string> = {
  landed: "착륙 상태",
  taking_off: "이륙 중",
  flying: "비행 중",
  landing: "착륙 중",
  emergency: "긴급 정지",
};

const ACTION_LABEL: Record<MappableButtonAction, string> = {
  takeoff: "이륙",
  land: "착륙",
  emergency: "긴급 정지",
};

function cloneFlightState(state: FlightState): FlightState {
  return {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
    tilt: { ...state.tilt },
    smoothedInput: { ...state.smoothedInput },
  };
}

function validStoredMappings(value: unknown): value is StoredButtonMappings {
  if (!value || typeof value !== "object" || !("version" in value) || !("mappings" in value)) {
    return false;
  }
  const candidate = value as StoredButtonMappings;
  if (candidate.version !== 1 || !candidate.mappings) return false;
  return ["takeoff", "land", "emergency"].every((action) => {
    const binding = candidate.mappings[action as MappableButtonAction];
    return (
      binding === null ||
      (typeof binding?.sourceId === "string" && typeof binding.buttonId === "string")
    );
  });
}

function displayButtonId(buttonId: string | undefined): string {
  if (!buttonId) return "미설정";
  const bitMatch = /^button_bit_(\d+)$/.exec(buttonId);
  if (bitMatch) return `${Number(bitMatch[1]) + 1}번`;
  const gamepadMatch = /^button_(\d+)$/.exec(buttonId);
  if (gamepadMatch) return `${Number(gamepadMatch[1])}번`;
  return buttonId;
}

function projectPoint(
  x: number,
  y: number,
  z: number,
  originX: number,
  originY: number,
  scale: number,
): [number, number] {
  return [
    originX + (x - z) * scale,
    originY + (x + z) * scale * 0.48 - y * scale * 1.35,
  ];
}

function drawDroneScene(
  canvas: HTMLCanvasElement,
  state: FlightState,
  time: number,
  reduceMotion: boolean,
): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  context.clearRect(0, 0, w, h);

  const sky = context.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#eaf5ff");
  sky.addColorStop(0.58, "#f8fbff");
  sky.addColorStop(1, "#e3edf4");
  context.fillStyle = sky;
  context.fillRect(0, 0, w, h);

  const scale = Math.max(22, Math.min(42, w / 20));
  // The single training drone remains in view while the grid moves below it.
  const cameraX = state.position.x;
  const cameraZ = state.position.z;
  const originX = w * 0.5;
  const originY = h * 0.68;
  context.lineWidth = 1;
  for (let index = -8; index <= 8; index += 1) {
    const major = index % 4 === 0;
    context.strokeStyle = major ? "rgba(70, 122, 162, 0.23)" : "rgba(70, 122, 162, 0.11)";
    context.beginPath();
    let point = projectPoint(index - cameraX, 0, -8 - cameraZ, originX, originY, scale);
    context.moveTo(point[0], point[1]);
    point = projectPoint(index - cameraX, 0, 8 - cameraZ, originX, originY, scale);
    context.lineTo(point[0], point[1]);
    context.stroke();

    context.beginPath();
    point = projectPoint(-8 - cameraX, 0, index - cameraZ, originX, originY, scale);
    context.moveTo(point[0], point[1]);
    point = projectPoint(8 - cameraX, 0, index - cameraZ, originX, originY, scale);
    context.lineTo(point[0], point[1]);
    context.stroke();
  }

  const ground = projectPoint(
    state.position.x - cameraX,
    0,
    state.position.z - cameraZ,
    originX,
    originY,
    scale,
  );
  const center = projectPoint(
    state.position.x - cameraX,
    state.position.y + 0.32,
    state.position.z - cameraZ,
    originX,
    originY,
    scale,
  );

  const shadowScale = Math.max(0.28, 1 - state.position.y * 0.08);
  context.save();
  context.translate(ground[0], ground[1] + 6);
  context.scale(1, 0.42);
  context.beginPath();
  context.arc(0, 0, 34 * shadowScale, 0, Math.PI * 2);
  context.fillStyle = `rgba(39, 57, 70, ${Math.max(0.08, 0.2 - state.position.y * 0.018)})`;
  context.fill();
  context.restore();

  const localRotors: Array<[number, number]> = [
    [-0.58, -0.58],
    [0.58, -0.58],
    [0.58, 0.58],
    [-0.58, 0.58],
  ];
  const cos = Math.cos(state.yaw);
  const sin = Math.sin(state.yaw);
  const rotorPoints = localRotors.map(([localX, localZ]) => {
    const worldX = state.position.x + localX * cos + localZ * sin;
    const worldZ = state.position.z - localX * sin + localZ * cos;
    const tiltHeight = localZ * state.tilt.pitch - localX * state.tilt.roll;
    return projectPoint(
      worldX - cameraX,
      state.position.y + 0.32 + tiltHeight,
      worldZ - cameraZ,
      originX,
      originY,
      scale,
    );
  });

  context.lineCap = "round";
  context.lineWidth = 9;
  context.strokeStyle = "#26384d";
  for (const point of rotorPoints) {
    context.beginPath();
    context.moveTo(center[0], center[1]);
    context.lineTo(point[0], point[1]);
    context.stroke();
  }

  const bladeAngle = reduceMotion ? 0 : time * 0.018;
  rotorPoints.forEach((point, index) => {
    context.save();
    context.translate(point[0], point[1]);
    context.rotate(bladeAngle * (index % 2 === 0 ? 1 : -1));
    context.strokeStyle = "rgba(28, 51, 72, 0.48)";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(-23, 0);
    context.lineTo(23, 0);
    context.moveTo(0, -7);
    context.lineTo(0, 7);
    context.stroke();
    context.fillStyle = index < 2 ? "#ff8d48" : "#3f7cff";
    context.beginPath();
    context.arc(0, 0, 7, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });

  context.save();
  context.translate(center[0], center[1]);
  context.rotate(-state.tilt.roll * 0.65);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#1e3146";
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(-26, -16, 52, 32, 12);
  context.fill();
  context.stroke();
  context.fillStyle = "#306eff";
  context.beginPath();
  context.roundRect(-13, -8, 26, 16, 6);
  context.fill();
  context.restore();

  const noseWorldX = state.position.x + Math.sin(state.yaw) * 0.78;
  const noseWorldZ = state.position.z + Math.cos(state.yaw) * 0.78;
  const nose = projectPoint(
    noseWorldX - cameraX,
    state.position.y + 0.34,
    noseWorldZ - cameraZ,
    originX,
    originY,
    scale,
  );
  context.strokeStyle = "#ff6c3b";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(center[0], center[1]);
  context.lineTo(nose[0], nose[1]);
  context.stroke();
}

function buttonsFromTransitions(
  previous: Readonly<Record<string, boolean>>,
  events: readonly ControllerButtonTransition[],
): Record<string, boolean> {
  const next = { ...previous };
  for (const event of events) {
    if (event.phase === "down") next[event.buttonId] = true;
    if (event.phase === "up") next[event.buttonId] = false;
  }
  return next;
}

export function DroneSimulator({
  controllerState,
  controlsEnabled,
  sourceSessionKey,
  mappingSourceId,
  inputUpdatedAt,
}: DroneSimulatorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flightStateRef = useRef<FlightState>(createInitialFlightState());
  const inputRef = useRef<FlightControlInput>(ZERO_INPUT);
  const inputUpdatedAtRef = useRef<number | null>(inputUpdatedAt);
  const controlsEnabledRef = useRef(controlsEnabled);
  const inputWasFreshRef = useRef(false);
  const reduceMotionRef = useRef(false);
  const previousControlsEnabledRef = useRef(false);
  const actionControlsEnabledRef = useRef(false);
  const buttonSnapshotRef = useRef<Record<string, boolean>>({});
  const lastButtonSequenceRef = useRef(0);
  const captureRef = useRef<ButtonCaptureState | null>(null);
  const mappingsRef = useRef<ControllerButtonMappings>(createEmptyButtonMappings());
  const [telemetry, setTelemetry] = useState<FlightState>(() => createInitialFlightState());
  const [mappings, setMappings] = useState<ControllerButtonMappings>(() =>
    createEmptyButtonMappings(),
  );
  const [capture, setCapture] = useState<ButtonCaptureState | null>(null);
  const [mappingMessage, setMappingMessage] = useState("기능을 선택한 뒤 조종기 버튼을 눌러 설정할 수 있습니다.");
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(BUTTON_MAPPING_STORAGE_KEY);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (validStoredMappings(parsed)) {
            setMappings(parsed.mappings);
            mappingsRef.current = parsed.mappings;
          }
        }
      } catch {
        // A blocked or malformed storage entry must not prevent flight controls.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    mappingsRef.current = mappings;
    if (!storageReady) return;
    try {
      const stored: StoredButtonMappings = { version: 1, mappings };
      window.localStorage.setItem(BUTTON_MAPPING_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Mapping remains valid for the current session when storage is blocked.
    }
  }, [mappings, storageReady]);

  useEffect(() => {
    controlsEnabledRef.current = controlsEnabled;
    inputUpdatedAtRef.current = inputUpdatedAt;
    if (controllerState.mappingStatus === "mapped" && controlsEnabled) {
      inputRef.current = {
        throttle: controllerState.throttle,
        yaw: controllerState.yaw,
        pitch: controllerState.pitch,
        roll: controllerState.roll,
        active: true,
      };
    } else {
      inputRef.current = ZERO_INPUT;
    }

    if (previousControlsEnabledRef.current && !controlsEnabled) {
      flightStateRef.current = neutralizeFlightMotion(flightStateRef.current);
      setTelemetry(cloneFlightState(flightStateRef.current));
    }
    if (!controlsEnabled) actionControlsEnabledRef.current = false;
    previousControlsEnabledRef.current = controlsEnabled;
  }, [controllerState, controlsEnabled, inputUpdatedAt]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reduceMotionRef.current = media.matches;
    };
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    lastButtonSequenceRef.current = 0;
    buttonSnapshotRef.current = {};
    captureRef.current = null;
    actionControlsEnabledRef.current = false;
    inputWasFreshRef.current = false;
    flightStateRef.current = neutralizeFlightMotion(flightStateRef.current);
    const timer = window.setTimeout(() => setCapture(null), 0);
    return () => window.clearTimeout(timer);
  }, [sourceSessionKey]);

  const dispatchFlightAction = useCallback((command: FlightCommand) => {
    flightStateRef.current = applyFlightCommand(flightStateRef.current, command);
    setTelemetry(cloneFlightState(flightStateRef.current));
  }, []);

  useEffect(() => {
    if (!sourceSessionKey || !mappingSourceId) return;
    const buttonTransitions = controllerState.buttonTransitions ?? [];
    const freshEvents = buttonTransitions.filter(
      (event) => event.sequence > lastButtonSequenceRef.current,
    );
    if (freshEvents.length === 0) {
      if (controlsEnabled && !actionControlsEnabledRef.current) {
        buttonSnapshotRef.current = { ...controllerState.buttons };
        actionControlsEnabledRef.current = true;
      }
      return;
    }

    const latestSequence = freshEvents.at(-1)?.sequence ?? lastButtonSequenceRef.current;
    if (freshEvents[0].sequence > lastButtonSequenceRef.current + 1) {
      buttonSnapshotRef.current = { ...controllerState.buttons };
      lastButtonSequenceRef.current = latestSequence;
      captureRef.current = null;
      setCapture(null);
      setMappingMessage("버튼 기록이 많이 밀려 현재 상태로 다시 맞췄습니다. 기능 설정을 다시 시도해 주세요.");
      return;
    }

    const groups: ControllerButtonTransition[][] = [];
    for (const event of freshEvents) {
      const previousGroup = groups.at(-1);
      if (
        previousGroup &&
        previousGroup[0]?.observationSequence === event.observationSequence
      ) {
        previousGroup.push(event);
      } else {
        groups.push([event]);
      }
    }

    let currentCapture = captureRef.current;
    let currentMappings = mappingsRef.current;
    const controlsJustEnabled =
      controlsEnabled && !actionControlsEnabledRef.current;
    actionControlsEnabledRef.current = controlsEnabled;
    for (const events of groups) {
      const previousButtons = buttonSnapshotRef.current;
      const currentButtons = buttonsFromTransitions(previousButtons, events);
      let consumedButtonIds: string[] = [];

      if (currentCapture) {
        const capturedAction = currentCapture.action;
        const update = updateButtonCapture(
          currentCapture,
          currentMappings,
          mappingSourceId,
          currentButtons,
        );
        currentCapture = update.capture;
        currentMappings = update.mappings;
        consumedButtonIds = update.consumedButtonIds;
        if (update.outcome === "mapped" && update.captured) {
          setMappingMessage(
            `${ACTION_LABEL[capturedAction]} 기능을 ${displayButtonId(update.captured.buttonId)}에 설정했습니다.`,
          );
        } else if (update.outcome === "ambiguous") {
          setMappingMessage("버튼을 한 번에 하나만 눌러 주세요.");
        } else if (update.outcome === "source_changed") {
          setMappingMessage("조종기가 바뀌어 버튼 설정을 취소했습니다.");
        }
      }

      if (controlsEnabled && !controlsJustEnabled && !document.hidden) {
        const actions = resolveMappedButtonActions(
          currentMappings,
          mappingSourceId,
          previousButtons,
          currentButtons,
          consumedButtonIds,
        );
        for (const action of actions) dispatchFlightAction(action);
      }
      buttonSnapshotRef.current = currentButtons;
    }

    lastButtonSequenceRef.current = latestSequence;
    captureRef.current = currentCapture;
    mappingsRef.current = currentMappings;
    setCapture(currentCapture);
    setMappings(currentMappings);
  }, [
    controllerState.buttonTransitions,
    controllerState.buttons,
    controlsEnabled,
    dispatchFlightAction,
    mappingSourceId,
    sourceSessionKey,
  ]);

  useEffect(() => {
    let frame = 0;
    let previousTime = performance.now();
    let lastTelemetryAt = 0;
    const neutralizeForSafety = () => {
      flightStateRef.current = neutralizeFlightMotion(flightStateRef.current);
      inputWasFreshRef.current = false;
      setTelemetry(cloneFlightState(flightStateRef.current));
    };
    const handleVisibilityChange = () => {
      previousTime = performance.now();
      if (document.hidden) neutralizeForSafety();
    };
    const tick = (time: number) => {
      const elapsed = Math.max(0, (time - previousTime) / 1000);
      previousTime = time;
      const lastInputAt = inputUpdatedAtRef.current;
      const inputIsFresh = Boolean(
        !document.hidden &&
          controlsEnabledRef.current &&
          lastInputAt !== null &&
          Date.now() - lastInputAt <= INPUT_STALE_AFTER_MS,
      );
      if (!inputIsFresh && inputWasFreshRef.current) {
        flightStateRef.current = neutralizeFlightMotion(flightStateRef.current);
      }
      inputWasFreshRef.current = inputIsFresh;
      flightStateRef.current = stepFlightState(
        flightStateRef.current,
        inputIsFresh ? inputRef.current : ZERO_INPUT,
        elapsed,
      );
      const canvas = canvasRef.current;
      if (canvas) {
        drawDroneScene(
          canvas,
          flightStateRef.current,
          time,
          reduceMotionRef.current,
        );
      }
      if (time - lastTelemetryAt >= 100) {
        lastTelemetryAt = time;
        setTelemetry(cloneFlightState(flightStateRef.current));
      }
      frame = window.requestAnimationFrame(tick);
    };
    const canvas = canvasRef.current;
    if (canvas) {
      drawDroneScene(
        canvas,
        flightStateRef.current,
        previousTime,
        reduceMotionRef.current,
      );
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    frame = window.requestAnimationFrame(tick);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const startCapture = (action: MappableButtonAction) => {
    if (!mappingSourceId || !controllerState.connected) {
      setMappingMessage("먼저 조종기를 연결해 주세요.");
      return;
    }
    const next = beginButtonCapture(
      action,
      mappingSourceId,
      buttonSnapshotRef.current,
    );
    captureRef.current = next;
    setCapture(next);
    setMappingMessage(`${ACTION_LABEL[action]}에 사용할 조종기 버튼을 눌러 주세요.`);
  };

  const cancelCapture = () => {
    captureRef.current = null;
    setCapture(null);
    setMappingMessage("버튼 설정을 취소했습니다.");
  };

  const removeMapping = (action: MappableButtonAction) => {
    const next = { ...mappings, [action]: null };
    mappingsRef.current = next;
    setMappings(next);
    setMappingMessage(`${ACTION_LABEL[action]} 버튼 설정을 지웠습니다.`);
  };

  return (
    <section className="pilot-card simulator-card" aria-labelledby="drone-simulator-title">
      <div className="simulator-heading">
        <div>
          <span>1차 비행 연습</span>
          <h2 id="drone-simulator-title">가상 드론 테스트</h2>
        </div>
        <strong
          className={`flight-mode mode-${telemetry.mode}`}
          role="status"
          aria-live="polite"
        >
          {MODE_LABEL[telemetry.mode]}
        </strong>
      </div>

      <div className="drone-stage">
        <div className="static-drone" aria-hidden="true">
          <i className="static-drone__arm static-drone__arm--one" />
          <i className="static-drone__arm static-drone__arm--two" />
          <i className="static-drone__rotor static-drone__rotor--one" />
          <i className="static-drone__rotor static-drone__rotor--two" />
          <i className="static-drone__rotor static-drone__rotor--three" />
          <i className="static-drone__rotor static-drone__rotor--four" />
          <b>BD</b>
        </div>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="밝은 테스트 격자 위의 가상 드론"
          aria-describedby="flight-telemetry"
        >
          밝은 테스트 격자 위에 가상 드론 한 대가 있습니다.
        </canvas>
        {!controlsEnabled ? (
          <div className="drone-stage-message">
            <strong>화면 버튼은 지금 바로 사용할 수 있습니다</strong>
            <span>실제 조종은 조종기를 연결하고 스틱·버튼 입력을 확인한 뒤 사용할 수 있습니다.</span>
          </div>
        ) : null}
        <div id="flight-telemetry" className="flight-telemetry" aria-live="off">
          <span>고도 <strong>{telemetry.position.y.toFixed(2)} m</strong></span>
          <span>방향 <strong>{Math.round((telemetry.yaw * 180) / Math.PI)}°</strong></span>
          <span>위치 <strong>{telemetry.position.x.toFixed(1)}, {telemetry.position.z.toFixed(1)}</strong></span>
        </div>
      </div>

      <div className="flight-action-bar" aria-label="드론 동작 버튼">
        <button type="button" className="is-takeoff" onClick={() => dispatchFlightAction("takeoff")}>이륙</button>
        <button type="button" onClick={() => dispatchFlightAction("land")}>착륙</button>
        <button type="button" onClick={() => dispatchFlightAction("reset")}>위치 초기화</button>
        <button type="button" className="is-emergency" onClick={() => dispatchFlightAction("emergency")}>긴급 정지</button>
      </div>

      <div className="button-mapping-panel">
        <div className="button-mapping-heading">
          <div>
            <span>조종기 버튼 설정</span>
            <h3>버튼 기능 연결</h3>
          </div>
          {capture ? <button type="button" className="mapping-cancel" onClick={cancelCapture}>설정 취소</button> : null}
        </div>
        <div className="button-mapping-list">
          {(["takeoff", "land", "emergency"] as const).map((action) => {
            const binding = mappings[action];
            const belongsToController = binding?.sourceId === mappingSourceId;
            return (
              <div key={action} className={capture?.action === action ? "mapping-row is-listening" : "mapping-row"}>
                <div>
                  <span>{ACTION_LABEL[action]} 버튼</span>
                  <strong>{belongsToController ? displayButtonId(binding?.buttonId) : "미설정"}</strong>
                </div>
                <button
                  type="button"
                  aria-label={`${ACTION_LABEL[action]} 버튼 설정`}
                  aria-pressed={capture?.action === action}
                  onClick={() => startCapture(action)}
                  disabled={!controllerState.connected}
                >
                  {capture?.action === action ? "입력 대기 중" : "설정"}
                </button>
                {belongsToController ? (
                  <button
                    type="button"
                    className="mapping-clear"
                    aria-label={`${ACTION_LABEL[action]} 버튼 설정 지우기`}
                    onClick={() => removeMapping(action)}
                  >
                    지우기
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mapping-message" role="status">{mappingMessage}</p>
      </div>
    </section>
  );
}

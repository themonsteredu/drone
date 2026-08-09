"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createControllerGestureRuntime,
  observeProfileButtonGestures,
  observeProfileInputChords,
  resetControllerGestureRuntime,
  type ControllerOperation,
  type ControllerProfile,
} from "../controllers/profiles";
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
import { createDroneTransform } from "../simulator/drone-transform";
import {
  FlightController,
  INPUT_STALE_AFTER_MS,
  getFlightActionAvailability,
} from "../simulator/flight-controller";
import {
  FLIGHT_PHASE,
  type FlightCommand,
  type FlightPhase,
  type FlightState,
} from "../simulator/flight-model";
import type { SimulatorPreferences } from "../simulator/settings";
import { DroneVisual } from "./drone-visual";
import { FlightSettingsPanel } from "./flight-settings-panel";
import type { SimulatorPreferencesUpdater } from "./use-simulator-preferences";

interface DroneSimulatorProps {
  controllerState: ControllerState;
  controlsEnabled: boolean;
  sourceSessionKey: string | null;
  mappingSourceId: string | null;
  inputUpdatedAt: number | null;
  controllerProfile: ControllerProfile;
  preferences: SimulatorPreferences;
  axisCount: number;
  onUpdatePreferences: (update: SimulatorPreferencesUpdater) => void;
  onResetPreferences: () => void;
}

interface StoredButtonMappingsV2 {
  version: 2;
  mappings: ControllerButtonMappings;
}

const BUTTON_MAPPING_STORAGE_KEY = "byrobot-drone-button-mappings-v2";
const LEGACY_BUTTON_MAPPING_STORAGE_KEY = "byrobot-drone-button-mappings-v1";

const PHASE_LABEL: Readonly<Record<FlightPhase, string>> = {
  [FLIGHT_PHASE.READY]: "대기",
  [FLIGHT_PHASE.START]: "시동 완료",
  [FLIGHT_PHASE.TAKEOFF]: "이륙 중",
  [FLIGHT_PHASE.FLIGHT]: "비행 가능",
  [FLIGHT_PHASE.LANDING]: "착륙 중",
  [FLIGHT_PHASE.STOP]: "착륙 완료",
  [FLIGHT_PHASE.EMERGENCY]: "긴급 안전 착륙 중",
};

const ACTION_LABEL: Readonly<Record<MappableButtonAction, string>> = {
  start: "시동",
  takeoff: "이륙",
  land: "착륙",
  emergency: "긴급 기능",
};

const ACTION_COMMAND: Readonly<Record<MappableButtonAction, FlightCommand>> = {
  start: "start",
  takeoff: "takeoff",
  land: "land",
  emergency: "emergency",
};

const PROFILE_OPERATION_COMMAND = {
  start: "start",
  takeoff: "takeoff",
  landing: "land",
  emergency: "emergency",
} as const satisfies Readonly<Record<ControllerOperation, FlightCommand>>;

function validBinding(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "object" &&
      value !== null &&
      "sourceId" in value &&
      "buttonId" in value &&
      typeof value.sourceId === "string" &&
      typeof value.buttonId === "string")
  );
}

function parseStoredMappings(value: unknown): ControllerButtonMappings | null {
  if (!value || typeof value !== "object" || !("mappings" in value)) {
    return null;
  }
  const candidate = value as {
    version?: unknown;
    mappings?: Partial<ControllerButtonMappings>;
  };
  if (candidate.version !== 1 && candidate.version !== 2) return null;
  const mappings = candidate.mappings;
  if (
    !mappings ||
    !validBinding(mappings.takeoff) ||
    !validBinding(mappings.land) ||
    !validBinding(mappings.emergency) ||
    (candidate.version === 2 && !validBinding(mappings.start))
  ) {
    return null;
  }
  return {
    start: candidate.version === 2 ? (mappings.start ?? null) : null,
    takeoff: mappings.takeoff ?? null,
    land: mappings.land ?? null,
    emergency: mappings.emergency ?? null,
  };
}

function displayButtonId(buttonId: string | undefined): string {
  if (!buttonId) return "미설정";
  const bitMatch = /^button_bit_(\d+)$/.exec(buttonId);
  if (bitMatch) return `${Number(bitMatch[1]) + 1}번 비트`;
  const gamepadMatch = /^button_(\d+)$/.exec(buttonId);
  if (gamepadMatch) return `${Number(gamepadMatch[1])}번`;
  return buttonId;
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

function cloneFlightState(state: FlightState): FlightState {
  return {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
    tilt: { ...state.tilt },
    smoothedInput: { ...state.smoothedInput },
  };
}

export function DroneSimulator({
  controllerState,
  controlsEnabled,
  sourceSessionKey,
  mappingSourceId,
  inputUpdatedAt,
  controllerProfile,
  preferences,
  axisCount,
  onUpdatePreferences,
  onResetPreferences,
}: DroneSimulatorProps) {
  const [flightController] = useState(() => new FlightController(preferences));
  const buttonSnapshotRef = useRef<Record<string, boolean>>({});
  const controllerStateRef = useRef(controllerState);
  const lastButtonSequenceRef = useRef(0);
  const captureRef = useRef<ButtonCaptureState | null>(null);
  const mappingsRef = useRef<ControllerButtonMappings>(
    createEmptyButtonMappings(),
  );
  const profileGestureRuntimeRef = useRef(createControllerGestureRuntime());
  const [telemetry, setTelemetry] = useState<FlightState>(() =>
    flightController.getState(),
  );
  const [mappings, setMappings] = useState<ControllerButtonMappings>(
    createEmptyButtonMappings,
  );
  const [capture, setCapture] = useState<ButtonCaptureState | null>(null);
  const [mappingMessage, setMappingMessage] = useState(
    "기능을 선택한 뒤 조종기 버튼을 눌러 설정할 수 있습니다.",
  );
  const [storageReady, setStorageReady] = useState(false);

  const profileHasDefaultButtons = useMemo(
    () =>
      Object.values(controllerProfile.defaultOperationGestures).some(Boolean),
    [controllerProfile],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const current = window.localStorage.getItem(BUTTON_MAPPING_STORAGE_KEY);
        const legacy = window.localStorage.getItem(
          LEGACY_BUTTON_MAPPING_STORAGE_KEY,
        );
        const parsed = parseStoredMappings(
          JSON.parse(current ?? legacy ?? "null"),
        );
        if (parsed) {
          setMappings(parsed);
          mappingsRef.current = parsed;
        }
      } catch {
        // Optional persistence must never block controller input.
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
      const stored: StoredButtonMappingsV2 = { version: 2, mappings };
      window.localStorage.setItem(
        BUTTON_MAPPING_STORAGE_KEY,
        JSON.stringify(stored),
      );
    } catch {
      // Mappings remain valid for this tab if storage is unavailable.
    }
  }, [mappings, storageReady]);

  useEffect(() => {
    flightController.setPreferences(preferences);
  }, [flightController, preferences]);

  useEffect(() => {
    flightController.setControllerState(
      controllerState,
      controlsEnabled,
      inputUpdatedAt,
    );
  }, [controllerState, controlsEnabled, flightController, inputUpdatedAt]);

  useEffect(() => {
    controllerStateRef.current = controllerState;
  }, [controllerState]);

  useEffect(() => {
    const currentControllerState = controllerStateRef.current;
    const latestSequence =
      currentControllerState.buttonTransitions?.at(-1)?.sequence ?? 0;
    lastButtonSequenceRef.current = latestSequence;
    buttonSnapshotRef.current = { ...currentControllerState.buttons };
    resetControllerGestureRuntime(profileGestureRuntimeRef.current);
    captureRef.current = null;
    flightController.neutralize();
    const timer = window.setTimeout(() => {
      setCapture(null);
      setMappingMessage(
        "조종기 연결이 바뀌었습니다. 사용자 버튼 설정은 새 입력부터 적용됩니다.",
      );
      setTelemetry(flightController.getState());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sourceSessionKey, flightController]);

  useEffect(() => {
    const currentControllerState = controllerStateRef.current;
    const latestSequence =
      currentControllerState.buttonTransitions?.at(-1)?.sequence ?? 0;
    lastButtonSequenceRef.current = latestSequence;
    buttonSnapshotRef.current = { ...currentControllerState.buttons };
    resetControllerGestureRuntime(profileGestureRuntimeRef.current);
    captureRef.current = null;
    const timer = window.setTimeout(() => setCapture(null), 0);
    return () => window.clearTimeout(timer);
  }, [preferences.controlMode]);

  const dispatchFlightAction = useCallback(
    (command: FlightCommand) => {
      const next = flightController.dispatch(command);
      setTelemetry(cloneFlightState(next));
    },
    [flightController],
  );

  useEffect(() => {
    if (!sourceSessionKey || !mappingSourceId) return;
    const buttonTransitions = controllerState.buttonTransitions ?? [];
    const freshEvents = buttonTransitions.filter(
      (event) => event.sequence > lastButtonSequenceRef.current,
    );
    if (freshEvents.length === 0) return;

    const latestSequence =
      freshEvents.at(-1)?.sequence ?? lastButtonSequenceRef.current;
    if (freshEvents[0].sequence > lastButtonSequenceRef.current + 1) {
      buttonSnapshotRef.current = { ...controllerState.buttons };
      lastButtonSequenceRef.current = latestSequence;
      resetControllerGestureRuntime(profileGestureRuntimeRef.current);
      captureRef.current = null;
      setCapture(null);
      setMappingMessage(
        "버튼 기록 간격이 벌어져 현재 상태로 다시 맞췄습니다. 설정을 다시 시도해 주세요.",
      );
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
    for (const events of groups) {
      const previousButtons = buttonSnapshotRef.current;
      const currentButtons = buttonsFromTransitions(previousButtons, events);
      const newestEventAt = Math.max(...events.map((event) => event.at));
      const eventAge = Date.now() - newestEventAt;
      const eventsAreFresh =
        eventAge >= 0 && eventAge <= INPUT_STALE_AFTER_MS;
      let consumedButtonIds: string[] = [];

      if (
        eventsAreFresh &&
        preferences.controlMode === "custom" &&
        currentCapture
      ) {
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

      const actionInputReady =
        eventsAreFresh &&
        controllerState.connected &&
        controllerState.mappingStatus === "mapped" &&
        !document.hidden;
      if (actionInputReady) {
        if (preferences.controlMode === "custom") {
          const actions = resolveMappedButtonActions(
            currentMappings,
            mappingSourceId,
            previousButtons,
            currentButtons,
            consumedButtonIds,
          );
          for (const action of actions) {
            dispatchFlightAction(ACTION_COMMAND[action]);
          }
        } else {
          const operations = observeProfileButtonGestures(
            controllerProfile,
            events,
            profileGestureRuntimeRef.current,
          );
          for (const operation of operations) {
            dispatchFlightAction(PROFILE_OPERATION_COMMAND[operation]);
          }
        }
      }
      buttonSnapshotRef.current = currentButtons;
    }

    lastButtonSequenceRef.current = latestSequence;
    captureRef.current = currentCapture;
    mappingsRef.current = currentMappings;
    setCapture(currentCapture);
    setMappings(currentMappings);
  }, [
    controllerProfile,
    controllerState.buttonTransitions,
    controllerState.buttons,
    controllerState.connected,
    controllerState.mappingStatus,
    dispatchFlightAction,
    mappingSourceId,
    preferences.controlMode,
    sourceSessionKey,
  ]);

  useEffect(() => {
    if (
      preferences.controlMode !== "byrobot" ||
      !sourceSessionKey ||
      !controlsEnabled ||
      document.hidden
    ) {
      profileGestureRuntimeRef.current.chords.clear();
      return;
    }
    const operations = observeProfileInputChords(
      controllerProfile,
      controllerState,
      Date.now(),
      profileGestureRuntimeRef.current,
    );
    for (const operation of operations) {
      dispatchFlightAction(PROFILE_OPERATION_COMMAND[operation]);
    }
  }, [
    controllerProfile,
    controllerState,
    controlsEnabled,
    dispatchFlightAction,
    preferences.controlMode,
    sourceSessionKey,
  ]);

  useEffect(() => {
    let frame = 0;
    let previousTime = performance.now();
    let lastTelemetryAt = 0;
    const handleVisibilityChange = () => {
      previousTime = performance.now();
      if (document.hidden) {
        setTelemetry(flightController.resetInputSession());
      }
    };
    const tick = (time: number) => {
      const elapsed = Math.max(0, (time - previousTime) / 1000);
      previousTime = time;
      const next = flightController.step(elapsed, Date.now(), !document.hidden);
      if (time - lastTelemetryAt >= 100) {
        lastTelemetryAt = time;
        setTelemetry(next);
      }
      frame = window.requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    frame = window.requestAnimationFrame(tick);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.cancelAnimationFrame(frame);
    };
  }, [flightController]);

  const readTransform = useCallback(
    () => createDroneTransform(flightController.getState()),
    [flightController],
  );

  const startCapture = (action: MappableButtonAction) => {
    if (preferences.controlMode !== "custom") return;
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
    setMappingMessage(
      `${ACTION_LABEL[action]}에 사용할 조종기 버튼을 눌러 주세요.`,
    );
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

  const availability = getFlightActionAvailability(
    telemetry.phase,
    telemetry.emergencyLatched,
  );
  const phaseLabel =
    telemetry.phase === FLIGHT_PHASE.STOP && telemetry.emergencyLatched
      ? "긴급 착륙 완료"
      : PHASE_LABEL[telemetry.phase];

  return (
    <section
      className="pilot-card simulator-card"
      aria-labelledby="drone-simulator-title"
    >
      <div className="simulator-heading">
        <div>
          <span>기본 비행 연습</span>
          <h2 id="drone-simulator-title">가상 드론 테스트</h2>
        </div>
        <strong
          className={`flight-mode phase-${telemetry.phase.toLowerCase()}`}
          role="status"
          aria-live="polite"
        >
          {phaseLabel}
        </strong>
      </div>

      <div className="drone-stage">
        <DroneVisual readTransform={readTransform} />
        {!controlsEnabled ? (
          <div className="drone-stage-message">
            <strong>화면 버튼으로 비행 절차를 먼저 연습할 수 있습니다</strong>
            <span>
              실제 스틱 조종은 조종기를 연결하고 입력이 정상인지 확인한 뒤 활성화됩니다.
            </span>
          </div>
        ) : null}
        <div id="flight-telemetry" className="flight-telemetry" aria-live="off">
          <span>비행 상태 <strong>{phaseLabel}</strong></span>
          <span>고도 <strong>{telemetry.position.y.toFixed(2)} m</strong></span>
          <span>방향 <strong>{Math.round((telemetry.yaw * 180) / Math.PI)}°</strong></span>
          <span>위치 <strong>{telemetry.position.x.toFixed(1)}, {telemetry.position.z.toFixed(1)}</strong></span>
        </div>
      </div>

      <div className="flight-action-bar" aria-label="드론 동작 버튼">
        <button
          type="button"
          className="is-start"
          disabled={!availability.start}
          onClick={() => dispatchFlightAction("start")}
        >
          시동
        </button>
        <button
          type="button"
          className="is-takeoff"
          disabled={!availability.takeoff}
          onClick={() => dispatchFlightAction("takeoff")}
        >
          이륙
        </button>
        <button
          type="button"
          disabled={!availability.land}
          onClick={() => dispatchFlightAction("land")}
        >
          착륙
        </button>
        <button
          type="button"
          disabled={!availability.reset}
          onClick={() => dispatchFlightAction("reset")}
        >
          위치 초기화
        </button>
        <button
          type="button"
          className="is-emergency"
          disabled={!availability.emergency}
          onClick={() => dispatchFlightAction("emergency")}
        >
          긴급 안전 착륙
        </button>
      </div>

      <FlightSettingsPanel
        preferences={preferences}
        axisCount={axisCount}
        profileName={sourceSessionKey ? controllerProfile.label : "조종기 연결 대기"}
        basicButtonsAvailable={Boolean(
          sourceSessionKey && profileHasDefaultButtons,
        )}
        onUpdate={onUpdatePreferences}
        onReset={onResetPreferences}
      />

      {preferences.controlMode === "custom" ? (
        <div className="button-mapping-panel">
          <div className="button-mapping-heading">
            <div>
              <span>사용자 설정</span>
              <h3>조종기 버튼 설정</h3>
            </div>
            {capture ? (
              <button
                type="button"
                className="mapping-cancel"
                onClick={cancelCapture}
              >
                설정 취소
              </button>
            ) : null}
          </div>
          <div className="button-mapping-list">
            {(["start", "takeoff", "land", "emergency"] as const).map(
              (action) => {
                const binding = mappings[action];
                const belongsToController =
                  binding?.sourceId === mappingSourceId;
                return (
                  <div
                    key={action}
                    className={
                      capture?.action === action
                        ? "mapping-row is-listening"
                        : "mapping-row"
                    }
                  >
                    <div>
                      <span>{ACTION_LABEL[action]}</span>
                      <strong>
                        {belongsToController
                          ? displayButtonId(binding?.buttonId)
                          : "미설정"}
                      </strong>
                    </div>
                    <button
                      type="button"
                      aria-label={`${ACTION_LABEL[action]} 버튼 설정`}
                      aria-pressed={capture?.action === action}
                      onClick={() => startCapture(action)}
                      disabled={!controllerState.connected}
                    >
                      {capture?.action === action ? "버튼을 눌러 주세요" : "설정"}
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
              },
            )}
          </div>
          <p className="mapping-message" role="status">{mappingMessage}</p>
        </div>
      ) : null}
    </section>
  );
}

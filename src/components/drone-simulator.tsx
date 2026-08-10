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
import {
  ExperienceCoordinator,
  MISSION_DEFINITIONS,
} from "../simulator/experience-coordinator";
import { CERTIFICATION_TIME_LIMIT_SECONDS } from "../experience";
import type { SimulatorPreferences } from "../simulator/settings";
import { DEFAULT_MODE2_GESTURE_CONFIG } from "../simulator/mode2-gesture-detector";
import { DroneVisual } from "./drone-visual";
import { FlightSettingsPanel } from "./flight-settings-panel";
import type { SimulatorPreferencesUpdater } from "./use-simulator-preferences";
import { StudentStatusHud } from "./experience/student-status-hud";
import {
  ArmingHoldProgress,
  StudentGuideOverlay,
} from "./experience/experience-guide-overlay";
import { ExperienceNavigation } from "./experience/experience-navigation";
import { FlightTrainingHud } from "./experience/flight-training-hud";
import {
  MissionSelection,
  STUDENT_MISSION_CARDS,
} from "./experience/mission-selection";
import { ExperienceFeedback } from "./experience/experience-feedback";
import { ExperienceResultScreen } from "./experience/qualification-result";
import {
  TeacherTestControls,
  type TeacherTestAction,
} from "./experience/teacher-test-controls";
import type { ExperienceStage as StudentExperienceStage } from "./experience/experience-types";
import type { TeacherShortcutId } from "../experience";

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

interface StoredButtonMappingsV3 {
  version: 3;
  mappings: ControllerButtonMappings;
}

const BUTTON_MAPPING_STORAGE_KEY = "byrobot-drone-button-mappings-v3";
const PREVIOUS_BUTTON_MAPPING_STORAGE_KEY = "byrobot-drone-button-mappings-v2";
const LEGACY_BUTTON_MAPPING_STORAGE_KEY = "byrobot-drone-button-mappings-v1";

const PHASE_LABEL: Readonly<Record<FlightPhase, string>> = {
  [FLIGHT_PHASE.READY]: "대기",
  [FLIGHT_PHASE.ARMING]: "시동 준비",
  [FLIGHT_PHASE.ARMED]: "시동 완료",
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
  emergency: "긴급정지 L 버튼",
  missionAction: "촬영 / 확인",
};

const ACTION_COMMAND: Readonly<Partial<Record<MappableButtonAction, FlightCommand>>> = {
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
} as const satisfies Readonly<Partial<Record<ControllerOperation, FlightCommand>>>;

const SPEED_LABEL = {
  beginner: "초보",
  normal: "일반",
  high: "고속",
} as const;

const EXPERIENCE_STAGE_MAP: Readonly<Record<string, StudentExperienceStage>> = {
  START: "tutorial",
  CONNECTING: "tutorial",
  CONTROL_GUIDE: "tutorial",
  TUTORIAL: "tutorial",
  TRAINING: "training",
  CERTIFICATION: "exam",
  QUALIFIED: "exam",
  MISSION_SELECT: "mission-selection",
  MISSION: "mission",
  RESULT: "result",
};

const TEACHER_SHORTCUT_MAP: Readonly<Record<TeacherTestAction, TeacherShortcutId>> = {
  "reset-training": "reset_training",
  "start-exam": "start_certification",
  "start-medical-mission": "start_medical_mission",
  "start-search-mission": "start_disaster_search",
  "reset-battery": "reset_battery",
  "reset-drone": "reset_drone_position",
};

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
    version?: number;
    mappings?: Partial<ControllerButtonMappings>;
  };
  if (
    candidate.version !== 1 &&
    candidate.version !== 2 &&
    candidate.version !== 3
  ) return null;
  const mappings = candidate.mappings;
  if (
    !mappings ||
    !validBinding(mappings.takeoff) ||
    !validBinding(mappings.land) ||
    !validBinding(mappings.emergency) ||
    (candidate.version >= 2 && !validBinding(mappings.start)) ||
    (candidate.version === 3 && !validBinding(mappings.missionAction))
  ) {
    return null;
  }
  return {
    start: candidate.version >= 2 ? (mappings.start ?? null) : null,
    takeoff: mappings.takeoff ?? null,
    land: mappings.land ?? null,
    emergency: mappings.emergency ?? null,
    missionAction:
      candidate.version === 3 ? (mappings.missionAction ?? null) : null,
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
  const [experienceCoordinator] = useState(
    () => new ExperienceCoordinator(flightController.getState()),
  );
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
  const [experience, setExperience] = useState(() =>
    experienceCoordinator.getSnapshot(),
  );
  const [mode2Gesture, setMode2Gesture] = useState(() =>
    flightController.getMode2GestureState(),
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
        const previous = window.localStorage.getItem(
          PREVIOUS_BUTTON_MAPPING_STORAGE_KEY,
        );
        const legacy = window.localStorage.getItem(
          LEGACY_BUTTON_MAPPING_STORAGE_KEY,
        );
        const parsed = parseStoredMappings(
          JSON.parse(current ?? previous ?? legacy ?? "null"),
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
      const stored: StoredButtonMappingsV3 = { version: 3, mappings };
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
    const emergencyBinding = mappings.emergency;
    const profileEmergency = controllerProfile.defaultOperationGestures.emergency;
    flightController.setMode2Bindings({
      emergencyButtonId:
        emergencyBinding?.sourceId === mappingSourceId
          ? emergencyBinding.buttonId
          : profileEmergency?.kind === "button"
            ? profileEmergency.buttonId
          : null,
    });
  }, [
    controllerProfile.defaultOperationGestures.emergency,
    flightController,
    mappingSourceId,
    mappings.emergency,
  ]);

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
    flightController.resetInputSession();
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
      if (command === "reset") {
        experienceCoordinator.synchronizeFlightState(next);
      }
      setTelemetry(cloneFlightState(next));
    },
    [experienceCoordinator, flightController],
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
        currentCapture &&
        (preferences.controlMode === "custom" ||
          currentCapture.action === "emergency" ||
          currentCapture.action === "missionAction")
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
        controlsEnabled &&
        controllerState.connected &&
        controllerState.mappingStatus === "mapped" &&
        !document.hidden;
      if (actionInputReady) {
        const mappedActions = resolveMappedButtonActions(
          currentMappings,
          mappingSourceId,
          previousButtons,
          currentButtons,
          consumedButtonIds,
        );
        for (const action of mappedActions) {
          if (action === "missionAction") {
            experienceCoordinator.queueMissionAction();
          } else if (
            action === "emergency" &&
            preferences.controlMode === "custom" &&
            controllerState.mappingStatus === "mapped" &&
            controllerState.throttle <=
              DEFAULT_MODE2_GESTURE_CONFIG.emergencyThrottleThreshold
          ) {
            dispatchFlightAction("emergency");
          }
        }
        if (preferences.controlMode === "custom") {
          for (const action of mappedActions) {
            if (action === "missionAction" || action === "emergency") continue;
            const command = ACTION_COMMAND[action];
            if (command) dispatchFlightAction(command);
          }
        } else {
          const operations = observeProfileButtonGestures(
            controllerProfile,
            events,
            profileGestureRuntimeRef.current,
          );
          for (const operation of operations) {
            if (operation === "missionAction") {
              experienceCoordinator.queueMissionAction();
              continue;
            }
            const command = PROFILE_OPERATION_COMMAND[operation];
            if (command) dispatchFlightAction(command);
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
    controllerState.throttle,
    controlsEnabled,
    dispatchFlightAction,
    experienceCoordinator,
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
      if (operation === "missionAction") {
        experienceCoordinator.queueMissionAction();
        continue;
      }
      const command = PROFILE_OPERATION_COMMAND[operation];
      if (command) dispatchFlightAction(command);
    }
  }, [
    controllerProfile,
    controllerState,
    controlsEnabled,
    dispatchFlightAction,
    experienceCoordinator,
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
      if (experienceCoordinator.consumeFlightResetRequest()) {
        const reset = flightController.dispatch("reset");
        experienceCoordinator.synchronizeFlightState(reset);
      }
      const activeExperience = experienceCoordinator.getSnapshot();
      const configuredMissionAction = mappingsRef.current.missionAction;
      const missionActionReady = Boolean(
        (configuredMissionAction?.sourceId === mappingSourceId &&
          configuredMissionAction.buttonId) ||
          controllerProfile.defaultOperationGestures.missionAction,
      );
      const interactionReady = !(
        activeExperience.progress.stage === "RESULT" ||
        activeExperience.certificationFinished ||
        (activeExperience.progress.stage === "MISSION" &&
          activeExperience.mission?.kind === "disaster_search" &&
          !missionActionReady)
      );
      let next = flightController.step(
        elapsed,
        Date.now(),
        !document.hidden && interactionReady,
      );
      const experienceStep = experienceCoordinator.step(
        next,
        controlsEnabled,
        elapsed,
        preferences.speedLevel,
        interactionReady,
      );
      if (
        experienceStep.windForce.x !== 0 ||
        experienceStep.windForce.y !== 0 ||
        experienceStep.windForce.z !== 0
      ) {
        next = flightController.applyWorldForce(
          experienceStep.windForce,
          elapsed,
        );
      }
      if (experienceStep.collisionOccurred) {
        next = flightController.applyCollisionResponse();
      }
      if (experienceStep.requestFlightReset) {
        next = flightController.dispatch("reset");
        experienceCoordinator.synchronizeFlightState(next);
      }
      if (time - lastTelemetryAt >= 100) {
        lastTelemetryAt = time;
        setTelemetry(next);
        setMode2Gesture(flightController.getMode2GestureState());
        setExperience(experienceCoordinator.getSnapshot());
      }
      frame = window.requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    frame = window.requestAnimationFrame(tick);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.cancelAnimationFrame(frame);
    };
  }, [
    controllerProfile.defaultOperationGestures.missionAction,
    controlsEnabled,
    experienceCoordinator,
    flightController,
    mappingSourceId,
    preferences.speedLevel,
  ]);

  const readTransform = useCallback(
    () => createDroneTransform(flightController.getState()),
    [flightController],
  );
  const readScene = useCallback(
    () => experienceCoordinator.getSnapshot().scene,
    [experienceCoordinator],
  );

  const refreshExperience = useCallback(() => {
    setExperience(experienceCoordinator.getSnapshot());
  }, [experienceCoordinator]);

  const startExperience = useCallback(() => {
    experienceCoordinator.start(controlsEnabled);
    refreshExperience();
  }, [controlsEnabled, experienceCoordinator, refreshExperience]);

  const beginTutorial = useCallback(() => {
    experienceCoordinator.beginTutorial(flightController.getState());
    refreshExperience();
  }, [experienceCoordinator, flightController, refreshExperience]);

  const selectMission = useCallback(
    (missionId: string) => {
      if (!MISSION_DEFINITIONS.some((mission) => mission.id === missionId)) return;
      experienceCoordinator.selectMission(
        missionId,
        flightController.getState(),
      );
      refreshExperience();
    },
    [experienceCoordinator, flightController, refreshExperience],
  );

  const retryCertification = useCallback(() => {
    experienceCoordinator.retryCertification(flightController.getState());
    refreshExperience();
  }, [experienceCoordinator, flightController, refreshExperience]);

  const openMissionSelection = useCallback(() => {
    experienceCoordinator.openMissionSelection();
    refreshExperience();
  }, [experienceCoordinator, refreshExperience]);

  const applyTeacherTestAction = useCallback(
    (action: TeacherTestAction) => {
      experienceCoordinator.applyTeacherAction(
        TEACHER_SHORTCUT_MAP[action],
        flightController.getState(),
      );
      refreshExperience();
    },
    [experienceCoordinator, flightController, refreshExperience],
  );

  const dismissFeedback = useCallback(
    (id: string) => {
      experienceCoordinator.dismissFeedback(id);
      refreshExperience();
    },
    [experienceCoordinator, refreshExperience],
  );

  const startCapture = (action: MappableButtonAction) => {
    if (
      preferences.controlMode !== "custom" &&
      action !== "emergency" &&
      action !== "missionAction"
    ) return;
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

  const domainStage = experience.progress.stage;
  const studentStage =
    EXPERIENCE_STAGE_MAP[domainStage] ?? ("tutorial" as StudentExperienceStage);
  const completedStudentStages = useMemo(() => {
    const completed: StudentExperienceStage[] = [];
    if (
      experience.progress.trainingCompleted ||
      ["TRAINING", "CERTIFICATION", "QUALIFIED", "MISSION_SELECT", "MISSION", "RESULT"].includes(
        domainStage,
      )
    ) {
      completed.push("tutorial");
    }
    if (experience.progress.trainingCompleted) completed.push("training");
    if (experience.progress.qualified) completed.push("exam");
    if (["MISSION", "RESULT"].includes(domainStage)) {
      completed.push("mission-selection");
    }
    if (domainStage === "RESULT") completed.push("mission");
    return completed;
  }, [domainStage, experience.progress.qualified, experience.progress.trainingCompleted]);
  const studentConnection = !controllerState.connected
    ? "missing"
    : controlsEnabled
      ? "connected"
      : "connecting";
  const horizontalSpeed = Math.hypot(
    telemetry.velocity.x,
    telemetry.velocity.z,
  );
  const missionBattery = experience.missionRuntime?.battery.percent ?? 100;
  const remainingSeconds =
    domainStage === "CERTIFICATION" && !experience.certificationFinished
      ? Math.max(
          0,
          CERTIFICATION_TIME_LIMIT_SECONDS - experience.stageElapsedSeconds,
        )
      : domainStage === "MISSION" && experience.mission
        ? Math.max(
            0,
            experience.mission.timeLimitSeconds -
              (experience.missionRuntime?.elapsedSeconds ?? 0),
          )
        : undefined;
  const requiredMissionTargets =
    experience.mission?.targets.filter((target) => target.required) ?? [];
  const effectiveMissionActionBinding =
    mappings.missionAction?.sourceId === mappingSourceId
      ? mappings.missionAction
      : null;
  const hasMissionActionBinding = Boolean(
    effectiveMissionActionBinding ||
      controllerProfile.defaultOperationGestures.missionAction,
  );
  const waitingForMissionAction =
    domainStage === "MISSION" &&
    experience.mission?.kind === "disaster_search" &&
    !hasMissionActionBinding;
  const objectiveProgress =
    domainStage === "TUTORIAL"
      ? { current: experience.tutorialStepIndex, total: 6 }
      : domainStage === "TRAINING" || domainStage === "CERTIFICATION"
        ? experience.gateProgress
        : domainStage === "MISSION" && experience.mission?.kind === "disaster_search"
          ? {
              current: experience.missionRuntime?.foundTargetIds.length ?? 0,
              total: requiredMissionTargets.length,
            }
          : undefined;
  const currentObjective = waitingForMissionAction
    ? "촬영·확인 버튼을 먼저 설정하세요. 준비될 때까지 임무 시간은 멈춥니다."
    : ["TRAINING", "CERTIFICATION", "MISSION"].includes(domainStage) &&
    telemetry.phase === FLIGHT_PHASE.READY
      ? `Mode 2 시동을 건 뒤 ${experience.currentObjective}`
      : experience.currentObjective;
  const activeWarning = waitingForMissionAction
    ? "촬영·확인 버튼 설정 필요"
    : experience.feedback.find(
        (item) => item.tone === "warning" || item.tone === "emergency",
      )?.title;
  const showCertificationResult =
    experience.certificationFinished &&
    Boolean(experience.certification) &&
    (domainStage === "CERTIFICATION" || domainStage === "QUALIFIED");
  const showFlightArea =
    domainStage !== "MISSION_SELECT" &&
    domainStage !== "RESULT" &&
    !showCertificationResult;
  const effectiveEmergencyBinding =
    mappings.emergency?.sourceId === mappingSourceId
      ? mappings.emergency
      : null;
  const verifiedEmergencyDefault =
    controllerProfile.defaultOperationGestures.emergency;
  const hasEmergencyBinding = Boolean(
    effectiveEmergencyBinding || verifiedEmergencyDefault,
  );
  const missionCards = STUDENT_MISSION_CARDS.filter((card) =>
    MISSION_DEFINITIONS.some((mission) => mission.id === card.id),
  ).map((card) => ({
    ...card,
    locked: !experience.progress.qualified,
  }));
  const certificationItems = experience.certification
    ? [
        {
          id: "gates",
          label: "링 통과",
          score: experience.certification.breakdown.gates,
          maximum: 30,
        },
        {
          id: "collision",
          label: "충돌 없음",
          score: experience.certification.breakdown.collisionFree,
          maximum: 20,
        },
        {
          id: "stability",
          label: "비행 안정성",
          score: experience.certification.breakdown.stability,
          maximum: 20,
        },
        {
          id: "landing",
          label: "착륙 정확도",
          score: experience.certification.breakdown.landing,
          maximum: 20,
        },
        {
          id: "time",
          label: "시간",
          score: experience.certification.breakdown.time,
          maximum: 10,
        },
      ]
    : [];
  const missionResultItems = experience.result
    ? [
        {
          id: "safety",
          label: "안전 운항",
          score: experience.result.safety.score,
          maximum: 100,
          rating: experience.result.safety.stars,
        },
        {
          id: "stability",
          label: "조종 안정성",
          score: experience.result.stability.score,
          maximum: 100,
          rating: experience.result.stability.stars,
        },
        {
          id: "landing",
          label: "착륙 정확도",
          score: experience.result.landing.score,
          maximum: 100,
          rating: experience.result.landing.stars,
        },
        {
          id: "objective",
          label: "임무 수행",
          score: experience.result.objective.score,
          maximum: 100,
          rating: experience.result.objective.stars,
        },
      ]
    : [];
  const basicMappingActions: MappableButtonAction[] = [
    ...(!hasEmergencyBinding ? (["emergency"] as const) : []),
    ...(domainStage === "MISSION" &&
    experience.mission?.kind === "disaster_search" &&
    !hasMissionActionBinding
      ? (["missionAction"] as const)
      : []),
  ];
  const mappingActions: readonly MappableButtonAction[] =
    preferences.controlMode === "custom"
      ? ["start", "takeoff", "land", "emergency", "missionAction"]
      : basicMappingActions;

  return (
    <section
      className="pilot-card simulator-card"
      aria-labelledby="drone-simulator-title"
    >
      <StudentStatusHud
        connection={studentConnection}
        stage={studentStage}
        flightStatus={phaseLabel}
        speedLabel={SPEED_LABEL[preferences.speedLevel]}
        controllerName={
          controllerState.connected ? controllerProfile.label : undefined
        }
      />

      <ExperienceNavigation
        currentStage={studentStage}
        completedStages={completedStudentStages}
      />

      <div className="simulator-heading experience-simulator-heading">
        <div>
          <span>실제 조종 행동 중심 체험</span>
          <h2 id="drone-simulator-title">미래항공모빌리티 운항 체험</h2>
        </div>
        <strong
          className={`flight-mode phase-${telemetry.phase.toLowerCase()}`}
          role="status"
          aria-live="polite"
        >
          {phaseLabel}
        </strong>
      </div>

      {domainStage === "MISSION_SELECT" ? (
        <MissionSelection
          missions={missionCards}
          selectedMissionId={experience.progress.selectedMissionId}
          onSelectMission={selectMission}
        />
      ) : null}

      {showCertificationResult && experience.certification ? (
        <ExperienceResultScreen
          variant="qualification"
          succeeded={experience.certification.qualified}
          heading={experience.certification.message}
          message={
            experience.certification.qualified
              ? "실제 항공모빌리티 임무를 선택할 준비가 되었습니다."
              : "천천히 다시 조종하면 점수를 더 높일 수 있습니다."
          }
          totalScore={experience.certification.total}
          scoreItems={certificationItems}
          profileType={
            experience.certification.qualified ? "안전 운항형" : "균형 성장형"
          }
          onContinue={
            experience.certification.qualified
              ? openMissionSelection
              : undefined
          }
          onRetry={retryCertification}
        />
      ) : null}

      {domainStage === "RESULT" && experience.result ? (
        <ExperienceResultScreen
          variant="mission"
          succeeded={experience.result.completed}
          heading={
            experience.result.completed
              ? `${experience.mission?.title ?? "항공모빌리티 임무"} 성공`
              : "다시 도전할 준비가 되었습니다"
          }
          message={experience.result.profileReason}
          totalScore={experience.result.totalScore}
          scoreItems={missionResultItems}
          profileType={experience.result.profileLabel}
          careerMessage={experience.result.careerMessage}
          onContinue={openMissionSelection}
          continueLabel="임무 선택으로"
          onRetry={
            experience.mission
              ? () => selectMission(experience.mission?.id ?? "")
              : undefined
          }
        />
      ) : null}

      {showFlightArea ? (
        <>
          {domainStage === "TUTORIAL" && experience.tutorialStep ? (
            <section className="tutorial-flight-guide" aria-live="polite">
              <div>
                <span>
                  조종법 {experience.tutorialStep.order} / 6
                </span>
                <h3>{experience.tutorialStep.title}</h3>
                <p>{experience.tutorialStep.instruction}</p>
              </div>
              {experience.tutorialStep.id === "arming" ? (
                <ArmingHoldProgress
                  elapsedSeconds={mode2Gesture.armingHeldMs / 1000}
                  durationSeconds={3}
                />
              ) : null}
            </section>
          ) : null}

          <div className="drone-stage">
            <DroneVisual readTransform={readTransform} readScene={readScene} />
            {domainStage !== "START" && !controlsEnabled ? (
              <StudentGuideOverlay
                kind="connect"
                title={
                  controllerState.connected
                    ? "조종기 입력을 확인해 주세요"
                    : "조종기를 USB에 연결해 주세요"
                }
                instruction={
                  controllerState.connected
                    ? "스틱을 중앙에 놓아 자동 보정을 마친 뒤, 양쪽 스틱을 한 번 움직여 입력을 확인해 주세요."
                    : "처음 한 번만 ‘조종기 처음 연결하기’를 눌러 장치를 선택합니다."
                }
                detail="연결이 복구되면 현재 훈련이나 임무에서 그대로 이어집니다. 멈춘 동안 시험 시간과 배터리는 줄지 않습니다."
              />
            ) : domainStage === "START" ? (
              <StudentGuideOverlay
                kind="start"
                title="미래항공모빌리티 운항 훈련"
                instruction="실제 바이로봇 조종기를 손에 잡고 시동부터 임무 착륙까지 체험합니다."
                detail="체험을 시작하면 승인된 USB 조종기를 자동으로 확인합니다."
                primaryAction={{
                  label: "체험 시작",
                  onSelect: startExperience,
                }}
              />
            ) : domainStage === "CONNECTING" ? (
              <StudentGuideOverlay
                kind="connect"
                title={
                  controllerState.connected
                    ? "조종기를 확인하고 있습니다"
                    : "조종기를 USB에 연결해 주세요"
                }
                instruction={
                  controllerState.connected
                    ? "스틱을 중앙에 놓아 자동 보정을 마친 뒤, 양쪽 스틱을 한 번 움직여 입력을 확인해 주세요."
                    : "처음 한 번만 왼쪽의 ‘조종기 처음 연결하기’를 눌러 장치를 선택합니다."
                }
                detail="이미 권한을 승인한 조종기는 다음 접속부터 자동으로 연결됩니다."
              />
            ) : domainStage === "CONTROL_GUIDE" ? (
              <StudentGuideOverlay
                kind="tutorial"
                title="바이로봇 Mode 2 조종법"
                instruction="왼쪽 스틱은 고도와 회전, 오른쪽 스틱은 전후·좌우 이동을 조종합니다."
                detail="첫 단계에서는 양쪽 스틱을 아래쪽 안으로 모아 3초 동안 시동을 겁니다."
                primaryAction={{
                  label: "조종법 익히기 시작",
                  onSelect: beginTutorial,
                  disabled: !controlsEnabled,
                }}
              />
            ) : null}
            <div id="flight-telemetry" className="flight-telemetry" aria-live="off">
              <span>비행 상태 <strong>{phaseLabel}</strong></span>
              <span>고도 <strong>{telemetry.position.y.toFixed(2)} m</strong></span>
              <span>방향 <strong>{Math.round((telemetry.yaw * 180) / Math.PI)}°</strong></span>
              <span>위치 <strong>{telemetry.position.x.toFixed(1)}, {telemetry.position.z.toFixed(1)}</strong></span>
            </div>
            <div className="flight-feedback-overlay">
              <ExperienceFeedback
                items={experience.feedback}
                onDismiss={dismissFeedback}
              />
            </div>
            {!["START", "CONNECTING", "CONTROL_GUIDE"].includes(domainStage) ? (
              <button
                type="button"
                className="flight-emergency-overlay"
                disabled={!availability.emergency}
                onClick={() => dispatchFlightAction("emergency")}
              >
                긴급 안전 착륙
              </button>
            ) : null}
          </div>

          {!["START", "CONNECTING", "CONTROL_GUIDE"].includes(domainStage) ? (
            <FlightTrainingHud
              altitudeMeters={telemetry.position.y}
              speedMetersPerSecond={horizontalSpeed}
              batteryPercent={missionBattery}
              objective={currentObjective}
              elapsedSeconds={experience.stageElapsedSeconds}
              remainingSeconds={remainingSeconds}
              objectiveProgress={objectiveProgress}
              warning={activeWarning}
            />
          ) : null}

          <div className="flight-action-bar student-flight-actions" aria-label="화면 비행 조작">
            <button
              type="button"
              className="is-start"
              disabled={!availability.start}
              onClick={() => dispatchFlightAction("arm")}
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
            <p className="screen-control-note">
              <strong>조종기 Mode 2가 기본 조작입니다.</strong>
              <span>화면 버튼은 연결 점검과 수업 보조용으로 동일한 비행 상태를 실행합니다.</span>
            </p>
          </div>
        </>
      ) : null}

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

      {mappingActions.length > 0 ? (
        <div className="button-mapping-panel">
          <div className="button-mapping-heading">
            <div>
              <span>
                {preferences.controlMode === "custom"
                  ? "사용자 설정"
                  : "안전 기능 확인"}
              </span>
              <h3>
                {preferences.controlMode === "custom"
                  ? "조종기 버튼 설정"
                  : "조종기 버튼 한 번 확인하기"}
              </h3>
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
            {mappingActions.map(
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
          {preferences.controlMode === "byrobot" && !hasEmergencyBinding ? (
            <p className="mapping-safety-note">
              긴급정지는 스로틀을 끝까지 내린 상태에서 여기서 확인한 L 버튼을
              함께 눌렀을 때만 작동합니다. 확인되지 않은 버튼 값은 자동으로
              추측하지 않습니다.
            </p>
          ) : null}
        </div>
      ) : null}

      <TeacherTestControls onAction={applyTeacherTestAction} />
    </section>
  );
}

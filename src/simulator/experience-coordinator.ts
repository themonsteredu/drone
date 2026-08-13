import {
  BASIC_TRAINING_COURSE,
  CERTIFICATION_COURSE,
  CERTIFICATION_TIME_LIMIT_SECONDS,
  CourseTracker,
  DISASTER_SEARCH_MISSION,
  MEDICAL_DELIVERY_MISSION,
  MISSION_DEFINITIONS,
  MODE2_TUTORIAL_STEPS,
  applyTeacherShortcut,
  assessLanding,
  calculateCertificationScore,
  calculateMissionResult,
  createInitialExperienceProgress,
  createMissionRuntimeState,
  confirmMissionPreflight,
  createTutorialRuntimeState,
  getMissionDefinition,
  reduceExperienceProgress,
  selectMissionPlan,
  stepMission,
  stepTutorial,
  type CertificationAttemptMetrics,
  type CertificationScore,
  type ExperienceEvent,
  type ExperienceProgressState,
  type ExperienceResult,
  type MissionDefinition,
  type MissionRuntimeState,
  type TeacherShortcutId,
  type TutorialRuntimeState,
} from "../experience";
import type { FlightState } from "./flight-model";
import type {
  DroneSceneMarker,
  DroneScenePresentation,
} from "./scene-presentation";
import type { FlightSpeedLevel } from "./settings";

export type ExperienceFeedbackTone =
  | "info"
  | "success"
  | "warning"
  | "collision"
  | "emergency";

export interface ExperienceFeedbackMessage {
  id: string;
  tone: ExperienceFeedbackTone;
  title: string;
  message?: string;
}

interface TimedFeedback extends ExperienceFeedbackMessage {
  expiresAt: number;
}

export interface ExperienceCoordinatorStep {
  windForce: { x: number; y: number; z: number };
  collisionOccurred: boolean;
  requestFlightReset: boolean;
}

export interface ExperienceCoordinatorSnapshot {
  progress: ExperienceProgressState;
  stageElapsedSeconds: number;
  tutorialStepIndex: number;
  tutorialStep: (typeof MODE2_TUTORIAL_STEPS)[number] | null;
  gateProgress: { current: number; total: number; collisions: number };
  certification: CertificationScore | null;
  certificationFinished: boolean;
  mission: MissionDefinition | null;
  missionRuntime: MissionRuntimeState | null;
  result: ExperienceResult | null;
  feedback: readonly ExperienceFeedbackMessage[];
  scene: DroneScenePresentation;
  currentObjective: string;
}

function velocityMagnitude(state: FlightState): number {
  return Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
}

function wrappedAngleDelta(current: number, baseline: number): number {
  const fullTurn = Math.PI * 2;
  return ((current - baseline + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function isNormalLandingTransition(
  previous: FlightState,
  current: FlightState,
): boolean {
  return (
    (previous.phase === "FLIGHT" || previous.phase === "LANDING") &&
    current.phase === "READY" &&
    current.position.y <= 0.02
  );
}

function volumeCenter(
  volume: MissionDefinition["obstacles"][number]["volume"],
) {
  if (volume.shape === "sphere") return volume.center;
  return {
    x: (volume.min.x + volume.max.x) / 2,
    y: (volume.min.y + volume.max.y) / 2,
    z: (volume.min.z + volume.max.z) / 2,
  };
}

function volumeSize(
  volume: MissionDefinition["obstacles"][number]["volume"],
) {
  if (volume.shape === "sphere") {
    const diameter = volume.radius * 2;
    return { x: diameter, y: diameter, z: diameter };
  }
  return {
    x: volume.max.x - volume.min.x,
    y: volume.max.y - volume.min.y,
    z: volume.max.z - volume.min.z,
  };
}

function volumeRadius(
  volume: MissionDefinition["obstacles"][number]["volume"],
): number {
  if (volume.shape === "sphere") return volume.radius;
  return Math.max(volume.max.x - volume.min.x, volume.max.z - volume.min.z) / 2;
}

function landingZoneRadius(zone: {
  bands: readonly { maxRadius: number }[];
}): number {
  let radius = 0;
  for (const band of zone.bands) radius = Math.max(radius, band.maxRadius);
  return radius || 2.2;
}

function bodyRelativePoint(
  origin: Readonly<{ x: number; y: number; z: number }>,
  yaw: number,
  direction: "forward" | "right",
  distance: number,
) {
  const xDirection = direction === "forward" ? Math.sin(yaw) : Math.cos(yaw);
  const zDirection = direction === "forward" ? Math.cos(yaw) : -Math.sin(yaw);
  return {
    x: origin.x + xDirection * distance,
    y: origin.y,
    z: origin.z + zDirection * distance,
  };
}

/**
 * Integration boundary between FlightPhysics and the data-driven experience
 * domain. It consumes FlightState snapshots, emits events/forces, and never
 * reads ControllerState, Serial packets, or DroneVisual internals.
 */
export class ExperienceCoordinator {
  private progress = createInitialExperienceProgress();
  private tutorial: TutorialRuntimeState;
  private courseTracker = new CourseTracker(BASIC_TRAINING_COURSE);
  private courseSnapshot = this.courseTracker.getSnapshot();
  private previousFlight: FlightState;
  private stageElapsedSeconds = 0;
  private feedbackSequence = 0;
  private feedback: TimedFeedback[] = [];
  private collisionPulseUntil = 0;
  private certification: CertificationScore | null = null;
  private certificationFinished = false;
  private certificationClockStarted = false;
  private certificationMetrics: CertificationAttemptMetrics;
  private certificationYawBaseline = 0;
  private certificationAltitudeBaseline: number | null = null;
  private certificationMinAltitude = 0;
  private certificationMaxAltitude = 0;
  private stableSamples = 0;
  private totalSamples = 0;
  private mission: MissionDefinition | null = null;
  private missionRuntime: MissionRuntimeState | null = null;
  private result: ExperienceResult | null = null;
  private missionActionQueued = false;
  private requestFlightReset = false;

  constructor(initialFlight: FlightState) {
    this.previousFlight = initialFlight;
    this.tutorial = createTutorialRuntimeState({
      position: initialFlight.position,
      yaw: initialFlight.yaw,
      flightPhase: initialFlight.phase,
    });
    this.certificationMetrics = this.emptyCertificationMetrics();
  }

  start(controllerReady: boolean): void {
    this.progress = reduceExperienceProgress(this.progress, { type: "start" });
    if (controllerReady) this.setControllerReady();
  }

  setControllerReady(): void {
    if (this.progress.controllerReady && this.progress.stage !== "CONNECTING") return;
    this.progress = reduceExperienceProgress(this.progress, {
      type: "controllerReady",
    });
  }

  setControllerUnavailable(): void {
    this.progress = reduceExperienceProgress(this.progress, {
      type: "controllerUnavailable",
    });
  }

  beginTutorial(flight: FlightState): void {
    this.progress = reduceExperienceProgress(this.progress, {
      type: "beginTutorial",
    });
    this.resetTutorial(flight);
    this.requestFlightReset = true;
  }

  openMissionSelection(): void {
    this.progress = reduceExperienceProgress(this.progress, {
      type: "openMissionSelection",
    });
    if (this.progress.stage === "MISSION_SELECT") {
      this.certificationFinished = false;
      this.feedback = [];
    }
  }

  selectMission(missionId: string, flight: FlightState): void {
    const mission = getMissionDefinition(missionId);
    if (!mission) return;
    this.progress = reduceExperienceProgress(this.progress, {
      type: "selectMission",
      missionId,
    });
    if (this.progress.stage !== "MISSION") return;
    this.certificationFinished = false;
    this.mission = mission;
    this.missionRuntime = createMissionRuntimeState(mission);
    this.result = null;
    this.resetStageClock();
    this.previousFlight = flight;
    this.requestFlightReset = true;
    this.pushFeedback("info", mission.title, mission.briefing, 6);
  }

  retryCertification(flight: FlightState): void {
    this.progress = { ...this.progress, stage: "CERTIFICATION" };
    this.feedback = [];
    this.beginCertification(flight);
    this.requestFlightReset = true;
  }

  queueMissionAction(): void {
    this.missionActionQueued = true;
  }

  chooseMissionPlan(planId: string): void {
    if (!this.mission || !this.missionRuntime) return;
    this.missionRuntime = selectMissionPlan(this.mission, this.missionRuntime, planId);
  }

  confirmMissionDispatch(): void {
    if (!this.mission || !this.missionRuntime) return;
    const next = confirmMissionPreflight(this.mission, this.missionRuntime);
    if (next === this.missionRuntime) return;
    this.missionRuntime = next;
    this.resetStageClock();
    this.pushFeedback(
      "success",
      this.mission.kind === "medical_delivery" ? "의약품 인수 완료" : "수색 계획 승인",
      "시동을 걸고 지정된 운항 계획에 따라 출발하세요.",
      5,
    );
  }

  consumeFlightResetRequest(): boolean {
    const requested = this.requestFlightReset;
    this.requestFlightReset = false;
    return requested;
  }

  synchronizeFlightState(flight: FlightState): void {
    this.previousFlight = flight;
    if (
      this.progress.stage === "CERTIFICATION" &&
      !this.certificationClockStarted
    ) {
      this.certificationYawBaseline = flight.yaw;
      this.certificationAltitudeBaseline = null;
      this.certificationMinAltitude = flight.position.y;
      this.certificationMaxAltitude = flight.position.y;
    }
    if (this.missionRuntime) {
      this.missionRuntime = {
        ...this.missionRuntime,
        previousPosition: { ...flight.position },
      };
    }
  }

  dismissFeedback(id: string): void {
    this.feedback = this.feedback.filter((item) => item.id !== id);
  }

  applyTeacherAction(
    shortcut: TeacherShortcutId,
    flight: FlightState,
  ): void {
    const update = applyTeacherShortcut(this.progress, shortcut);
    this.progress = update.state;
    this.requestFlightReset =
      this.requestFlightReset ||
      update.effects.resetFlight ||
      update.effects.resetDronePosition;
    const changesStage =
      shortcut === "reset_training" ||
      shortcut === "start_certification" ||
      shortcut === "start_medical_mission" ||
      shortcut === "start_disaster_search";
    if (changesStage) {
      this.feedback = [];
      this.stageElapsedSeconds = 0;
    }
    this.previousFlight = flight;
    if (shortcut === "reset_training") {
      this.courseTracker = new CourseTracker(BASIC_TRAINING_COURSE);
      this.courseSnapshot = this.courseTracker.getSnapshot();
    } else if (shortcut === "start_certification") {
      this.beginCertification(flight);
    } else if (
      shortcut === "start_medical_mission" ||
      shortcut === "start_disaster_search"
    ) {
      const selected = shortcut === "start_medical_mission"
        ? MEDICAL_DELIVERY_MISSION
        : DISASTER_SEARCH_MISSION;
      this.mission = selected;
      this.missionRuntime = createMissionRuntimeState(selected);
      this.result = null;
    } else if (
      shortcut === "reset_battery" &&
      this.mission &&
      this.missionRuntime
    ) {
      const freshBattery = createMissionRuntimeState(this.mission).battery;
      this.missionRuntime = {
        ...this.missionRuntime,
        battery: freshBattery,
      };
    }
  }

  step(
    flight: FlightState,
    controllerReady: boolean,
    elapsedSeconds: number,
    speedLevel: FlightSpeedLevel,
    interactionReady = true,
  ): ExperienceCoordinatorStep {
    const boundedDt = Math.max(0, Math.min(0.25, elapsedSeconds));
    if (controllerReady) this.setControllerReady();
    else this.setControllerUnavailable();

    const runtimeReady = controllerReady && interactionReady;
    if (
      runtimeReady &&
      this.progress.stage === "CERTIFICATION" &&
      !this.certificationClockStarted &&
      (flight.phase === "ARMED" || flight.phase === "FLIGHT")
    ) {
      this.certificationClockStarted = true;
    }
    const dt =
      runtimeReady &&
      (this.progress.stage !== "CERTIFICATION" ||
        this.certificationClockStarted)
        ? boundedDt
        : 0;
    this.stageElapsedSeconds += dt;
    this.feedback = this.feedback.filter(
      (item) => item.expiresAt > this.stageElapsedSeconds,
    );
    let windForce = { x: 0, y: 0, z: 0 };
    let collisionOccurred = false;

    if (!runtimeReady) {
      this.synchronizeFlightState(flight);
      const requestFlightReset = this.requestFlightReset;
      this.requestFlightReset = false;
      return { windForce, collisionOccurred, requestFlightReset };
    }

    if (this.progress.stage === "TUTORIAL") {
      const update = stepTutorial(MODE2_TUTORIAL_STEPS, this.tutorial, {
        position: flight.position,
        yaw: flight.yaw,
        flightPhase: flight.phase,
      });
      this.tutorial = update.state;
      if (update.stepCompleted && update.completedStep) {
        this.pushFeedback(
          "success",
          update.completedStep.successMessage,
          undefined,
          2.2,
        );
        this.progress = reduceExperienceProgress(this.progress, {
          type: "tutorialStepCompleted",
          totalSteps: MODE2_TUTORIAL_STEPS.length,
        });
        if (this.progress.stage === "TRAINING") {
          this.beginTraining(flight);
          this.requestFlightReset = true;
        }
      }
    } else if (
      this.progress.stage === "TRAINING" ||
      this.progress.stage === "CERTIFICATION"
    ) {
      const course = this.progress.stage === "TRAINING"
        ? BASIC_TRAINING_COURSE
        : CERTIFICATION_COURSE;
      const courseUpdate = this.courseTracker.update(
        this.previousFlight.position,
        flight.position,
        this.stageElapsedSeconds,
      );
      this.courseSnapshot = courseUpdate.snapshot;
      collisionOccurred = this.handleEvents(courseUpdate.events) || collisionOccurred;

      if (this.progress.stage === "CERTIFICATION" && !this.certificationFinished) {
        this.updateCertificationMetrics(flight, dt);
      }

      const landedNow = isNormalLandingTransition(this.previousFlight, flight);
      if (landedNow) {
        const landing = assessLanding(flight.position, course.landingZone);
        if (
          this.progress.stage === "TRAINING" &&
          this.courseSnapshot.nextGateIndex >= course.gates.length &&
          landing.success
        ) {
          this.pushFeedback("success", "기초 비행 훈련 완료", "자격시험으로 이동합니다.", 4);
          this.progress = reduceExperienceProgress(this.progress, {
            type: "trainingCompleted",
          });
          this.beginCertification(flight);
          this.requestFlightReset = true;
        } else if (this.progress.stage === "TRAINING") {
          this.pushFeedback(
            "warning",
            "착륙 지점을 다시 확인하세요",
            `링 ${this.courseSnapshot.nextGateIndex}/${course.gates.length} · 착륙 ${landing.label}`,
            4,
          );
        } else if (!this.certificationFinished) {
          this.certificationMetrics = {
            ...this.certificationMetrics,
            landed: true,
            landingAccuracyScore: landing.score,
            elapsedSeconds: this.stageElapsedSeconds,
          };
          this.finishCertification();
        }
      }

      if (
        this.progress.stage === "CERTIFICATION" &&
        !this.certificationFinished &&
        this.stageElapsedSeconds >= CERTIFICATION_TIME_LIMIT_SECONDS
      ) {
        this.certificationMetrics.elapsedSeconds = CERTIFICATION_TIME_LIMIT_SECONDS;
        this.finishCertification();
      }
    } else if (
      this.progress.stage === "MISSION" &&
      this.mission &&
      this.missionRuntime
    ) {
      const landedNow = isNormalLandingTransition(this.previousFlight, flight);
      const movementDemand = Math.max(
        Math.abs(flight.smoothedInput.pitch),
        Math.abs(flight.smoothedInput.roll),
      );
      const stabilitySample = Math.max(
        0,
        Math.min(
          1,
          1 -
            (Math.abs(flight.tilt.pitch) + Math.abs(flight.tilt.roll)) /
              (Math.PI / 4),
        ),
      );
      const update = stepMission(this.mission, this.missionRuntime, {
        elapsedSeconds: dt,
        position: flight.position,
        speedLevel,
        movementMagnitude: movementDemand,
        throttleMagnitude: Math.abs(flight.smoothedInput.throttle),
        missionActionPressed: this.missionActionQueued,
        landed: landedNow,
        emergencyActivated:
          this.previousFlight.phase !== "EMERGENCY" &&
          flight.phase === "EMERGENCY",
        collisionEnabled:
          flight.position.y > 0.05 &&
          (flight.phase === "TAKEOFF" ||
            flight.phase === "FLIGHT" ||
            flight.phase === "LANDING" ||
            flight.phase === "EMERGENCY"),
        stabilitySample,
      });
      this.missionActionQueued = false;
      this.missionRuntime = update.state;
      windForce = update.windForce;
      collisionOccurred = this.handleEvents(update.events) || collisionOccurred;
      if (
        update.state.status === "COMPLETED" ||
        update.state.status === "EXPIRED"
      ) {
        this.result = calculateMissionResult(this.mission, update.state);
        this.progress = reduceExperienceProgress(this.progress, {
          type: "missionCompleted",
          result: this.result,
        });
      }
    }

    this.previousFlight = flight;
    const requestFlightReset = this.requestFlightReset;
    this.requestFlightReset = false;
    return { windForce, collisionOccurred, requestFlightReset };
  }

  getSnapshot(): ExperienceCoordinatorSnapshot {
    return {
      progress: { ...this.progress },
      stageElapsedSeconds: this.stageElapsedSeconds,
      tutorialStepIndex: this.tutorial.stepIndex,
      tutorialStep: MODE2_TUTORIAL_STEPS[this.tutorial.stepIndex] ?? null,
      gateProgress: {
        current: this.courseSnapshot.nextGateIndex,
        total:
          this.progress.stage === "CERTIFICATION"
            ? CERTIFICATION_COURSE.gates.length
            : BASIC_TRAINING_COURSE.gates.length,
        collisions: this.courseSnapshot.collisionCount,
      },
      certification: this.certification,
      certificationFinished: this.certificationFinished,
      mission: this.mission,
      missionRuntime: this.missionRuntime
        ? {
            ...this.missionRuntime,
            previousPosition: { ...this.missionRuntime.previousPosition },
            foundTargetIds: [...this.missionRuntime.foundTargetIds],
            activeWindZoneIds: [...this.missionRuntime.activeWindZoneIds],
            activeObstacleIds: [...this.missionRuntime.activeObstacleIds],
            collisionCooldownUntil: {
              ...this.missionRuntime.collisionCooldownUntil,
            },
            battery: { ...this.missionRuntime.battery },
          }
        : null,
      result: this.result,
      feedback: this.feedback.map((item) => ({
        id: item.id,
        tone: item.tone,
        title: item.title,
        message: item.message,
      })),
      scene: this.buildScene(),
      currentObjective: this.currentObjective(),
    };
  }

  private resetTutorial(flight: FlightState): void {
    this.tutorial = createTutorialRuntimeState({
      position: flight.position,
      yaw: flight.yaw,
      flightPhase: flight.phase,
    });
    this.stageElapsedSeconds = 0;
    this.previousFlight = flight;
  }

  private beginTraining(flight: FlightState): void {
    this.courseTracker = new CourseTracker(BASIC_TRAINING_COURSE);
    this.courseSnapshot = this.courseTracker.getSnapshot();
    this.resetStageClock();
    this.previousFlight = flight;
  }

  private beginCertification(flight: FlightState): void {
    this.courseTracker = new CourseTracker(CERTIFICATION_COURSE);
    this.courseSnapshot = this.courseTracker.getSnapshot();
    this.resetStageClock();
    this.certification = null;
    this.certificationFinished = false;
    this.certificationClockStarted = false;
    this.certificationMetrics = this.emptyCertificationMetrics();
    this.certificationYawBaseline = flight.yaw;
    this.certificationAltitudeBaseline = null;
    this.certificationMinAltitude = flight.position.y;
    this.certificationMaxAltitude = flight.position.y;
    this.stableSamples = 0;
    this.totalSamples = 0;
    this.previousFlight = flight;
  }

  private emptyCertificationMetrics(): CertificationAttemptMetrics {
    return {
      gatesPassed: 0,
      requiredGates: CERTIFICATION_COURSE.gates.length,
      collisions: 0,
      stableFlightRatio: 1,
      landingAccuracyScore: 0,
      elapsedSeconds: 0,
      armed: false,
      tookOff: false,
      yawTurnCompleted: false,
      altitudeChangeCompleted: false,
      landed: false,
      emergencyActivated: false,
    };
  }

  private updateCertificationMetrics(flight: FlightState, dt: number): void {
    if (
      this.certificationAltitudeBaseline === null &&
      flight.phase === "FLIGHT" &&
      flight.position.y >= 0.8
    ) {
      this.certificationAltitudeBaseline = flight.position.y;
      this.certificationMinAltitude = flight.position.y;
      this.certificationMaxAltitude = flight.position.y;
    } else if (
      this.certificationAltitudeBaseline !== null &&
      flight.phase === "FLIGHT"
    ) {
      this.certificationMinAltitude = Math.min(
        this.certificationMinAltitude,
        flight.position.y,
      );
      this.certificationMaxAltitude = Math.max(
        this.certificationMaxAltitude,
        flight.position.y,
      );
    }
    this.totalSamples += dt;
    if (
      velocityMagnitude(flight) <= 2.2 &&
      Math.abs(flight.tilt.pitch) + Math.abs(flight.tilt.roll) <= Math.PI / 5
    ) {
      this.stableSamples += dt;
    }
    this.certificationMetrics = {
      ...this.certificationMetrics,
      gatesPassed: this.courseSnapshot.nextGateIndex,
      collisions: this.courseSnapshot.collisionCount,
      stableFlightRatio: this.totalSamples > 0
        ? this.stableSamples / this.totalSamples
        : 1,
      elapsedSeconds: this.stageElapsedSeconds,
      armed:
        this.certificationMetrics.armed ||
        flight.phase === "ARMED" ||
        flight.phase === "FLIGHT",
      tookOff:
        this.certificationMetrics.tookOff ||
        ((this.previousFlight.phase === "ARMED" ||
          this.previousFlight.phase === "TAKEOFF") &&
          flight.phase === "FLIGHT"),
      yawTurnCompleted:
        this.certificationMetrics.yawTurnCompleted ||
        wrappedAngleDelta(flight.yaw, this.certificationYawBaseline) >=
          Math.PI / 3,
      altitudeChangeCompleted:
        this.certificationMetrics.altitudeChangeCompleted ||
        (this.certificationAltitudeBaseline !== null &&
          Math.max(
            this.certificationMaxAltitude -
              this.certificationAltitudeBaseline,
            this.certificationAltitudeBaseline -
              this.certificationMinAltitude,
          ) >= 0.8),
      emergencyActivated:
        this.certificationMetrics.emergencyActivated ||
        (this.previousFlight.phase !== "EMERGENCY" &&
          flight.phase === "EMERGENCY"),
    };
  }

  private finishCertification(): void {
    this.certification = calculateCertificationScore(
      this.certificationMetrics,
    );
    this.certificationFinished = true;
    this.progress = reduceExperienceProgress(this.progress, {
      type: "certificationCompleted",
      score: this.certification,
    });
    this.pushFeedback(
      this.certification.qualified ? "success" : "warning",
      this.certification.message,
      this.certification.qualified
        ? "실제 항공모빌리티 임무를 선택할 수 있습니다."
        : "점수를 확인하고 천천히 다시 도전해 보세요.",
      8,
    );
  }

  private pushFeedback(
    tone: ExperienceFeedbackTone,
    title: string,
    message?: string,
    durationSeconds = 3,
  ): void {
    this.feedbackSequence += 1;
    this.feedback = [
      ...this.feedback.slice(-2),
      {
        id: `feedback-${this.feedbackSequence}`,
        tone,
        title,
        message,
        expiresAt: this.stageElapsedSeconds + durationSeconds,
      },
    ];
  }

  /** A new activity must never inherit a collision flash or stale message. */
  private resetStageClock(): void {
    this.feedback = [];
    this.collisionPulseUntil = 0;
    this.stageElapsedSeconds = 0;
  }

  private handleEvents(events: readonly ExperienceEvent[]): boolean {
    let collision = false;
    for (const event of events) {
      if (event.type === "gatePassed") {
        this.pushFeedback("success", "링 통과!", `${event.order}번째 관문을 통과했습니다.`);
      } else if (event.type === "collision") {
        collision = true;
        this.collisionPulseUntil = this.stageElapsedSeconds + 0.5;
        this.pushFeedback("collision", "충돌", "조종을 천천히 안정시켜 주세요.");
      } else if (event.type === "windEntered") {
        this.pushFeedback("warning", "강풍 주의", "기체가 옆으로 밀립니다. 반대 방향으로 보정하세요.", 5);
      } else if (event.type === "targetFound") {
        this.pushFeedback("success", `탐색 완료 ${event.count}/${event.total}`);
      } else if (event.type === "missionCompleted") {
        this.pushFeedback("success", "미션 성공");
      } else if (event.type === "batteryLow") {
        this.pushFeedback("warning", "배터리 주의", "착륙 지점으로 이동할 준비를 하세요.", 5);
      } else if (event.type === "emergencyActivated") {
        this.pushFeedback("emergency", "긴급정지 작동", "안전 착륙을 시작합니다.", 5);
      }
    }
    return collision;
  }

  private currentObjective(): string {
    if (this.progress.stage === "TUTORIAL") {
      return this.getSnapshotSafeTutorial()?.instruction ?? "조종법 안내 완료";
    }
    if (this.progress.stage === "TRAINING") {
      return this.courseSnapshot.nextGateIndex < BASIC_TRAINING_COURSE.gates.length
        ? `${this.courseSnapshot.nextGateIndex + 1}번째 링을 순서대로 통과하세요.`
        : "착륙 패드 중앙에 천천히 착륙하세요.";
    }
    if (this.progress.stage === "CERTIFICATION") {
      return this.certificationFinished
        ? "시험 결과를 확인하세요."
        : !this.certificationClockStarted
          ? `Mode 2 시동을 걸면 ${CERTIFICATION_TIME_LIMIT_SECONDS}초 시험이 시작됩니다.`
          : "링 3개 통과, 오른쪽 Yaw, 고도 변경과 정밀 착륙을 완료하세요.";
    }
    if (this.progress.stage === "MISSION" && this.mission && this.missionRuntime) {
      if (this.mission.kind === "medical_delivery") {
        if (!this.missionRuntime.selectedPlanId) return "운항 경로를 선택하세요.";
        if (!this.missionRuntime.preflightConfirmed) return "의약품과 출발 전 점검을 확인하세요.";
        if (this.missionRuntime.operationPhase === "HANDOVER") {
          return "임시 응급진료소 의료진에게 의약품을 인계하세요.";
        }
        return "선택한 비행 통로를 유지하며 임시 응급진료소로 운항하세요.";
      }
      if (!this.missionRuntime.selectedPlanId) return "수색 비행 계획을 선택하세요.";
      if (!this.missionRuntime.preflightConfirmed) return "수색 순서와 장비 점검을 확인하세요.";
      const total = this.mission.targets.filter((target) => target.required).length;
      const found = this.missionRuntime.foundTargetIds.length;
      return found < total
        ? `탐색 지점 가까이에서 촬영/확인 버튼을 누르세요. ${found}/${total}`
        : "출발 착륙장으로 복귀해 착륙하세요.";
    }
    return "안내에 따라 실제 조종기로 비행하세요.";
  }

  private getSnapshotSafeTutorial() {
    return MODE2_TUTORIAL_STEPS[this.tutorial.stepIndex] ?? null;
  }

  private buildScene(): DroneScenePresentation {
    const markers: DroneSceneMarker[] = [];
    const stage = this.progress.stage;
    if (stage === "TUTORIAL") {
      const tutorialStep = this.getSnapshotSafeTutorial();
      if (tutorialStep?.id === "arming" || tutorialStep?.id === "takeoff") {
        markers.push({
          id: "tutorial-start-pad",
          kind: "start-pad",
          position: { x: 0, y: 0, z: 0 },
          radius: 1.8,
          label: "출발",
          active: true,
        });
      }
      if (tutorialStep?.id === "forward") {
        const target = bodyRelativePoint(
          this.tutorial.baselinePosition,
          this.tutorial.baselineYaw,
          "forward",
          2.5,
        );
        markers.push({
          id: "tutorial-forward-marker",
          kind: "arrow",
          position: { x: target.x, y: 0.05, z: target.z },
          radius: 1,
          label: "전진 목표",
          active: true,
        });
      }
      if (tutorialStep?.id === "roll-right" || tutorialStep?.id === "landing") {
        const target = tutorialStep.id === "roll-right"
          ? bodyRelativePoint(
              this.tutorial.baselinePosition,
              this.tutorial.baselineYaw,
              "right",
              2.2,
            )
          : this.tutorial.baselinePosition;
        markers.push({
          id: "tutorial-landing-pad",
          kind: "landing-pad",
          position: { x: target.x, y: 0, z: target.z },
          radius: 1.8,
          label: "오른쪽 착륙 지점",
          active: true,
        });
      }
    } else if (stage === "TRAINING" || stage === "CERTIFICATION") {
      const course = stage === "TRAINING"
        ? BASIC_TRAINING_COURSE
        : CERTIFICATION_COURSE;
      markers.push({
        id: `${course.id}-start`,
        kind: "start-pad",
        position: course.startPosition,
        radius: 1.8,
        label: "출발",
      });
      for (const [index, gate] of course.gates.entries()) {
        markers.push({
          id: gate.id,
          kind: "gate",
          position: gate.center,
          normal: gate.normal,
          radius: gate.outerRadius,
          label: `Gate ${gate.order}`,
          active: index === this.courseSnapshot.nextGateIndex,
          completed: index < this.courseSnapshot.nextGateIndex,
        });
      }
      for (const obstacle of course.obstacles) {
        markers.push({
          id: obstacle.id,
          kind: "building",
          position: volumeCenter(obstacle.volume),
          size: volumeSize(obstacle.volume),
          radius: volumeRadius(obstacle.volume),
          label: obstacle.label,
        });
      }
      markers.push({
        id: course.landingZone.id,
        kind: "landing-pad",
        position: course.landingZone.center,
        radius: landingZoneRadius(course.landingZone),
        label: "착륙",
        active: this.courseSnapshot.nextGateIndex >= course.gates.length,
      });
    } else if (stage === "MISSION" && this.mission && this.missionRuntime) {
      const selectedPlan = this.mission.plans.find(
        (plan) => plan.id === this.missionRuntime?.selectedPlanId,
      );
      if (selectedPlan) {
        markers.push({
          id: `${this.mission.id}-selected-corridor`,
          kind: "flight-corridor",
          position: selectedPlan.waypoints[0] ?? this.mission.startPosition,
          path: selectedPlan.waypoints,
          radius: selectedPlan.corridorRadius,
          label: selectedPlan.label,
          active: this.missionRuntime.preflightConfirmed,
        });
      }
      markers.push({
        id: `${this.mission.id}-start`,
        kind: "start-pad",
        position: this.mission.startPosition,
        radius: this.mission.kind === "medical_delivery" ? 2.2 : 2.4,
        label: this.mission.kind === "medical_delivery" ? "재난 의료거점 출발장" : "현장 지휘소 출발장",
        active: !this.missionRuntime.preflightConfirmed,
      });
      if (this.mission.kind === "medical_delivery") {
        // Buildings are scenery beside the operational pads, never on top of
        // the drone or landing trigger. This keeps both the camera and the
        // collision model readable from the first frame.
        markers.push(
          {
            id: "medical-hospital-a",
            kind: "hospital",
            position: { x: 8.8, y: 1.8, z: 1.2 },
            size: { x: 5.2, y: 3.6, z: 4.4 },
            radius: 2.2,
            label: "재난 의료거점",
            variant: "hospital-a",
          },
          {
            id: "medical-hospital-b",
            kind: "hospital",
            position: { x: 14.6, y: 1.65, z: 25.8 },
            size: { x: 4.8, y: 3.3, z: 4.6 },
            radius: 2.2,
            label: "임시 응급진료소",
            variant: "hospital-b",
          },
        );
      } else {
        markers.push({
          id: "search-command-center",
          kind: "command-center",
          position: { x: -10.2, y: 1.35, z: 2.4 },
          size: { x: 4, y: 2.7, z: 3.4 },
          radius: 2,
          label: "현장 지휘소",
          variant: "disaster",
        });
      }
      for (const obstacle of this.mission.obstacles) {
        markers.push({
          id: obstacle.id,
          kind:
            this.mission.kind === "disaster_search"
              ? "damaged-building"
              : "rock-slope",
          position: volumeCenter(obstacle.volume),
          size: volumeSize(obstacle.volume),
          radius: volumeRadius(obstacle.volume),
          label: obstacle.label,
          variant: this.mission.kind === "disaster_search" ? "disaster" : "city",
        });
      }
      for (const target of this.mission.targets) {
        if (target.action === "landing") continue;
        markers.push({
          id: target.id,
          kind: "search-target",
          position: target.position,
          radius: target.activationRadius,
          label: target.label,
          active: !this.missionRuntime.foundTargetIds.includes(target.id),
          completed: this.missionRuntime.foundTargetIds.includes(target.id),
        });
      }
      for (const zone of this.mission.windZones) {
        markers.push({
          id: zone.id,
          kind: "wind-zone",
          position: volumeCenter(zone.volume),
          radius: volumeRadius(zone.volume),
          label: zone.label,
          active: this.missionRuntime.activeWindZoneIds.includes(zone.id),
        });
      }
      markers.push({
        id: this.mission.landingZone.id,
        kind: "landing-pad",
        position: this.mission.landingZone.center,
        radius: landingZoneRadius(this.mission.landingZone),
        label: this.mission.landingZone.label,
        active:
          this.mission.kind === "medical_delivery"
            ? this.missionRuntime.operationPhase === "FLIGHT" ||
              this.missionRuntime.operationPhase === "HANDOVER"
            : this.missionRuntime.foundTargetIds.length >=
              this.mission.targets.filter((target) => target.required).length,
      });
    }
    return {
      markers,
      collisionPulse: this.collisionPulseUntil > this.stageElapsedSeconds,
      environment:
        stage === "MISSION" && this.mission?.kind === "medical_delivery"
          ? "medical-delivery-zone"
          : stage === "MISSION" && this.mission?.kind === "disaster_search"
            ? "disaster-zone"
            : "training",
      cargoState:
        stage === "MISSION" &&
        this.mission?.kind === "medical_delivery" &&
        this.missionRuntime?.preflightConfirmed
          ? this.missionRuntime.operationPhase === "HANDOVER"
            ? "handover"
            : "loaded"
          : "none",
    };
  }
}

export { MISSION_DEFINITIONS };

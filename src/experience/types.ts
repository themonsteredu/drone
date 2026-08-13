/**
 * Hardware- and renderer-neutral domain types for the educational experience.
 *
 * Coordinates follow the simulator contract: +Y is up and +Z is forward when
 * the aircraft heading is zero. The experience layer never reads USB packets
 * and never mutates a DroneVisual.
 */

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export type ExperienceStage =
  | "START"
  | "CONNECTING"
  | "CONTROL_GUIDE"
  | "TUTORIAL"
  | "TRAINING"
  | "CERTIFICATION"
  | "QUALIFIED"
  | "MISSION_SELECT"
  | "MISSION"
  | "RESULT";

export type TutorialCriterion =
  | { kind: "flight_event"; event: "armed" | "takeoff" | "landed" }
  | { kind: "minimum_altitude"; meters: number }
  | { kind: "yaw_delta"; radians: number; direction: "right" | "left" }
  | { kind: "position_delta"; axis: "x" | "z"; meters: number }
  | {
      kind: "body_relative_distance";
      direction: "forward" | "right";
      meters: number;
    }
  | { kind: "enter_volume"; volume: TriggerVolume };

export interface TutorialStepDefinition {
  id: string;
  order: number;
  title: string;
  instruction: string;
  successMessage: string;
  criterion: TutorialCriterion;
}

export interface SphereVolume {
  shape: "sphere";
  center: Vector3;
  radius: number;
}

export interface BoxVolume {
  shape: "box";
  min: Vector3;
  max: Vector3;
}

export type TriggerVolume = SphereVolume | BoxVolume;

export interface GateDefinition {
  id: string;
  label: string;
  order: number;
  center: Vector3;
  /** Unit normal pointing in the required travel direction. */
  normal: Vector3;
  /** Clear opening; the drone radius is subtracted during pass detection. */
  innerRadius: number;
  /** Outer edge of the visible ring. */
  outerRadius: number;
  /** Trigger thickness on either side of the ring plane. */
  halfThickness: number;
}

export interface ObstacleDefinition {
  id: string;
  label: string;
  volume: TriggerVolume;
}

export interface LandingBand {
  maxRadius: number;
  score: 100 | 80 | 60 | 40;
  label: "중앙" | "안쪽" | "중간" | "가장자리";
}

export interface LandingZoneDefinition {
  id: string;
  label: string;
  center: Vector3;
  bands: readonly LandingBand[];
  /** Maximum vertical separation accepted as ground contact. */
  maxHeight: number;
}

export interface LandingAssessment {
  zoneId: string;
  score: 100 | 80 | 60 | 40 | 0;
  label: "중앙" | "안쪽" | "중간" | "가장자리" | "범위 밖";
  horizontalDistance: number;
  success: boolean;
}

export interface CourseDefinition {
  id: string;
  title: string;
  description: string;
  startPosition: Vector3;
  gates: readonly GateDefinition[];
  obstacles: readonly ObstacleDefinition[];
  landingZone: LandingZoneDefinition;
}

export interface WindZoneDefinition {
  id: string;
  label: string;
  volume: TriggerVolume;
  /** Acceleration/force hint consumed by the flight integration layer. */
  force: Vector3;
  /** Optional gentle variation, never randomness, for deterministic lessons. */
  pulse?: { amplitude: number; frequencyHz: number };
}

export type MissionKind = "medical_delivery" | "disaster_search";

export type MissionOperationPhase =
  | "BRIEFING"
  | "PREFLIGHT"
  | "FLIGHT"
  | "HANDOVER"
  | "RETURNING"
  | "COMPLETED";

export interface MissionPlanDefinition {
  id: string;
  label: string;
  summary: string;
  badge: string;
  distanceLabel: string;
  durationLabel: string;
  energyLabel: string;
  riskLabel: string;
  /** Lightweight world-space guide used for corridor awareness and rendering. */
  waypoints: readonly Vector3[];
  corridorRadius: number;
  recommended?: boolean;
}

export interface MissionPayloadDefinition {
  label: string;
  detail: string;
  handlingNote: string;
}

export interface MissionTargetDefinition {
  id: string;
  label: string;
  position: Vector3;
  activationRadius: number;
  action: "mission_action" | "landing";
  required: boolean;
}

export interface MissionScoringRules {
  safetyWeight: number;
  stabilityWeight: number;
  landingWeight: number;
  objectiveWeight: number;
  timeWeight: number;
  collisionPenaltyPercent: number;
  emergencyPenaltyPercent: number;
}

export interface MissionDefinition {
  id: string;
  kind: MissionKind;
  title: string;
  description: string;
  briefing: string;
  roleTitle: string;
  dispatchLabel: string;
  plans: readonly MissionPlanDefinition[];
  preflightChecklist: readonly string[];
  payload?: MissionPayloadDefinition;
  startPosition: Vector3;
  targets: readonly MissionTargetDefinition[];
  timeLimitSeconds: number;
  batteryStartPercent: number;
  windZones: readonly WindZoneDefinition[];
  obstacles: readonly ObstacleDefinition[];
  landingZone: LandingZoneDefinition;
  scoringRules: MissionScoringRules;
}

export interface BatteryConfig {
  capacityPercent: number;
  idleDrainPerSecond: number;
  movementDrainPerSecond: number;
  throttleDrainPerSecond: number;
  speedMultipliers: Readonly<Record<"beginner" | "normal" | "high", number>>;
  lowThresholdPercent: number;
}

export interface BatteryState {
  percent: number;
  low: boolean;
  depleted: boolean;
}

export type ExperienceEvent =
  | { type: "controllerConnected"; atSeconds: number }
  | { type: "controllerDisconnected"; atSeconds: number }
  | { type: "armingStarted"; atSeconds: number }
  | { type: "armed"; atSeconds: number }
  | { type: "takeoff"; atSeconds: number }
  | { type: "landing"; atSeconds: number }
  | {
      type: "landed";
      atSeconds: number;
      assessment?: LandingAssessment;
    }
  | { type: "gatePassed"; atSeconds: number; gateId: string; order: number }
  | {
      type: "collision";
      atSeconds: number;
      colliderId: string;
      colliderKind: "ring" | "obstacle";
    }
  | { type: "missionActionPressed"; atSeconds: number }
  | { type: "targetFound"; atSeconds: number; targetId: string; count: number; total: number }
  | { type: "missionCompleted"; atSeconds: number; missionId: string }
  | { type: "emergencyActivated"; atSeconds: number }
  | { type: "windEntered"; atSeconds: number; windZoneId: string }
  | { type: "windExited"; atSeconds: number; windZoneId: string }
  | { type: "batteryLow"; atSeconds: number; percent: number }
  | { type: "batteryDepleted"; atSeconds: number };

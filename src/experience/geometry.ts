import type {
  CourseDefinition,
  ExperienceEvent,
  GateDefinition,
  LandingAssessment,
  LandingZoneDefinition,
  ObstacleDefinition,
  TriggerVolume,
  Vector3,
} from "./types";

const EPSILON = 1e-9;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function distance3(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function isPointInsideVolume(point: Vector3, volume: TriggerVolume): boolean {
  if (volume.shape === "sphere") {
    return distance3(point, volume.center) <= volume.radius;
  }

  return (
    point.x >= volume.min.x &&
    point.x <= volume.max.x &&
    point.y >= volume.min.y &&
    point.y <= volume.max.y &&
    point.z >= volume.min.z &&
    point.z <= volume.max.z
  );
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addScaled(start: Vector3, direction: Vector3, scale: number): Vector3 {
  return {
    x: start.x + direction.x * scale,
    y: start.y + direction.y * scale,
    z: start.z + direction.z * scale,
  };
}

function normalized(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= EPSILON) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export type GateIntersection =
  | { kind: "none" }
  | { kind: "wrong_direction" }
  | { kind: "clear"; point: Vector3; radialDistance: number }
  | { kind: "ring"; point: Vector3; radialDistance: number };

/** True while the drone center is inside the gate's central trigger volume. */
export function isPointInsideGateTrigger(
  point: Vector3,
  gate: GateDefinition,
  droneRadius = 0,
): boolean {
  const normal = normalized(gate.normal);
  const offset = subtract(point, gate.center);
  const planeDistance = dot(offset, normal);
  const radialVector = {
    x: offset.x - normal.x * planeDistance,
    y: offset.y - normal.y * planeDistance,
    z: offset.z - normal.z * planeDistance,
  };
  const safeRadius = Math.max(0, gate.innerRadius - Math.max(0, droneRadius));
  return (
    Math.abs(planeDistance) <= gate.halfThickness + Math.max(0, droneRadius) &&
    Math.hypot(radialVector.x, radialVector.y, radialVector.z) <= safeRadius
  );
}

/**
 * Sweeps the drone between two frames so fast movement cannot skip a gate.
 * A pass is accepted from either side of the gate plane when the ordered gate
 * is crossed through its clear inner opening. Course order, rather than an
 * invisible one-way plane, guides the student route.
 */
export function detectGateIntersection(
  previous: Vector3,
  current: Vector3,
  gate: GateDefinition,
  droneRadius = 0.22,
): GateIntersection {
  const normal = normalized(gate.normal);
  const previousOffset = subtract(previous, gate.center);
  const currentOffset = subtract(current, gate.center);
  const previousSide = dot(previousOffset, normal);
  const currentSide = dot(currentOffset, normal);
  const movement = subtract(current, previous);
  const crossedPlane =
    ((previousSide <= 0 && currentSide >= 0) ||
      (previousSide >= 0 && currentSide <= 0)) &&
    Math.abs(currentSide - previousSide) > EPSILON;

  if (!crossedPlane) {
    return { kind: "none" };
  }

  const interpolation = clamp(-previousSide / (currentSide - previousSide), 0, 1);
  const intersection = addScaled(previous, movement, interpolation);
  const centerOffset = subtract(intersection, gate.center);
  const normalOffset = dot(centerOffset, normal);
  const radialVector = {
    x: centerOffset.x - normal.x * normalOffset,
    y: centerOffset.y - normal.y * normalOffset,
    z: centerOffset.z - normal.z * normalOffset,
  };
  const radialDistance = Math.hypot(radialVector.x, radialVector.y, radialVector.z);
  const safeOpening = Math.max(0, gate.innerRadius - Math.max(0, droneRadius));
  const collisionEdge = gate.outerRadius + Math.max(0, droneRadius);

  if (radialDistance <= safeOpening) {
    return { kind: "clear", point: intersection, radialDistance };
  }
  if (radialDistance <= collisionEdge) {
    return { kind: "ring", point: intersection, radialDistance };
  }
  return { kind: "none" };
}

function segmentIntersectsSphere(
  start: Vector3,
  end: Vector3,
  center: Vector3,
  radius: number,
): boolean {
  const segment = subtract(end, start);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared <= EPSILON) {
    return distance3(start, center) <= radius;
  }
  const projection = clamp(dot(subtract(center, start), segment) / lengthSquared, 0, 1);
  return distance3(addScaled(start, segment, projection), center) <= radius;
}

function segmentIntersectsExpandedBox(
  start: Vector3,
  end: Vector3,
  volume: Extract<TriggerVolume, { shape: "box" }>,
  expansion: number,
): boolean {
  const direction = subtract(end, start);
  let minimumTime = 0;
  let maximumTime = 1;

  for (const axis of ["x", "y", "z"] as const) {
    const minimum = volume.min[axis] - expansion;
    const maximum = volume.max[axis] + expansion;
    if (Math.abs(direction[axis]) <= EPSILON) {
      if (start[axis] < minimum || start[axis] > maximum) {
        return false;
      }
      continue;
    }

    const inverse = 1 / direction[axis];
    let near = (minimum - start[axis]) * inverse;
    let far = (maximum - start[axis]) * inverse;
    if (near > far) {
      [near, far] = [far, near];
    }
    minimumTime = Math.max(minimumTime, near);
    maximumTime = Math.min(maximumTime, far);
    if (minimumTime > maximumTime) {
      return false;
    }
  }
  return true;
}

export function segmentIntersectsObstacle(
  previous: Vector3,
  current: Vector3,
  obstacle: ObstacleDefinition,
  droneRadius = 0.22,
): boolean {
  if (obstacle.volume.shape === "sphere") {
    return segmentIntersectsSphere(
      previous,
      current,
      obstacle.volume.center,
      obstacle.volume.radius + Math.max(0, droneRadius),
    );
  }
  return segmentIntersectsExpandedBox(previous, current, obstacle.volume, Math.max(0, droneRadius));
}

export function assessLanding(
  position: Vector3,
  zone: LandingZoneDefinition,
): LandingAssessment {
  const distance = horizontalDistance(position, zone.center);
  if (Math.abs(position.y - zone.center.y) > zone.maxHeight) {
    return {
      zoneId: zone.id,
      score: 0,
      label: "범위 밖",
      horizontalDistance: distance,
      success: false,
    };
  }

  const orderedBands = [...zone.bands].sort((a, b) => a.maxRadius - b.maxRadius);
  const band = orderedBands.find((candidate) => distance <= candidate.maxRadius);
  return {
    zoneId: zone.id,
    score: band?.score ?? 0,
    label: band?.label ?? "범위 밖",
    horizontalDistance: distance,
    success: Boolean(band),
  };
}

export interface CourseTrackerSnapshot {
  nextGateIndex: number;
  passedGateIds: readonly string[];
  collisionCount: number;
}

export interface CourseUpdate {
  snapshot: CourseTrackerSnapshot;
  events: readonly ExperienceEvent[];
}

/** Ordered gate and collision detector with a short contact debounce. */
export class CourseTracker {
  private nextGateIndex = 0;
  private readonly passedGateIds = new Set<string>();
  private readonly lastCollisionAt = new Map<string, number>();
  private collisionCount = 0;

  constructor(
    private readonly course: CourseDefinition,
    private readonly droneRadius = 0.22,
    private readonly collisionCooldownSeconds = 0.75,
  ) {}

  reset(): void {
    this.nextGateIndex = 0;
    this.passedGateIds.clear();
    this.lastCollisionAt.clear();
    this.collisionCount = 0;
  }

  getSnapshot(): CourseTrackerSnapshot {
    return {
      nextGateIndex: this.nextGateIndex,
      passedGateIds: [...this.passedGateIds],
      collisionCount: this.collisionCount,
    };
  }

  update(previous: Vector3, current: Vector3, atSeconds: number): CourseUpdate {
    const events: ExperienceEvent[] = [];
    const orderedGates = [...this.course.gates].sort((a, b) => a.order - b.order);
    const expectedGate = orderedGates[this.nextGateIndex];

    for (const gate of orderedGates) {
      const intersection = detectGateIntersection(previous, current, gate, this.droneRadius);
      const insideExpectedTrigger =
        gate.id === expectedGate?.id &&
        isPointInsideGateTrigger(current, gate, this.droneRadius);
      if (intersection.kind === "ring") {
        this.recordCollision(gate.id, "ring", atSeconds, events);
      }
      if (
        gate.id === expectedGate?.id &&
        (intersection.kind === "clear" || insideExpectedTrigger)
      ) {
        this.passedGateIds.add(gate.id);
        this.nextGateIndex += 1;
        events.push({ type: "gatePassed", atSeconds, gateId: gate.id, order: gate.order });
      }
    }

    for (const obstacle of this.course.obstacles) {
      if (segmentIntersectsObstacle(previous, current, obstacle, this.droneRadius)) {
        this.recordCollision(obstacle.id, "obstacle", atSeconds, events);
      }
    }

    return { snapshot: this.getSnapshot(), events };
  }

  private recordCollision(
    colliderId: string,
    colliderKind: "ring" | "obstacle",
    atSeconds: number,
    events: ExperienceEvent[],
  ): void {
    const previousTime = this.lastCollisionAt.get(colliderId) ?? Number.NEGATIVE_INFINITY;
    if (atSeconds - previousTime < this.collisionCooldownSeconds) {
      return;
    }
    this.lastCollisionAt.set(colliderId, atSeconds);
    this.collisionCount += 1;
    events.push({ type: "collision", atSeconds, colliderId, colliderKind });
  }
}

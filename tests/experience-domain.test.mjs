import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const moduleCache = new Map();

function resolveTypeScriptModule(specifier, parentUrl) {
  const unresolved = new URL(specifier, parentUrl);
  const candidates = unresolved.pathname.endsWith(".ts")
    ? [unresolved]
    : [new URL(`${unresolved.href}.ts`), new URL(`${unresolved.href}/index.ts`)];
  const resolved = candidates.find((candidate) => existsSync(fileURLToPath(candidate)));
  if (!resolved) {
    throw new Error(`Cannot resolve ${specifier} from ${parentUrl.href}`);
  }
  return resolved;
}

function loadPureTypeScriptModule(url) {
  const key = url.href;
  if (moduleCache.has(key)) return moduleCache.get(key).exports;

  const loadedModule = { exports: {} };
  moduleCache.set(key, loadedModule);
  const source = readFileSync(url, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileURLToPath(url),
  }).outputText;
  new Function("require", "module", "exports", compiled)(
    (specifier) => {
      if (!specifier.startsWith(".")) {
        throw new Error(`Experience domain must remain dependency-free: ${specifier}`);
      }
      return loadPureTypeScriptModule(resolveTypeScriptModule(specifier, url));
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const experience = loadPureTypeScriptModule(
  new URL("../src/experience/index.ts", import.meta.url),
);
const { createMissionActivityRecord, renderMissionActivityRecord } = loadPureTypeScriptModule(
  new URL("../src/experience/activity-record.ts", import.meta.url),
);

const {
  BASIC_TRAINING_COURSE,
  CERTIFICATION_COURSE,
  CERTIFICATION_PASS_SCORE,
  CERTIFICATION_SCORE_WEIGHTS,
  CERTIFICATION_TIME_LIMIT_SECONDS,
  CourseTracker,
  DISASTER_SEARCH_MISSION,
  MEDICAL_DELIVERY_MISSION,
  MISSION_DEFINITIONS,
  MODE2_TUTORIAL_STEPS,
  TEACHER_SHORTCUTS,
  applyTeacherShortcut,
  assessLanding,
  calculateCertificationScore,
  calculateMissionResult,
  combineWindForces,
  confirmMissionPreflight,
  createBatteryState,
  createInitialExperienceProgress,
  createMissionRuntimeState,
  detectGateIntersection,
  findNearbyMissionTarget,
  isPointInsideGateTrigger,
  reduceExperienceProgress,
  selectMissionPlan,
  updateMissionPreflight,
  scoreToStars,
  segmentIntersectsObstacle,
  stepBattery,
  stepMission,
} = experience;

function createPreparedMissionState(mission) {
  const initial = createMissionRuntimeState(mission);
  let selected = selectMissionPlan(mission, initial, mission.plans[0].id);
  selected = updateMissionPreflight(mission, selected, { planReason: "강풍을 피해 안전하게 운항하려고" });
  for (const item of mission.preflightChecklist) {
    selected = updateMissionPreflight(mission, selected, { item, checked: true });
  }
  return confirmMissionPreflight(mission, selected);
}

function stepMissionAt(mission, state, position, options = {}) {
  return stepMission(mission, state, {
    elapsedSeconds: options.elapsedSeconds ?? 1,
    position,
    speedLevel: options.speedLevel ?? "normal",
    movementMagnitude: options.movementMagnitude ?? 0.3,
    throttleMagnitude: options.throttleMagnitude ?? 0.2,
    missionActionPressed: options.missionActionPressed ?? false,
    landed: options.landed ?? false,
    grounded: options.grounded ?? options.landed ?? false,
    motorsStopped: options.motorsStopped ?? options.grounded ?? options.landed ?? false,
    emergencyActivated: options.emergencyActivated ?? false,
    collisionEnabled: options.collisionEnabled,
    stabilitySample: options.stabilitySample ?? 0.9,
  });
}

test("dispatch requires every real check and a reason, and changing plans invalidates them", () => {
  const mission = MEDICAL_DELIVERY_MISSION;
  let state = selectMissionPlan(mission, createMissionRuntimeState(mission), mission.plans[0].id);
  assert.equal(confirmMissionPreflight(mission, state).preflightConfirmed, false);
  state = updateMissionPreflight(mission, state, { planReason: "   " });
  for (const item of mission.preflightChecklist) state = updateMissionPreflight(mission, state, { item, checked: true });
  assert.equal(confirmMissionPreflight(mission, state).preflightConfirmed, false);
  state = updateMissionPreflight(mission, state, { planReason: "  강풍을 피하려고  " });
  const unchecked = updateMissionPreflight(mission, state, { item: mission.preflightChecklist[0], checked: false });
  assert.equal(confirmMissionPreflight(mission, unchecked).preflightConfirmed, false);
  const changed = selectMissionPlan(mission, state, mission.plans[1].id);
  assert.deepEqual(changed.checkedPreflightItems, []);
  assert.equal(changed.planReason, "");
  assert.equal(confirmMissionPreflight(mission, changed).preflightConfirmed, false);
  const confirmed = confirmMissionPreflight(mission, state);
  assert.equal(confirmed.preflightConfirmed, true);
  assert.equal(confirmed.planReason, "강풍을 피하려고");
  assert.equal(selectMissionPlan(mission, confirmed, mission.plans[1].id), confirmed);
  assert.equal(updateMissionPreflight(mission, confirmed, { planReason: "사후 변경" }), confirmed);
  assert.equal(confirmMissionPreflight(DISASTER_SEARCH_MISSION, state), state);
});

test("handover requires current stopped ground contact and rejects the exact deadline", () => {
  const mission = MEDICAL_DELIVERY_MISSION;
  const pad = { ...mission.landingZone.center };
  const ready = stepMissionAt(mission, createPreparedMissionState(mission), pad, { landed: true }).state;
  assert.equal(ready.operationPhase, "HANDOVER");
  const spinningDown = stepMissionAt(mission, ready, pad, { grounded: true, motorsStopped: false, missionActionPressed: true });
  assert.equal(spinningDown.state.operationPhase, "HANDOVER");
  assert.equal(spinningDown.state.status, "ACTIVE");
  for (const [position, grounded] of [[{ ...pad, y: 5 }, false], [{ ...pad, x: pad.x + 10 }, true], [pad, false]]) {
    const invalid = stepMissionAt(mission, ready, position, { grounded, missionActionPressed: true });
    assert.equal(invalid.state.status, "ACTIVE");
    assert.equal(invalid.state.operationPhase, "FLIGHT");
    assert.equal(invalid.state.handoverCompleted, false);
    assert.equal(invalid.events.some((event) => event.type === "missionCompleted"), false);
    const returnedWithoutLanding = stepMissionAt(mission, invalid.state, pad, { grounded: true, missionActionPressed: true });
    assert.equal(returnedWithoutLanding.state.handoverCompleted, false);
    const relanded = stepMissionAt(mission, invalid.state, pad, { landed: true });
    assert.equal(stepMissionAt(mission, relanded.state, pad, { grounded: true, missionActionPressed: true }).state.status, "COMPLETED");
  }
  for (const delta of [0.5, 0.6]) {
    const expired = stepMissionAt(mission, { ...ready, elapsedSeconds: mission.timeLimitSeconds - 0.5 }, pad, { elapsedSeconds: delta, grounded: true, missionActionPressed: true });
    assert.equal(expired.state.status, "EXPIRED");
    assert.equal(expired.state.handoverCompleted, false);
    assert.equal(expired.events.some((event) => event.type === "missionCompleted"), false);
  }
  const done = stepMissionAt(mission, ready, pad, { grounded: true, missionActionPressed: true, landed: true });
  assert.equal(done.state.operationPhase, "COMPLETED");
  assert.equal(done.events.filter((event) => event.type === "missionCompleted").length, 1);
  const again = stepMissionAt(mission, done.state, pad, { missionActionPressed: true, grounded: true });
  assert.deepEqual(again.events, []);
});

test("activity exports preserve decisions and failed outcomes without executing student text", () => {
  const mission = MEDICAL_DELIVERY_MISSION;
  const state = { ...createPreparedMissionState(mission), status: "EXPIRED", elapsedSeconds: 180, collisionCount: 2 };
  const student = { participant: '<img src=x onerror="alert(1)">', reflection: "다음엔 <script>alert(1)</script> & 속도 줄이기", practice: true };
  const stamp = { id: "test-record", recordedAt: "2026-09-06T03:00:00.000Z" };
  const record = createMissionActivityRecord(mission, state, student, stamp);
  assert.equal(record.result.completed, false);
  assert.equal(record.outcome.status, "EXPIRED");
  assert.equal(record.plan.reason, state.planReason);
  assert.ok(record.preflight.every((item) => item.checked));
  state.collisionCount = 9;
  assert.equal(record.outcome.collisionCount, 2);
  const html = renderMissionActivityRecord(record);
  assert.match(html, /제한 시간 종료/);
  assert.match(html, /교사 점검 모드/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img|<iframe|https?:\/\//i);
  assert.match(html, /default-src 'none'/);
  assert.throws(() => createMissionActivityRecord(mission, createPreparedMissionState(mission), student, stamp));
  assert.throws(() => createMissionActivityRecord(mission, state, { ...student, participant: " " }, stamp));
  assert.throws(() => createMissionActivityRecord(DISASTER_SEARCH_MISSION, state, student, stamp));
});

test("tutorial is an ordered six-step Mode 2 flight activity, not a checklist", () => {
  assert.equal(MODE2_TUTORIAL_STEPS.length, 6);
  assert.deepEqual(
    MODE2_TUTORIAL_STEPS.map((step) => step.id),
    ["arming", "takeoff", "yaw-right", "forward", "roll-right", "landing"],
  );
  assert.match(MODE2_TUTORIAL_STEPS[0].instruction, /벌려 2초/);
  assert.equal(MODE2_TUTORIAL_STEPS[1].criterion.kind, "minimum_altitude");
  assert.equal(MODE2_TUTORIAL_STEPS[2].criterion.direction, "right");
});

test("training and certification courses expose three ordered gates and precision landing", () => {
  assert.equal(BASIC_TRAINING_COURSE.gates.length, 3);
  assert.deepEqual(BASIC_TRAINING_COURSE.gates.map((gate) => gate.order), [1, 2, 3]);
  assert.equal(CERTIFICATION_COURSE.gates.length, 3);
  assert.deepEqual(
    BASIC_TRAINING_COURSE.landingZone.bands.map((band) => band.score),
    [100, 80, 60, 40],
  );
  for (const gate of BASIC_TRAINING_COURSE.gates) {
    assert.ok(
      gate.center.y > gate.outerRadius,
      `${gate.id} must be fully above the runway`,
    );
  }
  for (const obstacle of BASIC_TRAINING_COURSE.obstacles) {
    assert.equal(
      obstacle.volume.shape,
      "box",
      `${obstacle.id} must expose its exact height to the scene`,
    );
    const height = obstacle.volume.max.y - obstacle.volume.min.y;
    const tallestGate = Math.max(
      ...BASIC_TRAINING_COURSE.gates.map((gate) => gate.center.y),
    );
    // Tall enough to read as a course marker from behind the aircraft, and
    // short enough that a student can still see the ring line above it.
    assert.ok(height > tallestGate && height < tallestGate * 4);
  }
});

test("gate pass accepts either plane direction through the clear opening", () => {
  const gate = BASIC_TRAINING_COURSE.gates[0];
  // Derived from the gate so course tuning cannot silently stop exercising it.
  const before = gate.center.z - 1;
  const after = gate.center.z + 1;
  const offCenter = gate.innerRadius - 0.1;
  const clear = detectGateIntersection(
    { x: gate.center.x, y: gate.center.y, z: before },
    { x: gate.center.x, y: gate.center.y, z: after },
    gate,
  );
  const backwards = detectGateIntersection(
    { x: gate.center.x, y: gate.center.y, z: after },
    { x: gate.center.x, y: gate.center.y, z: before },
    gate,
  );
  const rim = detectGateIntersection(
    { x: gate.center.x + offCenter, y: gate.center.y, z: before },
    { x: gate.center.x + offCenter, y: gate.center.y, z: after },
    gate,
  );
  assert.equal(clear.kind, "clear");
  assert.equal(backwards.kind, "clear");
  assert.equal(rim.kind, "ring");
  assert.equal(isPointInsideGateTrigger(gate.center, gate, 0.22), true);
  assert.equal(
    isPointInsideGateTrigger({ ...gate.center, z: gate.center.z + gate.halfThickness + 0.3 }, gate),
    false,
  );
});

test("raised courses leave a drone-width route clear through every gate and mission leg", () => {
  const course = BASIC_TRAINING_COURSE;
  assert.ok(course.gates[1].center.y - course.gates[0].center.y >= 3);
  assert.ok(course.gates[1].center.y - course.gates[2].center.y >= 3);
  const trainingPath = [course.startPosition, ...course.gates.map(gate => gate.center), course.landingZone.center];
  const courses = [{ id: course.id, points: trainingPath, obstacles: course.obstacles }];
  for (const mission of MISSION_DEFINITIONS) {
    for (const plan of mission.plans) {
      courses.push({ id: plan.id, points: [mission.startPosition, ...plan.waypoints, mission.landingZone.center], obstacles: mission.obstacles });
      for (const target of mission.targets.filter(target => target.action === "mission_action")) {
        assert.ok(plan.waypoints.some(point => Math.hypot(point.x - target.position.x, point.y - target.position.y, point.z - target.position.z) < target.activationRadius));
      }
    }
  }
  for (const { id, points, obstacles } of courses) {
    for (let index = 1; index < points.length; index += 1) {
      for (const obstacle of obstacles) {
        assert.equal(segmentIntersectsObstacle(points[index - 1], points[index], obstacle, 0.45), false, `${id} leg ${index} intersects ${obstacle.id}`);
      }
    }
  }
});

test("medical route choices retain a wind-free detour and an exposed direct route at flight height", () => {
  const zone = MEDICAL_DELIVERY_MISSION.windZones[0];
  const crossesWind = plan => plan.waypoints.slice(1).some((point, index) =>
    segmentIntersectsObstacle(plan.waypoints[index], point, { id: zone.id, label: zone.label, volume: zone.volume }, 0));
  assert.equal(crossesWind(MEDICAL_DELIVERY_MISSION.plans[0]), false);
  assert.equal(crossesWind(MEDICAL_DELIVERY_MISSION.plans[1]), true);
});

test("ordered tracker ignores a later gate until the expected gate is passed", () => {
  const tracker = new CourseTracker(BASIC_TRAINING_COURSE);
  const second = BASIC_TRAINING_COURSE.gates[1];
  const skipped = tracker.update(
    { x: second.center.x, y: second.center.y, z: second.center.z - 1 },
    { x: second.center.x, y: second.center.y, z: second.center.z + 1 },
    1,
  );
  assert.equal(skipped.events.filter((event) => event.type === "gatePassed").length, 0);
  assert.equal(skipped.snapshot.nextGateIndex, 0);

  const opening = BASIC_TRAINING_COURSE.gates[0];
  const first = tracker.update(
    { x: opening.center.x, y: opening.center.y, z: opening.center.z - 1 },
    { x: opening.center.x, y: opening.center.y, z: opening.center.z + 1 },
    2,
  );
  assert.deepEqual(first.snapshot.passedGateIds, ["training-gate-1"]);
  assert.equal(first.events[0].type, "gatePassed");
});

test("the third gate sensor accepts a drone centered in its visible trigger", () => {
  const tracker = new CourseTracker(BASIC_TRAINING_COURSE);
  const [first, second, third] = BASIC_TRAINING_COURSE.gates;
  tracker.update(
    { x: first.center.x, y: first.center.y, z: first.center.z - 1 },
    { x: first.center.x, y: first.center.y, z: first.center.z + 1 },
    1,
  );
  tracker.update(
    { x: second.center.x, y: second.center.y, z: second.center.z - 1 },
    { x: second.center.x, y: second.center.y, z: second.center.z + 1 },
    2,
  );
  const update = tracker.update(third.center, third.center, 3);

  assert.deepEqual(update.snapshot.passedGateIds, [
    "training-gate-1",
    "training-gate-2",
    "training-gate-3",
  ]);
  assert.equal(
    update.events.some(
      (event) => event.type === "gatePassed" && event.gateId === third.id,
    ),
    true,
  );
});

test("ring and obstacle contacts emit debounced collision events", () => {
  const tracker = new CourseTracker(BASIC_TRAINING_COURSE);
  const gate = BASIC_TRAINING_COURSE.gates[0];
  const rimX = gate.center.x + gate.innerRadius - 0.1;
  const rimPass = [
    { x: rimX, y: gate.center.y, z: gate.center.z - 1 },
    { x: rimX, y: gate.center.y, z: gate.center.z + 1 },
  ];
  const firstHit = tracker.update(rimPass[0], rimPass[1], 1);
  const repeatedHit = tracker.update(rimPass[0], rimPass[1], 1.2);
  assert.equal(firstHit.events.some((event) => event.type === "collision"), true);
  assert.equal(repeatedHit.events.some((event) => event.type === "collision"), false);

  const obstacle = BASIC_TRAINING_COURSE.obstacles[0];
  assert.equal(
    segmentIntersectsObstacle(
      { x: obstacle.volume.min.x - 1, y: 1, z: obstacle.volume.min.z + 0.2 },
      { x: obstacle.volume.max.x + 1, y: 1, z: obstacle.volume.min.z + 0.2 },
      obstacle,
    ),
    true,
  );
});

test("landing assessment produces exact 100/80/60/40/fail bands", () => {
  const zone = BASIC_TRAINING_COURSE.landingZone;
  const position = (distance, height = 0) => ({
    x: zone.center.x + distance,
    y: height,
    z: zone.center.z,
  });
  assert.equal(assessLanding(position(0.3), zone).score, 100);
  assert.equal(assessLanding(position(0.7), zone).score, 80);
  assert.equal(assessLanding(position(1.2), zone).score, 60);
  assert.equal(assessLanding(position(1.9), zone).score, 40);
  assert.equal(assessLanding(position(2.3), zone).score, 0);
  assert.equal(assessLanding(position(0, 0.5), zone).score, 0);
});

test("certification uses the requested 30/20/20/20/10 score and 90 second limit", () => {
  assert.equal(CERTIFICATION_TIME_LIMIT_SECONDS, 90);
  assert.equal(CERTIFICATION_PASS_SCORE, 70);
  assert.deepEqual(CERTIFICATION_SCORE_WEIGHTS, {
    gates: 30,
    collisionFree: 20,
    stability: 20,
    landing: 20,
    time: 10,
  });

  const score = calculateCertificationScore({
    gatesPassed: 3,
    collisions: 0,
    stableFlightRatio: 1,
    landingAccuracyScore: 100,
    elapsedSeconds: 55,
    armed: true,
    tookOff: true,
    yawTurnCompleted: true,
    altitudeChangeCompleted: true,
    landed: true,
    emergencyActivated: false,
  });
  assert.equal(score.total, 100);
  assert.equal(score.qualified, true);
  assert.equal(score.message, "운항 자격 획득");
});

test("a high numerical exam score cannot bypass a required flight action", () => {
  const score = calculateCertificationScore({
    gatesPassed: 3,
    collisions: 0,
    stableFlightRatio: 1,
    landingAccuracyScore: 100,
    elapsedSeconds: 50,
    armed: true,
    tookOff: true,
    yawTurnCompleted: false,
    altitudeChangeCompleted: true,
    landed: true,
    emergencyActivated: false,
  });
  assert.equal(score.total, 100);
  assert.equal(score.requirementsMet, false);
  assert.equal(score.qualified, false);
  assert.equal(score.message, "다시 도전");

  const emergencyScore = calculateCertificationScore({
    gatesPassed: 3,
    collisions: 0,
    stableFlightRatio: 1,
    landingAccuracyScore: 100,
    elapsedSeconds: 50,
    armed: true,
    tookOff: true,
    yawTurnCompleted: true,
    altitudeChangeCompleted: true,
    landed: true,
    emergencyActivated: true,
  });
  assert.equal(emergencyScore.requirementsMet, false);
  assert.equal(emergencyScore.qualified, false);
});

test("battery drains gently and high-speed demand drains faster", () => {
  const start = createBatteryState(100);
  const beginner = stepBattery(start, {
    elapsedSeconds: 5,
    speedLevel: "beginner",
    movementMagnitude: 1,
    throttleMagnitude: 1,
    atSeconds: 5,
  });
  const high = stepBattery(start, {
    elapsedSeconds: 5,
    speedLevel: "high",
    movementMagnitude: 1,
    throttleMagnitude: 1,
    atSeconds: 5,
  });
  assert.ok(high.state.percent < beginner.state.percent);
  assert.ok(high.state.percent > 98, "initial missions have generous battery life");
});

test("both missions are data definitions and contain no controller button values", () => {
  assert.deepEqual(MISSION_DEFINITIONS.map((mission) => mission.id), [
    "medical-delivery",
    "disaster-search",
  ]);
  assert.equal(MEDICAL_DELIVERY_MISSION.windZones.length, 1);
  assert.equal(MEDICAL_DELIVERY_MISSION.plans.length, 2);
  assert.equal(MEDICAL_DELIVERY_MISSION.payload.label, "응급 의약품 보관함");
  assert.equal(DISASTER_SEARCH_MISSION.plans.length, 2);
  assert.equal(DISASTER_SEARCH_MISSION.targets.length, 3);
  assert.doesNotMatch(JSON.stringify(MISSION_DEFINITIONS), /buttonId|buttonBit|0x70/);
});

test("wind force is deterministic and zero outside its trigger volume", () => {
  const outside = combineWindForces(
    MEDICAL_DELIVERY_MISSION.windZones,
    { x: 0, y: 1, z: 2 },
    10,
  );
  const inside = combineWindForces(
    MEDICAL_DELIVERY_MISSION.windZones,
    { x: 0, y: 1, z: 12 },
    10,
  );
  assert.deepEqual(outside, { x: 0, y: 0, z: 0 });
  assert.ok(inside.x > 0);
  assert.equal(inside.y, 0);
});

test("mission runtime emits wind enter and exit events", () => {
  let state = createPreparedMissionState(MEDICAL_DELIVERY_MISSION);
  const entered = stepMissionAt(MEDICAL_DELIVERY_MISSION, state, { x: 0, y: 1, z: 12 });
  state = entered.state;
  assert.equal(entered.events.some((event) => event.type === "windEntered"), true);
  const exited = stepMissionAt(MEDICAL_DELIVERY_MISSION, state, { x: 0, y: 1, z: 17 });
  assert.equal(exited.events.some((event) => event.type === "windExited"), true);
});

test("mission obstacle collision fires on entry, not repeatedly while stationary", () => {
  const obstacle = MEDICAL_DELIVERY_MISSION.obstacles[0];
  const inside = { x: -3.4, y: 1, z: 7 };
  const outside = { x: 0, y: 1, z: 7 };
  let state = createPreparedMissionState(MEDICAL_DELIVERY_MISSION);

  const entered = stepMissionAt(MEDICAL_DELIVERY_MISSION, state, inside);
  state = entered.state;
  assert.equal(
    entered.events.filter((event) => event.type === "collision").length,
    1,
  );
  assert.deepEqual(state.activeObstacleIds, [obstacle.id]);
  assert.equal(state.payloadIntegrityPercent, 85);

  const stationary = stepMissionAt(
    MEDICAL_DELIVERY_MISSION,
    state,
    inside,
    { elapsedSeconds: 2 },
  );
  assert.equal(
    stationary.events.filter((event) => event.type === "collision").length,
    0,
  );

  state = stepMissionAt(
    MEDICAL_DELIVERY_MISSION,
    stationary.state,
    outside,
  ).state;
  const reentered = stepMissionAt(MEDICAL_DELIVERY_MISSION, state, inside);
  assert.equal(
    reentered.events.filter((event) => event.type === "collision").length,
    1,
  );
});

test("selected air corridor records only a new route departure edge", () => {
  let state = createPreparedMissionState(MEDICAL_DELIVERY_MISSION);
  const outside = { x: 18, y: 2, z: 10 };
  state = stepMissionAt(MEDICAL_DELIVERY_MISSION, state, outside).state;
  assert.equal(state.outsideSelectedCorridor, true);
  assert.equal(state.corridorViolationCount, 1);
  state = stepMissionAt(MEDICAL_DELIVERY_MISSION, state, outside).state;
  assert.equal(state.corridorViolationCount, 1);
  state = stepMissionAt(
    MEDICAL_DELIVERY_MISSION,
    state,
    { x: 4.8, y: 2, z: 7 },
  ).state;
  assert.equal(state.outsideSelectedCorridor, false);
});

test("grounded mission observation never emits a collision", () => {
  const state = createPreparedMissionState(MEDICAL_DELIVERY_MISSION);
  const grounded = stepMissionAt(
    MEDICAL_DELIVERY_MISSION,
    state,
    { x: -3.4, y: 0, z: 7 },
    { collisionEnabled: false },
  );
  assert.equal(
    grounded.events.some((event) => event.type === "collision"),
    false,
  );
});

test("medical delivery requires route planning, cargo handover and a successful hospital B landing", () => {
  const unprepared = createMissionRuntimeState(MEDICAL_DELIVERY_MISSION);
  const paused = stepMissionAt(MEDICAL_DELIVERY_MISSION, unprepared, { x: 0, y: 1, z: 12 });
  assert.equal(paused.state.elapsedSeconds, 0);
  assert.equal(paused.windForce.x, 0);

  let state = createPreparedMissionState(MEDICAL_DELIVERY_MISSION);
  const offPad = stepMissionAt(MEDICAL_DELIVERY_MISSION, state, { x: 4, y: 0, z: 24 }, { landed: true });
  assert.equal(offPad.state.status, "ACTIVE");
  assert.equal(offPad.state.landingAssessment.score, 0);

  state = offPad.state;
  const delivered = stepMissionAt(
    MEDICAL_DELIVERY_MISSION,
    state,
    { x: 8.1, y: 0, z: 24 },
    { landed: true },
  );
  assert.equal(delivered.state.status, "ACTIVE");
  assert.equal(delivered.state.operationPhase, "HANDOVER");
  const handedOver = stepMissionAt(
    MEDICAL_DELIVERY_MISSION,
    delivered.state,
    { x: 8.1, y: 0, z: 24 },
    { missionActionPressed: true, grounded: true },
  );
  assert.equal(handedOver.state.status, "COMPLETED");
  assert.equal(handedOver.state.handoverCompleted, true);
  assert.equal(handedOver.state.foundTargetIds.includes("hospital-b"), true);
  assert.equal(handedOver.events.some((event) => event.type === "missionCompleted"), true);

  const deadlineState = {
    ...createPreparedMissionState(MEDICAL_DELIVERY_MISSION),
    elapsedSeconds: MEDICAL_DELIVERY_MISSION.timeLimitSeconds - 0.1,
  };
  const lateLanding = stepMissionAt(
    MEDICAL_DELIVERY_MISSION,
    deadlineState,
    { x: 8.1, y: 0, z: 24 },
    { landed: true, elapsedSeconds: 0.1 },
  );
  assert.equal(lateLanding.state.status, "EXPIRED");
  assert.equal(
    lateLanding.events.some((event) => event.type === "missionCompleted"),
    false,
  );
});

test("mission action emits a common event and finds a nearby search target once", () => {
  let state = createPreparedMissionState(DISASTER_SEARCH_MISSION);
  const target = DISASTER_SEARCH_MISSION.targets[0];
  assert.equal(findNearbyMissionTarget(DISASTER_SEARCH_MISSION, target.position)?.id, target.id);
  const found = stepMissionAt(DISASTER_SEARCH_MISSION, state, target.position, {
    missionActionPressed: true,
  });
  state = found.state;
  assert.deepEqual(
    found.events.filter((event) => event.type === "missionActionPressed" || event.type === "targetFound").map((event) => event.type),
    ["missionActionPressed", "targetFound"],
  );

  const duplicate = stepMissionAt(DISASTER_SEARCH_MISSION, state, target.position, {
    missionActionPressed: true,
  });
  assert.equal(duplicate.events.filter((event) => event.type === "targetFound").length, 0);
});

test("disaster search requires all three targets and a return landing", () => {
  let state = createPreparedMissionState(DISASTER_SEARCH_MISSION);
  for (const target of DISASTER_SEARCH_MISSION.targets) {
    state = stepMissionAt(DISASTER_SEARCH_MISSION, state, target.position, {
      missionActionPressed: true,
    }).state;
  }
  assert.equal(state.status, "RETURNING");
  assert.equal(state.foundTargetIds.length, 3);

  const returned = stepMissionAt(
    DISASTER_SEARCH_MISSION,
    state,
    { x: 0.1, y: 0, z: 0 },
    { landed: true },
  );
  assert.equal(returned.state.status, "COMPLETED");
  assert.equal(returned.events.some((event) => event.type === "missionCompleted"), true);
});

test("result calculation returns category stars, total score and activity-based profile", () => {
  let state = createPreparedMissionState(DISASTER_SEARCH_MISSION);
  for (const target of DISASTER_SEARCH_MISSION.targets) {
    state = stepMissionAt(DISASTER_SEARCH_MISSION, state, target.position, {
      missionActionPressed: true,
      stabilitySample: 1,
    }).state;
  }
  state = stepMissionAt(
    DISASTER_SEARCH_MISSION,
    state,
    { x: 0.05, y: 0, z: 0 },
    { landed: true, stabilitySample: 1 },
  ).state;
  const result = calculateMissionResult(DISASTER_SEARCH_MISSION, state);
  assert.equal(result.completed, true);
  assert.equal(result.objective.score, 100);
  assert.equal(result.landing.score, 100);
  assert.equal(result.profileLabel, "탐색 전문형");
  assert.ok(result.totalScore >= 90);
  assert.match(result.careerMessage, /현장 위험.*수색 순서.*비행 경로.*구조팀/);
  assert.equal(scoreToStars(89), 4);
  assert.equal(scoreToStars(90), 5);
});

  test("student experience reducer follows connection, tutorial, training, exam and mission stages", () => {
    let progress = createInitialExperienceProgress();
    progress = reduceExperienceProgress(progress, { type: "controllerReady" });
    assert.equal(progress.stage, "START");
    assert.equal(progress.controllerReady, true);
    progress = reduceExperienceProgress(progress, { type: "start" });
    assert.equal(progress.stage, "CONNECTING");
    progress = reduceExperienceProgress(progress, { type: "controllerReady" });
  assert.equal(progress.stage, "CONTROL_GUIDE");
  progress = reduceExperienceProgress(progress, { type: "beginTutorial" });
  for (let index = 0; index < MODE2_TUTORIAL_STEPS.length; index += 1) {
    progress = reduceExperienceProgress(progress, {
      type: "tutorialStepCompleted",
      totalSteps: MODE2_TUTORIAL_STEPS.length,
    });
  }
  assert.equal(progress.stage, "TRAINING");
  progress = reduceExperienceProgress(progress, { type: "trainingCompleted" });
  assert.equal(progress.stage, "CERTIFICATION");
});

test("teacher shortcuts expose all requested reset and direct-start actions as effects", () => {
  assert.deepEqual(
    TEACHER_SHORTCUTS.map((shortcut) => shortcut.id),
    [
      "reset_training",
      "start_certification",
      "start_medical_mission",
      "start_disaster_search",
      "reset_battery",
      "reset_drone_position",
    ],
  );
  const initial = createInitialExperienceProgress();
  const mission = applyTeacherShortcut(initial, "start_medical_mission");
  assert.equal(mission.state.stage, "MISSION");
  assert.equal(mission.state.selectedMissionId, "medical-delivery");
  assert.equal(mission.effects.resetBattery, true);
  assert.equal(mission.effects.resetDronePosition, true);

  const battery = applyTeacherShortcut(mission.state, "reset_battery");
  assert.equal(battery.state, mission.state);
  assert.equal(battery.effects.resetBattery, true);
  assert.equal(battery.effects.resetFlight, false);
});

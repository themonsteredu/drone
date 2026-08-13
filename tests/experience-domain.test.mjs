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
  createBatteryState,
  createInitialExperienceProgress,
  createMissionRuntimeState,
  detectGateIntersection,
  findNearbyMissionTarget,
  isPointInsideGateTrigger,
  reduceExperienceProgress,
  scoreToStars,
  segmentIntersectsObstacle,
  stepBattery,
  stepMission,
} = experience;

function stepMissionAt(mission, state, position, options = {}) {
  return stepMission(mission, state, {
    elapsedSeconds: options.elapsedSeconds ?? 1,
    position,
    speedLevel: options.speedLevel ?? "normal",
    movementMagnitude: options.movementMagnitude ?? 0.3,
    throttleMagnitude: options.throttleMagnitude ?? 0.2,
    missionActionPressed: options.missionActionPressed ?? false,
    landed: options.landed ?? false,
    emergencyActivated: options.emergencyActivated ?? false,
    collisionEnabled: options.collisionEnabled,
    stabilitySample: options.stabilitySample ?? 0.9,
  });
}

test("tutorial is an ordered six-step Mode 2 flight activity, not a checklist", () => {
  assert.equal(MODE2_TUTORIAL_STEPS.length, 6);
  assert.deepEqual(
    MODE2_TUTORIAL_STEPS.map((step) => step.id),
    ["arming", "takeoff", "yaw-right", "forward", "roll-right", "landing"],
  );
  assert.match(MODE2_TUTORIAL_STEPS[0].instruction, /3초/);
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
    assert.equal(obstacle.volume.max.y - obstacle.volume.min.y, 12);
  }
});

test("gate pass requires a forward plane crossing through the clear opening", () => {
  const gate = BASIC_TRAINING_COURSE.gates[0];
  const clear = detectGateIntersection(
    { x: 0, y: gate.center.y, z: 4 },
    { x: 0, y: gate.center.y, z: 6 },
    gate,
  );
  const backwards = detectGateIntersection(
    { x: 0, y: gate.center.y, z: 6 },
    { x: 0, y: gate.center.y, z: 4 },
    gate,
  );
  const rim = detectGateIntersection(
    { x: 1.5, y: gate.center.y, z: 4 },
    { x: 1.5, y: gate.center.y, z: 6 },
    gate,
  );
  assert.equal(clear.kind, "clear");
  assert.equal(backwards.kind, "wrong_direction");
  assert.equal(rim.kind, "ring");
  assert.equal(isPointInsideGateTrigger(gate.center, gate, 0.22), true);
  assert.equal(
    isPointInsideGateTrigger({ ...gate.center, z: gate.center.z + gate.halfThickness + 0.3 }, gate),
    false,
  );
});

test("ordered tracker ignores a later gate until the expected gate is passed", () => {
  const tracker = new CourseTracker(BASIC_TRAINING_COURSE);
  const skipped = tracker.update(
    { x: 2.2, y: 1.7, z: 9 },
    { x: 2.2, y: 1.7, z: 11 },
    1,
  );
  assert.equal(skipped.events.filter((event) => event.type === "gatePassed").length, 0);
  assert.equal(skipped.snapshot.nextGateIndex, 0);

  const first = tracker.update(
    { x: 0, y: BASIC_TRAINING_COURSE.gates[0].center.y, z: 4 },
    { x: 0, y: BASIC_TRAINING_COURSE.gates[0].center.y, z: 6 },
    2,
  );
  assert.deepEqual(first.snapshot.passedGateIds, ["training-gate-1"]);
  assert.equal(first.events[0].type, "gatePassed");
});

test("ring and obstacle contacts emit debounced collision events", () => {
  const tracker = new CourseTracker(BASIC_TRAINING_COURSE);
  const gateY = BASIC_TRAINING_COURSE.gates[0].center.y;
  const firstHit = tracker.update(
    { x: 1.5, y: gateY, z: 4 },
    { x: 1.5, y: gateY, z: 6 },
    1,
  );
  const repeatedHit = tracker.update(
    { x: 1.5, y: gateY, z: 4 },
    { x: 1.5, y: gateY, z: 6 },
    1.2,
  );
  assert.equal(firstHit.events.some((event) => event.type === "collision"), true);
  assert.equal(repeatedHit.events.some((event) => event.type === "collision"), false);

  const obstacle = BASIC_TRAINING_COURSE.obstacles[0];
  assert.equal(
    segmentIntersectsObstacle(
      { x: -3, y: 1, z: 7.4 },
      { x: -1.5, y: 1, z: 7.4 },
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
  let state = createMissionRuntimeState(MEDICAL_DELIVERY_MISSION);
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
  let state = createMissionRuntimeState(MEDICAL_DELIVERY_MISSION);

  const entered = stepMissionAt(MEDICAL_DELIVERY_MISSION, state, inside);
  state = entered.state;
  assert.equal(
    entered.events.filter((event) => event.type === "collision").length,
    1,
  );
  assert.deepEqual(state.activeObstacleIds, [obstacle.id]);

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

test("grounded mission observation never emits a collision", () => {
  const state = createMissionRuntimeState(MEDICAL_DELIVERY_MISSION);
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

test("medical delivery completes only on a successful hospital B landing", () => {
  let state = createMissionRuntimeState(MEDICAL_DELIVERY_MISSION);
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
  assert.equal(delivered.state.status, "COMPLETED");
  assert.equal(delivered.state.foundTargetIds.includes("hospital-b"), true);
  assert.equal(delivered.events.some((event) => event.type === "missionCompleted"), true);

  const deadlineState = {
    ...createMissionRuntimeState(MEDICAL_DELIVERY_MISSION),
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
  let state = createMissionRuntimeState(DISASTER_SEARCH_MISSION);
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
  let state = createMissionRuntimeState(DISASTER_SEARCH_MISSION);
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
  let state = createMissionRuntimeState(DISASTER_SEARCH_MISSION);
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
  assert.match(result.careerMessage, /안전.*경로.*환경 변화.*임무 성공/);
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

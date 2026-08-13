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
  const resolved = candidates.find((candidate) =>
    existsSync(fileURLToPath(candidate)),
  );
  if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
  return resolved;
}

function loadTypeScriptModule(url) {
  if (moduleCache.has(url.href)) return moduleCache.get(url.href).exports;
  const loadedModule = { exports: {} };
  moduleCache.set(url.href, loadedModule);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileURLToPath(url),
  }).outputText;
  new Function("require", "module", "exports", compiled)(
    (specifier) => {
      if (!specifier.startsWith(".")) {
        throw new Error(`Unexpected runtime dependency: ${specifier}`);
      }
      return loadTypeScriptModule(resolveTypeScriptModule(specifier, url));
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const { ExperienceCoordinator } = loadTypeScriptModule(
  new URL("../src/simulator/experience-coordinator.ts", import.meta.url),
);
const { BASIC_TRAINING_COURSE } = loadTypeScriptModule(
  new URL("../src/experience/training.ts", import.meta.url),
);
const PAD = BASIC_TRAINING_COURSE.landingZone.center;

function flightState({
  phase = "READY",
  x = 0,
  y = 0,
  z = 0,
  yaw = 0,
} = {}) {
  return {
    phase,
    position: { x, y, z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw,
    yawRate: 0,
    tilt: { pitch: 0, roll: 0 },
    smoothedInput: { throttle: 0, yaw: 0, pitch: 0, roll: 0 },
    rotorSpeed: phase === "READY" ? 0 : 1,
    takeoffYaw: 0,
    emergencyLatched: false,
    groundLowThrottleSeconds: 0,
  };
}

function prepareSelectedMission(coordinator) {
  const mission = coordinator.getSnapshot().mission;
  assert.ok(mission);
  coordinator.chooseMissionPlan(mission.plans[0].id);
  coordinator.confirmMissionDispatch();
}

test("coordinates the full hands-on tutorial into the training stage", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);

  coordinator.start(false);
  assert.equal(coordinator.getSnapshot().progress.stage, "CONNECTING");

  coordinator.step(initial, true, 0.016, "normal");
  assert.equal(coordinator.getSnapshot().progress.stage, "CONTROL_GUIDE");

  coordinator.beginTutorial(initial);
  assert.equal(coordinator.getSnapshot().progress.stage, "TUTORIAL");

  coordinator.step(flightState({ phase: "ARMED" }), true, 0.016, "normal");
  coordinator.step(
    flightState({ phase: "FLIGHT", y: 1.05 }),
    true,
    0.016,
    "normal",
  );
  coordinator.step(
    // A turn the student sees as "right" decreases internal yaw.
    flightState({ phase: "FLIGHT", y: 1.05, yaw: -Math.PI / 2 }),
    true,
    0.016,
    "normal",
  );
  const forwardScene = coordinator.getSnapshot().scene;
  assert.equal(
    forwardScene.markers.some((marker) => marker.id === "tutorial-start-pad"),
    false,
    "the old start pad must not compete with the current forward target",
  );
  assert.equal(
    forwardScene.markers.find(
      (marker) => marker.id === "tutorial-forward-marker",
    )?.label,
    "전진 목표",
  );
  coordinator.step(
    flightState({ phase: "FLIGHT", x: -3, y: 1.05, yaw: -Math.PI / 2 }),
    true,
    0.016,
    "normal",
  );
  coordinator.step(
    flightState({ phase: "FLIGHT", x: -3, y: 1, z: 2.5, yaw: -Math.PI / 2 }),
    true,
    0.016,
    "normal",
  );
  const landing = coordinator.step(
    flightState({ phase: "READY", x: -3, y: 0, z: 2.5, yaw: -Math.PI / 2 }),
    true,
    0.016,
    "normal",
  );

  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.progress.stage, "TRAINING");
  assert.equal(snapshot.progress.trainingCompleted, false);
  assert.equal(landing.requestFlightReset, true);
  assert.equal(snapshot.scene.markers.filter((marker) => marker.kind === "gate").length, 3);
});

test("teacher mission shortcut keeps mission action and wind outside flight visuals", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);
  coordinator.applyTeacherAction("start_disaster_search", initial);
  prepareSelectedMission(coordinator);
  coordinator.queueMissionAction();
  coordinator.step(
    flightState({ phase: "FLIGHT", x: -5, y: 1.2, z: 8 }),
    true,
    0.1,
    "normal",
  );
  const search = coordinator.getSnapshot();
  assert.deepEqual(search.missionRuntime?.foundTargetIds, ["search-target-1"]);
  assert.equal(
    search.scene.markers.find((marker) => marker.id === "search-target-1")
      ?.completed,
    true,
  );
  const elapsedBeforeBatteryReset = search.missionRuntime?.elapsedSeconds;
  coordinator.applyTeacherAction("reset_battery", flightState());
  const batteryReset = coordinator.getSnapshot();
  assert.deepEqual(batteryReset.missionRuntime?.foundTargetIds, ["search-target-1"]);
  assert.equal(
    batteryReset.missionRuntime?.elapsedSeconds,
    elapsedBeforeBatteryReset,
  );
  assert.equal(
    batteryReset.stageElapsedSeconds,
    search.stageElapsedSeconds,
  );
  assert.equal(batteryReset.missionRuntime?.battery.percent, 100);

  coordinator.applyTeacherAction("start_medical_mission", initial);
  prepareSelectedMission(coordinator);
  const wind = coordinator.step(
    flightState({ phase: "FLIGHT", x: 0, y: 1, z: 11 }),
    true,
    0.1,
    "normal",
  );
  assert.ok(wind.windForce.x > 0);
  assert.equal(wind.windForce.y, 0);
});

test("box obstacles expose exact above-ground dimensions to the 3D scene", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);
  coordinator.applyTeacherAction("start_medical_mission", initial);
  prepareSelectedMission(coordinator);

  const marker = coordinator
    .getSnapshot()
    .scene.markers.find((candidate) => candidate.id === "medical-building-1");
  assert.deepEqual(marker?.position, { x: -4.4, y: 3.25, z: 8 });
  assert.deepEqual(marker?.size, { x: 3.2, y: 6.5, z: 4 });
  assert.equal(marker.position.y - marker.size.y / 2, 0);
});

test("medical scenery keeps both hospitals clear of the operational pads", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);
  coordinator.applyTeacherAction("start_medical_mission", initial);
  assert.equal(
    coordinator.getSnapshot().scene.environment,
    "medical-delivery-zone",
  );
  assert.equal(coordinator.getSnapshot().scene.cargoState, "none");
  prepareSelectedMission(coordinator);

  const markers = coordinator.getSnapshot().scene.markers;
  const startPad = markers.find((marker) => marker.id === "medical-delivery-start");
  const hospitalA = markers.find((marker) => marker.id === "medical-hospital-a");
  const hospitalB = markers.find((marker) => marker.id === "medical-hospital-b");
  const landingPad = markers.find((marker) => marker.id === "hospital-b-pad");

  assert.equal(startPad?.kind, "start-pad");
  assert.deepEqual(startPad?.position, { x: 0, y: 0, z: 0 });
  assert.equal(hospitalA?.kind, "hospital");
  assert.deepEqual(hospitalA?.position, { x: 8.8, y: 1.8, z: 1.2 });
  assert.notDeepEqual(hospitalA?.position, startPad?.position);
  assert.equal(hospitalB?.kind, "hospital");
  assert.deepEqual(hospitalB?.position, { x: 14.6, y: 1.65, z: 25.8 });
  assert.notDeepEqual(hospitalB?.position, landingPad?.position);
  assert.equal(landingPad?.kind, "landing-pad");
  assert.deepEqual(landingPad?.position, { x: 8, y: 0, z: 24 });
  assert.equal(coordinator.getSnapshot().scene.cargoState, "loaded");
});

test("disaster search uses a damaged building and a separate field command center", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);
  coordinator.applyTeacherAction("start_disaster_search", initial);
  prepareSelectedMission(coordinator);

  const markers = coordinator.getSnapshot().scene.markers;
  assert.equal(
    markers.find((marker) => marker.id === "search-command-center")?.kind,
    "command-center",
  );
  assert.equal(
    markers.find((marker) => marker.id === "search-rubble-1")?.kind,
    "damaged-building",
  );
  assert.equal(
    markers.find((marker) => marker.id === "disaster-search-start")?.kind,
    "start-pad",
  );
  assert.equal(coordinator.getSnapshot().scene.environment, "disaster-zone");
  assert.equal(coordinator.getSnapshot().scene.cargoState, "none");
});

test("course gate visuals expose the exact trigger-plane normal", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);
  coordinator.applyTeacherAction("reset_training", initial);

  const thirdGate = coordinator
    .getSnapshot()
    .scene.markers.find((candidate) => candidate.id === "training-gate-3");
  assert.deepEqual(thirdGate?.normal, { x: 1, y: 0, z: 0 });
});

test("controller loss pauses the exam clock and STOP reset is not a landing", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);
  coordinator.applyTeacherAction("start_certification", initial);
  assert.equal(coordinator.consumeFlightResetRequest(), true);
  coordinator.synchronizeFlightState(initial);

  coordinator.step(flightState({ phase: "ARMED" }), true, 1, "normal");
  const startedAt = coordinator.getSnapshot().stageElapsedSeconds;
  coordinator.step(flightState({ phase: "FLIGHT", y: 1 }), false, 5, "normal");
  assert.equal(coordinator.getSnapshot().stageElapsedSeconds, startedAt);
  assert.equal(coordinator.getSnapshot().progress.controllerReady, false);

  coordinator.step(flightState({ phase: "STOP" }), true, 0.1, "normal");
  coordinator.step(flightState({ phase: "READY" }), true, 0.1, "normal");
  assert.equal(coordinator.getSnapshot().certificationFinished, false);
});

test("certification requires right yaw and a separate in-flight altitude change", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);
  coordinator.applyTeacherAction("start_certification", initial);
  coordinator.consumeFlightResetRequest();
  coordinator.synchronizeFlightState(initial);

  coordinator.step(flightState({ phase: "ARMED" }), true, 0.1, "normal");
  coordinator.step(
    flightState({ phase: "FLIGHT", y: 0.85, yaw: -Math.PI / 2 }),
    true,
    0.1,
    "normal",
  );
  assert.equal(coordinator.certificationMetrics.yawTurnCompleted, false);
  assert.equal(
    coordinator.certificationMetrics.altitudeChangeCompleted,
    false,
    "reaching takeoff height alone is not the separate altitude exercise",
  );

  coordinator.step(
    flightState({ phase: "FLIGHT", y: 1.7, yaw: Math.PI / 2 }),
    true,
    0.1,
    "normal",
  );
  assert.equal(coordinator.certificationMetrics.yawTurnCompleted, true);
  assert.equal(coordinator.certificationMetrics.altitudeChangeCompleted, true);
});

function crossCourseGates(coordinator) {
  // Derived from the course so ring tuning cannot quietly stop crossing them.
  const crossings = BASIC_TRAINING_COURSE.gates.map((gate) => {
    const alongX = Math.abs(gate.normal.x) > Math.abs(gate.normal.z);
    const step = (offset) => ({
      x: gate.center.x + (alongX ? offset : 0),
      y: gate.center.y,
      z: gate.center.z + (alongX ? 0 : offset),
    });
    return [step(-0.5), step(0.5)];
  });
  for (const [before, after] of crossings) {
    coordinator.step(
      flightState({ phase: "FLIGHT", ...before }),
      true,
      0.2,
      "normal",
    );
    coordinator.step(
      flightState({ phase: "FLIGHT", ...after }),
      true,
      0.2,
      "normal",
    );
  }
}

test("the complete student journey reaches both mission result screens", () => {
  const initial = flightState();
  const coordinator = new ExperienceCoordinator(initial);

  coordinator.applyTeacherAction("reset_training", initial);
  assert.equal(coordinator.consumeFlightResetRequest(), true);
  coordinator.synchronizeFlightState(initial);

  crossCourseGates(coordinator);
  coordinator.step(
    flightState({ phase: "FLIGHT", x: PAD.x, y: 0.2, z: PAD.z }),
    true,
    0.2,
    "normal",
  );
  const trainingLanding = coordinator.step(
    flightState({ phase: "READY", x: PAD.x, y: 0, z: PAD.z }),
    true,
    0.2,
    "normal",
  );
  assert.equal(coordinator.getSnapshot().progress.stage, "CERTIFICATION");
  assert.equal(trainingLanding.requestFlightReset, true);

  coordinator.synchronizeFlightState(initial);
  coordinator.step(flightState({ phase: "ARMED" }), true, 0.2, "normal");
  coordinator.step(
    flightState({ phase: "FLIGHT", y: 1 }),
    true,
    0.2,
    "normal",
  );
  crossCourseGates(coordinator);
  coordinator.step(
    flightState({ phase: "FLIGHT", x: PAD.x - 2.5, y: 1.8, z: PAD.z, yaw: Math.PI / 2 }),
    true,
    0.2,
    "normal",
  );
  coordinator.step(
    flightState({ phase: "FLIGHT", x: PAD.x, y: 0.2, z: PAD.z, yaw: Math.PI / 2 }),
    true,
    0.2,
    "normal",
  );
  coordinator.step(
    flightState({ phase: "READY", x: PAD.x, y: 0, z: PAD.z, yaw: Math.PI / 2 }),
    true,
    0.2,
    "normal",
  );
  const qualification = coordinator.getSnapshot();
  assert.equal(qualification.progress.stage, "QUALIFIED");
  assert.equal(qualification.certification?.qualified, true);

  coordinator.openMissionSelection();
  assert.equal(coordinator.getSnapshot().progress.stage, "MISSION_SELECT");
  coordinator.selectMission("medical-delivery", initial);
  prepareSelectedMission(coordinator);
  coordinator.consumeFlightResetRequest();
  coordinator.synchronizeFlightState(initial);
  coordinator.step(
    flightState({ phase: "FLIGHT", x: 8, y: 1, z: 24 }),
    true,
    1,
    "normal",
  );
  coordinator.step(
    flightState({ phase: "READY", x: 8, y: 0, z: 24 }),
    true,
    0.2,
    "normal",
  );
  coordinator.queueMissionAction();
  coordinator.step(
    flightState({ phase: "READY", x: 8, y: 0, z: 24 }),
    true,
    0.1,
    "normal",
  );
  let result = coordinator.getSnapshot();
  assert.equal(result.progress.stage, "RESULT");
  assert.equal(result.result?.completed, true);
  assert.equal(result.mission?.id, "medical-delivery");

  coordinator.openMissionSelection();
  coordinator.selectMission("disaster-search", initial);
  prepareSelectedMission(coordinator);
  coordinator.consumeFlightResetRequest();
  coordinator.synchronizeFlightState(initial);
  for (const target of [
    { x: -5, y: 1.2, z: 8 },
    { x: 5.5, y: 1.5, z: 13 },
    { x: -1, y: 1, z: 20 },
  ]) {
    coordinator.queueMissionAction();
    coordinator.step(
      flightState({ phase: "FLIGHT", ...target }),
      true,
      1,
      "normal",
    );
  }
  coordinator.step(
    flightState({ phase: "FLIGHT", y: 1 }),
    true,
    1,
    "normal",
  );
  coordinator.step(initial, true, 0.2, "normal");
  result = coordinator.getSnapshot();
  assert.equal(result.progress.stage, "RESULT");
  assert.equal(result.result?.completed, true);
  assert.equal(result.mission?.id, "disaster-search");
  assert.deepEqual(result.missionRuntime?.foundTargetIds.sort(), [
    "search-target-1",
    "search-target-2",
    "search-target-3",
  ]);
});

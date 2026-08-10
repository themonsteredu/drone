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
    flightState({ phase: "FLIGHT", y: 1.05, yaw: Math.PI / 2 }),
    true,
    0.016,
    "normal",
  );
  coordinator.step(
    flightState({ phase: "FLIGHT", x: 3, y: 1.05, yaw: Math.PI / 2 }),
    true,
    0.016,
    "normal",
  );
  coordinator.step(
    flightState({ phase: "FLIGHT", x: 3, y: 1, z: -2.5, yaw: Math.PI / 2 }),
    true,
    0.016,
    "normal",
  );
  const landing = coordinator.step(
    flightState({ phase: "READY", x: 3, y: 0, z: -2.5, yaw: Math.PI / 2 }),
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
  const wind = coordinator.step(
    flightState({ phase: "FLIGHT", x: 0, y: 1, z: 11 }),
    true,
    0.1,
    "normal",
  );
  assert.ok(wind.windForce.x > 0);
  assert.equal(wind.windForce.y, 0);
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

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const cache = new Map();
function load(path) {
  const url = typeof path === "string" ? new URL(path, import.meta.url) : path;
  if (cache.has(url.href)) return cache.get(url.href).exports;
  const loadedModule = { exports: {} };
  cache.set(url.href, loadedModule);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: url.pathname,
  }).outputText;
  new Function("require", "module", "exports", compiled)((specifier) => {
    const base = new URL(specifier, url);
    const resolved = [new URL(base.href + ".ts"), new URL(base.href + "/index.ts")].find(candidate => existsSync(candidate));
    if (!resolved) throw new Error(`Unexpected dependency: ${specifier}`);
    return load(resolved);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const { getMissionGuidance, destinationBearing } = load("../src/experience/mission-guidance.ts");
const { MEDICAL_DELIVERY_MISSION: medical, DISASTER_SEARCH_MISSION: search, createMissionRuntimeState, selectMissionPlan, confirmMissionPreflight, updateMissionPreflight } = load("../src/experience/missions.ts");
const model = load("../src/simulator/flight-model.ts");
const { FlightFeedbackTracker, touchdownSettlingOffset } = load("../src/simulator/flight-feedback.ts");
const { flightAudioLevels } = load("../src/simulator/flight-audio.ts");
const flightAt = (position, changes = {}) => ({ ...model.createInitialFlightState(), phase: "FLIGHT", mode: "flying", position, rotorSpeed: 1, ...changes });
const runtimeFor = (mission, plan = mission.plans[0].id) => {
  let runtime = selectMissionPlan(mission, createMissionRuntimeState(mission), plan);
  runtime = updateMissionPreflight(mission, runtime, { planReason: "안전한 경로를 선택했어요" });
  for (const item of mission.preflightChecklist) runtime = updateMissionPreflight(mission, runtime, { item, checked: true });
  return confirmMissionPreflight(mission, runtime);
};

test("bearings follow the aircraft nose across heading wrap and distinguish height from horizontal distance", () => {
  const position = { x: 0, y: 8, z: 0 };
  assert.equal(destinationBearing(position, 0, { x: 10, y: 1, z: 0 }).directionLabel, "기체 오른쪽");
  assert.equal(destinationBearing(position, Math.PI / 2, { x: 10, y: 1, z: 0 }).relativeBearingDegrees, 0);
  assert.equal(destinationBearing(position, -3 * Math.PI / 2, { x: 10, y: 1, z: 0 }).relativeBearingDegrees, 0);
  assert.equal(destinationBearing(position, 0, { x: 0, y: 0, z: 0 }).directionLabel, "지점 바로 위");
});

test("medical guidance respects the selected corridor and advances beyond a reached waypoint", () => {
  const safe = runtimeFor(medical);
  const origin = flightAt({ x: 0, y: 2, z: 0 });
  const first = getMissionGuidance(medical, safe, origin);
  const fast = getMissionGuidance(medical, runtimeFor(medical, "medical-fast"), origin);
  assert.equal(first.destinationLabel, "항로 경유점 1");
  assert.notEqual(first.relativeBearingDegrees, fast.relativeBearingDegrees);
  assert.ok(Math.abs(first.distanceMeters - Math.hypot(4.8, 7)) < 0.001);
  const reached = getMissionGuidance(medical, safe, flightAt({ x: 4.8, y: 2.4, z: 7 }));
  assert.equal(reached.destinationLabel, "항로 경유점 2");
  assert.ok(reached.routePercent > first.routePercent);
});

test("landing alignment, ground handover and emergency guidance stay distinct", () => {
  const runtime = runtimeFor(medical);
  const above = flightAt({ x: 8, y: 2, z: 24 });
  assert.match(getMissionGuidance(medical, runtime, above).action, /천천히 하강/);
  const handover = getMissionGuidance(medical, { ...runtime, operationPhase: "HANDOVER" }, { ...above, phase: "READY" });
  assert.equal(handover.phaseLabel, "의약품 인계");
  assert.match(handover.action, /인계/);
  const emergency = getMissionGuidance(medical, runtime, { ...above, phase: "EMERGENCY", emergencyLatched: true });
  assert.equal(emergency.tone, "warning");
  assert.match(emergency.action, /긴급 안전 착륙/);
});

test("search uses actual proximity, gives altitude guidance when too high, and returns to the command pad", () => {
  const runtime = runtimeFor(search);
  const high = getMissionGuidance(search, runtime, flightAt({ x: -5, y: 9, z: 8 }));
  assert.match(high.action, /고도로 조절/);
  assert.doesNotMatch(high.action, /전송을 누르/);
  const targetTwo = getMissionGuidance(search, runtime, flightAt({ ...search.targets[1].position }));
  assert.equal(targetTwo.destinationLabel, "탐색 지점 2");
  assert.match(targetTwo.action, /촬영·위치 전송/);
  const returning = getMissionGuidance(search, { ...runtime, foundTargetIds: search.targets.map(target => target.id), status: "RETURNING", operationPhase: "RETURNING" }, flightAt({ x: -1, y: 2, z: 20 }));
  assert.equal(returning.destinationLabel, search.landingZone.label);
  assert.equal(returning.phaseLabel, "지휘소 복귀");
  assert.match(returning.action, /복귀/);
});

test("actual assisted and manual landings emit one touchdown; resets and ground holds do not", () => {
  for (const phase of ["LANDING", "FLIGHT"]) {
    const tracker = new FlightFeedbackTracker();
    let flight = flightAt({ x: 0, y: 1.5, z: 0 }, { phase, mode: phase === "LANDING" ? "landing" : "flying" });
    tracker.update(flight);
    for (let frame = 0; frame < 600; frame += 1) {
      flight = model.stepFlightState(flight, { throttle: phase === "FLIGHT" ? -1 : 0, yaw: 0, pitch: 0, roll: 0, active: true }, 1 / 60);
      tracker.update(flight);
    }
    assert.equal(flight.position.y, 0);
    assert.equal(tracker.getSignal().sequence, 1);
    assert.ok(tracker.getSignal().strength > 0);
    tracker.update(flightAt({ x: 0, y: 5, z: 0 }));
    tracker.reset();
    tracker.update(model.createInitialFlightState());
    assert.equal(tracker.getSignal().sequence, 1);
  }
});

test("settling stays above the ground and expires; audio is silent outside an active flight", () => {
  assert.equal(touchdownSettlingOffset(-1, 1), 0);
  assert.equal(touchdownSettlingOffset(0.7, 1), 0);
  for (let t = 0; t < 0.7; t += 0.01) assert.ok(touchdownSettlingOffset(t, 1) >= 0 && touchdownSettlingOffset(t, 1) < 0.02);
  const flying = flightAt({ x: 0, y: 3, z: 0 }, { velocity: { x: 2, y: 1, z: 0 } });
  const silent = flightAudioLevels(flying, 1, false);
  assert.equal(silent.rotor, 0);
  assert.equal(silent.wind, 0);
  const active = flightAudioLevels(flying, 1, true);
  assert.ok(active.rotor > 0 && active.wind > 0);
  assert.equal(flightAudioLevels(model.createInitialFlightState(), 1, true).wind, 0);
});

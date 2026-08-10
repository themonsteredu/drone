import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadPureTypeScriptModule(url) {
  const source = readFileSync(url, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    () => {
      throw new Error("Flight physics must remain dependency-free");
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const flight = loadPureTypeScriptModule(
  new URL("../src/simulator/flight-model.ts", import.meta.url),
);

const {
  DEFAULT_EXPO,
  DEFAULT_FLIGHT_CONFIG,
  FLIGHT_PHASE,
  FLIGHT_SPEED_SCALE,
  applyExpoCurve,
  applyFlightCommand,
  applyRescaledDeadZone,
  conditionFlightControls,
  createInitialFlightState,
  resolveFlightModelConfig,
  stepFlightState,
} = flight;

const NEUTRAL = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

function advance(state, input, seconds, settings = {}, frequency = 120) {
  const frames = Math.round(seconds * frequency);
  let next = state;
  for (let index = 0; index < frames; index += 1) {
    next = stepFlightState(next, input, 1 / frequency, settings);
  }
  return next;
}

function flightState({ yaw = 0, takeoffYaw = 0 } = {}) {
  return {
    ...createInitialFlightState(),
    phase: FLIGHT_PHASE.FLIGHT,
    mode: "flying",
    position: { x: 0, y: 1.4, z: 0 },
    yaw,
    takeoffYaw,
    rotorSpeed: 1,
  };
}

test("student defaults are normal speed, 0.10 dead zone, 0.45 expo and stabilization", () => {
  assert.equal(DEFAULT_FLIGHT_CONFIG.deadZone, 0.1);
  assert.equal(DEFAULT_FLIGHT_CONFIG.expo, 0.45);
  assert.equal(DEFAULT_EXPO, 0.45);
  assert.equal(DEFAULT_FLIGHT_CONFIG.speedLevel, "normal");
  assert.equal(DEFAULT_FLIGHT_CONFIG.headless, false);
  assert.equal(DEFAULT_FLIGHT_CONFIG.stabilization, true);
  assert.deepEqual(FLIGHT_SPEED_SCALE, {
    beginner: 0.35,
    normal: 0.65,
    high: 1,
  });
});
test("rescaled dead zone removes the center while preserving full endpoint output", () => {
  assert.equal(applyRescaledDeadZone(0.1, 0.1), 0);
  assert.equal(applyRescaledDeadZone(-0.1, 0.1), 0);
  assert.ok(Math.abs(applyRescaledDeadZone(0.55, 0.1) - 0.5) < 1e-12);
  assert.ok(Math.abs(applyRescaledDeadZone(-0.55, 0.1) + 0.5) < 1e-12);
  assert.equal(applyRescaledDeadZone(1, 0.1), 1);
  assert.equal(applyRescaledDeadZone(-1, 0.1), -1);
});

test("expo softens center response without reducing either endpoint", () => {
  assert.equal(applyExpoCurve(0, 0.45), 0);
  assert.ok(applyExpoCurve(0.5, 0.45) < 0.5);
  assert.equal(applyExpoCurve(1, 0.45), 1);
  assert.equal(applyExpoCurve(-1, 0.45), -1);
  assert.ok(applyExpoCurve(0.2, 0.45) < applyExpoCurve(0.5, 0.45));
});

test("speed levels scale throttle, yaw, pitch and roll together", () => {
  const full = { throttle: 1, yaw: 1, pitch: 1, roll: 1 };
  const beginner = conditionFlightControls(full, {
    speedLevel: "beginner",
  });
  const normal = conditionFlightControls(full, { speedLevel: "normal" });
  const high = conditionFlightControls(full, { speedLevel: "high" });

  for (const axis of ["throttle", "yaw", "pitch", "roll"]) {
    assert.equal(beginner[axis], 0.35);
    assert.equal(normal[axis], 0.65);
    assert.equal(high[axis], 1);
  }
});

test("large ascent suppresses only small accidental yaw, not intentional diagonal yaw", () => {
  const accidental = conditionFlightControls(
    { ...NEUTRAL, throttle: 0.8, yaw: 0.18 },
    { speedLevel: "high" },
  );
  const intentional = conditionFlightControls(
    { ...NEUTRAL, throttle: 0.8, yaw: 0.35 },
    { speedLevel: "high" },
  );
  const yawWithoutAscent = conditionFlightControls(
    { ...NEUTRAL, throttle: 0.2, yaw: 0.18 },
    { speedLevel: "high" },
  );

  assert.equal(accidental.yaw, 0);
  assert.ok(accidental.throttle > 0);
  assert.ok(intentional.yaw > 0);
  assert.ok(intentional.throttle > 0);
  assert.ok(yawWithoutAscent.yaw > 0);
});

test("disconnected input is neutral and invalid settings resolve safely", () => {
  assert.deepEqual(
    conditionFlightControls({ ...NEUTRAL, throttle: 1, active: false }),
    NEUTRAL,
  );
  const config = resolveFlightModelConfig({
    deadZone: 5,
    expo: -1,
    sensitivity: Number.NaN,
    speedLevel: "invalid",
  });
  assert.equal(config.deadZone, 0.95);
  assert.equal(config.expo, 0);
  assert.equal(config.sensitivity, 0);
  assert.equal(config.speedLevel, "normal");
});

test("input smoothing accelerates progressively rather than jumping", () => {
  const next = stepFlightState(
    flightState(),
    { ...NEUTRAL, pitch: 1 },
    1 / 120,
    { speedLevel: "high" },
  );
  assert.ok(next.smoothedInput.pitch > 0);
  assert.ok(next.smoothedInput.pitch < 1);
  assert.ok(next.velocity.z > 0);
  assert.ok(next.velocity.z < DEFAULT_FLIGHT_CONFIG.maxHorizontalSpeed);
});

test("positive roll always means aircraft-right in the physics contract", () => {
  const right = advance(
    flightState(),
    { ...NEUTRAL, roll: 1 },
    0.8,
    { speedLevel: "high" },
  );
  const left = advance(
    flightState(),
    { ...NEUTRAL, roll: -1 },
    0.8,
    { speedLevel: "high" },
  );
  assert.ok(right.position.x > 0);
  assert.ok(left.position.x < 0);
  assert.ok(Math.abs(right.position.z) < 1e-12);
});

test("headless OFF uses aircraft heading while ON uses takeoff heading", () => {
  const facingRight = flightState({ yaw: Math.PI / 2, takeoffYaw: 0 });
  const bodyRelative = advance(
    facingRight,
    { ...NEUTRAL, pitch: 1 },
    0.8,
    { headless: false, speedLevel: "high" },
  );
  const headless = advance(
    facingRight,
    { ...NEUTRAL, pitch: 1 },
    0.8,
    { headless: true, speedLevel: "high" },
  );

  assert.ok(bodyRelative.position.x > 0.5);
  assert.ok(Math.abs(bodyRelative.position.z) < 1e-9);
  assert.ok(headless.position.z > 0.5);
  assert.ok(Math.abs(headless.position.x) < 1e-9);
  assert.equal(headless.yaw, Math.PI / 2, "headless does not disable yaw");
});

test("stabilization settles position velocity and visual tilt faster", () => {
  const moving = advance(
    flightState(),
    { ...NEUTRAL, pitch: 1, roll: 0.7 },
    0.8,
    { speedLevel: "high", stabilization: true },
  );
  const stabilized = advance(moving, NEUTRAL, 0.7, {
    speedLevel: "high",
    stabilization: true,
  });
  const direct = advance(moving, NEUTRAL, 0.7, {
    speedLevel: "high",
    stabilization: false,
  });

  const planarSpeed = (state) => Math.hypot(state.velocity.x, state.velocity.z);
  const tiltMagnitude = (state) =>
    Math.hypot(state.tilt.pitch, state.tilt.roll);
  assert.ok(planarSpeed(stabilized) < planarSpeed(direct) * 0.35);
  assert.ok(tiltMagnitude(stabilized) < tiltMagnitude(direct) * 0.2);
});

test("explicit legacy start/takeoff remains deterministic and normal landing returns ready", () => {
  const ready = createInitialFlightState();
  assert.equal(ready.phase, FLIGHT_PHASE.READY);

  const started = applyFlightCommand(ready, "start");
  assert.equal(started.phase, FLIGHT_PHASE.START);
  const spunUp = advance(
    started,
    { ...NEUTRAL, pitch: 1, throttle: 1 },
    0.5,
    { speedLevel: "high" },
  );
  assert.equal(spunUp.phase, FLIGHT_PHASE.START);
  assert.equal(spunUp.position.y, 0, "manual sticks are locked before flight");
  assert.ok(spunUp.rotorSpeed > 0.4, "rotors animate after start");

  const takeoff = applyFlightCommand(spunUp, "takeoff");
  assert.equal(takeoff.phase, FLIGHT_PHASE.TAKEOFF);
  const airborne = advance(takeoff, NEUTRAL, 4);
  assert.equal(airborne.phase, FLIGHT_PHASE.FLIGHT);
  assert.equal(airborne.position.y, 1.4);

  const landing = applyFlightCommand(airborne, "land");
  assert.equal(landing.phase, FLIGHT_PHASE.LANDING);
  const stopped = advance(landing, NEUTRAL, 6);
  assert.equal(stopped.phase, FLIGHT_PHASE.READY);
  assert.equal(stopped.position.y, 0);
  assert.deepEqual(stopped.velocity, { x: 0, y: 0, z: 0 });
  const rotorsStopped = advance(stopped, NEUTRAL, 2);
  assert.ok(rotorsStopped.rotorSpeed < 0.001);
});

test("takeoff captures heading for later headless control", () => {
  const started = {
    ...applyFlightCommand(createInitialFlightState(), "start"),
    yaw: 1.17,
  };
  const takeoff = applyFlightCommand(started, "takeoff");
  assert.equal(takeoff.takeoffYaw, 1.17);
});

test("emergency performs a controlled landing, latches, then resets safely", () => {
  const moving = advance(
    flightState(),
    { ...NEUTRAL, pitch: 1, roll: 1, yaw: 1 },
    0.5,
    { speedLevel: "high" },
  );
  const emergency = applyFlightCommand(moving, "emergency");
  assert.equal(emergency.phase, FLIGHT_PHASE.EMERGENCY);
  assert.equal(emergency.velocity.x, 0);
  assert.equal(emergency.velocity.z, 0);
  assert.equal(emergency.yawRate, 0);
  assert.equal(emergency.emergencyLatched, true);

  const descending = advance(emergency, NEUTRAL, 0.25);
  assert.ok(descending.position.y < emergency.position.y);
  assert.ok(descending.position.y > 1, "safe landing does not drop instantly");

  const grounded = advance(descending, NEUTRAL, 5);
  assert.equal(grounded.phase, FLIGHT_PHASE.STOP);
  assert.equal(grounded.position.y, 0);
  assert.equal(applyFlightCommand(grounded, "start").phase, FLIGHT_PHASE.STOP);
  assert.deepEqual(
    applyFlightCommand(grounded, "reset"),
    createInitialFlightState(),
  );
});

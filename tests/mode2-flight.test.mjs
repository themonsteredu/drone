import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function transpile(url) {
  return ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText;
}

function load(url, requireModule = () => ({})) {
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", transpile(url))(
    requireModule,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const model = load(
  new URL("../src/simulator/flight-model.ts", import.meta.url),
);
const gestures = load(
  new URL("../src/simulator/mode2-gesture-detector.ts", import.meta.url),
);
const controller = load(
  new URL("../src/simulator/flight-controller.ts", import.meta.url),
  (specifier) => {
    if (specifier === "./flight-model") return model;
    if (specifier === "./mode2-gesture-detector") return gestures;
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  },
);

const NEUTRAL = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

function mappedState(axes = {}, buttons = {}, rawAxes = []) {
  return {
    connected: true,
    mappingStatus: "mapped",
    ...NEUTRAL,
    ...axes,
    buttons,
    rawAxes,
    rawButtons: [],
  };
}

function advance(state, input, seconds, settings = {}, frequency = 120) {
  let next = state;
  for (let frame = 0; frame < Math.round(seconds * frequency); frame += 1) {
    next = model.stepFlightState(next, input, 1 / frequency, settings);
  }
  return next;
}

const DEFAULT_PREFERENCES = {
  version: 2,
  speedLevel: "normal",
  controlMode: "byrobot",
  headless: false,
  stabilization: true,
  deadZone: 0.1,
  sensitivity: 1,
  expo: 0.45,
  customAxisMapping: {
    throttle: { axisIndex: 1, inverted: false },
    yaw: { axisIndex: 0, inverted: true },
    pitch: { axisIndex: 3, inverted: false },
    roll: { axisIndex: 2, inverted: true },
  },
};

test("Mode 2 arming uses semantic ControllerState and requires a continuous three-second hold", () => {
  const detector = new gestures.Mode2GestureDetector();
  const inwardDown = mappedState(
    { throttle: -0.9, yaw: 0.82, pitch: -0.88, roll: -0.8 },
    {},
    // Deliberately contradictory raw data: raw indices must be irrelevant.
    [1, 1, 1, 1],
  );

  const started = detector.observe(inwardDown, 100);
  assert.equal(started.phase, gestures.MODE2_GESTURE_PHASE.ARMING);
  assert.equal(started.armingStarted, true);
  assert.equal(started.armingProgress, 0);

  const second = detector.observe(inwardDown, 2100);
  assert.ok(Math.abs(second.armingProgress - 2 / 3) < 1e-12);
  assert.equal(second.armed, false);

  const armed = detector.observe(inwardDown, 3100);
  assert.equal(armed.phase, gestures.MODE2_GESTURE_PHASE.ARMED);
  assert.equal(armed.armingProgress, 1);
  assert.equal(armed.armed, true);

  const resetDetector = new gestures.Mode2GestureDetector();
  resetDetector.observe(inwardDown, 0);
  assert.equal(
    resetDetector.observe(mappedState(), 1500).phase,
    gestures.MODE2_GESTURE_PHASE.READY,
  );
  assert.equal(
    resetDetector.observe(inwardDown, 3000).armingProgress,
    0,
    "leaving the corners restarts the continuous hold",
  );
});

test("each inward/down semantic axis is required for Mode 2 arming", () => {
  const active = {
    throttle: -0.8,
    yaw: 0.8,
    pitch: -0.8,
    roll: -0.8,
  };
  assert.equal(
    gestures.isMode2ArmingGestureActive(mappedState(active)),
    true,
  );
  for (const axis of ["throttle", "yaw", "pitch", "roll"]) {
    assert.equal(
      gestures.isMode2ArmingGestureActive(
        mappedState({ ...active, [axis]: 0 }),
      ),
      false,
      `${axis} cannot be omitted`,
    );
  }
});

test("Mode 2 arming accepts shorter horizontal travel at a real diagonal", () => {
  const corner = (down, inward) =>
    mappedState({
      throttle: -down,
      yaw: inward,
      pitch: -down,
      roll: -inward,
    });

  assert.equal(gestures.isMode2ArmingGestureActive(corner(0.39, 0.65)), false);
  assert.equal(gestures.isMode2ArmingGestureActive(corner(0.8, 0.24)), false);
  assert.equal(gestures.isMode2ArmingGestureActive(corner(0.4, 0.25)), true);
  assert.equal(gestures.isMode2ArmingGestureActive(corner(0.8, 0.55)), true);
  assert.equal(gestures.isMode2ArmingGestureActive(corner(1, 1)), true);
  const config = gestures.resolveMode2GestureConfig();
  assert.equal(config.armingDownThreshold, 0.4);
  assert.equal(config.armingInwardThreshold, 0.25);
  assert.equal(config.armingReleaseGraceMs, 650);
});

test("a momentary analog wobble does not erase the three-second hold", () => {
  const detector = new gestures.Mode2GestureDetector();
  const corner = mappedState({
    throttle: -0.8,
    yaw: 0.65,
    pitch: -0.8,
    roll: -0.65,
  });

  detector.observe(corner, 0);
  detector.observe(corner, 1400);
  const wobble = detector.observe(mappedState(), 1650);
  assert.equal(wobble.phase, gestures.MODE2_GESTURE_PHASE.ARMING);
  assert.ok(wobble.armingProgress > 0.5);

  const recovered = detector.observe(corner, 1700);
  assert.equal(recovered.phase, gestures.MODE2_GESTURE_PHASE.ARMING);
  const armed = detector.observe(corner, 3000);
  assert.equal(armed.phase, gestures.MODE2_GESTURE_PHASE.ARMED);
});

test("releasing the sticks beyond the grace period still cancels arming", () => {
  const detector = new gestures.Mode2GestureDetector();
  const corner = mappedState({
    throttle: -0.8,
    yaw: 0.65,
    pitch: -0.8,
    roll: -0.65,
  });

  detector.observe(corner, 0);
  detector.observe(corner, 1000);
  assert.equal(
    detector.observe(mappedState(), 1700).phase,
    gestures.MODE2_GESTURE_PHASE.READY,
  );
});

test("emergency requires low throttle plus an explicitly bound logical L button", () => {
  const state = mappedState({ throttle: -0.9 }, { logical_l: true });
  assert.equal(
    gestures.isMode2EmergencyChordActive(state),
    false,
    "no product-specific 0x70 button is guessed",
  );
  assert.equal(
    gestures.isMode2EmergencyChordActive(state, {
      emergencyButtonId: "logical_l",
    }),
    true,
  );
  assert.equal(
    gestures.isMode2EmergencyChordActive(
      mappedState({ throttle: -0.2 }, { logical_l: true }),
      { emergencyButtonId: "logical_l" },
    ),
    false,
  );

  const detector = new gestures.Mode2GestureDetector();
  const first = detector.observe(state, 0, {
    emergencyButtonId: "logical_l",
  });
  const held = detector.observe(state, 20, {
    emergencyButtonId: "logical_l",
  });
  assert.equal(first.emergencyActivated, true);
  assert.equal(held.emergencyActivated, false, "held chord is one-shot");
});

test("armed flight uses a throttle threshold, manual lift, and held-low-throttle disarm", () => {
  let state = model.applyFlightCommand(
    model.applyFlightCommand(model.createInitialFlightState(), "begin-arming"),
    "arm",
  );
  assert.equal(state.phase, model.FLIGHT_PHASE.ARMED);

  state = advance(
    state,
    { ...NEUTRAL, throttle: 0.2 },
    1,
    { speedLevel: "high" },
  );
  assert.equal(state.phase, model.FLIGHT_PHASE.ARMED);
  assert.equal(state.position.y, 0, "sub-threshold noise cannot take off");

  state = advance(
    state,
    { ...NEUTRAL, throttle: 0.75 },
    0.7,
    { speedLevel: "high" },
  );
  assert.equal(state.phase, model.FLIGHT_PHASE.FLIGHT);
  assert.ok(state.position.y > 0.1);

  state = advance(
    state,
    { ...NEUTRAL, throttle: -1 },
    4,
    { speedLevel: "high" },
  );
  assert.equal(state.phase, model.FLIGHT_PHASE.READY);
  assert.equal(state.position.y, 0);
  assert.equal(state.emergencyLatched, false);
});

test("FlightController drives READY -> ARMING -> ARMED and gates emergency by semantic binding", () => {
  const flightController = new controller.FlightController(
    DEFAULT_PREFERENCES,
  );
  const inwardDown = mappedState({
    throttle: -0.9,
    yaw: 0.9,
    pitch: -0.9,
    roll: -0.9,
  });

  for (const now of [0, 1000, 2000, 3000]) {
    flightController.setControllerState(inwardDown, true, now);
    flightController.step(1 / 60, now, true);
  }
  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.ARMED);
  assert.equal(flightController.getMode2GestureState().armingProgress, 1);

  for (const now of [3100, 3200, 3300, 3400, 3500]) {
    flightController.setControllerState(
      mappedState({ throttle: 0.9 }),
      true,
      now,
    );
    flightController.step(0.1, now, true);
  }
  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.FLIGHT);

  flightController.setMode2Bindings({ emergencyButtonId: "logical_l" });
  const emergencyState = mappedState(
    { throttle: -0.9 },
    { logical_l: true },
  );
  flightController.setControllerState(emergencyState, true, 3600);
  flightController.step(1 / 60, 3600, true);
  assert.equal(
    flightController.getState().phase,
    model.FLIGHT_PHASE.EMERGENCY,
  );
});

const ARMING_CORNER = {
  throttle: -0.85,
  yaw: 0.85,
  pitch: -0.85,
  roll: -0.85,
};

test("a corner held through a live 0x71 stream completes the three-second hold", () => {
  const flightController = new controller.FlightController(
    DEFAULT_PREFERENCES,
  );

  // The accepted-joystick timestamp advances on every CRC-valid packet, so a
  // stick the student is still holding keeps reporting fresh input.
  for (let now = 0; now <= 3000; now += 100) {
    flightController.setControllerState(mappedState(ARMING_CORNER), true, now);
    flightController.step(0.1, now, true);
  }

  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.ARMED);
  assert.equal(flightController.getMode2GestureState().armingProgress, 1);
});

test("a persisted user axis mapping does not disable semantic Mode 2 arming", () => {
  const flightController = new controller.FlightController({
    ...DEFAULT_PREFERENCES,
    controlMode: "custom",
  });

  for (let now = 0; now <= 3000; now += 100) {
    flightController.setControllerState(mappedState(ARMING_CORNER), true, now);
    flightController.step(0.1, now, true);
  }

  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.ARMED);
  assert.equal(flightController.getMode2GestureState().armingProgress, 1);
});

test("a new training stage can arm again after the previous stage reset", () => {
  const flightController = new controller.FlightController(
    DEFAULT_PREFERENCES,
  );

  for (let now = 0; now <= 3000; now += 100) {
    flightController.setControllerState(mappedState(ARMING_CORNER), true, now);
    flightController.step(0.1, now, true);
  }
  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.ARMED);

  flightController.dispatch("reset");
  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.READY);
  assert.equal(flightController.getMode2GestureState().armingProgress, 0);

  for (let now = 4000; now <= 7000; now += 100) {
    flightController.setControllerState(mappedState(ARMING_CORNER), true, now);
    flightController.step(0.1, now, true);
  }
  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.ARMED);
});

test("a corner sample that stops streaming cancels arming instead of completing it", () => {
  const flightController = new controller.FlightController(
    DEFAULT_PREFERENCES,
  );
  flightController.setControllerState(mappedState(ARMING_CORNER), true, 0);

  flightController.step(1 / 60, 0, true);
  assert.equal(
    flightController.getState().phase,
    model.FLIGHT_PHASE.ARMING,
    "the first fresh sample starts the hold",
  );

  // No further input arrives. Once the sample is stale the hold must restart
  // rather than coast to ARMED on a controller that is no longer reporting.
  for (const now of [600, 1500, 3000, 3600]) {
    flightController.step(1 / 60, now, true);
  }

  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.READY);
  assert.equal(flightController.getMode2GestureState().armingProgress, 0);
});

test("FlightController applies bounded mission-neutral world force only in flight", () => {
  const flightController = new controller.FlightController(
    DEFAULT_PREFERENCES,
  );
  const grounded = flightController.applyWorldForce(
    { x: 0.42, y: 0, z: 0 },
    0.2,
  );
  assert.deepEqual(grounded.velocity, { x: 0, y: 0, z: 0 });

  flightController.dispatch("start");
  flightController.dispatch("takeoff");
  for (let frame = 0; frame < 20; frame += 1) {
    flightController.step(0.25, frame * 250, true);
  }
  assert.equal(flightController.getState().phase, model.FLIGHT_PHASE.FLIGHT);
  const before = flightController.getState();
  const after = flightController.applyWorldForce(
    { x: 0.42, y: 0, z: 0 },
    0.2,
  );
  assert.ok(Math.abs(after.velocity.x - (before.velocity.x + 0.084)) < 1e-12);
  assert.equal(after.velocity.y, before.velocity.y);
  assert.equal(after.velocity.z, before.velocity.z);
  assert.equal(
    flightController.getState().velocity.x,
    after.velocity.x,
    "the coordinator owns the updated state",
  );
});

test("a controller session change disarms on the ground but preserves airborne recovery", () => {
  const grounded = new controller.FlightController(DEFAULT_PREFERENCES);
  grounded.dispatch("begin-arming");
  grounded.dispatch("arm");
  assert.equal(grounded.getState().phase, model.FLIGHT_PHASE.ARMED);
  grounded.resetInputSession();
  assert.equal(grounded.getState().phase, model.FLIGHT_PHASE.READY);
  assert.equal(grounded.getMode2GestureState().armingProgress, 0);

  const airborne = new controller.FlightController(DEFAULT_PREFERENCES);
  airborne.dispatch("start");
  airborne.dispatch("takeoff");
  for (let frame = 0; frame < 20; frame += 1) {
    airborne.step(0.25, frame * 250, true);
  }
  assert.equal(airborne.getState().phase, model.FLIGHT_PHASE.FLIGHT);
  airborne.resetInputSession();
  assert.equal(airborne.getState().phase, model.FLIGHT_PHASE.FLIGHT);
  assert.deepEqual(airborne.getState().smoothedInput, NEUTRAL);
});

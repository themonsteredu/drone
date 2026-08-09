import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const moduleCache = new Map();

function loadTypeScriptModule(url) {
  const key = url.href;
  if (moduleCache.has(key)) return moduleCache.get(key).exports;

  const source = readFileSync(url, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: url.pathname,
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(key, loadedModule);
  new Function("require", "module", "exports", compiled)(
    () => {
      throw new Error("Simulator pure modules must not import runtime dependencies");
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const flight = loadTypeScriptModule(
  new URL("../src/simulator/flight-model.ts", import.meta.url),
);
const buttonMapping = loadTypeScriptModule(
  new URL("../src/simulator/button-mapping.ts", import.meta.url),
);

const {
  applyDeadZone,
  applyFlightCommand,
  conditionFlightInput,
  createInitialFlightState,
  exponentialSmoothing,
  neutralizeFlightMotion,
  stepFlightState,
} = flight;
const {
  assignButtonMapping,
  beginButtonCapture,
  createEmptyButtonMappings,
  findRisingButtons,
  resolveMappedButtonActions,
  updateButtonCapture,
} = buttonMapping;

const NEUTRAL = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

function advance(state, input, seconds, frequency = 120) {
  const frames = Math.round(seconds * frequency);
  let next = state;
  for (let index = 0; index < frames; index += 1) {
    next = stepFlightState(next, input, 1 / frequency);
  }
  return next;
}

function flyingState() {
  return {
    ...createInitialFlightState(),
    mode: "flying",
    position: { x: 0, y: 1.4, z: 0 },
  };
}

test("applies an idempotent 0.10 dead zone and clamps unsafe numbers", () => {
  assert.equal(applyDeadZone(0.099), 0);
  assert.equal(applyDeadZone(-0.099), 0);
  assert.equal(applyDeadZone(0.1), 0.1);
  assert.equal(applyDeadZone(-0.1), -0.1);
  assert.equal(applyDeadZone(2), 1);
  assert.equal(applyDeadZone(-2), -1);
  assert.equal(applyDeadZone(Number.NaN), 0);
  assert.equal(applyDeadZone(applyDeadZone(0.35)), 0.35);
});

test("keeps cross-axis jitter neutral while allowing deliberate combined control", () => {
  assert.deepEqual(
    conditionFlightInput({ throttle: 0.8, yaw: 0.08, pitch: 0, roll: 0 }),
    { throttle: 0.8, yaw: 0, pitch: 0, roll: 0 },
  );
  assert.deepEqual(
    conditionFlightInput({ throttle: 0.8, yaw: 0.3, pitch: 0, roll: 0 }),
    { throttle: 0.8, yaw: 0.3, pitch: 0, roll: 0 },
  );
  assert.deepEqual(
    conditionFlightInput({ ...NEUTRAL, throttle: 1, active: false }),
    NEUTRAL,
  );
});

test("uses frame-rate-independent exponential smoothing", () => {
  const once = exponentialSmoothing(0, 1, 7, 0.5);
  let many = 0;
  for (let index = 0; index < 50; index += 1) {
    many = exponentialSmoothing(many, 1, 7, 0.01);
  }
  assert.ok(Math.abs(once - many) < 1e-12);
  assert.ok(once > 0 && once < 1);
});

test("implements the semantic axis contract in independent world directions", () => {
  const throttle = advance(flyingState(), { ...NEUTRAL, throttle: 1 }, 0.5);
  const yaw = advance(flyingState(), { ...NEUTRAL, yaw: 1 }, 0.5);
  const pitch = advance(flyingState(), { ...NEUTRAL, pitch: 1 }, 0.5);
  const roll = advance(flyingState(), { ...NEUTRAL, roll: 1 }, 0.5);

  assert.ok(throttle.position.y > 1.4, "positive throttle rises");
  assert.ok(yaw.yaw > 0, "positive yaw turns clockwise");
  assert.ok(pitch.position.z > 0, "positive pitch moves forward at yaw zero");
  assert.ok(roll.position.x > 0, "positive roll moves right at yaw zero");
  assert.ok(Math.abs(throttle.yaw) < 1e-12);
  assert.ok(Math.abs(yaw.position.x) < 1e-12);
  assert.ok(Math.abs(yaw.position.z) < 1e-12);
});

test("ignores small yaw during ascent but supports intentional ascent and rotation", () => {
  const jitter = advance(
    flyingState(),
    { ...NEUTRAL, throttle: 0.8, yaw: 0.08 },
    0.5,
  );
  const combined = advance(
    flyingState(),
    { ...NEUTRAL, throttle: 0.8, yaw: 0.35 },
    0.5,
  );
  assert.ok(jitter.position.y > 1.4);
  assert.equal(jitter.yaw, 0);
  assert.ok(combined.position.y > 1.4);
  assert.ok(combined.yaw > 0);
});

test("fixed internal substeps make a 0.2 second update frame-rate stable", () => {
  const input = { throttle: 0.5, yaw: 0.4, pitch: 0.7, roll: -0.3 };
  const once = stepFlightState(flyingState(), input, 0.2);
  let many = flyingState();
  for (let index = 0; index < 24; index += 1) {
    many = stepFlightState(many, input, 1 / 120);
  }
  for (const key of ["x", "y", "z"]) {
    assert.ok(Math.abs(once.position[key] - many.position[key]) < 1e-12);
    assert.ok(Math.abs(once.velocity[key] - many.velocity[key]) < 1e-12);
  }
  assert.ok(Math.abs(once.yaw - many.yaw) < 1e-12);
});

test("takeoff and landing form a deterministic safe state machine", () => {
  const initial = createInitialFlightState();
  const takingOff = stepFlightState(
    initial,
    { ...NEUTRAL, command: "takeoff" },
    0,
  );
  assert.equal(takingOff.mode, "taking_off");
  assert.deepEqual(initial, createInitialFlightState(), "input state was not mutated");

  const airborne = advance(takingOff, NEUTRAL, 4);
  assert.equal(airborne.mode, "flying");
  assert.equal(airborne.position.y, 1.4);

  const landing = stepFlightState(
    airborne,
    { ...NEUTRAL, command: "land" },
    0,
  );
  assert.equal(landing.mode, "landing");
  const landed = advance(landing, NEUTRAL, 5);
  assert.equal(landed.mode, "landed");
  assert.equal(landed.position.y, 0);
  assert.deepEqual(landed.velocity, { x: 0, y: 0, z: 0 });
});

test("emergency stops planar motion, descends, and remains latched until reset", () => {
  const moving = advance(
    flyingState(),
    { throttle: 0, yaw: 1, pitch: 1, roll: 1 },
    0.4,
  );
  const emergency = applyFlightCommand(moving, "emergency");
  assert.equal(emergency.mode, "emergency");
  assert.equal(emergency.velocity.x, 0);
  assert.equal(emergency.velocity.z, 0);
  assert.equal(emergency.yawRate, 0);

  const groundedEmergency = advance(emergency, NEUTRAL, 4);
  assert.equal(groundedEmergency.mode, "emergency");
  assert.equal(groundedEmergency.position.y, 0);
  assert.equal(applyFlightCommand(groundedEmergency, "takeoff").mode, "emergency");
  assert.deepEqual(
    applyFlightCommand(groundedEmergency, "reset"),
    createInitialFlightState(),
  );
});

test("caps a long suspended-frame delta instead of jumping across the scene", () => {
  const longFrame = stepFlightState(
    flyingState(),
    { ...NEUTRAL, pitch: 1 },
    60,
  );
  const cappedFrame = stepFlightState(
    flyingState(),
    { ...NEUTRAL, pitch: 1 },
    0.25,
  );
  assert.deepEqual(longFrame, cappedFrame);
});

test("neutralizes disconnect drift without changing mode, position, or yaw", () => {
  const moving = advance(
    flyingState(),
    { throttle: 0.4, yaw: 0.5, pitch: 0.8, roll: -0.3 },
    0.4,
  );
  const snapshot = structuredClone(moving);
  const neutral = neutralizeFlightMotion(moving);

  assert.equal(neutral.mode, moving.mode);
  assert.deepEqual(neutral.position, moving.position);
  assert.equal(neutral.yaw, moving.yaw);
  assert.deepEqual(neutral.velocity, { x: 0, y: 0, z: 0 });
  assert.equal(neutral.yawRate, 0);
  assert.deepEqual(neutral.smoothedInput, NEUTRAL);
  assert.deepEqual(neutral.tilt, { pitch: 0, roll: 0 });
  assert.deepEqual(moving, snapshot, "source state was not mutated");
  assert.notEqual(neutral.position, moving.position, "nested state was copied");
});

test("finds only false-to-true button edges", () => {
  assert.deepEqual(
    findRisingButtons(
      { button_bit_0: false, button_bit_1: true },
      { button_bit_0: true, button_bit_1: true },
    ),
    ["button_bit_0"],
  );
});

test("capture waits for a held button to be released and consumes the new press", () => {
  const empty = createEmptyButtonMappings();
  let capture = beginButtonCapture("takeoff", "serial:one", {
    button_bit_0: true,
  });
  let update = updateButtonCapture(capture, empty, "serial:one", {
    button_bit_0: true,
  });
  assert.equal(update.outcome, "waiting");
  capture = update.capture;

  update = updateButtonCapture(capture, empty, "serial:one", {
    button_bit_0: false,
  });
  assert.equal(update.outcome, "waiting");
  capture = update.capture;

  update = updateButtonCapture(capture, empty, "serial:one", {
    button_bit_0: true,
  });
  assert.equal(update.outcome, "mapped");
  assert.deepEqual(update.mappings.takeoff, {
    sourceId: "serial:one",
    buttonId: "button_bit_0",
  });
  assert.deepEqual(update.consumedButtonIds, ["button_bit_0"]);
  assert.deepEqual(
    resolveMappedButtonActions(
      update.mappings,
      "serial:one",
      { button_bit_0: false },
      { button_bit_0: true },
      update.consumedButtonIds,
    ),
    [],
  );
});

test("assigning a duplicate button unmaps the previous action", () => {
  const binding = { sourceId: "serial:one", buttonId: "button_bit_3" };
  const takeoff = assignButtonMapping(
    createEmptyButtonMappings(),
    "takeoff",
    binding,
  );
  const landing = assignButtonMapping(takeoff, "land", binding);
  assert.equal(landing.takeoff, null);
  assert.deepEqual(landing.land, binding);
});

test("ambiguous multi-button capture maps nothing and consumes both edges", () => {
  const mappings = createEmptyButtonMappings();
  const capture = beginButtonCapture("land", "serial:one", {
    button_bit_1: false,
    button_bit_2: false,
  });
  const update = updateButtonCapture(capture, mappings, "serial:one", {
    button_bit_1: true,
    button_bit_2: true,
  });
  assert.equal(update.outcome, "ambiguous");
  assert.deepEqual(update.mappings, mappings);
  assert.deepEqual(update.consumedButtonIds, ["button_bit_1", "button_bit_2"]);
  assert.ok(update.capture);
});

test("mapped actions are source-scoped, edge-triggered, and safety-prioritized", () => {
  let mappings = createEmptyButtonMappings();
  mappings = assignButtonMapping(mappings, "takeoff", {
    sourceId: "serial:one",
    buttonId: "a",
  });
  mappings = assignButtonMapping(mappings, "land", {
    sourceId: "serial:one",
    buttonId: "b",
  });
  mappings = assignButtonMapping(mappings, "emergency", {
    sourceId: "serial:one",
    buttonId: "c",
  });
  const released = { a: false, b: false, c: false };
  const pressed = { a: true, b: true, c: true };

  assert.deepEqual(
    resolveMappedButtonActions(mappings, "serial:one", released, pressed),
    ["emergency", "land", "takeoff"],
  );
  assert.deepEqual(
    resolveMappedButtonActions(mappings, "serial:one", pressed, pressed),
    [],
    "held buttons do not repeat",
  );
  assert.deepEqual(
    resolveMappedButtonActions(mappings, "gamepad:two", released, pressed),
    [],
    "another controller cannot use this profile",
  );
});

test("changing controller source cancels capture without changing mappings", () => {
  const mappings = createEmptyButtonMappings();
  const capture = beginButtonCapture("emergency", "serial:one", {});
  const update = updateButtonCapture(
    capture,
    mappings,
    "gamepad:two",
    { button_1: true },
  );
  assert.equal(update.outcome, "source_changed");
  assert.equal(update.capture, null);
  assert.deepEqual(update.mappings, mappings);
});

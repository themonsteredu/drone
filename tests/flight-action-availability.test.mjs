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

const modelUrl = new URL("../src/simulator/flight-model.ts", import.meta.url);
const model = load(modelUrl);
const gestureDetector = load(
  new URL("../src/simulator/mode2-gesture-detector.ts", import.meta.url),
);
const controller = load(
  new URL("../src/simulator/flight-controller.ts", import.meta.url),
  (specifier) => {
    if (specifier === "./flight-model") return model;
    if (specifier === "./mode2-gesture-detector") return gestureDetector;
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  },
);

test("emergency completion requires reset before another start", () => {
  assert.deepEqual(
    controller.getFlightActionAvailability(model.FLIGHT_PHASE.STOP, true),
    {
      start: false,
      takeoff: false,
      land: false,
      reset: true,
      emergency: false,
    },
  );
  assert.equal(
    controller.getFlightActionAvailability(model.FLIGHT_PHASE.STOP, false)
      .start,
    true,
  );
});

test("emergency control is visible but only enabled after motor start", () => {
  assert.equal(
    controller.getFlightActionAvailability(model.FLIGHT_PHASE.READY).emergency,
    false,
  );
  assert.equal(
    controller.getFlightActionAvailability(model.FLIGHT_PHASE.START).emergency,
    true,
  );
  assert.equal(
    controller.getFlightActionAvailability(model.FLIGHT_PHASE.FLIGHT)
      .emergency,
    true,
  );
});

test("screen start arms the Mode 2 state and then enables assisted takeoff", () => {
  const flightController = new controller.FlightController({
    controlMode: "byrobot",
    speedLevel: "normal",
    headless: false,
    stabilization: true,
    deadZone: 0.1,
    expo: 0.45,
    sensitivity: 1,
  });
  assert.equal(
    controller.getFlightActionAvailability(model.FLIGHT_PHASE.READY).start,
    true,
  );
  assert.equal(
    controller.getFlightActionAvailability(model.FLIGHT_PHASE.READY).takeoff,
    false,
  );

  const armed = flightController.dispatch("arm");
  assert.equal(armed.phase, model.FLIGHT_PHASE.ARMED);
  assert.equal(
    controller.getFlightActionAvailability(armed.phase).takeoff,
    true,
  );

  const takingOff = flightController.dispatch("takeoff");
  assert.equal(takingOff.phase, model.FLIGHT_PHASE.TAKEOFF);
});

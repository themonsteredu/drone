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
const controller = load(
  new URL("../src/simulator/flight-controller.ts", import.meta.url),
  (specifier) => {
    if (specifier === "./flight-model") return model;
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

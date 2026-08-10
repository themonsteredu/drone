import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadModule(path) {
  const url = new URL(path, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", compiled)(loaded, loaded.exports);
  return loaded.exports;
}

const calibration = loadModule("../src/controllers/center-calibration.ts");

test("accepts only a new joystick packet timestamp for automatic centering", () => {
  assert.equal(calibration.isNewCenterCalibrationSample(null, null), false);
  assert.equal(calibration.isNewCenterCalibrationSample(null, 100), true);
  assert.equal(calibration.isNewCenterCalibrationSample(100, 100), false);
  assert.equal(calibration.isNewCenterCalibrationSample(100, 101), true);
});

test("samples neutral axes and computes their average center", () => {
  let state = calibration.restartCenterCalibration(4);
  state = calibration.observeCenterCalibration(state, [0.03, -0.02, 0.01, 0], 0, {
    sampleDurationMs: 100,
    minimumSamples: 2,
  });
  state = calibration.observeCenterCalibration(state, [0.01, 0, -0.01, 0.02], 100, {
    sampleDurationMs: 100,
    minimumSamples: 2,
  });
  assert.equal(state.status, "complete");
  assert.deepEqual(state.centers, [0.02, -0.01, 0, 0.01]);
});

test("will not calibrate while a stick is held away from neutral", () => {
  let state = calibration.restartCenterCalibration(4);
  state = calibration.observeCenterCalibration(state, [0, -0.8, 0, 0], 1000);
  assert.equal(state.status, "waiting-neutral");
  assert.equal(state.sampleCount, 0);
  assert.equal(state.startedAt, null);
});

test("reports deterministic sampling progress", () => {
  const state = calibration.observeCenterCalibration(
    calibration.restartCenterCalibration(4),
    [0, 0, 0, 0],
    100,
  );
  assert.equal(calibration.centerCalibrationProgress(state, 550, 900), 0.5);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadSettingsModule() {
  const url = new URL("../src/simulator/settings.ts", import.meta.url);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("module", "exports", compiled)(
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const settings = loadSettingsModule();

test("uses the requested student defaults and exact speed scales", () => {
  const defaults = settings.createDefaultSimulatorPreferences();
  assert.equal(defaults.speedLevel, "normal");
  assert.equal(defaults.controlMode, "byrobot");
  assert.equal(defaults.headless, false);
  assert.equal(defaults.stabilization, true);
  assert.equal(defaults.deadZone, 0.1);
  assert.equal(defaults.expo, 0.45);
  assert.equal(defaults.sensitivity, 1);
  assert.deepEqual(settings.SPEED_LEVEL_SCALE, {
    beginner: 0.35,
    normal: 0.65,
    high: 1,
  });
});

test("inverts hardware-tested yaw and roll in the initial custom axis mapping", () => {
  const defaults = settings.createDefaultSimulatorPreferences();
  assert.deepEqual(defaults.customAxisMapping, {
    throttle: { axisIndex: 1, inverted: false },
    yaw: { axisIndex: 0, inverted: true },
    pitch: { axisIndex: 3, inverted: false },
    roll: { axisIndex: 2, inverted: true },
  });
  assert.deepEqual(
    settings.axisAssignmentsFromPreferences(defaults, 4),
    ["yaw", "throttle", "roll", "pitch"],
  );
  assert.deepEqual(settings.invertedAxesFromPreferences(defaults), [0, 2]);
});

test("validates versioned stored preferences and rejects unsafe data", () => {
  const valid = settings.createDefaultSimulatorPreferences();
  assert.deepEqual(settings.parseSimulatorPreferences(valid), valid);
  assert.equal(
    settings.parseSimulatorPreferences({ ...valid, version: 3 }),
    null,
  );
  assert.equal(
    settings.parseSimulatorPreferences({ ...valid, deadZone: 0.9 }),
    null,
  );
  assert.equal(
    settings.parseSimulatorPreferences({
      ...valid,
      customAxisMapping: {
        ...valid.customAxisMapping,
        roll: { axisIndex: 3, inverted: true },
      },
    }),
    null,
    "duplicate axis assignments are rejected",
  );
});

test("migrates only the exact legacy default to the hardware-tested yaw sign", () => {
  const current = settings.createDefaultSimulatorPreferences();
  const legacyDefault = {
    ...current,
    version: 1,
    speedLevel: "beginner",
    customAxisMapping: {
      ...current.customAxisMapping,
      yaw: { axisIndex: 0, inverted: false },
    },
  };
  const migratedDefault = settings.migrateLegacySimulatorPreferences(
    legacyDefault,
  );
  assert.equal(migratedDefault.version, 2);
  assert.equal(migratedDefault.speedLevel, "beginner");
  assert.equal(migratedDefault.customAxisMapping.yaw.inverted, true);

  const intentionalCustom = {
    ...legacyDefault,
    customAxisMapping: {
      throttle: { axisIndex: 3, inverted: true },
      yaw: { axisIndex: 2, inverted: false },
      pitch: { axisIndex: 1, inverted: false },
      roll: { axisIndex: 0, inverted: false },
    },
  };
  assert.deepEqual(
    settings.migrateLegacySimulatorPreferences(intentionalCustom)
      .customAxisMapping,
    intentionalCustom.customAxisMapping,
  );
});

test("default preference objects do not share mutable axis bindings", () => {
  const first = settings.createDefaultSimulatorPreferences();
  const second = settings.createDefaultSimulatorPreferences();
  first.customAxisMapping.roll.inverted = false;
  assert.equal(second.customAxisMapping.roll.inverted, true);
});

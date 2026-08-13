import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleCache = new Map();

function loadTypeScriptModule(url) {
  const key = url.href;
  if (moduleCache.has(key)) return moduleCache.get(key).exports;

  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: url.pathname,
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(key, loadedModule);
  const parentPath = fileURLToPath(url);
  new Function("require", "module", "exports", compiled)(
    (specifier) => {
      let target = resolve(dirname(parentPath), specifier);
      if (!extname(target)) target += ".ts";
      return loadTypeScriptModule(pathToFileURL(target));
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const profiles = loadTypeScriptModule(
  new URL("../src/controllers/profiles/byrobot-profiles.ts", import.meta.url),
);
const calibration = loadTypeScriptModule(
  new URL("../src/controllers/calibration.ts", import.meta.url),
);
const gestures = loadTypeScriptModule(
  new URL("../src/simulator/mode2-gesture-detector.ts", import.meta.url),
);

const PRESET = profiles.BYROBOT_STRICT_JOYSTICK_AXIS_PRESET;

/**
 * Mirrors how ControllerDiagnosticsPage turns preset bindings into a fixed
 * axis profile, so this covers the sign path the student actually flies
 * through rather than the binding table alone.
 */
function project(rawAxes) {
  const assignments = Array.from({ length: rawAxes.length }, () => null);
  const invertedAxes = [];
  for (const binding of PRESET.bindings) {
    assignments[binding.rawAxisIndex] = binding.control;
    if (binding.inverted) invertedAxes.push(binding.rawAxisIndex);
  }
  return calibration.projectMappedControllerState(
    {
      connected: true,
      mappingStatus: "unidentified",
      controllerModel: "test",
      protocol: "test",
      throttle: null,
      yaw: null,
      pitch: null,
      roll: null,
      buttons: {},
      rawAxes,
    },
    calibration.createFixedAxisProfile(rawAxes, assignments, {
      deadZone: 0,
      invertedAxes,
    }),
  );
}

// Raw 0x71 stick order is [left X, left Y, right X, right Y].
const raw = ({ leftX = 0, leftY = 0, rightX = 0, rightY = 0 }) => [
  leftX,
  leftY,
  rightX,
  rightY,
];

test("the default preset keeps the documented semantic stick directions", () => {
  // throttle +1 up, yaw +1 clockwise, pitch +1 forward, roll +1 aircraft-right.
  assert.equal(project(raw({ leftY: 1 })).throttle, 1, "left stick up climbs");
  assert.equal(
    project(raw({ leftX: 1 })).yaw,
    1,
    "left stick right yaws clockwise, so semantic yaw must be positive",
  );
  assert.equal(
    project(raw({ rightY: 1 })).pitch,
    1,
    "right stick up moves forward",
  );
  assert.equal(
    project(raw({ rightX: 1 })).roll,
    -1,
    "the classroom controller's raw right-X needs a Roll sign correction",
  );
  assert.equal(
    project(raw({ rightX: -1 })).roll,
    1,
    "physical right-stick right produces semantic aircraft-right movement",
  );
});

test("the documented Mode 2 corner reaches the arming gesture through the preset", () => {
  // Left stick about 5 o'clock and right stick about 7 o'clock, per README.
  const corner = project(
    raw({ leftX: 1, leftY: -1, rightX: 1, rightY: -1 }),
  );

  assert.equal(corner.mappingStatus, "mapped");
  assert.equal(corner.roll, -1, "physical right-stick left is negative Roll");
  assert.equal(
    gestures.isMode2ArmingGestureActive(corner),
    true,
    "the verified 7 o'clock corner must remain reachable after Roll correction",
  );
});

test("only the hardware-verified Roll axis carries a sign inversion", () => {
  assert.deepEqual(
    PRESET.bindings.map((binding) => [binding.control, binding.inverted]),
    [
      ["yaw", false],
      ["throttle", false],
      ["roll", true],
      ["pitch", false],
    ],
  );
});

test("the profile preserves yaw while correcting Roll independently", () => {
  assert.equal(project(raw({ leftX: 1 })).yaw, 1);
  assert.equal(project(raw({ rightX: 1 })).roll, -1);
});

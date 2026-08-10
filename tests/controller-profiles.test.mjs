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
  const parentPath = fileURLToPath(url);
  new Function("require", "module", "exports", compiled)(
    (specifier) => {
      if (!specifier.startsWith(".")) {
        throw new Error(`Profile pure modules cannot import ${specifier}`);
      }
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
const discovery = loadTypeScriptModule(
  new URL("../src/controllers/profiles/operation-discovery.ts", import.meta.url),
);
const gestureRuntime = loadTypeScriptModule(
  new URL("../src/controllers/profiles/gesture-runtime.ts", import.meta.url),
);

const STRICT_CONTEXT = {
  codecId: "coding-e-drone-controller-input-v1",
  dataType: 0x71,
  payloadLength: 8,
  axisCount: 4,
};

test("provides distinct Smart, PRC-95, Battle Drone, and generic profiles", () => {
  assert.deepEqual(
    profiles.BYROBOT_CONTROLLER_PROFILES.map((profile) => profile.id),
    [
      "byrobot-smart-controller",
      "byrobot-prc95",
      "byrobot-battle-drone",
      "byrobot-generic",
    ],
  );
  assert.equal(
    profiles.selectControllerProfile("byrobot-smart-controller").id,
    "byrobot-smart-controller",
  );
  assert.equal(
    profiles.selectControllerProfile("future-unknown-adapter").id,
    "byrobot-generic",
  );
});

test("strict 0x71 preset applies hardware-tested yaw and roll corrections only", () => {
  const preset = profiles.BYROBOT_STRICT_JOYSTICK_AXIS_PRESET;
  assert.deepEqual(preset.rawAxisOrder, [
    "left-x",
    "left-y",
    "right-x",
    "right-y",
  ]);
  assert.deepEqual(
    preset.bindings.map(({ rawAxisIndex, control, inverted }) => ({
      rawAxisIndex,
      control,
      inverted,
    })),
    [
      { rawAxisIndex: 0, control: "yaw", inverted: true },
      { rawAxisIndex: 1, control: "throttle", inverted: false },
      { rawAxisIndex: 2, control: "roll", inverted: true },
      { rawAxisIndex: 3, control: "pitch", inverted: false },
    ],
  );
});

test("does not apply the axis preset until every strict codec guard matches", () => {
  const profile = profiles.GENERIC_BYROBOT_PROFILE;
  assert.equal(
    profiles.resolveControllerProfile(profile, STRICT_CONTEXT).axisSource,
    "verified-protocol-preset",
  );
  for (const context of [
    { ...STRICT_CONTEXT, codecId: "raw-only-unverified-controller" },
    { ...STRICT_CONTEXT, dataType: 0x70 },
    { ...STRICT_CONTEXT, payloadLength: 10 },
    { ...STRICT_CONTEXT, axisCount: 5 },
  ]) {
    const resolved = profiles.resolveControllerProfile(profile, context);
    assert.equal(resolved.axisSource, "unavailable");
    assert.deepEqual(resolved.axisBindings, []);
  }
});

test("keeps every executable product operation default null", () => {
  for (const profile of profiles.BYROBOT_CONTROLLER_PROFILES) {
    assert.deepEqual(profile.defaultOperationGestures, {
      start: null,
      takeoff: null,
      landing: null,
      emergency: null,
      missionAction: null,
    });
    const resolved = profiles.resolveControllerProfile(profile, STRICT_CONTEXT);
    assert.deepEqual(resolved.operations, {
      start: null,
      takeoff: null,
      landing: null,
      emergency: null,
      missionAction: null,
    });
  }
});

test("profile runtime supports model-specific long press durations", () => {
  const profile = {
    ...profiles.GENERIC_BYROBOT_PROFILE,
    defaultOperationGestures: {
      start: null,
      takeoff: {
        kind: "button",
        buttonId: "button_bit_0",
        trigger: "long-press",
        minimumDurationMs: 1200,
        verification: {
          status: "verified",
          model: "test-only",
          sourceUrl: "https://example.invalid/test",
          summary: "test-only verified fixture",
        },
      },
      landing: null,
      emergency: null,
    },
  };
  const runtime = gestureRuntime.createControllerGestureRuntime();
  const event = (sequence, phase, at) => ({
    sequence,
    observationSequence: sequence,
    buttonId: "button_bit_0",
    buttonNumber: 1,
    phase,
    at,
  });
  assert.deepEqual(
    gestureRuntime.observeProfileButtonGestures(
      profile,
      [event(1, "down", 0), event(2, "up", 1000)],
      runtime,
    ),
    [],
  );
  assert.deepEqual(
    gestureRuntime.observeProfileButtonGestures(
      profile,
      [event(3, "down", 2000), event(4, "up", 3200)],
      runtime,
    ),
    ["takeoff"],
  );
});

test("profile runtime supports verified stick and button chords", () => {
  const profile = {
    ...profiles.GENERIC_BYROBOT_PROFILE,
    defaultOperationGestures: {
      start: {
        kind: "input-chord",
        buttons: ["button_bit_2"],
        axes: [{ control: "throttle", maximum: -0.8 }],
        minimumDurationMs: 500,
        verification: {
          status: "verified",
          model: "test-only",
          sourceUrl: "https://example.invalid/test",
          summary: "test-only verified fixture",
        },
      },
      takeoff: null,
      landing: null,
      emergency: null,
    },
  };
  const runtime = gestureRuntime.createControllerGestureRuntime();
  const activeState = {
    connected: true,
    mappingStatus: "mapped",
    throttle: -0.9,
    yaw: 0,
    pitch: 0,
    roll: 0,
    buttons: { button_bit_2: true },
  };
  assert.deepEqual(
    gestureRuntime.observeProfileInputChords(profile, activeState, 1000, runtime),
    [],
  );
  assert.deepEqual(
    gestureRuntime.observeProfileInputChords(profile, activeState, 1500, runtime),
    ["start"],
  );
  assert.deepEqual(
    gestureRuntime.observeProfileInputChords(profile, activeState, 2000, runtime),
    [],
    "a held chord fires once",
  );
  gestureRuntime.observeProfileInputChords(
    profile,
    { ...activeState, buttons: { button_bit_2: false } },
    2100,
    runtime,
  );
  assert.deepEqual(
    gestureRuntime.observeProfileInputChords(profile, activeState, 2600, runtime),
    [],
    "returning active begins a new hold window",
  );
});

test("stores Battle Drone manual instructions as non-executable hints", () => {
  const hints = profiles.BATTLE_DRONE_PROFILE.operationHints;
  assert.deepEqual(
    hints.map((hint) => hint.operation),
    ["takeoff", "landing", "emergency"],
  );
  assert.ok(hints.every((hint) => hint.executable === false));
  assert.ok(
    hints.every((hint) =>
      hint.sourceUrl.startsWith(
        "https://dev.byrobot.co.kr/documents/kr/products/battle_drone/",
      ),
    ),
  );
});

test("accepts complete user axis/button mappings without mutating them", () => {
  const axes = [
    { rawAxisIndex: 0, physicalAxis: "left-x", control: "roll", inverted: false },
    { rawAxisIndex: 1, physicalAxis: "left-y", control: "pitch", inverted: true },
    { rawAxisIndex: 2, physicalAxis: "right-x", control: "yaw", inverted: false },
    { rawAxisIndex: 3, physicalAxis: "right-y", control: "throttle", inverted: true },
  ];
  const userTakeoff = {
    kind: "button",
    buttonId: "button_bit_9",
    trigger: "down",
    origin: "user",
    capturedAt: 1234,
  };
  const resolved = profiles.resolveControllerProfile(
    profiles.PRC95_PROFILE,
    {},
    { axes, operations: { takeoff: userTakeoff } },
  );
  assert.equal(resolved.axisSource, "user");
  assert.deepEqual(resolved.axisBindings, axes);
  assert.deepEqual(resolved.operations.takeoff, userTakeoff);
  assert.equal(resolved.operationSources.takeoff, "user");
  assert.notEqual(resolved.axisBindings, axes);
  assert.notEqual(resolved.operations.takeoff, userTakeoff);

  const incomplete = profiles.resolveControllerProfile(
    profiles.PRC95_PROFILE,
    STRICT_CONTEXT,
    { axes: axes.slice(0, 3) },
  );
  assert.equal(incomplete.axisSource, "invalid-user-mapping");
  assert.deepEqual(incomplete.axisBindings, []);
});

test("records immutable raw 0x70/0x71 discovery evidence without decoding it", () => {
  let session = discovery.startOperationDiscovery({
    captureId: "capture-1",
    operation: "start",
    sourceId: "serial:one",
    profileId: "byrobot-smart-controller",
    startedAt: 1000,
  });
  const mutablePayload = [1, 0, 1];
  session = discovery.recordOperationDiscoveryFrame(
    session,
    "serial:one",
    { dataType: 0x70, payload: mutablePayload, receivedAt: 1010 },
  );
  mutablePayload[0] = 99;
  session = discovery.recordOperationDiscoveryFrame(
    session,
    "serial:one",
    {
      dataType: 0x71,
      payload: [0, 50, 0x12, 2, 0, 0, 0x22, 2],
      receivedAt: 1020,
      from: 0x20,
      to: 0x70,
    },
  );
  session = discovery.finishOperationDiscovery(session, 1100);

  assert.equal(session.status, "completed");
  assert.deepEqual(session.frames[0].payload, [1, 0, 1]);
  assert.equal("buttonId" in session.frames[0], false);
  assert.deepEqual(discovery.summarizeOperationDiscovery(session), {
    operation: "start",
    frameCount: 2,
    buttonPacketCount: 1,
    joystickPacketCount: 1,
    distinctButtonPayloadCount: 1,
    distinctJoystickPayloadCount: 1,
    firstReceivedAt: 1010,
    lastReceivedAt: 1020,
  });
});

test("keeps a bounded capture and rejects source changes or unrelated DataTypes", () => {
  let session = discovery.startOperationDiscovery({
    captureId: "capture-2",
    operation: "emergency",
    sourceId: "serial:one",
    profileId: "byrobot-battle-drone",
    startedAt: 2000,
  });
  for (let index = 0; index < 4; index += 1) {
    session = discovery.recordOperationDiscoveryFrame(
      session,
      "serial:one",
      { dataType: 0x70, payload: [index], receivedAt: 2001 + index },
      2,
    );
  }
  assert.deepEqual(
    session.frames.map((frame) => frame.payload[0]),
    [2, 3],
  );
  assert.equal(session.droppedFrameCount, 2);

  assert.throws(
    () =>
      discovery.recordOperationDiscoveryFrame(
        session,
        "gamepad:two",
        { dataType: 0x70, payload: [0], receivedAt: 2010 },
      ),
    /source changed/,
  );
  assert.throws(
    () =>
      discovery.recordOperationDiscoveryFrame(
        session,
        "serial:one",
        { dataType: 0x40, payload: [0], receivedAt: 2010 },
      ),
    /0x70 and Joystick 0x71/,
  );
});

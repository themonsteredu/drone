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

  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) throw new Error(`Unexpected import: ${specifier}`);
    return loadTypeScriptModule(new URL(`${specifier}.ts`, url));
  };
  new Function("require", "module", "exports", compiled)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const crcModule = loadTypeScriptModule(
  new URL("../src/controllers/protocols/byrobot/crc16.ts", import.meta.url),
);
const parserModule = loadTypeScriptModule(
  new URL("../src/controllers/protocols/byrobot/parser.ts", import.meta.url),
);
const packetModule = loadTypeScriptModule(
  new URL("../src/controllers/protocols/byrobot/packet.ts", import.meta.url),
);
const inputModule = loadTypeScriptModule(
  new URL(
    "../src/controllers/protocols/byrobot/controller-input.ts",
    import.meta.url,
  ),
);
const dataTypeMonitorModule = loadTypeScriptModule(
  new URL(
    "../src/controllers/diagnostics/data-type-monitor.ts",
    import.meta.url,
  ),
);
const buttonEventJournalModule = loadTypeScriptModule(
  new URL(
    "../src/controllers/diagnostics/button-event-journal.ts",
    import.meta.url,
  ),
);
const calibrationModule = loadTypeScriptModule(
  new URL("../src/controllers/calibration.ts", import.meta.url),
);
const controllerTypesModule = loadTypeScriptModule(
  new URL("../src/controllers/types.ts", import.meta.url),
);
const typesModule = loadTypeScriptModule(
  new URL("../src/controllers/protocols/byrobot/types.ts", import.meta.url),
);

const { crc16Byrobot } = crcModule;
const { ByrobotPacketParser } = parserModule;
const {
  buildControllerDataRequest,
  buildControllerInputActivationPing,
  buildDeviceAddressedPacket,
} = packetModule;
const {
  ByrobotControllerInputTracker,
  RAW_ONLY_CONTROLLER_INPUT_CODEC,
  decodeOfficialButtonPacket,
  decodeOfficialJoystickPacket,
  isByrobotControllerInputActive,
} = inputModule;
const { ByrobotDataTypeMonitor } = dataTypeMonitorModule;
const { ControllerButtonEventJournal } = buttonEventJournalModule;
const {
  createFixedAxisProfile,
  normalizeCalibratedAxis,
  projectMappedControllerState,
} = calibrationModule;
const { createUnidentifiedState } = controllerTypesModule;
const { LEGACY_LINK_PROFILE } = typesModule;

function concatenate(...arrays) {
  return Uint8Array.from(arrays.flatMap((array) => Array.from(array)));
}

test("matches the CRC in an official BYROBOT firmware packet example", () => {
  const headerAndPayload = Uint8Array.of(0x90, 0x04, 0x01, 0x00, 0x00, 0x00);
  assert.equal(crc16Byrobot(headerAndPayload), 0x3116);
});

test("builds the reviewed Base-to-Controller input activation Ping", () => {
  assert.equal(
    Array.from(buildControllerInputActivationPing(), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(" "),
    "0a 55 01 08 70 20 00 00 00 00 00 00 00 00 86 d9",
  );
});

test("builds official one-byte Controller Request frames for Joystick and Button", () => {
  assert.equal(
    Array.from(buildControllerDataRequest(0x71), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(" "),
    "0a 55 04 01 70 20 71 ea 4f",
  );
  assert.equal(
    Array.from(buildControllerDataRequest(0x70), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(" "),
    "0a 55 04 01 70 20 70 cb 5f",
  );
});

test("parses a complete device-addressed frame", () => {
  const parser = new ByrobotPacketParser();
  const frame = buildDeviceAddressedPacket(
    0x71,
    0x20,
    0x70,
    Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
  );
  const result = parser.feed(frame, 1234);

  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0].dataType, 0x71);
  assert.equal(result.packets[0].length, 8);
  assert.equal(result.packets[0].from, 0x20);
  assert.equal(result.packets[0].to, 0x70);
  assert.deepEqual(Array.from(result.packets[0].payload), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(result.packets[0].crcValid, true);
  assert.equal(result.bufferedBytes, 0);
});

test("restores a frame across every one-byte stream boundary", () => {
  const parser = new ByrobotPacketParser();
  const frame = buildDeviceAddressedPacket(
    0x70,
    0x20,
    0x70,
    Uint8Array.of(0x34, 0x12, 0x01),
  );
  const packets = [];
  for (const byte of frame) packets.push(...parser.feed(Uint8Array.of(byte)).packets);

  assert.equal(packets.length, 1);
  assert.deepEqual(Array.from(packets[0].payload), [0x34, 0x12, 0x01]);
});

test("handles leading noise and back-to-back frames", () => {
  const parser = new ByrobotPacketParser();
  const first = buildDeviceAddressedPacket(0x01, 0x70, 0x20, new Uint8Array(8));
  const second = buildDeviceAddressedPacket(0x02, 0x20, 0x70, Uint8Array.of(9));
  const result = parser.feed(concatenate(Uint8Array.of(0xff, 0x00, 0x33), first, second));

  assert.deepEqual(result.packets.map((packet) => packet.dataType), [0x01, 0x02]);
  assert.ok(result.issues.some((issue) => issue.code === "discarded_noise"));
});

test("reports CRC mismatch and resynchronizes to the following valid frame", () => {
  const parser = new ByrobotPacketParser();
  const valid = buildDeviceAddressedPacket(0x04, 0x70, 0x20, Uint8Array.of(0x07));
  const invalid = valid.slice();
  invalid[invalid.length - 1] ^= 0xff;
  const result = parser.feed(concatenate(invalid, valid));

  assert.equal(result.packets.length, 1);
  assert.ok(result.issues.some((issue) => issue.code === "crc_error"));
});

test("keeps incomplete frames buffered and reset removes them", () => {
  const parser = new ByrobotPacketParser();
  const frame = buildDeviceAddressedPacket(0x01, 0x70, 0x20, new Uint8Array(8));
  const partial = parser.feed(frame.slice(0, 7));
  assert.equal(partial.packets.length, 0);
  assert.equal(partial.bufferedBytes, 7);

  parser.reset();
  assert.equal(parser.bufferedBytes, 0);
});

test("uses length framing when a payload itself contains 0A 55", () => {
  const parser = new ByrobotPacketParser();
  const frame = buildDeviceAddressedPacket(
    0x05,
    0x20,
    0x70,
    Uint8Array.of(0x01, 0x0a, 0x55, 0x02),
  );
  const result = parser.feed(frame);
  assert.equal(result.packets.length, 1);
  assert.deepEqual(Array.from(result.packets[0].payload), [0x01, 0x0a, 0x55, 0x02]);
});

test("supports an injected legacy Link profile without inventing From/To", () => {
  const parser = new ByrobotPacketParser(LEGACY_LINK_PROFILE);
  const headerAndPayload = Uint8Array.of(0x01, 0x02, 0xaa, 0xbb);
  const crc = crc16Byrobot(headerAndPayload);
  const frame = Uint8Array.of(
    0x0a,
    0x55,
    ...headerAndPayload,
    crc & 0xff,
    crc >> 8,
  );
  const result = parser.feed(frame);

  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0].profile, "legacy-link");
  assert.equal(result.packets[0].from, undefined);
  assert.equal(result.packets[0].to, undefined);
});

test("caps an untrusted stream buffer", () => {
  const parser = new ByrobotPacketParser();
  const result = parser.feed(new Uint8Array(70_000));
  assert.ok(result.issues.some((issue) => issue.code === "buffer_overflow"));
  assert.ok(parser.bufferedBytes <= 1);
});

test("decodes the official 8-byte signed Joystick layout without semantic mapping", () => {
  const parser = new ByrobotPacketParser();
  const frame = buildDeviceAddressedPacket(
    0x71,
    0x20,
    0x70,
    Uint8Array.of(0x9c, 0x64, 0x11, 0x01, 0x32, 0xce, 0x22, 0x02),
  );
  const packet = parser.feed(frame, 555).packets[0];
  const result = decodeOfficialJoystickPacket(packet);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ok
      ? [
          result.value.left.x,
          result.value.left.y,
          result.value.right.x,
          result.value.right.y,
        ]
      : [],
    [-100, 100, 50, -50],
  );
  assert.equal(result.ok && result.value.left.directionName, "TL");
  assert.equal(result.ok && result.value.right.eventName, "STAY");
  assert.equal(result.ok && result.value.axesWithinDocumentedRange, true);
});

test("rejects 0x71 layouts whose payload length is not the official 8 bytes", () => {
  const parser = new ByrobotPacketParser();
  const packet = parser.feed(
    buildDeviceAddressedPacket(0x71, 0x20, 0x70, new Uint8Array(10)),
  ).packets[0];
  const result = decodeOfficialJoystickPacket(packet);

  assert.equal(result.ok, false);
  assert.match(result.reason, /unsupported payload length 10/);
});

test("rejects controller input DataTypes from the wrong device address", () => {
  const parser = new ByrobotPacketParser();
  const wrongSource = parser.feed(
    buildDeviceAddressedPacket(
      0x71,
      0x10,
      0x70,
      Uint8Array.of(0, 0, 0x22, 2, 0, 0, 0x22, 2),
    ),
  ).packets[0];
  const wrongTarget = parser.feed(
    buildDeviceAddressedPacket(0x70, 0x20, 0x10, Uint8Array.of(1, 0, 1)),
  ).packets[0];

  const joystick = decodeOfficialJoystickPacket(wrongSource);
  const button = decodeOfficialButtonPacket(wrongTarget);
  assert.equal(joystick.ok, false);
  assert.match(joystick.reason, /source\/target mismatch/);
  assert.equal(button.ok, false);
  assert.match(button.reason, /source\/target mismatch/);
});

test("keeps unverified product adapters on a raw-only input codec", () => {
  const parser = new ByrobotPacketParser();
  const tracker = new ByrobotControllerInputTracker(
    RAW_ONLY_CONTROLLER_INPUT_CODEC,
  );
  const packet = parser.feed(
    buildDeviceAddressedPacket(
      0x71,
      0x20,
      0x70,
      Uint8Array.of(0, 0, 0x22, 2, 0, 0, 0x22, 2),
    ),
  ).packets[0];
  tracker.observe(packet);

  const snapshot = tracker.snapshot();
  assert.equal(snapshot.evidence.joystickSeen, true);
  assert.equal(snapshot.evidence.joystickDecoded, false);
  assert.match(snapshot.joystickUnsupportedReason, /no verified controller input codec/);
});

test("does not treat an out-of-range sample as a valid movement baseline", () => {
  const parser = new ByrobotPacketParser();
  const tracker = new ByrobotControllerInputTracker();
  const packet = (x, at) =>
    parser.feed(
      buildDeviceAddressedPacket(
        0x71,
        0x20,
        0x70,
        Uint8Array.of(x, 0, 0x22, 2, 0, 0, 0x22, 2),
      ),
      at,
    ).packets[0];

  tracker.observe(packet(127, 1));
  assert.equal(tracker.snapshot().evidence.joystickDecoded, false);
  assert.equal(tracker.snapshot().latestAcceptedJoystickAt, null);
  tracker.observe(packet(0, 2));
  assert.equal(tracker.snapshot().evidence.joystickChangedEver, false);
  assert.equal(tracker.snapshot().latestAcceptedJoystickAt, 2);
  tracker.observe(packet(10, 3));
  assert.equal(tracker.snapshot().evidence.joystickChangedEver, true);
  assert.equal(tracker.snapshot().latestAcceptedJoystickAt, 3);
  tracker.observe(packet(127, 4));
  assert.equal(tracker.snapshot().latestJoystick.receivedAt, 4);
  assert.equal(
    tracker.snapshot().latestAcceptedJoystickAt,
    3,
    "an invalid sample must not refresh the accepted ControllerState input",
  );
});

test("decodes Button uint16 little-endian, event, and session input evidence", () => {
  const parser = new ByrobotPacketParser();
  const tracker = new ByrobotControllerInputTracker();
  const neutral = parser.feed(
    buildDeviceAddressedPacket(
      0x71,
      0x20,
      0x70,
      Uint8Array.of(0, 0, 0x22, 2, 0, 0, 0x22, 2),
    ),
    1,
  ).packets[0];
  const moved = parser.feed(
    buildDeviceAddressedPacket(
      0x71,
      0x20,
      0x70,
      Uint8Array.of(25, 0, 0x24, 1, 0, 0, 0x22, 2),
    ),
    2,
  ).packets[0];
  const buttonPacket = parser.feed(
    buildDeviceAddressedPacket(0x70, 0x20, 0x70, Uint8Array.of(0x04, 0x01, 1)),
    3,
  ).packets[0];
  const buttonReleasePacket = parser.feed(
    buildDeviceAddressedPacket(0x70, 0x20, 0x70, Uint8Array.of(0x04, 0x01, 3)),
    4,
  ).packets[0];

  const decodedButton = decodeOfficialButtonPacket(buttonPacket);
  assert.equal(decodedButton.ok, true);
  assert.equal(decodedButton.ok && decodedButton.value.button, 0x0104);
  assert.equal(decodedButton.ok && decodedButton.value.eventName, "DOWN");

  tracker.observe(neutral);
  assert.equal(tracker.snapshot().evidence.joystickChangedEver, false);
  tracker.observe(moved);
  assert.equal(tracker.snapshot().evidence.joystickChangedEver, true);
  assert.equal(isByrobotControllerInputActive(tracker.snapshot().evidence), false);
  tracker.observe(buttonPacket);
  let evidence = tracker.snapshot().evidence;
  assert.equal(evidence.buttonDecoded, true);
  assert.equal(evidence.buttonInteractionEver, true);
  assert.equal(evidence.buttonChangedEver, false);
  assert.equal(isByrobotControllerInputActive(evidence), false);
  tracker.observe(buttonReleasePacket);
  evidence = tracker.snapshot().evidence;
  assert.equal(evidence.buttonChangedEver, true);
  assert.equal(isByrobotControllerInputActive(evidence), true);
});

test("journals a quick Button Down to Up pair before a throttled UI snapshot", () => {
  const journal = new ControllerButtonEventJournal();

  journal.observe(0x0004, 1, 100);
  journal.observe(0x0004, 3, 101);

  assert.deepEqual(journal.snapshot(), [
    {
      sequence: 1,
      observationSequence: 1,
      buttonNumber: 3,
      buttonId: "button_bit_2",
      phase: "down",
      at: 100,
    },
    {
      sequence: 2,
      observationSequence: 2,
      buttonNumber: 3,
      buttonId: "button_bit_2",
      phase: "up",
      at: 101,
    },
  ]);
  assert.equal(journal.pressedSnapshot()[2], false);
});

test("keeps only actionable edges, caps transitions, and resets a session", () => {
  const journal = new ControllerButtonEventJournal(4);

  journal.observe(0x0001, 2, 1);
  journal.observe(0x0001, 2, 2);
  journal.observe(0x0001, 4, 3);
  assert.deepEqual(
    journal.snapshot().map(({ phase }) => phase),
    ["down"],
  );

  for (let index = 0; index < 3; index += 1) {
    journal.observe(0x0001, 3, 10 + index * 2);
    journal.observe(0x0001, 1, 11 + index * 2);
  }
  const capped = journal.snapshot();
  assert.equal(capped.length, 4);
  assert.equal(capped.at(-1).sequence, 7);

  journal.reset();
  assert.deepEqual(journal.snapshot(), []);
  assert.equal(journal.pressedSnapshot()[0], false);
  journal.observe(0x0001, 1, 200);
  assert.equal(journal.snapshot()[0].sequence, 1);
  assert.equal(journal.snapshot()[0].observationSequence, 1);

  const idle = new ControllerButtonEventJournal();
  idle.observe(0x0001, 0, 300);
  assert.deepEqual(idle.snapshot(), []);
});

test("preserves same-timestamp double taps in packet observation order", () => {
  const journal = new ControllerButtonEventJournal();

  journal.observe(0x0001, 1, 500);
  journal.observe(0x0001, 3, 500);
  journal.observe(0x0001, 1, 500);
  journal.observe(0x0001, 3, 500);

  assert.deepEqual(
    journal.snapshot().map(({ phase, observationSequence }) => [
      phase,
      observationSequence,
    ]),
    [
      ["down", 1],
      ["up", 2],
      ["down", 3],
      ["up", 4],
    ],
  );
});

test("counts every valid DataType in a rolling five-second window", () => {
  const parser = new ByrobotPacketParser();
  const monitor = new ByrobotDataTypeMonitor();
  const packet = (dataType, payload, at) =>
    parser.feed(
      buildDeviceAddressedPacket(dataType, 0x20, 0x70, Uint8Array.from(payload)),
      at,
    ).packets[0];

  monitor.observe(packet(0x02, [1], 1_000));
  monitor.observe(packet(0x71, [0, 0, 0x22, 2, 0, 0, 0x22, 2], 2_000));
  monitor.observe(packet(0x71, [10, 0, 0x24, 1, 0, 0, 0x22, 2], 3_000));

  const atThreeSeconds = monitor.snapshot(3_000);
  const joystick = atThreeSeconds.find((entry) => entry.dataType === 0x71);
  assert.equal(joystick.packetCount5s, 2);
  assert.equal(joystick.totalCount, 2);
  assert.equal(joystick.payloadChange5s, "yes");
  assert.deepEqual(joystick.changedByteIndices, [0, 2, 3]);

  const expired = monitor.snapshot(8_001);
  assert.equal(expired.find((entry) => entry.dataType === 0x71).packetCount5s, 0);
  assert.equal(expired.find((entry) => entry.dataType === 0x71).totalCount, 2);
  assert.equal(expired.find((entry) => entry.dataType === 0x70).packetCount5s, 0);
});

test("projects calibrated raw axes into a real mapped Common ControllerState", () => {
  const source = {
    ...createUnidentifiedState(true),
    rawAxes: [0.25, -0.5, 0.75, -1],
    controllerModel: "Unknown BYROBOT Controller",
  };
  const controls = ["yaw", "throttle", "roll", "pitch"];
  const calibrations = source.rawAxes.map((rawCurrent, index) => ({
    index,
    rawCurrent,
    observedMinimum: -1,
    observedMaximum: 1,
    center: 0,
    normalizedValue: rawCurrent,
    inverted: false,
    deadZone: 0,
    assignedControl: controls[index],
  }));

  const mapped = projectMappedControllerState(source, calibrations);
  assert.equal(mapped.mappingStatus, "mapped");
  assert.equal(mapped.yaw, 0.25);
  assert.equal(mapped.throttle, -0.5);
  assert.equal(mapped.roll, 0.75);
  assert.equal(mapped.pitch, -1);

  const incomplete = projectMappedControllerState(source, calibrations.slice(0, 3));
  assert.equal(incomplete.mappingStatus, "unidentified");
  assert.equal(incomplete.throttle, null);
});

test("creates the explicit BYROBOT stick profile with an exact 0.10 dead zone", () => {
  const profile = createFixedAxisProfile(
    [0.099, 0.1, -0.099, -0.6],
    ["yaw", "throttle", "roll", "pitch"],
    { deadZone: 0.1 },
  );

  assert.deepEqual(
    profile.map((axis) => axis.normalizedValue),
    [0, 0.1, 0, -0.6],
  );
  assert.deepEqual(
    profile.map((axis) => axis.assignedControl),
    ["yaw", "throttle", "roll", "pitch"],
  );
  assert.equal(
    normalizeCalibratedAxis({ ...profile[3], inverted: true }),
    0.6,
  );
});

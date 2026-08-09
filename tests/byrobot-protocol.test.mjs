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
const typesModule = loadTypeScriptModule(
  new URL("../src/controllers/protocols/byrobot/types.ts", import.meta.url),
);

const { crc16Byrobot } = crcModule;
const { ByrobotPacketParser } = parserModule;
const { buildControllerInputActivationPing, buildDeviceAddressedPacket } =
  packetModule;
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

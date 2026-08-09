import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps browser hardware APIs in a client-only diagnostics component", async () => {
  const [page, component] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/controller-diagnostics.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(page, /navigator\./);
  assert.match(component, /^"use client";/);
  assert.match(component, /navigator\.getGamepads\(\)/);
  assert.match(component, /gamepadconnected/);
  assert.match(component, /gamepaddisconnected/);
  assert.match(component, /navigator\.serial\.requestPort\(\)/);
  assert.match(component, /Serial 장치 선택/);
  assert.match(component, /BYROBOT 입력 활성화/);
  assert.match(component, /RAW SERIAL MONITOR/);
  assert.match(component, /Controller input mapping not identified yet/);
});

test("contains the requested adapter and protocol module boundaries", async () => {
  const files = [
    "../src/controllers/types.ts",
    "../src/controllers/controller-manager.ts",
    "../src/controllers/adapters/gamepad-adapter.ts",
    "../src/controllers/adapters/byrobot-serial-base.ts",
    "../src/controllers/adapters/smart-controller-adapter.ts",
    "../src/controllers/adapters/prc95-adapter.ts",
    "../src/controllers/adapters/battle-drone-adapter.ts",
    "../src/controllers/protocols/byrobot/parser.ts",
    "../src/controllers/protocols/byrobot/crc16.ts",
    "../src/controllers/protocols/byrobot/types.ts",
  ];

  await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")));
});

test("product placeholders do not invent semantic packet mappings", async () => {
  const adapters = await Promise.all(
    [
      "../src/controllers/adapters/smart-controller-adapter.ts",
      "../src/controllers/adapters/prc95-adapter.ts",
      "../src/controllers/adapters/battle-drone-adapter.ts",
    ].map((file) => readFile(new URL(file, import.meta.url), "utf8")),
  );

  for (const adapter of adapters) {
    assert.doesNotMatch(adapter, /throttle\s*:/);
    assert.doesNotMatch(adapter, /yaw\s*:/);
    assert.doesNotMatch(adapter, /pitch\s*:/);
    assert.doesNotMatch(adapter, /roll\s*:/);
  }
});

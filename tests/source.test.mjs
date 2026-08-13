import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps browser hardware APIs in a client-only diagnostics component", async () => {
  const [page, component, simpleUi, simulator, flightController, visual, settings] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/controller-diagnostics.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/controller-simple-ui.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/drone-simulator.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/simulator/flight-controller.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/drone-visual.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/flight-settings-panel.tsx", import.meta.url),
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
  assert.match(component, /DATA TYPE MONITOR/);
  assert.match(component, /BYROBOT CONTROLLER INPUT/);
  assert.match(component, /0x71 \/ 0x70 Request 1회/);
  assert.match(component, /Left X/);
  assert.match(component, /Right Y/);
  assert.match(component, /Controller input mapping not identified yet/);
  assert.match(component, /<details className="developer-details">/);
  assert.match(component, /개발자 정보 보기/);
  assert.match(component, /<DroneSimulator/);
  assert.match(simpleUi, /조종기 상태/);
  assert.match(simpleUi, /왼쪽 스틱/);
  assert.match(simpleUi, /최근 눌린 버튼/);
  assert.match(simulator, /미래항공모빌리티 운항 체험/);
  assert.match(simulator, /Mode 2 시동/);
  assert.match(simulator, /ExperienceCoordinator/);
  assert.match(simulator, /aria-label="화면 비행 조작"/);
  assert.match(simulator, /dispatchFlightAction\("arm"\)/);
  assert.match(simulator, /dispatchFlightAction\("takeoff"\)/);
  assert.match(simulator, /dispatchFlightAction\("land"\)/);
  assert.match(simulator, /dispatchFlightAction\("reset"\)/);
  assert.match(simulator, /dispatchFlightAction\("emergency"\)/);
  assert.match(simulator, /disabled=\{!availability\.emergency\}/);
  assert.match(simulator, /resetInputSession\(\)/);
  assert.match(simulator, /eventAge <= INPUT_STALE_AFTER_MS/);
  assert.match(simulator, /BUTTON_MAPPING_STORAGE_KEY/);
  assert.match(simulator, /controllerState\.buttonTransitions/);
  assert.doesNotMatch(simulator, /diagnostics\/button-event-journal/);
  assert.match(flightController, /INPUT_STALE_AFTER_MS = 800/);
  assert.match(component, /startInputRequestPolling\(150\)/);
  assert.match(flightController, /ControllerState/);
  assert.match(visual, /DroneTransform/);
  assert.match(settings, /바이로봇 기본 조종/);
  assert.match(settings, /헤드리스 모드/);
  assert.match(settings, /자세 안정화/);
});

test("keeps Gamepad stick, button, and transition evidence independent", async () => {
  const adapter = await readFile(
    new URL("../src/controllers/adapters/gamepad-adapter.ts", import.meta.url),
    "utf8",
  );

  assert.match(adapter, /axisChangedEver/);
  assert.match(adapter, /buttonChangedEver/);
  assert.match(adapter, /buttonTransitions/);
  assert.match(adapter, /phase: pressed \? "down" : "up"/);
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
    "../src/controllers/protocols/byrobot/controller-input.ts",
    "../src/controllers/diagnostics/data-type-monitor.ts",
    "../src/controllers/diagnostics/button-event-journal.ts",
    "../src/controllers/profiles/types.ts",
    "../src/controllers/profiles/byrobot-profiles.ts",
    "../src/controllers/profiles/gesture-runtime.ts",
    "../src/controllers/profiles/operation-discovery.ts",
    "../src/simulator/settings.ts",
    "../src/simulator/flight-controller.ts",
    "../src/simulator/flight-model.ts",
    "../src/simulator/mode2-gesture-detector.ts",
    "../src/simulator/drone-transform.ts",
    "../src/simulator/button-mapping.ts",
    "../src/components/drone-visual.tsx",
    "../src/components/flight-settings-panel.tsx",
    "../src/components/byrobot-operation-capture.tsx",
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const COMPONENT_FILES = [
  "student-status-hud.tsx",
  "experience-guide-overlay.tsx",
  "experience-navigation.tsx",
  "flight-training-hud.tsx",
  "mission-selection.tsx",
  "experience-feedback.tsx",
  "qualification-result.tsx",
  "teacher-test-controls.tsx",
  "mission-flight-overlay.tsx",
];

async function readExperienceFile(name) {
  return readFile(
    new URL(`../src/components/experience/${name}`, import.meta.url),
    "utf8",
  );
}

test("student experience components stay presentational and CSS-module scoped", async () => {
  const sources = await Promise.all(COMPONENT_FILES.map(readExperienceFile));

  for (const source of sources) {
    assert.match(source, /import styles from "\.\/experience-ui\.module\.css";/);
    assert.doesNotMatch(source, /from ["'].*controllers\//);
    assert.doesNotMatch(source, /from ["'].*simulator\//);
    assert.doesNotMatch(source, /navigator\.|localStorage|requestAnimationFrame/);
  }
});

test("student experience UI exposes accessible Korean flight guidance", async () => {
  const [status, guide, navigation, hud, missions, feedback, result, teacher] =
    await Promise.all(COMPONENT_FILES.map(readExperienceFile));

  assert.match(status, /미래항공모빌리티 운항 훈련/);
  assert.match(status, /aria-live="polite"/);
  assert.match(guide, /Mode 2 시동/);
  assert.match(guide, /시동 스틱 유지 시간/);
  assert.match(guide, /role="dialog"/);
  assert.match(navigation, /조종 자격시험/);
  assert.match(navigation, /aria-current=\{isCurrent \? "step"/);
  assert.match(hud, /고도/);
  assert.match(hud, /배터리/);
  assert.match(missions, /응급 의약품 운송/);
  assert.match(missions, /재난지역 탐색/);
  assert.match(missions, /missionCardVisual/);
  assert.match(feedback, /role=\{urgent \? "alert" : "status"\}/);
  assert.match(result, /운항 자격 획득/);
  assert.match(result, /항공모빌리티 운항 결과/);
  assert.match(teacher, /<details/);
  assert.match(teacher, /훈련 단계 초기화/);
  assert.match(teacher, /자격시험 바로 시작/);
});

test("mission UI requires an operational decision before hands-on flight", async () => {
  const overlay = await readExperienceFile("mission-flight-overlay.tsx");
  assert.match(overlay, /MISSION CONTROL · 운항 요청 접수/);
  assert.match(overlay, /어떤 항로로 배송할까요/);
  assert.match(overlay, /의약품 인수하고 운항 시작/);
  assert.match(overlay, /병원 B 도착/);
  assert.match(overlay, /의약품 인계 완료/);
  assert.match(overlay, /수색 계획 승인하고 운항 시작/);
  assert.match(overlay, /촬영·위치 전송/);
});

test("the opening cover uses the real lightweight 3D flight scene", async () => {
  const cover = await readExperienceFile("experience-cover.tsx");
  assert.match(cover, /MOAKIT/);
  assert.match(cover, /미래 직업 체험 · 항공모빌리티/);
  assert.match(cover, /<DroneVisual/);
  assert.match(cover, /readCoverDroneTransform/);
  assert.doesNotMatch(cover, /coverRotorOne|coverDroneArmOne|coverGrid/);
});

test("disaster search keeps an on-screen mission action fallback", async () => {
  const [simulator, overlay] = await Promise.all([
    readFile(
      new URL("../src/components/drone-simulator.tsx", import.meta.url),
      "utf8",
    ),
    readExperienceFile("mission-flight-overlay.tsx"),
  ]);

  assert.match(simulator, /missionActionReady=\{controlsEnabled\}/);
  assert.doesNotMatch(simulator, /준비될 때까지 임무 시간은 멈춥니다/);
  assert.doesNotMatch(
    simulator,
    /activeExperience\.mission\?\.kind === "disaster_search"\s*&&\s*!missionActionReady/,
  );
  assert.match(overlay, /화면에서 바로 누르거나 조종기 버튼을 선택 설정/);
});

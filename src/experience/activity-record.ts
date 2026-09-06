import type { MissionDefinition } from "./types";
import type { MissionRuntimeState } from "./missions";
import { calculateMissionResult, type ExperienceResult } from "./results";

export interface MissionActivityRecord {
  version: 1;
  id: string;
  recordedAt: string;
  participant: string;
  reflection: string;
  practice: boolean;
  mission: { id: string; title: string; role: string; kind: MissionDefinition["kind"] };
  plan: { id: string; label: string; reason: string };
  preflight: readonly { label: string; checked: boolean }[];
  outcome: {
    status: "COMPLETED" | "EXPIRED";
    elapsedSeconds: number;
    timeLimitSeconds: number;
    collisionCount: number;
    corridorViolationCount: number;
    emergencyActivations: number;
    batteryPercent: number;
    payloadIntegrityPercent: number;
    handoverCompleted: boolean;
    targets: readonly { label: string; found: boolean }[];
  };
  result: ExperienceResult;
}

export function createMissionActivityRecord(
  mission: MissionDefinition,
  runtime: MissionRuntimeState,
  student: { participant: string; reflection: string; practice: boolean },
  stamp: { id: string; recordedAt: string },
): MissionActivityRecord {
  const plan = mission.plans.find((candidate) => candidate.id === runtime.selectedPlanId);
  if (runtime.missionId !== mission.id || !plan || !runtime.preflightConfirmed ||
      (runtime.status !== "COMPLETED" && runtime.status !== "EXPIRED")) {
    throw new Error("임무가 끝난 뒤 기록을 저장할 수 있어요.");
  }
  const participant = student.participant.trim();
  const reflection = student.reflection.trim();
  if (!participant || participant.length > 40 || !reflection || reflection.length > 240) {
    throw new Error("이름 또는 모둠과 다음 운항에서 바꿔볼 점을 적어 주세요.");
  }
  if (!stamp.id || !Number.isFinite(Date.parse(stamp.recordedAt))) {
    throw new Error("기록 정보를 만들지 못했어요. 다시 시도해 주세요.");
  }
  return {
    version: 1,
    ...stamp,
    participant,
    reflection,
    practice: student.practice,
    mission: { id: mission.id, title: mission.title, role: mission.roleTitle, kind: mission.kind },
    plan: { id: plan.id, label: plan.label, reason: runtime.planReason },
    preflight: mission.preflightChecklist.map((label) => ({ label, checked: runtime.checkedPreflightItems.includes(label) })),
    outcome: {
      status: runtime.status,
      elapsedSeconds: runtime.elapsedSeconds,
      timeLimitSeconds: mission.timeLimitSeconds,
      collisionCount: runtime.collisionCount,
      corridorViolationCount: runtime.corridorViolationCount,
      emergencyActivations: runtime.emergencyActivations,
      batteryPercent: runtime.battery.percent,
      payloadIntegrityPercent: runtime.payloadIntegrityPercent,
      handoverCompleted: runtime.handoverCompleted,
      targets: mission.targets.filter((target) => target.required).map((target) => ({ label: target.label, found: runtime.foundTargetIds.includes(target.id) })),
    },
    result: calculateMissionResult(mission, runtime),
  };
}

function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** A standalone, printable record; no scripts, external assets, or network calls. */
export function renderMissionActivityRecord(record: MissionActivityRecord): string {
  const e = escapeHtml;
  const result = record.result;
  const outcome = record.outcome;
  const date = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(record.recordedAt));
  const row = (label: string, value: string | number) => `<tr><th scope="row">${e(label)}</th><td>${e(value)}</td></tr>`;
  const scores = [
    ["안전 운항", result.safety.score], ["비행 안정성", result.stability.score],
    ["정밀 착륙", result.landing.score], ["임무 수행", result.objective.score], ["시간 관리", result.time.score],
  ] as const;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${e(record.participant)} · 항공모빌리티 활동 기록</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#edf2f7;color:#142e4a;font-family:"S-Core Dream","Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere}main{max-width:850px;margin:28px auto;background:white;padding:36px 42px}header{border-bottom:3px solid #2467b6;padding-bottom:18px}header p{margin:0;color:#406283}h1{font-size:25px;margin:8px 0}h2{font-size:17px;margin:22px 0 9px}p{margin:8px 0}.meta{font-size:13px}.summary{display:flex;gap:18px;align-items:center;justify-content:space-between;margin:20px 0}.score{font-size:28px;font-weight:700;white-space:nowrap}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:7px;border-bottom:1px solid #dce5ee}th{font-weight:500;color:#42617e;width:55%}.writing{padding:12px 16px;background:#f0f5fb;border-left:3px solid #2467b6;white-space:pre-wrap}.check{padding:0;list-style:none;font-size:14px}.check li{margin:5px 0}footer{margin-top:24px;padding-top:12px;border-top:1px solid #dce5ee;font-size:12px;color:#526b83}footer p{margin:3px 0}@media(max-width:600px){main{margin:0;padding:24px 18px}.grid{grid-template-columns:1fr;gap:0}.summary{align-items:flex-start;flex-direction:column;gap:4px}}@page{size:A4;margin:14mm}@media print{body{background:white}main{margin:0;padding:0;max-width:none;font-size:12px}h1{font-size:22px}h2{margin-top:15px}section,table,.writing{break-inside:avoid}.meta,table,.check{font-size:12px}.writing{padding:8px 12px}footer{font-size:10px}}
</style></head><body><main>
<header><p>MOAKIT · 항공모빌리티 직업 체험</p><h1>나의 운항 활동 기록</h1><p>${e(record.participant)} · ${e(record.mission.title)}</p><p class="meta">기록 작성 ${e(date)} (한국 시간)${record.practice ? " · 교사 점검 모드" : ""}</p></header>
<div class="summary"><div><strong>${outcome.status === "COMPLETED" ? "임무 완료" : "제한 시간 종료 · 재도전"}</strong><p>${e(record.mission.role)}</p></div><div class="score">${e(result.totalScore)} / 100</div></div>
<section><h2>1. 출발 전 판단</h2><p><strong>선택 항로</strong> · ${e(record.plan.label)}</p><p class="writing">${e(record.plan.reason)}</p><ul class="check">${record.preflight.map((item) => `<li>${item.checked ? "✓ 확인" : "미확인"} · ${e(item.label)}</li>`).join("")}</ul></section>
<section><h2>2. 실제 운항 결과</h2><div class="grid"><table><caption>운항 평가 · 각 100점</caption><tbody>${scores.map(([label, score]) => row(label, score)).join("")}</tbody></table><table><caption>운항 중 기록</caption><tbody>${row("소요 / 제한 시간", `${Math.round(outcome.elapsedSeconds * 10) / 10} / ${outcome.timeLimitSeconds}초`)}${row("충돌 / 항로 이탈", `${outcome.collisionCount} / ${outcome.corridorViolationCount}회`)}${row("긴급 착륙 사용", `${outcome.emergencyActivations}회`)}${row("남은 배터리", `${Math.round(outcome.batteryPercent)}%`)}${record.mission.kind === "medical_delivery" ? row("화물 상태 / 인계", `${Math.round(outcome.payloadIntegrityPercent)}% / ${outcome.handoverCompleted ? "완료" : "미완료"}`) : row("확인·복귀 지점", `${outcome.targets.filter((target) => target.found).length} / ${outcome.targets.length}`)}</tbody></table></div><p>${e(result.profileLabel)} · ${e(result.profileReason)}</p></section>
<section><h2>3. 다음 운항에서 바꿔볼 점</h2><p class="writing">${e(record.reflection)}</p><p>${e(result.careerMessage)}</p></section>
<footer><p>교육용 시뮬레이션 활동 기록입니다. 실제 조종 자격을 인증하지 않습니다.</p><p>이 파일을 수업 제출함에 첨부하거나 인쇄해 선생님께 전달하세요. 온라인 제출 여부는 저장하지 않습니다.</p><p>기록 번호 ${e(record.id)} · 형식 ${record.version}</p></footer>
</main></body></html>`;
}

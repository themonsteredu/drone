"use client";

import styles from "./experience-ui.module.css";

interface MissionPlanView {
  id: string;
  label: string;
  summary: string;
  badge: string;
  distanceLabel: string;
  durationLabel: string;
  energyLabel: string;
  riskLabel: string;
  recommended?: boolean;
}

export interface MissionFlightOverlayProps {
  kind: "medical_delivery" | "disaster_search";
  title: string;
  roleTitle: string;
  dispatchLabel: string;
  objective: string;
  plans: readonly MissionPlanView[];
  checklist: readonly string[];
  payload?: { label: string; detail: string; handlingNote: string };
  operationPhase: "BRIEFING" | "PREFLIGHT" | "FLIGHT" | "HANDOVER" | "RETURNING" | "COMPLETED";
  selectedPlanId?: string;
  progressCurrent: number;
  progressTotal: number;
  routePercent?: number;
  collisionCount: number;
  destinationDistanceMeters: number;
  windActive: boolean;
  payloadIntegrityPercent: number;
  corridorViolationCount: number;
  outsideSelectedCorridor: boolean;
  nearbyTargetLabel?: string;
  missionActionReady: boolean;
  onSelectPlan: (planId: string) => void;
  onConfirmDispatch: () => void;
  onMissionAction: () => void;
}

export function MissionFlightOverlay({
  kind,
  title,
  roleTitle,
  dispatchLabel,
  objective,
  plans,
  checklist,
  payload,
  operationPhase,
  selectedPlanId,
  progressCurrent,
  progressTotal,
  routePercent,
  collisionCount,
  destinationDistanceMeters,
  windActive,
  payloadIntegrityPercent,
  corridorViolationCount,
  outsideSelectedCorridor,
  nearbyTargetLabel,
  missionActionReady,
  onSelectPlan,
  onConfirmDispatch,
  onMissionAction,
}: MissionFlightOverlayProps) {
  const medical = kind === "medical_delivery";
  const preparing = operationPhase === "BRIEFING" || operationPhase === "PREFLIGHT";
  const progress = medical
    ? Math.max(0, Math.min(100, routePercent ?? 0))
    : progressTotal > 0
      ? (progressCurrent / progressTotal) * 100
      : 0;
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);

  if (preparing) {
    return (
      <section className={styles.missionOperations} aria-label={`${title} 운항 준비`}>
        <div className={styles.operationHeader}>
          <div>
            <span>MISSION CONTROL · 운항 요청 접수</span>
            <h3>{title}</h3>
            <p>{roleTitle}</p>
          </div>
          <ol aria-label="임무 진행 단계">
            <li className={styles.operationStepActive}><b>1</b> 요청 확인</li>
            <li className={selectedPlanId ? styles.operationStepActive : ""}><b>2</b> 항로 판단</li>
            <li><b>3</b> 현장 운항</li>
            <li><b>4</b> 인계·보고</li>
          </ol>
        </div>

        <div className={styles.operationBody}>
          <article className={`${styles.dispatchCard} ${medical ? styles.dispatchMedical : styles.dispatchSearch}`}>
            <span>{medical ? "긴급 운송 요청" : "재난 수색 요청"}</span>
            <h4>{dispatchLabel}</h4>
            <p>
              {medical
                ? "지상 교통 지연으로 의약품 도착이 늦어지고 있습니다. 안전한 공중 경로를 판단해 전달해 주세요."
                : "접근이 어려운 재난 구역에서 구조 신호가 감지됐습니다. 안전한 수색 순서를 정해 위치를 확인해 주세요."}
            </p>
            <dl>
              <div><dt>임무 우선순위</dt><dd>{medical ? "긴급 · 안전" : "신속 · 정확"}</dd></div>
              <div><dt>제한 시간</dt><dd>{medical ? "3분" : "3분 30초"}</dd></div>
              <div><dt>운항 환경</dt><dd>{medical ? "도심 · 강풍 구역" : "재난 잔해 · 제한 시야"}</dd></div>
            </dl>
            {payload ? (
              <div className={styles.payloadCard}>
                <i aria-hidden="true">+</i>
                <div><strong>{payload.label}</strong><span>{payload.detail}</span></div>
              </div>
            ) : (
              <div className={styles.payloadCard}>
                <i aria-hidden="true">⌖</i>
                <div><strong>항공 촬영·확인 장비</strong><span>구조 신호 위치 기록</span></div>
              </div>
            )}
          </article>

          <div className={styles.operationDecision}>
            <div className={styles.decisionHeading}>
              <span>운항 판단 01</span>
              <h4>{medical ? "어떤 항로로 배송할까요?" : "어떤 순서로 수색할까요?"}</h4>
              <p>거리만 보지 말고 기상, 장애물과 배터리를 함께 판단하세요.</p>
            </div>
            <div className={styles.routeChoiceGrid}>
              {plans.map((plan, index) => {
                const selected = plan.id === selectedPlanId;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    className={selected ? styles.routeChoiceSelected : ""}
                    aria-pressed={selected}
                    onClick={() => onSelectPlan(plan.id)}
                  >
                    <span className={styles.routeMap} aria-hidden="true">
                      <i>{index === 0 ? "A" : "B"}</i><b /><em /><strong>H</strong>
                    </span>
                    <span className={styles.routeChoiceTitle}>
                      <b>{plan.label}</b>
                      <small>{plan.badge}</small>
                    </span>
                    <p>{plan.summary}</p>
                    <dl>
                      <div><dt>거리</dt><dd>{plan.distanceLabel}</dd></div>
                      <div><dt>시간</dt><dd>{plan.durationLabel}</dd></div>
                      <div><dt>에너지</dt><dd>{plan.energyLabel}</dd></div>
                      <div><dt>주의</dt><dd>{plan.riskLabel}</dd></div>
                    </dl>
                  </button>
                );
              })}
            </div>

            <div className={styles.preflightBox}>
              <div>
                <span>출발 전 확인</span>
                <ul>{checklist.map((item) => <li key={item}>✓ {item}</li>)}</ul>
              </div>
              <button type="button" onClick={onConfirmDispatch} disabled={!selectedPlan}>
                {medical ? "의약품 인수하고 운항 시작" : "수색 계획 승인하고 운항 시작"}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.missionFlightOverlay}>
      <section
        className={`${styles.missionBrief} ${medical ? styles.missionBriefMedical : styles.missionBriefSearch}`}
        aria-label={`${title} 현재 목표`}
      >
        <p>{selectedPlan?.label ?? title} · {roleTitle}</p>
        <h3>{objective}</h3>
        <div className={styles.missionBriefProgress}>
          <span>
            {medical
              ? `운송 경로 ${Math.round(progress)}%`
              : `탐색 완료 ${progressCurrent}/${progressTotal}`}
          </span>
          <progress value={progress} max={100} />
        </div>
      </section>

      <aside className={styles.missionConditionStack} aria-label="임무 상태">
        {medical ? (
          <div className={payloadIntegrityPercent >= 70 ? styles.missionConditionGood : styles.missionConditionAlert}>
            <span aria-hidden="true">+</span>
            <strong>화물 상태 {Math.round(payloadIntegrityPercent)}%</strong>
          </div>
        ) : (
          <div className={styles.missionConditionProgress}>
            <span>탐색 완료</span><strong>{progressCurrent}/{progressTotal}</strong>
          </div>
        )}
        <div className={outsideSelectedCorridor ? styles.missionConditionAlert : ""}>
          <span aria-hidden="true">◇</span>
          <strong>{outsideSelectedCorridor ? "지정 항로 이탈" : `항로 이탈 ${corridorViolationCount}회`}</strong>
        </div>
        <div><span aria-hidden="true">⌖</span><strong>{medical ? "목적지" : "복귀 지점"} {Math.round(destinationDistanceMeters)}m</strong></div>
        <div><span aria-hidden="true">!</span><strong>충돌 {collisionCount}회</strong></div>
      </aside>

      {windActive ? (
        <div className={styles.windNotice} role="status">
          <span aria-hidden="true">≋</span>
          <div><strong>강풍 구역 진입</strong><small>항로와 화물 상태를 유지하며 반대 방향으로 보정하세요.</small></div>
        </div>
      ) : null}

      {medical && operationPhase === "HANDOVER" ? (
        <div className={styles.handoverPrompt} role="dialog" aria-label="의약품 인계">
          <span>운항 단계 4/4</span>
          <h3>병원 B 도착</h3>
          <p>기체가 안전하게 착륙했습니다. 의료진에게 의약품을 인계하고 임무 기록을 완료하세요.</p>
          <div><b>화물 상태 {Math.round(payloadIntegrityPercent)}%</b><b>충돌 {collisionCount}회</b></div>
          <button type="button" onClick={onMissionAction}>의약품 인계 완료</button>
        </div>
      ) : null}

      {!medical && nearbyTargetLabel ? (
        <div className={styles.searchActionPrompt} role="status">
          <div><strong>구조 신호 포착</strong><small>{nearbyTargetLabel} · 위치를 촬영하고 지휘소에 전송하세요.</small></div>
          <button type="button" onClick={onMissionAction} disabled={!missionActionReady}>
            <span aria-hidden="true">▣</span> 촬영·위치 전송
          </button>
          <small>화면에서 바로 누르거나 조종기 버튼을 선택 설정할 수 있습니다.</small>
        </div>
      ) : null}
    </div>
  );
}

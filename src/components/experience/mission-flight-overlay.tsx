"use client";

import styles from "./experience-ui.module.css";

export interface MissionFlightOverlayProps {
  kind: "medical_delivery" | "disaster_search";
  title: string;
  objective: string;
  progressCurrent: number;
  progressTotal: number;
  routePercent?: number;
  collisionCount: number;
  destinationDistanceMeters: number;
  windActive: boolean;
  nearbyTargetLabel?: string;
  missionActionReady: boolean;
  onMissionAction: () => void;
}

export function MissionFlightOverlay({
  kind,
  title,
  objective,
  progressCurrent,
  progressTotal,
  routePercent,
  collisionCount,
  destinationDistanceMeters,
  windActive,
  nearbyTargetLabel,
  missionActionReady,
  onMissionAction,
}: MissionFlightOverlayProps) {
  const medical = kind === "medical_delivery";
  const progress = medical
    ? Math.max(0, Math.min(100, routePercent ?? 0))
    : progressTotal > 0
      ? (progressCurrent / progressTotal) * 100
      : 0;

  return (
    <div className={styles.missionFlightOverlay}>
      <section
        className={`${styles.missionBrief} ${medical ? styles.missionBriefMedical : styles.missionBriefSearch}`}
        aria-label={`${title} 현재 목표`}
      >
        <p>{title}</p>
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
          <div className={styles.missionConditionGood}>
            <span aria-hidden="true">✓</span>
            <strong>화물 안전</strong>
          </div>
        ) : (
          <div className={styles.missionConditionProgress}>
            <span>탐색 완료</span>
            <strong>{progressCurrent}/{progressTotal}</strong>
          </div>
        )}
        <div>
          <span aria-hidden="true">◇</span>
          <strong>충돌 {collisionCount}회</strong>
        </div>
        <div>
          <span aria-hidden="true">⌖</span>
          <strong>{medical ? "목적지" : "복귀 지점"} {Math.round(destinationDistanceMeters)}m</strong>
        </div>
      </aside>

      {windActive ? (
        <div className={styles.windNotice} role="status">
          <span aria-hidden="true">≋</span>
          <div>
            <strong>강풍 주의</strong>
            <small>기체가 옆으로 밀리고 있습니다.</small>
          </div>
        </div>
      ) : null}

      {!medical && nearbyTargetLabel ? (
        <div className={styles.searchActionPrompt} role="status">
          <div>
            <strong>목표 지점 발견</strong>
            <small>{nearbyTargetLabel} · 촬영·확인 버튼을 누르세요.</small>
          </div>
          <button
            type="button"
            onClick={onMissionAction}
            disabled={!missionActionReady}
          >
            <span aria-hidden="true">▣</span>
            촬영·확인
          </button>
          <small>화면에서 바로 누르거나 조종기 버튼을 선택 설정할 수 있습니다.</small>
        </div>
      ) : null}
    </div>
  );
}

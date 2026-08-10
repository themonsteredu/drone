"use client";

import styles from "./experience-ui.module.css";
import type { MissionCardContent } from "./experience-types";

export const STUDENT_MISSION_CARDS: readonly MissionCardContent[] = [
  {
    id: "medical-delivery",
    number: 1,
    title: "응급 의약품 운송",
    situation: "병원 A에서 병원 B로 응급 의약품을 전달합니다.",
    objective: "안전한 비행 통로를 따라 이동한 뒤 병원 착륙장에 정밀 착륙하세요.",
    durationLabel: "약 3분",
    accent: "medical",
  },
  {
    id: "disaster-search",
    number: 2,
    title: "재난지역 탐색",
    situation: "재난 지역을 비행하며 구조가 필요한 위치를 찾습니다.",
    objective: "목표 지점 3곳을 확인하고 출발 지점으로 안전하게 복귀하세요.",
    durationLabel: "약 4분",
    accent: "search",
  },
];

export interface MissionSelectionProps {
  missions: readonly MissionCardContent[];
  selectedMissionId?: string;
  onSelectMission: (missionId: string) => void;
  heading?: string;
  description?: string;
}

export function MissionSelection({
  missions,
  selectedMissionId,
  onSelectMission,
  heading = "실제 임무를 선택하세요",
  description = "운항 자격을 활용해 미래항공모빌리티 전문가의 임무를 체험합니다.",
}: MissionSelectionProps) {
  return (
    <section className={styles.missionSelection} aria-labelledby="mission-selection-title">
      <div className={styles.sectionHeading}>
        <p>항공모빌리티 직업체험</p>
        <h2 id="mission-selection-title">{heading}</h2>
        <span>{description}</span>
      </div>

      <div className={styles.missionGrid}>
        {missions.map((mission) => {
          const selected = mission.id === selectedMissionId;
          return (
            <article
              key={mission.id}
              className={`${styles.missionCard} ${styles[`mission_${mission.accent ?? "neutral"}`]}`}
            >
              <div className={styles.missionNumber} aria-hidden="true">
                {String(mission.number).padStart(2, "0")}
              </div>
              <p>체험 임무 {mission.number}</p>
              <h3>{mission.title}</h3>
              <span>{mission.situation}</span>
              <div className={styles.missionObjective}>
                <strong>운항 목표</strong>
                <p>{mission.objective}</p>
              </div>
              {mission.durationLabel ? (
                <small>예상 체험 시간 {mission.durationLabel}</small>
              ) : null}
              <button
                type="button"
                aria-pressed={selected}
                disabled={mission.locked}
                onClick={() => onSelectMission(mission.id)}
              >
                {mission.locked
                  ? "자격 획득 후 선택 가능"
                  : selected
                    ? "선택됨"
                    : "이 임무 선택"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

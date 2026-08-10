import styles from "./experience-ui.module.css";
import type { ExperienceStage } from "./experience-types";

const DEFAULT_STAGES: ReadonlyArray<{
  id: ExperienceStage;
  label: string;
  shortLabel: string;
}> = [
  { id: "tutorial", label: "조종법 익히기", shortLabel: "안내" },
  { id: "training", label: "기초 조종 훈련", shortLabel: "훈련" },
  { id: "exam", label: "조종 자격시험", shortLabel: "시험" },
  { id: "mission-selection", label: "항공모빌리티 임무 선택", shortLabel: "선택" },
  { id: "mission", label: "실제 비행 임무", shortLabel: "임무" },
  { id: "result", label: "직업체험 결과", shortLabel: "결과" },
];

export interface ExperienceNavigationProps {
  currentStage: ExperienceStage;
  completedStages?: readonly ExperienceStage[];
  accessibleLabel?: string;
}

export function ExperienceNavigation({
  currentStage,
  completedStages = [],
  accessibleLabel = "미래항공모빌리티 체험 순서",
}: ExperienceNavigationProps) {
  const completed = new Set(completedStages);

  return (
    <nav className={styles.experienceNavigation} aria-label={accessibleLabel}>
      <ol>
        {DEFAULT_STAGES.map((stage, index) => {
          const isCurrent = stage.id === currentStage;
          const isComplete = completed.has(stage.id);
          return (
            <li
              key={stage.id}
              className={
                isCurrent
                  ? styles.navigationCurrent
                  : isComplete
                    ? styles.navigationComplete
                    : undefined
              }
              aria-current={isCurrent ? "step" : undefined}
            >
              <span aria-hidden="true">{isComplete ? "✓" : index + 1}</span>
              <div>
                <small>{stage.shortLabel}</small>
                <strong>{stage.label}</strong>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}


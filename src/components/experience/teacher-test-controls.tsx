"use client";

import styles from "./experience-ui.module.css";

export type TeacherTestAction =
  | "reset-training"
  | "start-exam"
  | "start-medical-mission"
  | "start-search-mission"
  | "reset-battery"
  | "reset-drone";

export interface TeacherTestControlsProps {
  onAction: (action: TeacherTestAction) => void;
  disabledActions?: readonly TeacherTestAction[];
  openByDefault?: boolean;
}

const TEACHER_ACTIONS: ReadonlyArray<{
  id: TeacherTestAction;
  label: string;
  description: string;
}> = [
  {
    id: "reset-training",
    label: "훈련 단계 초기화",
    description: "조종법 안내 첫 단계로 되돌립니다.",
  },
  {
    id: "start-exam",
    label: "자격시험 바로 시작",
    description: "훈련 완료 조건을 건너뛰고 시험장을 확인합니다.",
  },
  {
    id: "start-medical-mission",
    label: "의약품 운송 바로 시작",
    description: "응급 의약품 운송 환경을 확인합니다.",
  },
  {
    id: "start-search-mission",
    label: "재난 탐색 바로 시작",
    description: "재난지역 탐색 환경을 확인합니다.",
  },
  {
    id: "reset-battery",
    label: "배터리 초기화",
    description: "가상 배터리를 시작 값으로 복원합니다.",
  },
  {
    id: "reset-drone",
    label: "드론 위치 초기화",
    description: "현재 단계의 출발 위치로 드론을 이동합니다.",
  },
];

export function TeacherTestControls({
  onAction,
  disabledActions = [],
  openByDefault = false,
}: TeacherTestControlsProps) {
  const disabled = new Set(disabledActions);

  return (
    <details className={styles.teacherControls} open={openByDefault}>
      <summary>
        <span>교사용 테스트 기능</span>
        <small>수업 준비와 기능 점검에만 사용하세요.</small>
      </summary>
      <div className={styles.teacherControlsBody}>
        {TEACHER_ACTIONS.map((action) => (
          <article key={action.id}>
            <div>
              <strong>{action.label}</strong>
              <p>{action.description}</p>
            </div>
            <button
              type="button"
              disabled={disabled.has(action.id)}
              onClick={() => onAction(action.id)}
            >
              실행
            </button>
          </article>
        ))}
      </div>
    </details>
  );
}


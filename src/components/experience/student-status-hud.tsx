import styles from "./experience-ui.module.css";
import type {
  ExperienceStage,
  StudentConnectionState,
} from "./experience-types";

const CONNECTION_LABELS: Readonly<Record<StudentConnectionState, string>> = {
  missing: "연결 안 됨",
  connecting: "확인 중",
  connected: "연결됨",
};

const STAGE_LABELS: Readonly<Record<ExperienceStage, string>> = {
  tutorial: "조종법 안내",
  training: "조종 훈련",
  exam: "조종 자격시험",
  "mission-selection": "임무 선택",
  mission: "항공모빌리티 임무",
  result: "운항 결과",
};

export interface StudentStatusHudProps {
  connection: StudentConnectionState;
  stage: ExperienceStage;
  flightStatus: string;
  speedLabel: string;
  title?: string;
  controllerName?: string;
}

export function StudentStatusHud({
  connection,
  stage,
  flightStatus,
  speedLabel,
  title = "미래항공모빌리티 운항 훈련",
  controllerName,
}: StudentStatusHudProps) {
  return (
    <header className={styles.statusHud}>
      <div className={styles.statusBrand}>
        <div>
          <p>운항 훈련</p>
          <h2>{title}</h2>
        </div>
      </div>

      <dl className={styles.statusSummary} aria-label="현재 체험 상태">
        <div>
          <dt>조종기</dt>
          <dd className={styles[connection]}>
            <i aria-hidden="true" />
            {CONNECTION_LABELS[connection]}
            {controllerName ? <small>{controllerName}</small> : null}
          </dd>
        </div>
        <div>
          <dt>현재 단계</dt>
          <dd>{STAGE_LABELS[stage]}</dd>
        </div>
        <div>
          <dt>현재 상태</dt>
          <dd aria-live="polite">{flightStatus}</dd>
        </div>
        <div>
          <dt>비행 속도</dt>
          <dd>{speedLabel}</dd>
        </div>
      </dl>
    </header>
  );
}

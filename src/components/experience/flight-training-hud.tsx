import styles from "./experience-ui.module.css";

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface FlightTrainingHudProps {
  altitudeMeters: number;
  speedMetersPerSecond: number;
  batteryPercent: number;
  objective: string;
  elapsedSeconds: number;
  remainingSeconds?: number;
  objectiveProgress?: {
    current: number;
    total: number;
  };
  warning?: string;
}

export function FlightTrainingHud({
  altitudeMeters,
  speedMetersPerSecond,
  batteryPercent,
  objective,
  elapsedSeconds,
  remainingSeconds,
  objectiveProgress,
  warning,
}: FlightTrainingHudProps) {
  const battery = Math.max(0, Math.min(100, batteryPercent));

  return (
    <aside className={styles.trainingHud} aria-label="비행 정보">
      <div className={styles.telemetryRow}>
        <dl>
          <div>
            <dt>고도</dt>
            <dd>{Math.max(0, altitudeMeters).toFixed(1)}m</dd>
          </div>
          <div>
            <dt>속도</dt>
            <dd>{Math.max(0, speedMetersPerSecond).toFixed(1)}m/s</dd>
          </div>
          <div>
            <dt>시간</dt>
            <dd>
              {remainingSeconds === undefined
                ? formatTime(elapsedSeconds)
                : formatTime(remainingSeconds)}
            </dd>
          </div>
          <div className={battery <= 20 ? styles.lowBattery : undefined}>
            <dt>배터리</dt>
            <dd>{Math.round(battery)}%</dd>
            <meter
              min={0}
              max={100}
              low={20}
              high={55}
              optimum={100}
              value={battery}
              aria-label={`배터리 ${Math.round(battery)}퍼센트`}
            />
          </div>
        </dl>
      </div>

      <div className={styles.objectivePanel} aria-live="polite">
        <span>현재 목표</span>
        <strong>{objective}</strong>
        {objectiveProgress ? (
          <small>
            진행 {objectiveProgress.current} / {objectiveProgress.total}
          </small>
        ) : null}
      </div>

      {warning ? (
        <p className={styles.hudWarning} role="alert">
          {warning}
        </p>
      ) : null}
    </aside>
  );
}


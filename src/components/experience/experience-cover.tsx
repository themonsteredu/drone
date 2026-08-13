"use client";

import styles from "./experience-ui.module.css";

export interface ExperienceCoverProps {
  controllerReady: boolean;
  controllerDetected: boolean;
  connecting: boolean;
  connectBusy: boolean;
  serialSupported: boolean;
  onStart: () => void;
  onConnect: () => void;
}

export function ExperienceCover({
  controllerReady,
  controllerDetected,
  connecting,
  connectBusy,
  serialSupported,
  onStart,
  onConnect,
}: ExperienceCoverProps) {
  const connectionTitle = controllerReady
    ? "조종 준비 완료"
    : connecting || controllerDetected
      ? "조종기 확인 중"
      : "조종기 자동 연결";
  const connectionDetail = controllerReady
    ? "체험을 시작하면 바로 조종할 수 있습니다."
    : connecting || controllerDetected
      ? "스틱과 버튼 입력을 확인하고 있습니다."
      : "USB 조종기를 연결하면 자동으로 확인합니다.";

  return (
    <section className={styles.cover} aria-labelledby="experience-cover-title">
      <header className={styles.coverHeader}>
        <div className={styles.coverLogoSpace} aria-label="모아킷 로고 자리" />
        <div className={styles.coverEnvironment} aria-label="권장 이용 환경">
          <span>Windows Chrome</span>
          <span>USB 조종기</span>
        </div>
      </header>

      <div className={styles.coverHero}>
        <div className={styles.coverCopy}>
          <h1 id="experience-cover-title">
            <span className={styles.coverTitleMain}>미래항공모빌리티</span>
            <span>운항 훈련</span>
          </h1>
          <p>
            직접 시동하고, 이륙하고, 임무를 수행하며
            <br />
            미래의 운항 전문가를 경험해 보세요.
          </p>

          <button type="button" className={styles.coverStart} onClick={onStart}>
            <span aria-hidden="true">▶</span>
            체험 시작
          </button>

          <div
            className={`${styles.coverConnection} ${controllerReady ? styles.coverConnectionReady : ""}`}
            role="status"
            aria-live="polite"
          >
            <span className={styles.coverControllerIcon} aria-hidden="true">⌁</span>
            <div>
              <strong>{connectionTitle}</strong>
              <p>{connectionDetail}</p>
            </div>
            <i aria-hidden="true" />
            {!controllerReady && !connecting ? (
              <button
                type="button"
                onClick={onConnect}
                disabled={!serialSupported || connectBusy}
              >
                {connectBusy ? "확인 중" : "처음 연결"}
              </button>
            ) : null}
          </div>

          <ul className={styles.coverFeatures} aria-label="체험 특징">
            <li><span aria-hidden="true">✣</span>실제 조종</li>
            <li><span aria-hidden="true">⚑</span>단계별 훈련</li>
            <li><span aria-hidden="true">◎</span>항공 임무 체험</li>
          </ul>

          <small className={styles.coverBrowserNote}>Chrome · Windows 노트북 권장</small>
        </div>

        <div className={styles.coverScene} aria-hidden="true">
          <div className={styles.coverSunGlow} />
          <div className={styles.coverCloudOne} />
          <div className={styles.coverCloudTwo} />
          <div className={styles.coverFlightPath} />
          <div className={styles.coverDrone}>
            <i className={styles.coverDroneArmOne} />
            <i className={styles.coverDroneArmTwo} />
            <i className={styles.coverRotorOne} />
            <i className={styles.coverRotorTwo} />
            <i className={styles.coverRotorThree} />
            <i className={styles.coverRotorFour} />
            <b />
          </div>
          <div className={`${styles.coverGate} ${styles.coverGateOne}`} />
          <div className={`${styles.coverGate} ${styles.coverGateTwo}`} />
          <div className={`${styles.coverGate} ${styles.coverGateThree}`} />
          <div className={styles.coverBuildings}>
            <i /><i /><i /><i />
          </div>
          <div className={styles.coverLandingPad}><span>H</span></div>
          <div className={styles.coverGrid} />
        </div>
      </div>
    </section>
  );
}

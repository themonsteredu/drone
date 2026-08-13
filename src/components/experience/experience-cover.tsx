"use client";

import type { DroneTransform } from "../../simulator/drone-transform";
import type { DroneScenePresentation } from "../../simulator/scene-presentation";
import { DroneVisual } from "../drone-visual-loader";
import styles from "./experience-ui.module.css";

const COVER_DRONE_TRANSFORM: DroneTransform = {
  position: { x: 0, y: 1.35, z: 4 },
  rotation: { yaw: 0 },
  tilt: { pitch: -0.03, roll: 0 },
  rotorSpeed: 0.72,
};

const COVER_DRONE_SCENE: DroneScenePresentation = {
  markers: [
    {
      id: "cover-start-pad",
      kind: "start-pad",
      position: { x: 0, y: 0, z: 0 },
      radius: 1.8,
      completed: true,
    },
    {
      id: "cover-flight-gate",
      kind: "gate",
      position: { x: 0, y: 2.2, z: 11 },
      radius: 1.9,
      active: true,
    },
    {
      id: "cover-landing-pad",
      kind: "landing-pad",
      position: { x: 5.5, y: 0, z: 18 },
      radius: 2.2,
    },
  ],
};

function readCoverDroneTransform(): DroneTransform {
  return COVER_DRONE_TRANSFORM;
}

function readCoverDroneScene(): DroneScenePresentation {
  return COVER_DRONE_SCENE;
}

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
        <div className={styles.coverBrand} aria-label="모아킷">
          <span aria-hidden="true">M</span>
          <div>
            <strong>MOAKIT</strong>
            <small>미래교육 콘텐츠</small>
          </div>
        </div>
        <div className={styles.coverEnvironment} aria-label="권장 이용 환경">
          <span><i aria-hidden="true" /> Windows Chrome</span>
          <span><i aria-hidden="true" /> USB 조종기</span>
        </div>
      </header>

      <div className={styles.coverHero}>
        <div className={styles.coverCopy}>
          <p className={styles.coverEyebrow}>미래 직업 체험 · 항공모빌리티</p>
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
            <i aria-hidden="true">→</i>
          </button>

          <div
            className={`${styles.coverConnection} ${controllerReady ? styles.coverConnectionReady : ""}`}
            role="status"
            aria-live="polite"
          >
            <span className={styles.coverControllerIcon} aria-hidden="true">⌘</span>
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
            <li><span aria-hidden="true">01</span><strong>직접 조종</strong><small>시동부터 착륙까지</small></li>
            <li><span aria-hidden="true">02</span><strong>단계별 훈련</strong><small>쉽게 배우는 Mode 2</small></li>
            <li><span aria-hidden="true">03</span><strong>항공 임무</strong><small>직업을 체험하는 비행</small></li>
          </ul>

          <small className={styles.coverBrowserNote}>Chrome · Windows 노트북 권장</small>
        </div>

        <div className={styles.coverScene}>
          <div className={styles.coverSceneTopbar} aria-hidden="true">
            <span><i /> 실시간 3D 훈련장</span>
            <small>MODE 2</small>
          </div>
          <div className={styles.coverSceneCanvas} aria-hidden="true">
            <DroneVisual
              readTransform={readCoverDroneTransform}
              readScene={readCoverDroneScene}
            />
          </div>
          <div className={styles.coverSceneCaption} aria-hidden="true">
            <span>TRAINING 01</span>
            <strong>시동 · 이륙 · 비행 · 착륙</strong>
            <small>조종기를 연결하고 미래의 운항을 시작하세요.</small>
          </div>
        </div>
      </div>
    </section>
  );
}

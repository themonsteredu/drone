"use client";

import { useEffect, useRef } from "react";
import styles from "./experience-ui.module.css";
import type {
  ExperienceAction,
  ExperienceProgress,
  StudentGuideKind,
} from "./experience-types";

export interface ArmingHoldProgressProps {
  elapsedSeconds: number;
  durationSeconds?: number;
}

export function ArmingHoldProgress({
  elapsedSeconds,
  durationSeconds = 3,
}: ArmingHoldProgressProps) {
  const duration = Math.max(1, Math.round(durationSeconds));
  const elapsed = Math.max(0, Math.min(duration, elapsedSeconds));
  const seconds = Array.from({ length: duration }, (_, index) => index + 1);

  return (
    <div className={styles.armingProgress}>
      <ol aria-label={`${duration}초 시동 유지 진행`}>
        {seconds.map((second) => {
          const reached = elapsed >= second;
          const active = !reached && Math.floor(elapsed) + 1 === second;
          return (
            <li
              key={second}
              className={reached ? styles.complete : active ? styles.active : undefined}
              aria-current={active ? "step" : undefined}
            >
              <span>{second}</span>
              <small>{second}초</small>
            </li>
          );
        })}
      </ol>
      <progress value={elapsed} max={duration} aria-label="시동 스틱 유지 시간" />
      <p aria-live="polite">
        {elapsed >= duration
          ? "시동 위치를 유지했습니다."
          : `시동 위치를 ${Math.ceil(Math.max(0, duration - elapsed))}초 더 유지하세요.`}
      </p>
    </div>
  );
}

export interface StudentGuideOverlayProps {
  kind: StudentGuideKind;
  title: string;
  instruction: string;
  detail?: string;
  progress?: ExperienceProgress;
  armingElapsedSeconds?: number;
  armingDurationSeconds?: number;
  primaryAction?: ExperienceAction;
  secondaryAction?: ExperienceAction;
}

export function StudentGuideOverlay({
  kind,
  title,
  instruction,
  detail,
  progress,
  armingElapsedSeconds = 0,
  armingDurationSeconds = 3,
  primaryAction,
  secondaryAction,
}: StudentGuideOverlayProps) {
  const progressCurrent = progress
    ? Math.max(0, Math.min(progress.total, progress.current))
    : 0;
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [title]);

  return (
    <section
      className={`${styles.guideOverlay} ${styles[`guide_${kind}`]}`}
      role="dialog"
      aria-labelledby="student-guide-title"
      aria-describedby="student-guide-instruction"
    >
      <div className={styles.guidePanel}>
        <p className={styles.guideEyebrow}>
          {kind === "connect"
            ? "조종기 연결"
            : kind === "arming"
              ? "Mode 2 시동"
              : kind === "tutorial"
                ? "조종법 익히기"
                : "운항 체험 시작"}
        </p>
        <h2 id="student-guide-title" ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        <p id="student-guide-instruction" className={styles.guideInstruction}>
          {instruction}
        </p>
        {detail ? <p className={styles.guideDetail}>{detail}</p> : null}

        {progress ? (
          <div className={styles.lessonProgress}>
            <div>
              <span>{progress.label ?? "진행 단계"}</span>
              <strong>
                {progressCurrent} / {progress.total}
              </strong>
            </div>
            <progress value={progressCurrent} max={Math.max(1, progress.total)} />
          </div>
        ) : null}

        {kind === "arming" ? (
          <ArmingHoldProgress
            elapsedSeconds={armingElapsedSeconds}
            durationSeconds={armingDurationSeconds}
          />
        ) : null}

        {primaryAction || secondaryAction ? (
          <div className={styles.guideActions}>
            {secondaryAction ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={secondaryAction.onSelect}
                disabled={secondaryAction.disabled}
              >
                {secondaryAction.label}
              </button>
            ) : null}
            {primaryAction ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={primaryAction.onSelect}
                disabled={primaryAction.disabled}
              >
                {primaryAction.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

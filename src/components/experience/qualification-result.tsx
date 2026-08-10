"use client";

import { useEffect, useId, useRef } from "react";
import styles from "./experience-ui.module.css";
import type { ExperienceScoreItem } from "./experience-types";

export interface QualificationBadgeProps {
  qualified: boolean;
  score: number;
  label?: string;
}

export function QualificationBadge({
  qualified,
  score,
  label = qualified ? "운항 자격 획득" : "재도전 준비",
}: QualificationBadgeProps) {
  return (
    <div
      className={`${styles.qualificationBadge} ${qualified ? styles.badgeQualified : styles.badgeRetry}`}
      role="status"
      aria-label={`${label}, 총점 ${Math.round(score)}점`}
    >
      <div aria-hidden="true">{qualified ? "A" : "R"}</div>
      <span>{label}</span>
      <strong>{Math.round(score)}</strong>
      <small>100점 만점</small>
    </div>
  );
}

function RatingStars({ rating }: { rating: number }) {
  const safeRating = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className={styles.ratingStars} aria-label={`별점 5점 중 ${safeRating}점`}>
      <span aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (index < safeRating ? "★" : "☆")).join("")}
      </span>
    </span>
  );
}

export interface ExperienceResultScreenProps {
  variant: "qualification" | "mission";
  succeeded: boolean;
  heading: string;
  message: string;
  totalScore: number;
  scoreItems: readonly ExperienceScoreItem[];
  profileType: string;
  careerMessage?: string;
  onContinue?: () => void;
  onRetry?: () => void;
  continueLabel?: string;
  retryLabel?: string;
}

export function ExperienceResultScreen({
  variant,
  succeeded,
  heading,
  message,
  totalScore,
  scoreItems,
  profileType,
  careerMessage =
    "항공모빌리티 운항 전문가는 기체 조종뿐 아니라 안전, 경로, 환경 변화와 임무 성공을 함께 판단합니다.",
  onContinue,
  onRetry,
  continueLabel,
  retryLabel = "다시 도전",
}: ExperienceResultScreenProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [heading]);

  return (
    <section className={styles.resultScreen} aria-labelledby={titleId}>
      <div className={styles.resultHeading}>
        <p>{variant === "qualification" ? "조종 자격시험 결과" : "항공모빌리티 운항 결과"}</p>
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {heading}
        </h2>
        <span>{message}</span>
      </div>

      <div className={styles.resultContent}>
        <QualificationBadge
          qualified={succeeded}
          score={totalScore}
          label={
            variant === "qualification"
              ? succeeded
                ? "운항 자격 획득"
                : "다시 도전"
              : succeeded
                ? "임무 수행 완료"
                : "운항 연습 필요"
          }
        />

        <div className={styles.scoreBreakdown}>
          <h3>운항 평가</h3>
          <dl>
            {scoreItems.map((item) => (
              <div key={item.id}>
                <dt>{item.label}</dt>
                <dd>
                  {item.rating === undefined ? (
                    <strong>
                      {Math.round(item.score)} / {Math.round(item.maximum)}
                    </strong>
                  ) : (
                    <RatingStars rating={item.rating} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className={styles.profileSummary}>
        <span>이번 활동에서 나타난 강점</span>
        <strong>{profileType}</strong>
        <p>{careerMessage}</p>
      </div>

      {onContinue || onRetry ? (
        <div className={styles.resultActions}>
          {onRetry ? (
            <button type="button" className={styles.secondaryButton} onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
          {onContinue ? (
            <button type="button" className={styles.primaryButton} onClick={onContinue}>
              {continueLabel ??
                (succeeded ? "다음 단계로" : "훈련으로 돌아가기")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

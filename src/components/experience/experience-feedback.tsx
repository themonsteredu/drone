"use client";

import styles from "./experience-ui.module.css";
import type { ExperienceFeedbackItem } from "./experience-types";

export interface ExperienceFeedbackProps {
  items: readonly ExperienceFeedbackItem[];
  onDismiss?: (id: string) => void;
  accessibleLabel?: string;
}

export function ExperienceFeedback({
  items,
  onDismiss,
  accessibleLabel = "비행 안내",
}: ExperienceFeedbackProps) {
  if (items.length === 0) return null;

  return (
    <section className={styles.feedbackStack} aria-label={accessibleLabel}>
      {items.map((item) => {
        const urgent = item.tone === "emergency" || item.tone === "collision";
        return (
          <article
            key={item.id}
            className={`${styles.feedbackToast} ${styles[`feedback_${item.tone}`]}`}
            role={urgent ? "alert" : "status"}
          >
            <div>
              <strong>{item.title}</strong>
              {item.message ? <p>{item.message}</p> : null}
            </div>
            {onDismiss ? (
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                aria-label={`${item.title} 안내 닫기`}
              >
                닫기
              </button>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}


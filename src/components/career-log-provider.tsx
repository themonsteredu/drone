"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { CareerSubmissionClient, EMPTY_CAREER_STATE, readCareerContext, type CareerSubmissionState } from "../experience/career-log";
import styles from "./experience/experience-ui.module.css";

const CareerLogContext = createContext<{ client: CareerSubmissionClient | null; state: CareerSubmissionState }>({ client: null, state: EMPTY_CAREER_STATE });
const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const emptySnapshot = () => EMPTY_CAREER_STATE;

export function CareerLogProvider({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const client = useMemo(() => {
    if (!hydrated) return null;
    const context = readCareerContext(window.location.search);
    if (!context) return null;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Submission still works in memory. */ }
    return new CareerSubmissionClient(context, storage);
  }, [hydrated]);
  const state = useSyncExternalStore(client?.subscribe ?? subscribeToHydration, client?.getSnapshot ?? emptySnapshot, emptySnapshot);
  return (
    <CareerLogContext.Provider value={{ client, state }}>
      {state.pending && <aside className={styles.careerRecovery} aria-label="미전송 진로기록">
        <div><strong>{state.pending.raw_data.record.participant} · 미전송 운항 기록</strong>
          <p role="status">{state.sending ? "진로기록 저장을 확인하고 있어요…" : state.error || "앞서 작성한 기록이 남아 있어요. 같은 기록으로 제출을 다시 시도할 수 있어요."}</p>
          {state.storageUnavailable && <p>이 브라우저에서는 임시 보관이 안 돼요. 제출이 끝날 때까지 이 창을 유지해 주세요.</p>}
        </div>
        <button type="button" disabled={state.sending} onClick={() => { void client?.retry(); }}>다시 제출</button>
      </aside>}
      {state.completed && state.noticeVisible && <aside className={styles.careerRecovery}>
        <p role="status">{state.completed.submission.raw_data.record.participant} · {state.completed.submission.raw_data.record.mission.title} 기록 제출 완료<br />접수번호 {state.completed.receipt.recordId}</p>
        <button type="button" onClick={() => client?.dismissNotice()}>확인</button>
      </aside>}
      {children}
    </CareerLogContext.Provider>
  );
}

export function useCareerLog() { return useContext(CareerLogContext); }

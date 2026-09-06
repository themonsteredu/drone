"use client";

import { useState, type FormEvent } from "react";
import type { MissionDefinition, MissionRuntimeState } from "../experience";
import { createMissionActivityRecord, renderMissionActivityRecord } from "../experience/activity-record";
import styles from "./experience/experience-ui.module.css";

export function MissionActivityRecordForm({ mission, runtime, practice }: {
  mission: MissionDefinition;
  runtime: MissionRuntimeState;
  practice: boolean;
}) {
  const [participant, setParticipant] = useState("");
  const [reflection, setReflection] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = Boolean(participant.trim() && reflection.trim());

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    const share = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "share";
    setBusy(true);
    setMessage("");
    try {
      const record = createMissionActivityRecord(mission, runtime, { participant, reflection, practice }, {
        id: crypto.randomUUID(), recordedAt: new Date().toISOString(),
      });
      const file = new File([renderMissionActivityRecord(record)], `aviation-record-${record.recordedAt.slice(0, 10)}-${record.id.slice(0, 8)}.html`, { type: "text/html;charset=utf-8" });
      if (share && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "항공모빌리티 활동 기록" });
        setMessage("공유를 마쳤어요. 전달한 곳에서 파일을 확인해 주세요.");
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.append(link);
        try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000); }
        setMessage(share
          ? "이 기기에서는 파일 공유를 지원하지 않아 다운로드를 요청했어요. 받은 파일을 선생님께 제출해 주세요."
          : "파일 다운로드를 요청했어요. 다운로드 목록에서 확인한 뒤 선생님께 제출해 주세요.");
      }
    } catch (error) {
      setMessage(error instanceof Error && error.name === "AbortError"
        ? "공유를 취소했어요. 작성한 내용은 그대로 있어요."
        : "기록 파일을 전달하지 못했어요. 작성한 내용을 유지했으니 다시 저장해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.activityRecordForm} onSubmit={save} aria-label="운항 활동 기록">
      <div><h3>나의 운항 기록</h3><p>선택 이유와 점검·운항 결과가 함께 담겨요. 저장한 파일을 선생님께 제출하세요.</p></div>
      <div className={styles.activityRecordFields}>
        <label>이름 또는 모둠<input value={participant} onChange={(event) => { setParticipant(event.target.value); setMessage(""); }} disabled={busy} required maxLength={40} autoComplete="off" placeholder="예: 하늘 모둠" /></label>
        <label>다음 운항에서 바꿔볼 점<textarea value={reflection} onChange={(event) => { setReflection(event.target.value); setMessage(""); }} disabled={busy} required maxLength={240} rows={2} placeholder="예: 착륙장에 가까워지면 미리 속도를 줄이겠어요." /></label>
      </div>
      <div className={styles.activityRecordActions}>
        <button type="submit" value="download" disabled={!ready || busy}>{busy ? "파일 준비 중…" : "기록 파일 저장"}</button>
        <button type="submit" value="share" disabled={!ready || busy}>파일 공유</button>
        <span>온라인 자동 저장·제출은 되지 않아요.</span>
      </div>
      <p role="status" aria-live="polite" className={styles.activityRecordMessage}>{message}</p>
    </form>
  );
}

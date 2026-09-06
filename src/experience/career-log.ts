import type { MissionActivityRecord } from "./activity-record";

export const CAREER_PROGRAM_REF = "aviation-mobility-01";
export const CAREER_INGEST_URL = "https://hub.moakit.ai/api/career-log/ingest";
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface CareerContext { boardCode: string; studentId: string }
export interface CareerSubmission {
  program_ref: typeof CAREER_PROGRAM_REF;
  board_code: string;
  student_id: string;
  source_event_id: string;
  process: string;
  artifact: string;
  reflection: string;
  raw_data: { activity: "aviation-flight"; record: MissionActivityRecord };
}
export interface CareerReceipt { recordId: string; studentId: string; duplicate: boolean }

export function readCareerContext(search: string): CareerContext | null {
  const params = new URLSearchParams(search);
  if (params.getAll("hub_code").length !== 1 || params.getAll("student_id").length !== 1) return null;
  const boardCode = (params.get("hub_code") ?? "").trim().toLowerCase();
  const studentId = (params.get("student_id") ?? "").trim().toLowerCase();
  return /^[a-z0-9]{4,10}$/.test(boardCode) && UUID_V4.test(studentId) ? { boardCode, studentId } : null;
}

export function careerEventId(context: CareerContext, attemptId: string): string {
  return `${CAREER_PROGRAM_REF}:${context.boardCode}:${context.studentId}:${attemptId}`;
}

export function makeCareerSubmission(context: CareerContext, record: MissionActivityRecord): CareerSubmission {
  if (!/^[a-z0-9]{4,10}$/.test(context.boardCode) || !UUID_V4.test(context.studentId)) throw new Error("invalid_student_id");
  if (!UUID_V4.test(record.id) || record.practice || !record.reflection.trim() ||
      !["COMPLETED", "EXPIRED"].includes(record.outcome.status)) throw new Error("invalid_activity_record");
  return {
    program_ref: CAREER_PROGRAM_REF,
    board_code: context.boardCode,
    student_id: context.studentId,
    source_event_id: careerEventId(context, record.id),
    process: `${record.mission.title}에서 ${record.plan.label}을 선택했습니다. 선택 이유: ${record.plan.reason}`,
    artifact: `${record.outcome.status === "COMPLETED" ? "임무 완료" : "제한 시간 종료"} · ${record.result.totalScore}점 · 충돌 ${record.outcome.collisionCount}회 · 항로 이탈 ${record.outcome.corridorViolationCount}회`,
    reflection: record.reflection,
    raw_data: { activity: "aviation-flight", record },
  };
}

export function pendingStorageKey(context: CareerContext): string {
  return `moakit-drone-career-pending-v1:${context.boardCode}:${context.studentId}`;
}

/** Browser storage contains an unsent draft, never proof of a server save. */
export function readPendingSubmission(raw: string | null, context: CareerContext): CareerSubmission | null {
  if (!raw || raw.length > 50_000) return null;
  try {
    const value = JSON.parse(raw) as CareerSubmission;
    const record = value.raw_data?.record;
    if (value.program_ref !== CAREER_PROGRAM_REF || value.student_id !== context.studentId || value.board_code !== context.boardCode ||
        value.raw_data?.activity !== "aviation-flight" || !record || record.version !== 1 || record.practice !== false ||
        !UUID_V4.test(record.id) || value.source_event_id !== careerEventId(context, record.id) ||
        !["medical-delivery", "disaster-search"].includes(record.mission?.id) ||
        typeof record.mission.title !== "string" || typeof record.participant !== "string" || record.participant.length > 40 ||
        !["COMPLETED", "EXPIRED"].includes(record.outcome?.status) ||
        typeof value.process !== "string" || !value.process.trim() || value.process.length > 1000 ||
        typeof value.artifact !== "string" || value.artifact.length > 1000 ||
        typeof value.reflection !== "string" || !value.reflection.trim() || value.reflection.length > 240) return null;
    return value;
  } catch { return null; }
}

export function readCareerReceipt(value: unknown, context: CareerContext): CareerReceipt | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  return body.ok === true && typeof body.record_id === "string" && UUID_V4.test(body.record_id) &&
    body.student_id === context.studentId && typeof body.duplicate === "boolean"
    ? { recordId: body.record_id, studentId: body.student_id, duplicate: body.duplicate } : null;
}

export function careerErrorMessage(code: string): string {
  if (["site_closed", "board_not_open", "program_not_published"].includes(code)) return "수업이 닫혀 있어요. 선생님께 수업을 열어 달라고 요청해 주세요.";
  if (["career_program_not_assigned", "origin_not_allowed", "invalid_career_record"].includes(code)) return "이 수업의 드론 제출 연결을 확인해야 해요. 기록은 보관 중입니다.";
  if (["invalid_student_id", "invalid_board_code", "invalid_source_event_id"].includes(code)) return "학생·수업 연결을 확인해 주세요. 수업 보드에서 드론 체험을 열어 주세요.";
  if (code === "source_event_conflict") return "기록 정보가 일치하지 않아 제출을 멈췄어요. 선생님께 알려 주세요.";
  return "저장 확인을 받지 못했어요. 작성한 기록으로 다시 제출해 주세요.";
}

export async function sendCareerSubmission(
  submission: CareerSubmission,
  fetcher: typeof fetch = fetch,
): Promise<CareerReceipt> {
  const response = await fetcher(CAREER_INGEST_URL, {
    method: "POST", mode: "cors", credentials: "omit", redirect: "error",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "submission_failed");
  const receipt = readCareerReceipt(body, { boardCode: submission.board_code, studentId: submission.student_id });
  if (!receipt) throw new Error("invalid_receipt");
  return receipt;
}

export interface CareerSubmissionState {
  pending: CareerSubmission | null;
  completed: { submission: CareerSubmission; receipt: CareerReceipt } | null;
  sending: boolean;
  error: string;
  storageUnavailable: boolean;
  noticeVisible: boolean;
}

export const EMPTY_CAREER_STATE: CareerSubmissionState = {
  pending: null, completed: null, sending: false, error: "", storageUnavailable: false, noticeVisible: false,
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One unsent record per student/board. A retry always uses the frozen first payload. */
export class CareerSubmissionClient {
  private state: CareerSubmissionState;
  private listeners = new Set<() => void>();
  private inFlight: Promise<boolean> | null = null;

  constructor(
    readonly context: CareerContext,
    private storage: DraftStorage | null,
    private transmit: (submission: CareerSubmission) => Promise<CareerReceipt> = sendCareerSubmission,
  ) {
    this.state = { ...EMPTY_CAREER_STATE, storageUnavailable: !storage };
    try { this.state.pending = readPendingSubmission(storage?.getItem(pendingStorageKey(context)) ?? null, context); }
    catch { this.state.storageUnavailable = true; }
  }

  getSnapshot = (): CareerSubmissionState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dismissNotice = () => { this.update({ noticeVisible: false }); };
  private update(patch: Partial<CareerSubmissionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  submit(record: MissionActivityRecord): Promise<boolean> {
    const eventId = careerEventId(this.context, record.id);
    if (this.state.completed?.submission.source_event_id === eventId) return Promise.resolve(true);
    if (this.state.pending && this.state.pending.source_event_id !== eventId) {
      this.update({ error: "앞서 제출하지 못한 기록을 먼저 다시 제출해 주세요." });
      return Promise.resolve(false);
    }
    if (this.inFlight) return this.inFlight;
    if (!this.state.pending) {
      // Clone before storing: later form edits cannot change a record already sent.
      const pending = JSON.parse(JSON.stringify(makeCareerSubmission(this.context, record))) as CareerSubmission;
      let storageUnavailable = !this.storage;
      try { this.storage?.setItem(pendingStorageKey(this.context), JSON.stringify(pending)); }
      catch { storageUnavailable = true; }
      this.update({ pending, completed: null, storageUnavailable });
    }
    return this.retry();
  }

  retry(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    const pending = this.state.pending;
    if (!pending) return Promise.resolve(false);
    this.update({ sending: true, error: "" });
    this.inFlight = this.deliver(pending).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async deliver(pending: CareerSubmission): Promise<boolean> {
    try {
      const receipt = await this.transmit(pending);
      try { this.storage?.removeItem(pendingStorageKey(this.context)); }
      catch { /* A leftover draft is safe: the server deduplicates it on retry. */ }
      this.update({ pending: null, completed: { submission: pending, receipt }, sending: false, error: "", noticeVisible: true });
      return true;
    } catch (error) {
      this.update({ sending: false, error: careerErrorMessage(error instanceof Error ? error.message : "") });
      return false;
    }
  }
}

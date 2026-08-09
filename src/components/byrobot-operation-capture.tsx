"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ControllerInputFrameEntry } from "../controllers/adapters/byrobot-serial-base";
import {
  finishOperationDiscovery,
  recordOperationDiscoveryFrame,
  startOperationDiscovery,
  summarizeOperationDiscovery,
  type ControllerOperation,
  type ControllerProfileId,
  type OperationDiscoverySession,
} from "../controllers/profiles";

const OPERATION_LABEL: Readonly<Record<ControllerOperation, string>> = {
  start: "시동",
  takeoff: "이륙",
  landing: "착륙",
  emergency: "긴급",
};

const OPERATIONS = [
  "start",
  "takeoff",
  "landing",
  "emergency",
] as const satisfies readonly ControllerOperation[];

interface ByrobotOperationCaptureProps {
  sourceSessionKey: string | null;
  controllerProfileId: ControllerProfileId;
  controllerProfileName: string;
  deviceIdentity: string;
  frames: readonly ControllerInputFrameEntry[];
}

export function ByrobotOperationCapture({
  sourceSessionKey,
  controllerProfileId,
  controllerProfileName,
  deviceIdentity,
  frames,
}: ByrobotOperationCaptureProps) {
  const [activeOperation, setActiveOperation] =
    useState<ControllerOperation | null>(null);
  const [records, setRecords] = useState<
    Partial<Record<ControllerOperation, OperationDiscoverySession>>
  >({});
  const [message, setMessage] = useState(
    "기록할 동작을 선택한 뒤 실제 조종기에서 그 동작을 해 주세요.",
  );
  const lastFrameSequenceRef = useRef(0);
  const sessionRef = useRef(sourceSessionKey);

  useEffect(() => {
    if (sessionRef.current === sourceSessionKey) return;
    sessionRef.current = sourceSessionKey;
    lastFrameSequenceRef.current = frames.at(-1)?.sequence ?? 0;
    setActiveOperation(null);
    setRecords({});
    setMessage("조종기 연결 세션이 바뀌어 이전 임시 기록을 지웠습니다.");
  }, [frames, sourceSessionKey]);

  useEffect(() => {
    if (!activeOperation || !sourceSessionKey) return;
    const freshFrames = frames.filter(
      (entry) => entry.sequence > lastFrameSequenceRef.current,
    );
    if (freshFrames.length === 0) return;
    lastFrameSequenceRef.current = freshFrames.at(-1)?.sequence ?? 0;

    setRecords((current) => {
      const record = current[activeOperation];
      if (!record || record.status !== "recording") return current;
      let next = record;
      for (const { dataType, payload, receivedAt, from, to } of freshFrames) {
        next = recordOperationDiscoveryFrame(next, sourceSessionKey, {
          dataType,
          payload,
          receivedAt,
          from,
          to,
        });
      }
      return { ...current, [activeOperation]: next };
    });
  }, [activeOperation, frames, sourceSessionKey]);

  const recordCount = useMemo(
    () => Object.values(records).filter(Boolean).length,
    [records],
  );

  const toggleRecording = (
    operation: ControllerOperation,
    occurredAt: number,
  ) => {
    if (!sourceSessionKey) {
      setMessage("먼저 BYROBOT Serial 조종기를 연결하고 입력을 활성화해 주세요.");
      return;
    }
    if (activeOperation === operation) {
      setRecords((current) => {
        const record = current[operation];
        return record
          ? {
              ...current,
              [operation]: finishOperationDiscovery(record, occurredAt),
            }
          : current;
      });
      setActiveOperation(null);
      setMessage(`${OPERATION_LABEL[operation]} 동작 기록을 완료했습니다.`);
      return;
    }

    lastFrameSequenceRef.current = frames.at(-1)?.sequence ?? 0;
    const record = startOperationDiscovery({
      captureId: `${sourceSessionKey}:${operation}:${occurredAt}`,
      operation,
      sourceId: sourceSessionKey,
      profileId: controllerProfileId,
      controllerModel: controllerProfileName,
      protocol: deviceIdentity,
      startedAt: occurredAt,
    });
    setRecords((current) => ({ ...current, [operation]: record }));
    setActiveOperation(operation);
    setMessage(
      `${OPERATION_LABEL[operation]} 동작을 해 주세요. 끝나면 ‘기록 완료’를 누르세요.`,
    );
  };

  const copyRecords = async () => {
    try {
      const completedRecords = Object.values(records).filter(
        (record): record is OperationDiscoverySession => Boolean(record),
      );
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            format: "byrobot-controller-operation-capture-v2",
            exportedAt: Date.now(),
            deviceIdentity,
            summaries: completedRecords.map(summarizeOperationDiscovery),
            records,
          },
          null,
          2,
        ),
      );
      setMessage("기본 조작 확인 기록을 클립보드에 복사했습니다.");
    } catch {
      setMessage(
        "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.",
      );
    }
  };

  return (
    <section
      className="panel operation-capture-panel"
      aria-labelledby="operation-capture-title"
    >
      <div className="panel-heading">
        <div>
          <span>CONTROLLER PROFILE EVIDENCE</span>
          <h2 id="operation-capture-title">바이로봇 기본 조작 확인</h2>
        </div>
        <span className="candidate-tag">패킷 기록 전용</span>
      </div>

      <p className="operation-capture-intro">
        시동·이륙·착륙·긴급 동작 동안 CRC를 통과한 0x70 버튼과 0x71
        조이스틱 패킷을 표본 화면과 별도의 패킷 저널에서 수신 순서대로
        기록합니다. 이 자료는 자동 버튼
        설정에 사용되지 않으며, 제품 프로필을 검증할 때만 활용합니다.
      </p>

      <div className="operation-capture-grid">
        {OPERATIONS.map((operation) => {
          const record = records[operation];
          const active = activeOperation === operation;
          return (
            <article key={operation} className={active ? "is-recording" : ""}>
              <div>
                <span>{OPERATION_LABEL[operation]} 동작</span>
                <strong>
                  {active
                    ? `${record?.frames.length ?? 0}개 패킷 기록 중`
                    : record
                      ? `${record.frames.length}개 패킷`
                      : "기록 없음"}
                </strong>
              </div>
              <button
                type="button"
                aria-pressed={active}
                onClick={(event) =>
                  toggleRecording(
                    operation,
                    Math.round(performance.timeOrigin + event.timeStamp),
                  )
                }
              >
                {active
                  ? "기록 완료"
                  : `${OPERATION_LABEL[operation]} 기록 시작`}
              </button>
            </article>
          );
        })}
      </div>

      <div className="toolbar operation-capture-actions">
        <button
          type="button"
          onClick={() => void copyRecords()}
          disabled={recordCount === 0}
        >
          기록 복사
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveOperation(null);
            setRecords({});
            setMessage("기본 조작 확인 기록을 지웠습니다.");
          }}
          disabled={recordCount === 0 && !activeOperation}
        >
          기록 지우기
        </button>
      </div>
      <p className="operation-capture-message" role="status">
        {message}
      </p>
    </section>
  );
}

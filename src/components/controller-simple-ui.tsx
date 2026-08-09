"use client";

interface ControllerStatusPanelProps {
  serialSupported: boolean;
  supportChecked: boolean;
  portSelected: boolean;
  connected: boolean;
  serialConnected: boolean;
  stickInputOk: boolean;
  buttonInputOk: boolean;
  mappingComplete: boolean;
  ready: boolean;
  busy: boolean;
  error: string | null;
  notice: string;
  onSelectPort: () => void;
  onConnect: () => void;
  onActivateInput: () => void;
  onDisconnect: () => void;
}

interface StickInputPanelProps {
  axes: readonly number[];
  recentButtonNumber: number | null;
  connected: boolean;
}

function StatusRow({
  label,
  ok,
  waitingLabel,
}: {
  label: string;
  ok: boolean;
  waitingLabel: string;
}) {
  return (
    <li className={ok ? "simple-status-row is-ok" : "simple-status-row"}>
      <span className="simple-status-dot" aria-hidden="true" />
      <span>{label}</span>
      <strong>{ok ? "정상" : waitingLabel}</strong>
    </li>
  );
}

function StickGauge({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const safeValue = value === null ? 0 : Math.max(-1, Math.min(1, value));
  const position = ((safeValue + 1) / 2) * 100;

  return (
    <div className={value === null ? "simple-stick-gauge is-empty" : "simple-stick-gauge"}>
      <div>
        <span>{label}</span>
        <output aria-live="off">{value === null ? "—" : safeValue.toFixed(2)}</output>
      </div>
      <div
        className="simple-stick-track"
        role={value === null ? undefined : "meter"}
        aria-label={`${label} ${value === null ? "입력 없음" : "입력값"}`}
        aria-valuemin={value === null ? undefined : -1}
        aria-valuemax={value === null ? undefined : 1}
        aria-valuenow={value === null ? undefined : safeValue}
        aria-valuetext={value === null ? "입력 없음" : safeValue.toFixed(2)}
      >
        <i className="simple-stick-center" />
        <i className="simple-stick-marker" style={{ left: `${position}%` }} />
      </div>
      <small><span>−1</span><span>0</span><span>+1</span></small>
    </div>
  );
}

export function ControllerStatusPanel({
  serialSupported,
  supportChecked,
  portSelected,
  connected,
  serialConnected,
  stickInputOk,
  buttonInputOk,
  mappingComplete,
  ready,
  busy,
  error,
  notice,
  onSelectPort,
  onConnect,
  onActivateInput,
  onDisconnect,
}: ControllerStatusPanelProps) {
  const currentStatus = ready
    ? "조종 준비 완료"
    : connected && stickInputOk && buttonInputOk && !mappingComplete
      ? "조종 설정 필요"
    : connected
      ? "입력 확인 중"
      : "연결 필요";

  return (
    <aside className="pilot-card controller-status-card" aria-labelledby="simple-status-title">
      <div className="pilot-card-heading">
        <span>조종기 상태</span>
        <h2 id="simple-status-title">연결 상태</h2>
      </div>

      <ul className="simple-status-list">
        <StatusRow label="USB 연결" ok={connected} waitingLabel="연결 안 됨" />
        <StatusRow label="스틱 입력" ok={stickInputOk} waitingLabel="입력 없음" />
        <StatusRow label="버튼 입력" ok={buttonInputOk} waitingLabel="입력 없음" />
      </ul>

      <div className={ready ? "simple-ready-state is-ready" : "simple-ready-state"} role="status" aria-live="polite">
        <span>현재 상태</span>
        <strong>{currentStatus}</strong>
      </div>

      <div className="simple-connection-actions">
        <button
          type="button"
          onClick={onSelectPort}
          disabled={!serialSupported || serialConnected || busy}
        >
          조종기 선택
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={onConnect}
          disabled={!portSelected || serialConnected || busy}
        >
          연결하기
        </button>
        <button
          type="button"
          onClick={onActivateInput}
          disabled={!serialConnected || busy || (stickInputOk && buttonInputOk)}
        >
          입력 시작
        </button>
        <button
          type="button"
          className="is-quiet"
          onClick={onDisconnect}
          disabled={!serialConnected || busy}
        >
          연결 해제
        </button>
      </div>

      {!supportChecked ? <p className="simple-help">브라우저 기능을 확인하고 있습니다.</p> : null}
      {supportChecked && !serialSupported ? (
        <p className="simple-error" role="alert">
          이 브라우저에서는 조종기를 연결할 수 없습니다. Windows의 최신 Chrome으로 열어 주세요.
        </p>
      ) : null}
      {error ? <p className="simple-error" role="alert">{error}</p> : null}
      {!error ? <p className="simple-help">{notice}</p> : null}
    </aside>
  );
}

export function StickInputPanel({
  axes,
  recentButtonNumber,
  connected,
}: StickInputPanelProps) {
  const axis = (index: number) =>
    connected && Number.isFinite(axes[index]) ? axes[index] : null;

  return (
    <aside className="pilot-card stick-input-card" aria-labelledby="simple-input-title">
      <div className="pilot-card-heading">
        <span>실시간 조종값</span>
        <h2 id="simple-input-title">현재 입력</h2>
      </div>

      <section className="simple-stick-group" aria-labelledby="left-stick-title">
        <h3 id="left-stick-title">왼쪽 스틱</h3>
        <StickGauge label="상하" value={axis(1)} />
        <StickGauge label="좌우" value={axis(0)} />
      </section>

      <section className="simple-stick-group" aria-labelledby="right-stick-title">
        <h3 id="right-stick-title">오른쪽 스틱</h3>
        <StickGauge label="상하" value={axis(3)} />
        <StickGauge label="좌우" value={axis(2)} />
      </section>

      <div className="recent-button" aria-live="polite">
        <span>최근 눌린 버튼</span>
        <strong>{recentButtonNumber === null ? "아직 없음" : `${recentButtonNumber}번`}</strong>
      </div>
      <p className="simple-help">화면 값은 원본이며, 드론 조종에는 0.10 데드존이 적용됩니다.</p>
    </aside>
  );
}

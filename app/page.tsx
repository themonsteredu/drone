"use client";

import { useEffect, useRef, useState } from "react";

type InputState = {
  axes: number[];
  buttons: boolean[];
};

const DEMO_INPUT: InputState = {
  axes: [-0.03, 0.82, -0.65, 0.04],
  buttons: [false, true, false, false, false, false, false, false],
};

const AXES = [
  { label: "LEFT X", index: 0, accent: "lime" },
  { label: "LEFT Y", index: 1, accent: "lime" },
  { label: "RIGHT X", index: 2, accent: "orange" },
  { label: "RIGHT Y", index: 3, accent: "orange" },
] as const;

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

const formatAxis = (value: number) => {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(2)}`;
};

function AxisMeter({
  label,
  value,
  accent,
  onChange,
}: {
  label: string;
  value: number;
  accent: "lime" | "orange";
  onChange?: (value: number) => void;
}) {
  const position = `${((clamp(value) + 1) / 2) * 100}%`;

  return (
    <div className={`axis-row axis-row--${accent}`}>
      <div className="axis-label-group">
        <span className="axis-label">{label}</span>
        <span className="axis-value">{formatAxis(value)}</span>
      </div>
      <div className="axis-control">
        <span className="axis-limit">−1</span>
        <div className="axis-track" aria-hidden="true">
          <span className="axis-center" />
          <span className="axis-fill" style={{ width: position }} />
          <span className="axis-marker" style={{ left: position }} />
        </div>
        <span className="axis-limit">+1</span>
        {onChange ? (
          <input
            aria-label={`${label} 데모 값`}
            className="axis-range"
            max="1"
            min="-1"
            onChange={(event) => onChange(Number(event.target.value))}
            step="0.01"
            type="range"
            value={value}
          />
        ) : null}
      </div>
    </div>
  );
}

function StickVisualizer({
  name,
  x,
  y,
  accent,
}: {
  name: string;
  x: number;
  y: number;
  accent: "lime" | "orange";
}) {
  const dotX = `${50 + clamp(x) * 35}%`;
  const dotY = `${50 + clamp(y) * 35}%`;

  return (
    <div className={`stick-unit stick-unit--${accent}`}>
      <div className="stick-heading">
        <span>{name}</span>
        <span className="stick-coordinate">
          {formatAxis(x)} / {formatAxis(y)}
        </span>
      </div>
      <div className="stick-field">
        <span className="stick-ring stick-ring--outer" />
        <span className="stick-ring stick-ring--inner" />
        <span className="stick-cross stick-cross--horizontal" />
        <span className="stick-cross stick-cross--vertical" />
        <span className="stick-dot" style={{ left: dotX, top: dotY }}>
          <span />
        </span>
        <span className="stick-axis stick-axis--x">X</span>
        <span className="stick-axis stick-axis--y">Y</span>
      </div>
    </div>
  );
}

export default function ControllerTest() {
  const [demoInput, setDemoInput] = useState<InputState>(DEMO_INPUT);
  const [liveInput, setLiveInput] = useState<InputState | null>(null);
  const [controllerName, setControllerName] = useState("BATTLE CONTROLLER · DEMO");
  const [isDemo, setIsDemo] = useState(true);
  const [notice, setNotice] = useState("데모 신호를 수신하고 있습니다.");
  const animationFrame = useRef<number | null>(null);
  const lastUpdate = useRef(0);

  useEffect(() => {
    function pollGamepad(time: number) {
      if (time - lastUpdate.current > 32) {
        const gamepad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);

        if (gamepad) {
          const nextAxes = [0, 1, 2, 3].map((index) =>
            clamp(gamepad.axes[index] ?? 0),
          );
          const nextButtons = Array.from({ length: 8 }, (_, index) =>
            Boolean(gamepad.buttons[index]?.pressed),
          );
          setLiveInput({ axes: nextAxes, buttons: nextButtons });
          setControllerName(gamepad.id || "USB GAMEPAD");
          setIsDemo(false);
          setNotice("실제 조종기 입력을 실시간으로 수신하고 있습니다.");
        } else {
          setLiveInput(null);
        }
        lastUpdate.current = time;
      }

      animationFrame.current = requestAnimationFrame(pollGamepad);
    }

    const handleConnected = (event: GamepadEvent) => {
      setControllerName(event.gamepad.id || "USB GAMEPAD");
      setIsDemo(false);
      setNotice("USB 조종기가 연결되었습니다.");
    };

    const handleDisconnected = () => {
      setIsDemo(true);
      setControllerName("BATTLE CONTROLLER · DEMO");
      setNotice("조종기 연결이 해제되어 데모 신호로 전환했습니다.");
    };

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);
    animationFrame.current = requestAnimationFrame(pollGamepad);

    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
      if (animationFrame.current !== null) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  const activeInput = !isDemo && liveInput ? liveInput : demoInput;
  const hasPhysicalController = liveInput !== null;
  const pressedCount = activeInput.buttons.filter(Boolean).length;

  const signalStrength = Math.round(
    Math.max(...activeInput.axes.map((value) => Math.abs(value))) * 100,
  );

  const updateDemoAxis = (index: number, value: number) => {
    setDemoInput((current) => ({
      ...current,
      axes: current.axes.map((axis, axisIndex) =>
        axisIndex === index ? value : axis,
      ),
    }));
  };

  const toggleDemoButton = (index: number) => {
    if (!isDemo) return;
    setDemoInput((current) => ({
      ...current,
      buttons: current.buttons.map((button, buttonIndex) =>
        buttonIndex === index ? !button : button,
      ),
    }));
  };

  const scanForController = () => {
    const gamepad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
    if (gamepad) {
      setIsDemo(false);
      setControllerName(gamepad.id || "USB GAMEPAD");
      setNotice("USB 조종기를 찾았습니다. 입력을 확인하세요.");
      return;
    }

    setIsDemo(true);
    setControllerName("BATTLE CONTROLLER · DEMO");
    setNotice("USB 장치를 찾지 못해 데모 신호를 유지합니다.");
  };

  const resetDemo = () => {
    setIsDemo(true);
    setDemoInput(DEMO_INPUT);
    setControllerName("BATTLE CONTROLLER · DEMO");
    setNotice("제공된 테스트 값으로 초기화했습니다.");
  };

  return (
    <main className="app-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Battle Drone Lab 홈">
          <span className="brand-mark">BD</span>
          <span className="brand-copy">
            <strong>BATTLE DRONE LAB</strong>
            <small>CONTROL SYSTEMS</small>
          </span>
        </a>
        <div className="mission-status">
          <span className="mission-pulse" />
          <span>INPUT DIAGNOSTICS</span>
          <strong>READY</strong>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">
            <span>SYS / 04</span>
            FLIGHT CONTROLLER CHECK
          </p>
          <h1>
            배틀드론
            <br />
            <span>조종기 테스트</span>
          </h1>
          <p className="hero-description">
            스틱 축과 버튼 신호를 실시간으로 점검하세요. 실제 USB 조종기가
            감지되면 데모 신호에서 자동으로 전환됩니다.
          </p>
        </div>

        <div className="connection-card" aria-live="polite">
          <div className="connection-card__top">
            <span className="connection-icon" aria-hidden="true">
              USB
            </span>
            <span className={`source-tag ${isDemo ? "source-tag--demo" : ""}`}>
              {isDemo ? "DEMO" : "LIVE"}
            </span>
          </div>
          <p>USB 연결 상태</p>
          <div className="connection-state">
            <span className="status-dot" />
            <strong>연결됨</strong>
          </div>
          <span className="controller-name" title={controllerName}>
            {controllerName}
          </span>
          <button className="scan-button" onClick={scanForController} type="button">
            <span aria-hidden="true">↻</span>
            연결 다시 확인
          </button>
        </div>
      </section>

      <section className="console-panel" aria-label="조종기 입력 모니터">
        <div className="console-header">
          <div>
            <span className="section-kicker">LIVE MONITOR</span>
            <h2>스틱 입력</h2>
          </div>
          <div className="console-meta">
            <span>
              PEAK <strong>{signalStrength}%</strong>
            </span>
            <span>
              RATE <strong>30 Hz</strong>
            </span>
          </div>
        </div>

        <div className="console-grid">
          <div className="stick-visuals">
            <StickVisualizer
              accent="lime"
              name="LEFT STICK"
              x={activeInput.axes[0]}
              y={activeInput.axes[1]}
            />
            <StickVisualizer
              accent="orange"
              name="RIGHT STICK"
              x={activeInput.axes[2]}
              y={activeInput.axes[3]}
            />
          </div>

          <div className="axis-list">
            {AXES.map((axis) => (
              <AxisMeter
                accent={axis.accent}
                key={axis.label}
                label={axis.label}
                onChange={
                  isDemo
                    ? (value) => updateDemoAxis(axis.index, value)
                    : undefined
                }
                value={activeInput.axes[axis.index] ?? 0}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="button-panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">DIGITAL INPUT</span>
              <h2>버튼 상태</h2>
            </div>
            <span className="pressed-count">{pressedCount} ACTIVE</span>
          </div>
          <div className="button-grid">
            {activeInput.buttons.map((pressed, index) => (
              <button
                aria-pressed={pressed}
                className={`input-button ${pressed ? "input-button--active" : ""}`}
                key={index}
                onClick={() => toggleDemoButton(index)}
                type="button"
              >
                <span className="input-button__number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="input-button__state">
                  <i />
                  {pressed ? "ON" : "OFF"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <aside className="diagnostic-panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">SYSTEM LOG</span>
              <h2>진단 상태</h2>
            </div>
            <span className="diagnostic-check">✓</span>
          </div>
          <p className="notice" aria-live="polite">
            {notice}
          </p>
          <div className="diagnostic-list">
            <div>
              <span>입력 소스</span>
              <strong>{isDemo ? "시뮬레이션" : "USB 게임패드"}</strong>
            </div>
            <div>
              <span>축 범위</span>
              <strong>−1.00 — +1.00</strong>
            </div>
            <div>
              <span>브라우저 API</span>
              <strong>{hasPhysicalController ? "ACTIVE" : "STANDBY"}</strong>
            </div>
          </div>
          <button className="reset-button" onClick={resetDemo} type="button">
            테스트 값으로 초기화
          </button>
        </aside>
      </section>

      <footer>
        <span>BDL—CTRL / WEB GAMEPAD API</span>
        <p>조종기 버튼을 한 번 누르면 브라우저가 장치를 인식합니다.</p>
        <span>BUILD 01</span>
      </footer>
    </main>
  );
}

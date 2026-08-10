"use client";

import type {
  ControllerControlMode,
  FlightSpeedLevel,
  SimulatorPreferences,
  SimulatorSemanticAxis,
} from "../simulator/settings";
import type { SimulatorPreferencesUpdater } from "./use-simulator-preferences";

interface FlightSettingsPanelProps {
  preferences: SimulatorPreferences;
  axisCount: number;
  profileName: string;
  basicButtonsAvailable: boolean;
  onUpdate: (update: SimulatorPreferencesUpdater) => void;
  onReset: () => void;
}

const SPEED_OPTIONS: ReadonlyArray<{
  value: FlightSpeedLevel;
  label: string;
  percent: number;
}> = [
  { value: "beginner", label: "초보", percent: 35 },
  { value: "normal", label: "일반", percent: 65 },
  { value: "high", label: "고속", percent: 100 },
];

const CONTROL_MODE_OPTIONS: ReadonlyArray<{
  value: ControllerControlMode;
  label: string;
}> = [
  { value: "byrobot", label: "바이로봇 기본 조종" },
  { value: "custom", label: "사용자 설정" },
];

const AXIS_OPTIONS: ReadonlyArray<{
  control: SimulatorSemanticAxis;
  label: string;
}> = [
  { control: "throttle", label: "상승·하강" },
  { control: "yaw", label: "좌우 회전" },
  { control: "pitch", label: "전진·후진" },
  { control: "roll", label: "좌우 이동" },
];

function TogglePair({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <fieldset className="flight-setting-group compact-setting">
      <legend>{label}</legend>
      <div className="segmented-control">
        <button
          type="button"
          aria-pressed={!value}
          onClick={() => onChange(false)}
        >
          끔
        </button>
        <button
          type="button"
          aria-pressed={value}
          onClick={() => onChange(true)}
        >
          켬
        </button>
      </div>
    </fieldset>
  );
}

function RangeSetting({
  label,
  value,
  minimum,
  maximum,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flight-range-setting">
      <span>
        <b>{label}</b>
        <output>{displayValue}</output>
      </span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function FlightSettingsPanel({
  preferences,
  axisCount,
  profileName,
  basicButtonsAvailable,
  onUpdate,
  onReset,
}: FlightSettingsPanelProps) {
  const updateBoolean = (
    key: "headless" | "stabilization",
    value: boolean,
  ) => {
    onUpdate((current) => ({ ...current, [key]: value }));
  };

  const updateAxis = (
    control: SimulatorSemanticAxis,
    axisIndex: number,
  ) => {
    onUpdate((current) => {
      const mapping = {
        throttle: { ...current.customAxisMapping.throttle },
        yaw: { ...current.customAxisMapping.yaw },
        pitch: { ...current.customAxisMapping.pitch },
        roll: { ...current.customAxisMapping.roll },
      };
      const previousIndex = mapping[control].axisIndex;
      const occupied = AXIS_OPTIONS.find(
        (candidate) =>
          candidate.control !== control &&
          mapping[candidate.control].axisIndex === axisIndex,
      );
      if (occupied) mapping[occupied.control].axisIndex = previousIndex;
      mapping[control].axisIndex = axisIndex;
      return { ...current, customAxisMapping: mapping };
    });
  };

  const updateAxisInversion = (
    control: SimulatorSemanticAxis,
    inverted: boolean,
  ) => {
    onUpdate((current) => ({
      ...current,
      customAxisMapping: {
        ...current.customAxisMapping,
        [control]: {
          ...current.customAxisMapping[control],
          inverted,
        },
      },
    }));
  };

  return (
    <section className="flight-settings-panel" aria-labelledby="flight-settings-title">
      <div className="flight-settings-heading">
        <div>
          <span>수업용 조종 설정</span>
          <h3 id="flight-settings-title">비행 설정</h3>
        </div>
        <button type="button" className="settings-reset" onClick={onReset}>
          기본값 복원
        </button>
      </div>

      <div className="flight-settings-grid">
        <fieldset className="flight-setting-group speed-setting">
          <legend>비행 속도</legend>
          <div className="segmented-control three-options">
            {SPEED_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={preferences.speedLevel === option.value}
                onClick={() =>
                  onUpdate((current) => ({
                    ...current,
                    speedLevel: option.value,
                  }))
                }
              >
                {option.label}
                <small>{option.percent}%</small>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flight-setting-group control-mode-setting">
          <legend>조종 방식</legend>
          <div className="segmented-control control-mode-options">
            {CONTROL_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={preferences.controlMode === option.value}
                onClick={() =>
                  onUpdate((current) => ({
                    ...current,
                    controlMode: option.value,
                  }))
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <TogglePair
          label="헤드리스 모드"
          value={preferences.headless}
          onChange={(value) => updateBoolean("headless", value)}
        />
        <TogglePair
          label="자세 안정화"
          value={preferences.stabilization}
          onChange={(value) => updateBoolean("stabilization", value)}
        />
      </div>

      <div className="flight-range-grid">
        <RangeSetting
          label="중앙 무시 범위"
          value={preferences.deadZone}
          minimum={0}
          maximum={0.3}
          step={0.01}
          displayValue={preferences.deadZone.toFixed(2)}
          onChange={(deadZone) =>
            onUpdate((current) => ({ ...current, deadZone }))
          }
        />
        <RangeSetting
          label="조종 감도"
          value={preferences.sensitivity}
          minimum={0.5}
          maximum={1.5}
          step={0.05}
          displayValue={`${Math.round(preferences.sensitivity * 100)}%`}
          onChange={(sensitivity) =>
            onUpdate((current) => ({ ...current, sensitivity }))
          }
        />
      </div>

      {preferences.controlMode === "byrobot" ? (
        <div className="basic-profile-summary" role="status">
          <span>적용 중인 기본 프로필</span>
          <strong>{profileName}</strong>
          <small>
            {basicButtonsAvailable
              ? "확인된 기본 버튼 조작을 사용합니다."
              : "Mode 2 스틱 시동과 실제 스로틀 이착륙이 기본입니다. 화면 비행 버튼은 연결 점검과 수업 보조용입니다."}
          </small>
        </div>
      ) : (
        <section className="custom-axis-settings" aria-labelledby="custom-axis-title">
          <div>
            <span>학생 화면에서는 기본 조종을 권장합니다</span>
            <h4 id="custom-axis-title">사용자 축 설정</h4>
          </div>
          <div className="custom-axis-grid">
            {AXIS_OPTIONS.map(({ control, label }) => {
              const binding = preferences.customAxisMapping[control];
              return (
                <div className="custom-axis-row" key={control}>
                  <label>
                    <span>{label}</span>
                    <select
                      value={binding.axisIndex}
                      onChange={(event) =>
                        updateAxis(control, Number(event.target.value))
                      }
                    >
                      {Array.from(
                        { length: Math.max(4, axisCount) },
                        (_, index) => (
                          <option key={index} value={index}>
                            Axis {index}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="axis-invert-check">
                    <input
                      type="checkbox"
                      checked={binding.inverted}
                      onChange={(event) =>
                        updateAxisInversion(control, event.target.checked)
                      }
                    />
                    <span>방향 반전</span>
                  </label>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <details className="advanced-flight-settings">
        <summary>고급 설정</summary>
        <RangeSetting
          label="Expo"
          value={preferences.expo}
          minimum={0}
          maximum={0.8}
          step={0.05}
          displayValue={preferences.expo.toFixed(2)}
          onChange={(expo) =>
            onUpdate((current) => ({ ...current, expo }))
          }
        />
        <p>
          Expo가 클수록 스틱 중앙은 부드럽고, 끝부분은 최대 출력까지 크게 반응합니다.
        </p>
      </details>
    </section>
  );
}

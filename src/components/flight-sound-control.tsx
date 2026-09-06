"use client";

import { useEffect, useRef, useState } from "react";
import { FlightAudioEngine } from "../simulator/flight-audio";
import type { TouchdownSignal } from "../simulator/flight-feedback";
import type { FlightState } from "../simulator/flight-model";

interface FlightSoundControlProps {
  flight: FlightState;
  windStrength: number;
  active: boolean;
  touchdown: TouchdownSignal;
}

export function FlightSoundControl({ flight, windStrength, active, touchdown }: FlightSoundControlProps) {
  const [status, setStatus] = useState<"off" | "starting" | "on" | "unavailable">("off");
  const engineRef = useRef<FlightAudioEngine | null>(null);
  const mountedRef = useRef(false);
  const lastTouchdown = useRef(touchdown.sequence);

  useEffect(() => {
    mountedRef.current = true;
    const onVisibilityChange = () => {
      const engine = engineRef.current;
      if (!engine) return;
      // Only the explicit sound button may create an AudioContext.
      const change = document.hidden ? engine.suspend() : engine.resume();
      void change.catch(() => {
        if (!mountedRef.current || engineRef.current !== engine) return;
        engine.dispose();
        engineRef.current = null;
        setStatus("unavailable");
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    engine?.update(flight, windStrength, active);
    if (touchdown.sequence !== lastTouchdown.current) {
      lastTouchdown.current = touchdown.sequence;
      if (active && !document.hidden) engine?.touchdown(touchdown.strength);
    }
  }, [flight, windStrength, active, touchdown]);

  const toggleSound = async () => {
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
      setStatus("off");
      return;
    }
    setStatus("starting");
    try {
      const engine = new FlightAudioEngine(new AudioContext());
      engineRef.current = engine;
      lastTouchdown.current = touchdown.sequence;
      engine.update(flight, windStrength, active);
      await engine.resume();
      if (document.hidden) await engine.suspend();
      if (mountedRef.current && engineRef.current === engine) setStatus("on");
    } catch {
      engineRef.current?.dispose();
      engineRef.current = null;
      if (mountedRef.current) setStatus("unavailable");
    }
  };

  return (
    <div className="flight-sound-toolbar" data-sound-state={status}>
      <span role="status">{status === "unavailable" ? "소리를 재생할 수 없습니다. 화면 안내로 진행하세요." : "프로펠러 · 바람 · 착륙 소리"}</span>
      <button type="button" aria-pressed={status === "on"} disabled={status === "starting"} onClick={toggleSound}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          {status === "on" ? <path d="M15 8c3 2 3 6 0 8M18 5c5 4 5 10 0 14" /> : <path d="m16 9 6 6m0-6-6 6" />}
        </svg>
        {status === "starting" ? "소리 준비 중" : status === "on" ? "비행 소리 끄기" : "비행 소리 켜기"}
      </button>
    </div>
  );
}

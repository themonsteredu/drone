"use client";

import { useEffect, useRef } from "react";
import type { DroneTransform } from "../simulator/drone-transform";

interface DroneVisualProps {
  readTransform: () => DroneTransform;
}

function projectPoint(
  x: number,
  y: number,
  z: number,
  originX: number,
  originY: number,
  scale: number,
): [number, number] {
  return [
    originX + (x - z) * scale,
    originY + (x + z) * scale * 0.48 - y * scale * 1.35,
  ];
}

function drawDroneScene(
  canvas: HTMLCanvasElement,
  transform: DroneTransform,
  time: number,
  reduceMotion: boolean,
): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  context.clearRect(0, 0, w, h);

  const sky = context.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#eaf5ff");
  sky.addColorStop(0.58, "#f8fbff");
  sky.addColorStop(1, "#e3edf4");
  context.fillStyle = sky;
  context.fillRect(0, 0, w, h);

  const { position, rotation, tilt, rotorSpeed } = transform;
  const scale = Math.max(22, Math.min(42, w / 20));
  // The training drone remains in view while the test grid moves below it.
  const cameraX = position.x;
  const cameraZ = position.z;
  const originX = w * 0.5;
  const originY = h * 0.68;
  context.lineWidth = 1;
  for (let index = -8; index <= 8; index += 1) {
    const major = index % 4 === 0;
    context.strokeStyle = major
      ? "rgba(70, 122, 162, 0.23)"
      : "rgba(70, 122, 162, 0.11)";
    context.beginPath();
    let point = projectPoint(
      index - cameraX,
      0,
      -8 - cameraZ,
      originX,
      originY,
      scale,
    );
    context.moveTo(point[0], point[1]);
    point = projectPoint(
      index - cameraX,
      0,
      8 - cameraZ,
      originX,
      originY,
      scale,
    );
    context.lineTo(point[0], point[1]);
    context.stroke();

    context.beginPath();
    point = projectPoint(
      -8 - cameraX,
      0,
      index - cameraZ,
      originX,
      originY,
      scale,
    );
    context.moveTo(point[0], point[1]);
    point = projectPoint(
      8 - cameraX,
      0,
      index - cameraZ,
      originX,
      originY,
      scale,
    );
    context.lineTo(point[0], point[1]);
    context.stroke();
  }

  const ground = projectPoint(
    position.x - cameraX,
    0,
    position.z - cameraZ,
    originX,
    originY,
    scale,
  );
  const center = projectPoint(
    position.x - cameraX,
    position.y + 0.32,
    position.z - cameraZ,
    originX,
    originY,
    scale,
  );

  const shadowScale = Math.max(0.28, 1 - position.y * 0.08);
  context.save();
  context.translate(ground[0], ground[1] + 6);
  context.scale(1, 0.42);
  context.beginPath();
  context.arc(0, 0, 34 * shadowScale, 0, Math.PI * 2);
  context.fillStyle = `rgba(39, 57, 70, ${Math.max(0.08, 0.2 - position.y * 0.018)})`;
  context.fill();
  context.restore();

  const localRotors: Array<[number, number]> = [
    [-0.58, -0.58],
    [0.58, -0.58],
    [0.58, 0.58],
    [-0.58, 0.58],
  ];
  const cos = Math.cos(rotation.yaw);
  const sin = Math.sin(rotation.yaw);
  const rotorPoints = localRotors.map(([localX, localZ]) => {
    const worldX = position.x + localX * cos + localZ * sin;
    const worldZ = position.z - localX * sin + localZ * cos;
    const tiltHeight = localZ * tilt.pitch - localX * tilt.roll;
    return projectPoint(
      worldX - cameraX,
      position.y + 0.32 + tiltHeight,
      worldZ - cameraZ,
      originX,
      originY,
      scale,
    );
  });

  context.lineCap = "round";
  context.lineWidth = 9;
  context.strokeStyle = "#26384d";
  for (const point of rotorPoints) {
    context.beginPath();
    context.moveTo(center[0], center[1]);
    context.lineTo(point[0], point[1]);
    context.stroke();
  }

  const bladeAngle =
    reduceMotion || rotorSpeed < 0.01 ? 0 : time * 0.018 * rotorSpeed;
  rotorPoints.forEach((point, index) => {
    context.save();
    context.translate(point[0], point[1]);
    context.rotate(bladeAngle * (index % 2 === 0 ? 1 : -1));
    context.strokeStyle = `rgba(28, 51, 72, ${0.48 + rotorSpeed * 0.16})`;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(-23, 0);
    context.lineTo(23, 0);
    context.moveTo(0, -7);
    context.lineTo(0, 7);
    context.stroke();
    context.fillStyle = index < 2 ? "#ff8d48" : "#3f7cff";
    context.beginPath();
    context.arc(0, 0, 7, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });

  context.save();
  context.translate(center[0], center[1]);
  context.rotate(-tilt.roll * 0.65);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#1e3146";
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(-26, -16, 52, 32, 12);
  context.fill();
  context.stroke();
  context.fillStyle = "#306eff";
  context.beginPath();
  context.roundRect(-13, -8, 26, 16, 6);
  context.fill();
  context.restore();

  // Red line is intentionally retained as the aircraft-forward marker.
  const noseWorldX = position.x + Math.sin(rotation.yaw) * 0.78;
  const noseWorldZ = position.z + Math.cos(rotation.yaw) * 0.78;
  const nose = projectPoint(
    noseWorldX - cameraX,
    position.y + 0.34,
    noseWorldZ - cameraZ,
    originX,
    originY,
    scale,
  );
  context.strokeStyle = "#ff6c3b";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(center[0], center[1]);
  context.lineTo(nose[0], nose[1]);
  context.stroke();
}

export function DroneVisual({ readTransform }: DroneVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readTransformRef = useRef(readTransform);

  useEffect(() => {
    readTransformRef.current = readTransform;
  }, [readTransform]);

  useEffect(() => {
    let frame = 0;
    let reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reduceMotion = media.matches;
    };
    const tick = (time: number) => {
      const canvas = canvasRef.current;
      if (canvas) {
        drawDroneScene(
          canvas,
          readTransformRef.current(),
          time,
          reduceMotion,
        );
      }
      frame = window.requestAnimationFrame(tick);
    };
    media.addEventListener("change", updatePreference);
    frame = window.requestAnimationFrame(tick);
    return () => {
      media.removeEventListener("change", updatePreference);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div className="static-drone" aria-hidden="true">
        <i className="static-drone__arm static-drone__arm--one" />
        <i className="static-drone__arm static-drone__arm--two" />
        <i className="static-drone__rotor static-drone__rotor--one" />
        <i className="static-drone__rotor static-drone__rotor--two" />
        <i className="static-drone__rotor static-drone__rotor--three" />
        <i className="static-drone__rotor static-drone__rotor--four" />
        <b>BD</b>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="밝은 테스트 격자 위의 가상 드론. 빨간 선은 기체의 앞방향입니다."
        aria-describedby="flight-telemetry"
      >
        밝은 테스트 격자 위에 가상 드론 한 대가 있습니다.
      </canvas>
    </>
  );
}

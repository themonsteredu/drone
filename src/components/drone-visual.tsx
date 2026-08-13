"use client";

import { useEffect, useRef } from "react";
import type { DroneTransform } from "../simulator/drone-transform";
import { projectScenePoint } from "../simulator/scene-projection";
import {
  EMPTY_DRONE_SCENE,
  type DroneScenePresentation,
} from "../simulator/scene-presentation";

interface DroneVisualProps {
  readTransform: () => DroneTransform;
  readScene?: () => DroneScenePresentation;
}


const projectPoint = projectScenePoint;

function drawDroneScene(
  canvas: HTMLCanvasElement,
  transform: DroneTransform,
  scene: DroneScenePresentation,
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
  const isMedicalScene = scene.markers.some(
    (marker) => marker.kind === "hospital",
  );
  const isSearchScene = scene.markers.some(
    (marker) => marker.kind === "search-target",
  );

  const sky = context.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, isSearchScene ? "#92c9f4" : "#91d0ff");
  sky.addColorStop(0.5, "#eef8ff");
  sky.addColorStop(1, isSearchScene ? "#d8dfd0" : "#dbeaf3");
  context.fillStyle = sky;
  context.fillRect(0, 0, w, h);

  const sunlight = context.createRadialGradient(
    w * 0.78,
    h * 0.13,
    0,
    w * 0.78,
    h * 0.13,
    Math.max(w, h) * 0.38,
  );
  sunlight.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  sunlight.addColorStop(0.2, "rgba(214, 239, 255, 0.42)");
  sunlight.addColorStop(1, "rgba(214, 239, 255, 0)");
  context.fillStyle = sunlight;
  context.fillRect(0, 0, w, h);

  context.strokeStyle = "rgba(81, 132, 174, 0.18)";
  context.beginPath();
  context.moveTo(0, h * 0.5);
  context.lineTo(w, h * 0.5);
  context.stroke();

  const horizonY = h * 0.5;
  context.fillStyle = isSearchScene ? "#8eb17c" : "#a9cba5";
  context.beginPath();
  context.moveTo(0, horizonY + 15);
  for (let x = 0; x <= w; x += Math.max(24, w / 18)) {
    const rise = Math.sin(x * 0.019) * 9 + Math.sin(x * 0.007) * 17;
    context.lineTo(x, horizonY - 12 - rise);
  }
  context.lineTo(w, horizonY + 54);
  context.lineTo(0, horizonY + 54);
  context.closePath();
  context.fill();

  context.save();
  context.globalAlpha = 0.72;
  if (isMedicalScene) {
    const buildingWidth = Math.max(34, w / 20);
    for (let index = 0; index < 12; index += 1) {
      const x = index * (buildingWidth + 10) - 15;
      const heightVariation = 24 + ((index * 17) % 34);
      context.fillStyle = index % 3 === 0 ? "#dce9f1" : "#c7d8e4";
      context.fillRect(
        x,
        horizonY - heightVariation,
        buildingWidth,
        heightVariation,
      );
      context.fillStyle = "rgba(74, 135, 178, 0.2)";
      context.fillRect(x + 7, horizonY - heightVariation + 10, 5, 5);
      context.fillRect(x + 18, horizonY - heightVariation + 10, 5, 5);
    }
  } else if (isSearchScene) {
    context.fillStyle = "#c7b28e";
    for (let index = 0; index < 9; index += 1) {
      const x = index * (w / 8) - 30;
      const blockHeight = 17 + ((index * 11) % 22);
      context.fillRect(x, horizonY - blockHeight, 54, blockHeight);
      context.strokeStyle = "rgba(91, 76, 55, 0.35)";
      context.strokeRect(x, horizonY - blockHeight, 54, blockHeight);
    }
  }
  context.restore();

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
      ? "rgba(53, 111, 157, 0.28)"
      : "rgba(70, 122, 162, 0.12)";
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

  const routeMarker = scene.markers
    .filter(
      (marker) =>
        marker.active &&
        [
          "gate",
          "landing-pad",
          "hospital",
          "search-target",
          "arrow",
        ].includes(marker.kind),
    )
    .sort((left, right) => {
      const leftDistance = Math.hypot(
        left.position.x - position.x,
        left.position.z - position.z,
      );
      const rightDistance = Math.hypot(
        right.position.x - position.x,
        right.position.z - position.z,
      );
      return leftDistance - rightDistance;
    })[0];
  if (routeMarker) {
    const routePoint = projectPoint(
      routeMarker.position.x - cameraX,
      Math.max(0.03, routeMarker.position.y * 0.25),
      routeMarker.position.z - cameraZ,
      originX,
      originY,
      scale,
    );
    const routeGradient = context.createLinearGradient(
      originX,
      originY,
      routePoint[0],
      routePoint[1],
    );
    routeGradient.addColorStop(0, "rgba(44, 129, 255, 0.08)");
    routeGradient.addColorStop(1, "rgba(30, 190, 255, 0.44)");
    context.strokeStyle = routeGradient;
    context.lineWidth = 16;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(originX, originY + 5);
    context.lineTo(routePoint[0], routePoint[1]);
    context.stroke();
    context.strokeStyle = "rgba(229, 249, 255, 0.92)";
    context.setLineDash([10, 9]);
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(originX, originY + 5);
    context.lineTo(routePoint[0], routePoint[1]);
    context.stroke();
    context.setLineDash([]);
  }

  for (const marker of scene.markers) {
    const point = projectPoint(
      marker.position.x - cameraX,
      marker.position.y,
      marker.position.z - cameraZ,
      originX,
      originY,
      scale,
    );
    const radius = Math.max(0.35, marker.radius ?? 0.75) * scale;
    const color = marker.completed
      ? "#28a879"
      : marker.active
        ? "#ff7a3d"
        : "#4b78c8";

    context.save();
    if (marker.kind === "gate") {
      context.strokeStyle = color;
      context.lineWidth = marker.active ? 7 : 5;
      context.beginPath();
      context.ellipse(point[0], point[1], radius * 0.72, radius, 0, 0, Math.PI * 2);
      context.stroke();
    } else if (
      marker.kind === "start-pad" ||
      marker.kind === "landing-pad"
    ) {
      context.translate(point[0], point[1]);
      context.scale(1, 0.45);
      context.fillStyle = marker.active ? "rgba(255, 122, 61, 0.22)" : "rgba(48, 110, 255, 0.14)";
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      const ringScales =
        marker.kind === "landing-pad"
          ? [0.72, 0.46, 0.22]
          : [0.55];
      for (const ringScale of ringScales) {
        context.beginPath();
        context.arc(0, 0, radius * ringScale, 0, Math.PI * 2);
        context.stroke();
      }
      if (marker.kind === "landing-pad") {
        context.fillStyle = color;
        context.beginPath();
        context.arc(0, 0, Math.max(3, radius * 0.055), 0, Math.PI * 2);
        context.fill();
      }
    } else if (marker.kind === "building" || marker.kind === "hospital") {
      const buildingWidth = radius * 1.25;
      const buildingHeight = Math.max(30, radius * 1.8);
      context.fillStyle = marker.kind === "hospital" ? "#f4f8fb" : "#bfd2df";
      context.strokeStyle = marker.kind === "hospital" ? "#d95757" : "#718da2";
      context.lineWidth = 2;
      context.fillRect(
        point[0] - buildingWidth / 2,
        point[1] - buildingHeight,
        buildingWidth,
        buildingHeight,
      );
      context.strokeRect(
        point[0] - buildingWidth / 2,
        point[1] - buildingHeight,
        buildingWidth,
        buildingHeight,
      );
      if (marker.kind === "hospital") {
        context.fillStyle = "#d94040";
        context.font = '700 18px "S-Core Dream", sans-serif';
        context.textAlign = "center";
        context.fillText("H", point[0], point[1] - buildingHeight * 0.48);
      }
    } else if (marker.kind === "search-target") {
      const pulse = 1 + Math.sin(time * 0.004) * 0.12;
      context.strokeStyle = color;
      context.setLineDash([5, 5]);
      context.lineWidth = 3;
      context.beginPath();
      context.arc(point[0], point[1], radius * 0.55 * pulse, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = color;
      context.beginPath();
      context.arc(point[0], point[1], 5, 0, Math.PI * 2);
      context.fill();
    } else if (marker.kind === "wind-zone") {
      context.fillStyle = "rgba(73, 177, 218, 0.13)";
      context.strokeStyle = "rgba(45, 137, 179, 0.7)";
      context.setLineDash([8, 6]);
      context.beginPath();
      context.ellipse(point[0], point[1], radius, radius * 0.45, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else if (marker.kind === "arrow") {
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(point[0] - radius * 0.5, point[1]);
      context.lineTo(point[0] + radius * 0.5, point[1]);
      context.stroke();
      context.beginPath();
      context.moveTo(point[0] + radius * 0.5, point[1]);
      context.lineTo(point[0] + radius * 0.2, point[1] - 10);
      context.lineTo(point[0] + radius * 0.2, point[1] + 10);
      context.closePath();
      context.fill();
    }

    if (marker.label && marker.kind !== "building") {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = '700 12px "S-Core Dream", sans-serif';
      context.textAlign = "center";
      context.fillStyle = "#18324a";
      context.fillText(marker.label, point[0], point[1] - radius - 10);
    }
    context.restore();
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

  if (scene.collisionPulse) {
    const collisionEdge = context.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.2,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.72,
    );
    collisionEdge.addColorStop(0, "rgba(255, 93, 76, 0)");
    collisionEdge.addColorStop(0.7, "rgba(255, 93, 76, 0.03)");
    collisionEdge.addColorStop(1, "rgba(255, 74, 62, 0.34)");
    context.fillStyle = collisionEdge;
    context.fillRect(0, 0, w, h);
  }
}

export function DroneVisual({ readTransform, readScene }: DroneVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readTransformRef = useRef(readTransform);
  const readSceneRef = useRef(readScene);

  useEffect(() => {
    readTransformRef.current = readTransform;
  }, [readTransform]);

  useEffect(() => {
    readSceneRef.current = readScene;
  }, [readScene]);

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
          readSceneRef.current?.() ?? EMPTY_DRONE_SCENE,
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

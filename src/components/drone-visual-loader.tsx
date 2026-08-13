"use client";

import dynamic from "next/dynamic";
import type { DroneTransform } from "../simulator/drone-transform";
import type { DroneScenePresentation } from "../simulator/scene-presentation";

interface DroneVisualProps {
  readTransform: () => DroneTransform;
  readScene?: () => DroneScenePresentation;
}

const DynamicDroneThreeVisual = dynamic(
  () =>
    import("./drone-three-visual").then((module) => module.DroneThreeVisual),
  {
    ssr: false,
    loading: () => (
      <div className="drone-three-loading" role="status">
        <span />
        3D 훈련장을 준비하고 있습니다.
      </div>
    ),
  },
);

export function DroneVisual(props: DroneVisualProps) {
  return <DynamicDroneThreeVisual {...props} />;
}

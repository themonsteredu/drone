import type { FlightState } from "./flight-model";

export interface DroneTransform {
  position: { x: number; y: number; z: number };
  rotation: { yaw: number };
  tilt: { pitch: number; roll: number };
  rotorSpeed: number;
}

/** Stable render boundary: a future GLB/GLTF model only needs this transform. */
export function createDroneTransform(state: FlightState): DroneTransform {
  return {
    position: { ...state.position },
    rotation: { yaw: state.yaw },
    tilt: { ...state.tilt },
    rotorSpeed: state.rotorSpeed,
  };
}

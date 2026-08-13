export type DroneSceneMarkerKind =
  | "start-pad"
  | "landing-pad"
  | "gate"
  | "arrow"
  | "building"
  | "hospital"
  | "flight-corridor"
  | "search-target"
  | "wind-zone";

export interface DroneSceneMarker {
  id: string;
  kind: DroneSceneMarkerKind;
  position: { x: number; y: number; z: number };
  /** Gate plane normal; the visual and trigger must share this direction. */
  normal?: { x: number; y: number; z: number };
  /** Exact world-space obstacle dimensions when the source is a box volume. */
  size?: { x: number; y: number; z: number };
  /** Ordered centerline used by lightweight route/corridor visuals. */
  path?: readonly { x: number; y: number; z: number }[];
  radius?: number;
  label?: string;
  active?: boolean;
  completed?: boolean;
}

export interface DroneScenePresentation {
  markers: readonly DroneSceneMarker[];
  collisionPulse?: boolean;
}

export const EMPTY_DRONE_SCENE: DroneScenePresentation = { markers: [] };

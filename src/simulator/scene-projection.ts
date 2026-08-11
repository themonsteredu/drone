/**
 * Student-view projection. World +Z is the course/front direction and is
 * drawn toward the top of the screen; world +X is aircraft-right.
 */
export function projectScenePoint(
  x: number,
  y: number,
  z: number,
  originX: number,
  originY: number,
  scale: number,
): [number, number] {
  return [
    originX + x * scale,
    originY + x * scale * 0.24 - z * scale * 0.55 - y * scale * 1.35,
  ];
}

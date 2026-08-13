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

/**
 * Keeps short classroom exercises fixed in the world and only starts a
 * follow-camera after the aircraft reaches a safe screen margin.
 */
export function resolveSceneCamera(
  position: Readonly<{ x: number; z: number }>,
  lockToOrigin: boolean,
  safeX = 5,
  safeZ = 6,
): { x: number; z: number } {
  if (lockToOrigin) return { x: 0, z: 0 };
  const followOutside = (value: number, safeExtent: number) => {
    const extent = Math.max(0, safeExtent);
    return Math.sign(value) * Math.max(0, Math.abs(value) - extent);
  };
  return {
    x: followOutside(position.x, safeX),
    z: followOutside(position.z, safeZ),
  };
}

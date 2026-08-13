export type RenderQualityTier = "school-laptop" | "balanced";

export interface RenderCapabilitySnapshot {
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  devicePixelRatio?: number;
  prefersReducedMotion?: boolean;
}

export interface RenderQualityConfig {
  tier: RenderQualityTier;
  targetFps: number;
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  treeCount: number;
}

/**
 * Keeps the simulator usable on ordinary school laptops. The visual tier never
 * changes controller polling or flight physics; it only limits GPU work.
 */
export function selectRenderQuality(
  capability: RenderCapabilitySnapshot,
): RenderQualityConfig {
  const cores = capability.hardwareConcurrency ?? 4;
  const memory = capability.deviceMemoryGb ?? 4;
  const requestedPixelRatio = capability.devicePixelRatio ?? 1;
  const reducedMotion = capability.prefersReducedMotion ?? false;
  const isSchoolLaptop = cores <= 4 || memory <= 4 || reducedMotion;

  if (isSchoolLaptop) {
    return {
      tier: "school-laptop",
      targetFps: 30,
      pixelRatio: Math.min(requestedPixelRatio, 1),
      antialias: false,
      shadows: false,
      treeCount: 16,
    };
  }

  return {
    tier: "balanced",
    targetFps: 45,
    pixelRatio: Math.min(requestedPixelRatio, 1.25),
    antialias: true,
    shadows: true,
    treeCount: 30,
  };
}

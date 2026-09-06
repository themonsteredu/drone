import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/simulator/render-quality.ts", import.meta.url),
  "utf8",
);

function loadQualitySelector() {
  const transpiled = source
    .replace(/export type[\s\S]*?;\n\n/, "")
    .replace(/export interface[\s\S]*?\n}\n\n/g, "")
    .replace(/export function selectRenderQuality\(\n  capability: RenderCapabilitySnapshot,\n\): RenderQualityConfig/, "function selectRenderQuality(capability)")
    .concat("\nreturn selectRenderQuality;");
  return Function(transpiled)();
}

test("uses a conservative 30fps profile on a school laptop", () => {
  const selectRenderQuality = loadQualitySelector();
  const quality = selectRenderQuality({
    hardwareConcurrency: 4,
    deviceMemoryGb: 4,
    devicePixelRatio: 2,
  });

  assert.deepEqual(quality, {
    tier: "school-laptop",
    targetFps: 30,
    pixelRatio: 1,
    antialias: false,
    shadows: false,
    treeCount: 16,
  });
});

test("caps balanced rendering instead of using a full high-DPI workload", () => {
  const selectRenderQuality = loadQualitySelector();
  const quality = selectRenderQuality({
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    devicePixelRatio: 2.5,
  });

  assert.equal(quality.tier, "balanced");
  assert.equal(quality.targetFps, 45);
  assert.equal(quality.pixelRatio, 1.25);
  assert.equal(quality.shadows, true);
  assert.equal(quality.treeCount, 30);
});

test("the real-time 3D view is dynamically loaded without post-processing", async () => {
  const [loader, visual, resources, model] = await Promise.all([
    readFile(
      new URL("../src/components/drone-visual-loader.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/drone-three-visual.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/components/flight-scene-resources.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/industrial-drone-model.ts", import.meta.url), "utf8"),
  ]);

  assert.match(loader, /dynamic\(/);
  assert.match(loader, /ssr: false/);
  assert.match(visual, /powerPreference: "low-power"/);
  assert.match(resources, /InstancedMesh/);
  assert.match(model, /z > 0 \? frontMark : metal/);
  assert.match(model, /frontMark = new THREE.MeshStandardMaterial/);
  assert.match(resources, /textures\.values\(\).*texture\.dispose\(\)/);
  assert.match(visual, /LANDING_PAD_VISUAL_SCALE = 1\.18/);
  assert.match(visual, /DRONE_MODEL_LOWEST_Y = -0\.605/);
  assert.match(visual, /LANDING_PAD_SURFACE_Y - DRONE_MODEL_LOWEST_Y/);
  assert.match(visual, /CAMERA_GROUND_LOCK_HEIGHT = 0\.08/);
  assert.match(visual, /const grounded = transform\.position\.y <= 0\.02/);
  assert.match(visual, /grounded \? 0 : transform\.tilt\.pitch/);
  assert.match(visual, /grounded \? 0 : -transform\.tilt\.roll/);
  assert.match(visual, /new THREE\.RingGeometry/);
  assert.doesNotMatch(visual + resources, /EffectComposer|UnrealBloomPass/);
});

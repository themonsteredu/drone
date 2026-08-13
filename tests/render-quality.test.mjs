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
  const [loader, visual] = await Promise.all([
    readFile(
      new URL("../src/components/drone-visual-loader.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/drone-three-visual.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(loader, /dynamic\(/);
  assert.match(loader, /ssr: false/);
  assert.match(visual, /powerPreference: "low-power"/);
  assert.match(visual, /InstancedMesh/);
  assert.doesNotMatch(visual, /EffectComposer|UnrealBloomPass|textureLoader/i);
});

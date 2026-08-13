import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const url = new URL("../src/simulator/scene-projection.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: url.pathname,
}).outputText;
const loadedModule = { exports: {} };
new Function("module", "exports", compiled)(
  loadedModule,
  loadedModule.exports,
);
const { projectScenePoint, resolveSceneCamera } = loadedModule.exports;

test("student projection draws yaw zero forward and positive X to the right", () => {
  const center = projectScenePoint(0, 0, 0, 100, 100, 10);
  const forward = projectScenePoint(0, 0, 1, 100, 100, 10);
  const right = projectScenePoint(1, 0, 0, 100, 100, 10);

  assert.deepEqual(center, [100, 100]);
  assert.equal(forward[0], center[0]);
  assert.ok(forward[1] < center[1]);
  assert.ok(right[0] > center[0]);
});

test("tutorial camera stays fixed while long routes follow only past a safe margin", () => {
  assert.deepEqual(resolveSceneCamera({ x: 3, z: 4 }, true), { x: 0, z: 0 });
  assert.deepEqual(resolveSceneCamera({ x: 3, z: 4 }, false), { x: 0, z: 0 });
  assert.deepEqual(resolveSceneCamera({ x: 8, z: 10 }, false), { x: 3, z: 4 });
  assert.deepEqual(resolveSceneCamera({ x: -8, z: -10 }, false), { x: -3, z: -4 });
});

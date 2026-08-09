import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleCache = new Map();

function loadTypeScriptModule(url) {
  const key = url.href;
  if (moduleCache.has(key)) return moduleCache.get(key).exports;
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(key, loadedModule);
  const parentPath = fileURLToPath(url);
  new Function("require", "module", "exports", compiled)(
    (specifier) => {
      if (!specifier.startsWith(".")) {
        throw new Error(`Unexpected dependency: ${specifier}`);
      }
      let target = resolve(dirname(parentPath), specifier);
      if (!extname(target)) {
        target = existsSync(`${target}.ts`)
          ? `${target}.ts`
          : resolve(target, "index.ts");
      }
      return loadTypeScriptModule(pathToFileURL(target));
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const { GamepadControllerAdapter } = loadTypeScriptModule(
  new URL("../src/controllers/adapters/gamepad-adapter.ts", import.meta.url),
);

function gamepad(timestamp, axis = 0) {
  return {
    id: "Test Gamepad",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp,
    axes: [axis, 0, 0, 0],
    buttons: [{ pressed: false, touched: false, value: 0 }],
  };
}

test("a frozen supported Gamepad timestamp does not refresh control input", async () => {
  const adapter = new GamepadControllerAdapter(0);
  adapter.update(gamepad(100));
  const firstUpdatedAt = adapter.getState().updatedAt;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  adapter.update(gamepad(100));
  assert.equal(adapter.getState().updatedAt, firstUpdatedAt);
  assert.ok(adapter.getRawData().sampledAt > firstUpdatedAt);

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  adapter.update(gamepad(101));
  assert.ok(adapter.getState().updatedAt > firstUpdatedAt);
});

test("Gamepad implementations without timestamps retain polling fallback", async () => {
  const adapter = new GamepadControllerAdapter(0);
  adapter.update(gamepad(0));
  const firstUpdatedAt = adapter.getState().updatedAt;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  adapter.update(gamepad(0));
  assert.ok(adapter.getState().updatedAt > firstUpdatedAt);
});

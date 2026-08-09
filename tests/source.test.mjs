import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the battle drone controller interface", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /배틀드론 조종기 테스트/);
  assert.match(page, /USB 연결 상태/);
  assert.match(page, /LEFT X/);
  assert.match(page, /RIGHT Y/);
  assert.match(page, /navigator\.getGamepads/);
  assert.match(page, /gamepadconnected/);
});

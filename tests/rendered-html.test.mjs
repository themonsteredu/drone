import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the battle drone controller diagnostics", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>배틀드론 조종기 테스트<\/title>/i);
  assert.match(html, /배틀드론/);
  assert.match(html, /조종기 테스트/);
  assert.match(html, /USB 연결 상태/);
  assert.match(html, /LEFT X/);
  assert.match(html, /RIGHT Y/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

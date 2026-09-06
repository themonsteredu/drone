import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const cache = new Map();
function load(path) {
  const url = typeof path === "string" ? new URL(path, import.meta.url) : path;
  if (cache.has(url.href)) return cache.get(url.href).exports;
  const loadedModule = { exports: {} };
  cache.set(url.href, loadedModule);
  const source = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: url.pathname,
  }).outputText;
  new Function("require", "module", "exports", source)((specifier) => {
    const base = new URL(specifier, url);
    const resolved = [new URL(base.href + ".ts"), new URL(base.href + "/index.ts")].find(candidate => existsSync(candidate));
    if (!resolved) throw new Error(`Unexpected dependency: ${specifier}`);
    return load(resolved);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const career = load("../src/experience/career-log.ts");
const { createMissionActivityRecord } = load("../src/experience/activity-record.ts");
const missions = load("../src/experience/missions.ts");
const context = { boardCode: "ab1234", studentId: "11111111-1111-4111-8111-111111111111" };
const receipt = { ok: true, duplicate: false, record_id: "22222222-2222-4222-8222-222222222222", student_id: context.studentId };

function activity(mission = missions.MEDICAL_DELIVERY_MISSION) {
  let state = missions.selectMissionPlan(mission, missions.createMissionRuntimeState(mission), mission.plans[0].id);
  state = missions.updateMissionPreflight(mission, state, { planReason: "강풍 구역을 피해 안전하게 운항하려고" });
  for (const item of mission.preflightChecklist) state = missions.updateMissionPreflight(mission, state, { item, checked: true });
  state = missions.confirmMissionPreflight(mission, state);
  state = { ...state, status: "EXPIRED", elapsedSeconds: mission.timeLimitSeconds, collisionCount: 2 };
  return createMissionActivityRecord(mission, state, { participant: "하늘 모둠", reflection: "미리 속도를 줄여 착륙하겠어요.", practice: false }, {
    id: state.attemptId, recordedAt: new Date().toISOString(),
  });
}
function storage() {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
}

test("only a single valid Hub student/board pair links the app; no fallback identity is created", () => {
  assert.deepEqual(career.readCareerContext(`?hub_code=AB1234&student_id=${context.studentId}`), context);
  for (const query of ["", "?hub_code=ab1234", "?hub_code=ab1234&student_id=하늘모둠", `?hub_code=ab1234&hub_code=cd3456&student_id=${context.studentId}`, `?hub_code=bad/code&student_id=${context.studentId}`]) {
    assert.equal(career.readCareerContext(query), null);
  }
});

test("each mission attempt has one UUID through plan selection and flight steps, and reset gets a new one", () => {
  const mission = missions.MEDICAL_DELIVERY_MISSION;
  const initial = missions.createMissionRuntimeState(mission);
  assert.match(initial.attemptId, career.UUID_V4);
  const selected = missions.selectMissionPlan(mission, initial, mission.plans[0].id);
  assert.equal(selected.attemptId, initial.attemptId);
  const stepped = missions.stepMission(mission, selected, { elapsedSeconds: 1, position: mission.startPosition, speedLevel: 1, movementMagnitude: 0, throttleMagnitude: 0 });
  assert.equal(stepped.state.attemptId, initial.attemptId);
  assert.notEqual(missions.createMissionRuntimeState(mission).attemptId, initial.attemptId);
});

test("submission includes actual route, checks and outcomes, rejects practice, and targets only the fixed Hub API", async () => {
  for (const mission of [missions.MEDICAL_DELIVERY_MISSION, missions.DISASTER_SEARCH_MISSION]) {
    const record = activity(mission);
    const body = career.makeCareerSubmission(context, record);
    assert.equal(body.raw_data.record.outcome.collisionCount, 2);
    assert.ok(body.raw_data.record.preflight.every(item => item.checked));
    assert.match(body.process, /강풍 구역/);
    assert.throws(() => career.makeCareerSubmission(context, { ...record, practice: true }));
    const result = await career.sendCareerSubmission(body, async (url, options) => {
      assert.equal(url, "https://hub.moakit.ai/api/career-log/ingest");
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.deepEqual(JSON.parse(options.body), body);
      return Response.json(receipt, { status: 201 });
    });
    assert.equal(result.recordId, receipt.record_id);
  }
});

test("failed requests retain the first payload across refresh; another attempt cannot overwrite it", async () => {
  const draftStorage = storage();
  const original = activity();
  let firstBody;
  const first = new career.CareerSubmissionClient(context, draftStorage, async body => {
    firstBody = JSON.stringify(body);
    throw new Error("network_error");
  });
  assert.equal(await first.submit(original), false);
  original.reflection = "전송 후 바뀐 문장";
  assert.notEqual(first.getSnapshot().pending.reflection, original.reflection);
  assert.equal(await first.submit(activity()), false);
  assert.equal(JSON.stringify(first.getSnapshot().pending), firstBody);
  const reloaded = new career.CareerSubmissionClient(context, draftStorage, async body => {
    assert.equal(JSON.stringify(body), firstBody);
    return career.readCareerReceipt({ ...receipt, duplicate: true }, context);
  });
  assert.equal(await reloaded.retry(), true);
  assert.equal(reloaded.getSnapshot().completed.receipt.duplicate, true);
  assert.equal(draftStorage.getItem(career.pendingStorageKey(context)), null);
});

test("rapid submit/retry shares one request, and acknowledged attempts do not submit again", async () => {
  let resolve;
  let calls = 0;
  const client = new career.CareerSubmissionClient(context, storage(), () => {
    calls += 1;
    return new Promise(done => { resolve = done; });
  });
  const record = activity();
  const first = client.submit(record);
  const second = client.submit(record);
  const third = client.retry();
  assert.equal(calls, 1);
  assert.equal(client.getSnapshot().completed, null);
  assert.equal(client.getSnapshot().sending, true);
  resolve(career.readCareerReceipt(receipt, context));
  assert.deepEqual(await Promise.all([first, second, third]), [true, true, true]);
  assert.equal(await client.submit(record), true);
  assert.equal(calls, 1);
});

test("a 2xx alone, wrong student, or missing receipt never marks a submission complete", async () => {
  for (const body of [{}, { ok: true }, { ...receipt, student_id: "33333333-3333-4333-8333-333333333333" }, { ...receipt, record_id: "not-a-receipt" }]) {
    const client = new career.CareerSubmissionClient(context, storage(), submission => career.sendCareerSubmission(submission, async () => Response.json(body)));
    assert.equal(await client.submit(activity()), false);
    assert.equal(client.getSnapshot().completed, null);
    assert.ok(client.getSnapshot().pending);
  }
  const submission = career.makeCareerSubmission(context, activity());
  await assert.rejects(career.sendCareerSubmission(submission, async () => Response.json({ error: "board_not_open" }, { status: 404 })), /board_not_open/);
});

test("draft recovery rejects different students, boards, practice records and corrupt data", () => {
  const body = career.makeCareerSubmission(context, activity());
  const raw = JSON.stringify(body);
  assert.deepEqual(career.readPendingSubmission(raw, context), body);
  assert.equal(career.readPendingSubmission(raw, { ...context, boardCode: "cd3456" }), null);
  assert.equal(career.readPendingSubmission(raw, { ...context, studentId: receipt.record_id }), null);
  assert.equal(career.readPendingSubmission("null", context), null);
  assert.equal(career.readPendingSubmission("broken", context), null);
  body.raw_data.record.practice = true;
  assert.equal(career.readPendingSubmission(JSON.stringify(body), context), null);
});

test("blocked session storage does not prevent submission and never claims refresh recovery", async () => {
  const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } };
  const client = new career.CareerSubmissionClient(context, blocked, async () => career.readCareerReceipt(receipt, context));
  assert.equal(client.getSnapshot().storageUnavailable, true);
  assert.equal(await client.submit(activity()), true);
  assert.equal(client.getSnapshot().completed.receipt.recordId, receipt.record_id);
});

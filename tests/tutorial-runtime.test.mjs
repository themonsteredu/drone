import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, dependencies = {}) {
  const url = new URL(path, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: url.pathname,
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", compiled)(
    loaded,
    loaded.exports,
    (name) => dependencies[name],
  );
  return loaded.exports;
}

const geometry = load("../src/experience/geometry.ts");
const tutorial = load("../src/experience/tutorial-runtime.ts", {
  "./geometry": geometry,
});

const steps = [
  {
    id: "armed",
    order: 1,
    title: "시동",
    instruction: "시동",
    successMessage: "완료",
    criterion: { kind: "flight_event", event: "armed" },
  },
  {
    id: "height",
    order: 2,
    title: "이륙",
    instruction: "이륙",
    successMessage: "완료",
    criterion: { kind: "minimum_altitude", meters: 1 },
  },
];

test("advances one hands-on tutorial criterion at a time", () => {
  let state = tutorial.createTutorialRuntimeState({
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    flightPhase: "READY",
  });
  let update = tutorial.stepTutorial(steps, state, {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    flightPhase: "ARMED",
  });
  assert.equal(update.stepCompleted, true);
  assert.equal(update.state.stepIndex, 1);
  update = tutorial.stepTutorial(steps, update.state, {
    position: { x: 0, y: 1.05, z: 0 },
    yaw: 0,
    flightPhase: "FLIGHT",
  });
  assert.equal(update.state.completed, true);
});

test("recognizes assisted screen takeoff after the armed step", () => {
  const takeoffStep = {
    id: "takeoff",
    order: 2,
    title: "이륙",
    instruction: "이륙",
    successMessage: "완료",
    criterion: { kind: "flight_event", event: "takeoff" },
  };
  const armed = tutorial.createTutorialRuntimeState({
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    flightPhase: "ARMED",
  });
  const takingOff = tutorial.stepTutorial([takeoffStep], armed, {
    position: { x: 0, y: 0.5, z: 0 },
    yaw: 0,
    flightPhase: "TAKEOFF",
  });
  assert.equal(takingOff.stepCompleted, false);
  const flying = tutorial.stepTutorial([takeoffStep], takingOff.state, {
    position: { x: 0, y: 1.4, z: 0 },
    yaw: 0,
    flightPhase: "FLIGHT",
  });
  assert.equal(flying.stepCompleted, true);
  assert.equal(flying.state.completed, true);
});

test("right yaw uses wrapped positive semantic direction", () => {
  const step = {
    id: "yaw",
    order: 1,
    title: "회전",
    instruction: "회전",
    successMessage: "완료",
    criterion: { kind: "yaw_delta", radians: Math.PI / 3, direction: "right" },
  };
  const state = tutorial.createTutorialRuntimeState({
    position: { x: 0, y: 1, z: 0 }, yaw: 3, flightPhase: "FLIGHT",
  });
  assert.equal(
    tutorial.tutorialCriterionSatisfied(step, state, {
      position: { x: 0, y: 1, z: 0 }, yaw: -2.1, flightPhase: "FLIGHT",
    }),
    true,
  );
});

test("forward and right tutorial targets follow the aircraft heading", () => {
  const state = tutorial.createTutorialRuntimeState({
    position: { x: 1, y: 1, z: 2 },
    yaw: Math.PI / 2,
    flightPhase: "FLIGHT",
  });
  const criterion = (direction) => ({
    id: direction,
    order: 1,
    title: direction,
    instruction: direction,
    successMessage: "완료",
    criterion: {
      kind: "body_relative_distance",
      direction,
      meters: 2,
    },
  });
  assert.equal(
    tutorial.tutorialCriterionSatisfied(criterion("forward"), state, {
      position: { x: 3.1, y: 1, z: 2 },
      yaw: Math.PI / 2,
      flightPhase: "FLIGHT",
    }),
    true,
  );
  assert.equal(
    tutorial.tutorialCriterionSatisfied(criterion("right"), state, {
      position: { x: 1, y: 1, z: -0.1 },
      yaw: Math.PI / 2,
      flightPhase: "FLIGHT",
    }),
    true,
  );
});

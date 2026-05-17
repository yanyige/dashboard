import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("data/check-smoke");
rmSync(root, { recursive: true, force: true });

run([
  "register-agent",
  "--id",
  "steward",
  "--name",
  "Context Steward",
  "--role",
  "context_steward",
  "--skills",
  "context,task-design"
]);

run([
  "create-project",
  "--id",
  "empty-project",
  "--title",
  "Empty Project",
  "--goal",
  "Verify a project with no tasks is flagged for intake."
]);

run([
  "create-project",
  "--id",
  "ready-project",
  "--title",
  "Ready Project",
  "--goal",
  "Verify a project with ready work is on track."
]);

const task = jsonRun([
  "publish-task",
  "--project",
  "ready-project",
  "--title",
  "Ready work",
  "--objective",
  "Prepare one task so the scheduled check can detect executable work.",
  "--json"
]);

jsonRun([
  "prepare-task",
  "--project",
  "ready-project",
  "--task",
  task.task.id,
  "--steward",
  "steward",
  "--brief",
  "This task is ready for an executor.",
  "--criterion",
  "Task remains ready.",
  "--deliverable",
  "A ready task.",
  "--json"
]);

const check = jsonRun([
  "check-projects",
  "--updated-by",
  "codex-thread",
  "--note",
  "scheduled test check",
  "--json"
]);

assert.equal(check.check.id, "check-0001");
assert.equal(check.check.project_count, 2);
assert.equal(check.results.length, 2);

const emptyResult = check.results.find(
  (result) => result.project_id === "empty-project"
);
const readyResult = check.results.find(
  (result) => result.project_id === "ready-project"
);

assert.equal(emptyResult.health, "at_risk");
assert.equal(readyResult.health, "on_track");

const checks = jsonRun(["list-project-checks", "--json"]);
assert.equal(checks.checks.length, 1);
assert.equal(checks.checks[0].id, "check-0001");

const shown = jsonRun([
  "show-project-check",
  "--check",
  "check-0001",
  "--json"
]);
assert.equal(shown.check.results.length, 2);

const emptyDashboard = jsonRun([
  "show-project-dashboard",
  "--project",
  "empty-project",
  "--json"
]);
assert.equal(emptyDashboard.dashboard.latest_status.check_run_id, "check-0001");

console.log("project check smoke passed");

function run(args) {
  return execFileSync(process.execPath, [
    "scripts/ccc.mjs",
    "--root",
    root,
    ...args
  ], {
    cwd: resolve("."),
    encoding: "utf8"
  });
}

function jsonRun(args) {
  return JSON.parse(run(args));
}

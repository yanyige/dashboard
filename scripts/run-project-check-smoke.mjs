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
  "archived-project",
  "--title",
  "Archived Project",
  "--goal",
  "Verify archived projects stay visible without active-work risk."
]);

jsonRun([
  "publish-task",
  "--project",
  "archived-project",
  "--title",
  "Historical draft",
  "--objective",
  "Remain visible after project archival.",
  "--json"
]);

const archived = jsonRun([
  "archive-project",
  "--project",
  "archived-project",
  "--archived-by",
  "steward",
  "--reason",
  "Duplicate project record.",
  "--json"
]);
assert.equal(archived.project.status, "archived");
assert.equal(archived.project.health, "done");

assert.throws(
  () =>
    run([
      "publish-task",
      "--project",
      "archived-project",
      "--title",
      "Should not publish",
      "--objective",
      "Archived projects should reject active work."
    ]),
  /Archived project cannot publish tasks/
);

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
assert.equal(check.check.project_count, 3);
assert.equal(check.results.length, 3);

const emptyResult = check.results.find(
  (result) => result.project_id === "empty-project"
);
const readyResult = check.results.find(
  (result) => result.project_id === "ready-project"
);
const archivedResult = check.results.find(
  (result) => result.project_id === "archived-project"
);

assert.equal(emptyResult.health, "at_risk");
assert.equal(readyResult.health, "on_track");
assert.equal(archivedResult.health, "done");
assert.match(archivedResult.summary, /archived/i);

const checks = jsonRun(["list-project-checks", "--json"]);
assert.equal(checks.checks.length, 1);
assert.equal(checks.checks[0].id, "check-0001");

const shown = jsonRun([
  "show-project-check",
  "--check",
  "check-0001",
  "--json"
]);
assert.equal(shown.check.results.length, 3);

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
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function jsonRun(args) {
  return JSON.parse(run(args));
}

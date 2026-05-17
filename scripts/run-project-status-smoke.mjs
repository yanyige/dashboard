import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("data/status-smoke");
rmSync(root, { recursive: true, force: true });

run([
  "create-project",
  "--id",
  "status-demo",
  "--title",
  "Status Demo",
  "--goal",
  "Verify thread-owned Context Steward project status updates.",
  "--context-summary",
  "The Codex thread acts as Context Steward for project reporting."
]);

const firstStatus = jsonRun([
  "update-project-status",
  "--project",
  "status-demo",
  "--health",
  "on_track",
  "--summary",
  "Project is initialized and ready for task intake.",
  "--updated-by",
  "codex-thread",
  "--progress",
  "Project and context snapshot exist.",
  "--next-action",
  "Publish first project-scoped task.",
  "--json"
]);

assert.equal(firstStatus.status_update.id, "status-0001");
assert.equal(firstStatus.project.health, "on_track");
assert.equal(firstStatus.project.current_status_update_id, "status-0001");
assert.equal(firstStatus.status_update.task_counts.total, 0);

jsonRun([
  "publish-task",
  "--project",
  "status-demo",
  "--title",
  "Create first task",
  "--objective",
  "Add the first visible task for the project dashboard.",
  "--priority",
  "high",
  "--json"
]);

const secondStatus = jsonRun([
  "update-project-status",
  "--project",
  "status-demo",
  "--health",
  "at_risk",
  "--summary",
  "Project has intake, but the first task still needs context preparation.",
  "--risk",
  "Draft task cannot be claimed until context is prepared.",
  "--next-action",
  "Prepare task-0001.",
  "--json"
]);

assert.equal(secondStatus.status_update.id, "status-0002");
assert.equal(secondStatus.status_update.task_counts.draft, 1);
assert.equal(secondStatus.status_update.context_counts.missing, 1);

const dashboard = jsonRun([
  "show-project-dashboard",
  "--project",
  "status-demo",
  "--json"
]);

assert.equal(dashboard.dashboard.project.health, "at_risk");
assert.equal(dashboard.dashboard.latest_status.id, "status-0002");
assert.equal(dashboard.dashboard.task_summary.total, 1);
assert.equal(dashboard.dashboard.task_hall.length, 1);

const history = jsonRun([
  "list-project-status",
  "--project",
  "status-demo",
  "--json"
]);

assert.equal(history.status_updates.length, 2);

console.log("project status smoke passed");

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

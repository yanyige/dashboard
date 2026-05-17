import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("data/cli-smoke");
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
  "context,task-design,project-memory"
]);

run([
  "register-agent",
  "--id",
  "builder",
  "--name",
  "Builder",
  "--role",
  "executor",
  "--skills",
  "node,workflow"
]);

const createdProject = jsonRun([
  "create-project",
  "--id",
  "cli-demo",
  "--title",
  "CLI Demo",
  "--goal",
  "Verify lifecycle commands against the shared control center core.",
  "--context-summary",
  "CLI smoke test context.",
  "--tech-stack",
  "Node.js,JSON",
  "--json"
]);
assert.equal(createdProject.project.current_context_snapshot_id, "context-0001");

const publishedTask = jsonRun([
  "publish-task",
  "--project",
  "cli-demo",
  "--title",
  "Exercise CLI lifecycle",
  "--objective",
  "Move one task through the complete command-driven lifecycle.",
  "--skills",
  "node,workflow",
  "--json"
]);
assert.equal(publishedTask.task.status, "draft");

const preparedTask = jsonRun([
  "prepare-task",
  "--project",
  "cli-demo",
  "--task",
  publishedTask.task.id,
  "--steward",
  "steward",
  "--brief",
  "Run a CLI smoke task through ready, claimed, in_progress, review, and done.",
  "--criterion",
  "Task reaches done.",
  "--criterion",
  "Project context advances.",
  "--deliverable",
  "Accepted delivery.",
  "--skills",
  "node,workflow",
  "--json"
]);
assert.equal(preparedTask.task.status, "ready");

const claimedTask = jsonRun([
  "claim-task",
  "--project",
  "cli-demo",
  "--task",
  publishedTask.task.id,
  "--agent",
  "builder",
  "--json"
]);
assert.equal(claimedTask.task.status, "claimed");

const startedTask = jsonRun([
  "start-task",
  "--project",
  "cli-demo",
  "--task",
  publishedTask.task.id,
  "--agent",
  "builder",
  "--json"
]);
assert.equal(startedTask.task.status, "in_progress");

const deliveredTask = jsonRun([
  "deliver-task",
  "--project",
  "cli-demo",
  "--task",
  publishedTask.task.id,
  "--agent",
  "builder",
  "--summary",
  "The command-driven lifecycle completed through delivery submission.",
  "--verification",
  "CLI smoke assertions passed.",
  "--followup",
  "Add command examples::Document each lifecycle command in README.::medium::markdown",
  "--json"
]);
assert.equal(deliveredTask.task.status, "review");

const acceptedDelivery = jsonRun([
  "accept-delivery",
  "--project",
  "cli-demo",
  "--task",
  publishedTask.task.id,
  "--steward",
  "steward",
  "--context-update",
  "CLI lifecycle commands are verified by a smoke test.",
  "--json"
]);
assert.equal(acceptedDelivery.task.status, "done");
assert.equal(acceptedDelivery.delivery.status, "accepted");
assert.equal(acceptedDelivery.project.current_context_snapshot_id, "context-0002");
assert.equal(acceptedDelivery.followup_tasks.length, 1);

const listedTasks = jsonRun([
  "list-tasks",
  "--project",
  "cli-demo",
  "--json"
]);
assert.equal(listedTasks.tasks.length, 2);

console.log("cli smoke passed");

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

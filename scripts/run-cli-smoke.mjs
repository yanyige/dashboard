import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("data/cli-smoke");
const repoRoot = resolve("data/cli-smoke-repo");
rmSync(root, { recursive: true, force: true });
rmSync(repoRoot, { recursive: true, force: true });
mkdirSync(repoRoot, { recursive: true });
writeFileSync(
  resolve(repoRoot, "README.md"),
  [
    "# CLI Demo README",
    "",
    "The README provides the latest CLI demo context.",
    "",
    "## P0",
    "",
    "- Support README-driven context refresh.",
    ""
  ].join("\n")
);

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
  "--repo-path",
  repoRoot,
  "--context-summary",
  "CLI smoke test context.",
  "--tech-stack",
  "Node.js,JSON",
  "--json"
]);
assert.equal(createdProject.project.current_context_snapshot_id, "context-0001");

const refreshedProject = jsonRun([
  "refresh-project-context",
  "--project",
  "cli-demo",
  "--updated-by",
  "steward",
  "--json"
]);
assert.equal(refreshedProject.context.id, "context-0002");
assert.match(refreshedProject.context.summary, /CLI Demo README/);
assert.deepEqual(refreshedProject.context.requirements.p0, [
  "Support README-driven context refresh."
]);

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
assert.match(preparedTask.task.execution_package.handoff_prompt, /deliver-task/);
assert.match(preparedTask.task.execution_package.handoff_prompt, /status to `review`/);

const claimableTasks = jsonRun([
  "list-claimable-tasks",
  "--project",
  "cli-demo",
  "--agent",
  "builder",
  "--json"
]);
assert.deepEqual(
  claimableTasks.tasks.map((task) => task.id),
  [publishedTask.task.id]
);

const claimedTask = jsonRun([
  "claim-next-task",
  "--project",
  "cli-demo",
  "--agent",
  "builder",
  "--acceptance-note",
  "Builder accepted the CLI smoke lifecycle task.",
  "--plan",
  "Claim, start, deliver, and wait for steward acceptance.",
  "--eta",
  "Immediate smoke run.",
  "--json"
]);
assert.equal(claimedTask.task.status, "claimed");
assert.equal(
  claimedTask.task.agent_acceptance.note,
  "Builder accepted the CLI smoke lifecycle task."
);
assert.equal(
  claimedTask.task.agent_acceptance.plan,
  "Claim, start, deliver, and wait for steward acceptance."
);

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
  "--ai-detection-status",
  "passed",
  "--ai-detection-summary",
  "CLI smoke delivery includes explicit verification.",
  "--ai-finding",
  "No missing verification was detected.",
  "--followup",
  "Add command examples::Document each lifecycle command in README.::medium::markdown",
  "--json"
]);
assert.equal(deliveredTask.task.status, "review");
assert.equal(deliveredTask.delivery.ai_detection.status, "passed");

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
  "--review-summary",
  "Accepted after checking CLI smoke delivery evidence.",
  "--json"
]);
assert.equal(acceptedDelivery.task.status, "done");
assert.equal(acceptedDelivery.delivery.status, "accepted");
assert.equal(acceptedDelivery.delivery.review.reviewed_by, "steward");
assert.equal(acceptedDelivery.project.current_context_snapshot_id, "context-0003");
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

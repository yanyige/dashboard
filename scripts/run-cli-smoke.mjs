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

run([
  "register-agent",
  "--id",
  "reviewer",
  "--name",
  "Delivery Reviewer",
  "--role",
  "reviewer",
  "--skills",
  "review,qa"
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

const ownerBinding = jsonRun([
  "set-project-owner",
  "--project",
  "cli-demo",
  "--thread",
  "cli-owner-thread",
  "--name",
  "CLI Owner Thread",
  "--assigned-by",
  "steward",
  "--json"
]);
assert.equal(ownerBinding.project.owner_thread.thread_id, "cli-owner-thread");

const ownerDashboard = jsonRun([
  "show-project-dashboard",
  "--project",
  "cli-demo",
  "--json"
]);
assert.match(ownerDashboard.dashboard.owner_thread_prompt, /claim-next-thread-message/);
assert.match(ownerDashboard.dashboard.owner_thread_prompt, /reply-thread-message/);

const createdThreadMessage = jsonRun([
  "create-thread-message",
  "--project",
  "cli-demo",
  "--sender-id",
  "web-owner",
  "--sender-name",
  "Dashboard User",
  "--content",
  "请汇报 CLI 项目当前状态。",
  "--json"
]);
assert.equal(createdThreadMessage.message.status, "pending");
assert.equal(createdThreadMessage.message.owner_thread_id, "cli-owner-thread");

const claimedThreadMessage = jsonRun([
  "claim-next-thread-message",
  "--project",
  "cli-demo",
  "--processed-by",
  "cli-owner-thread",
  "--json"
]);
assert.equal(claimedThreadMessage.message.id, createdThreadMessage.message.id);
assert.equal(claimedThreadMessage.message.status, "processing");
assert.equal(claimedThreadMessage.message.processed_by, "cli-owner-thread");

const repliedThreadMessage = jsonRun([
  "reply-thread-message",
  "--project",
  "cli-demo",
  "--message",
  createdThreadMessage.message.id,
  "--processed-by",
  "cli-owner-thread",
  "--reply",
  "CLI 项目已完成 Thread Inbox 领取和回复闭环验证。",
  "--json"
]);
assert.equal(repliedThreadMessage.message.status, "replied");
assert.equal(
  repliedThreadMessage.dashboard.thread_inbox_summary.replied_ids[0],
  createdThreadMessage.message.id
);

const noPendingThreadMessage = jsonRun([
  "claim-next-thread-message",
  "--project",
  "cli-demo",
  "--processed-by",
  "cli-owner-thread",
  "--json"
]);
assert.equal(noPendingThreadMessage.message, null);

const failingThreadMessage = jsonRun([
  "create-thread-message",
  "--project",
  "cli-demo",
  "--sender-id",
  "web-owner",
  "--content",
  "这条消息用于验证失败回写。",
  "--json"
]);
const claimedFailingThreadMessage = jsonRun([
  "claim-next-thread-message",
  "--project",
  "cli-demo",
  "--processed-by",
  "cli-owner-thread",
  "--json"
]);
assert.equal(claimedFailingThreadMessage.message.id, failingThreadMessage.message.id);

const failedThreadMessage = jsonRun([
  "fail-thread-message",
  "--project",
  "cli-demo",
  "--message",
  failingThreadMessage.message.id,
  "--processed-by",
  "cli-owner-thread",
  "--error",
  "缺少外部项目上下文，等待人工补充。",
  "--json"
]);
assert.equal(failedThreadMessage.message.status, "failed");
assert.equal(failedThreadMessage.dashboard.thread_inbox_summary.failed_ids.length, 1);

const listedThreadMessages = jsonRun([
  "list-thread-messages",
  "--project",
  "cli-demo",
  "--status",
  "failed",
  "--json"
]);
assert.equal(listedThreadMessages.messages.length, 1);

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

const agentsAfterDelivery = jsonRun([
  "list-agents",
  "--json"
]);
const builderAfterDelivery = agentsAfterDelivery.agents.find(
  (agent) => agent.id === "builder"
);
assert.equal(builderAfterDelivery.status, "available");
assert.deepEqual(builderAfterDelivery.active_task_ids, []);

const acceptedDelivery = jsonRun([
  "accept-delivery",
  "--project",
  "cli-demo",
  "--task",
  publishedTask.task.id,
  "--steward",
  "steward",
  "--reviewer",
  "reviewer",
  "--context-update",
  "CLI lifecycle commands are verified by a smoke test.",
  "--review-summary",
  "Accepted after checking CLI smoke delivery evidence.",
  "--json"
]);
assert.equal(acceptedDelivery.task.status, "done");
assert.equal(acceptedDelivery.delivery.status, "accepted");
assert.equal(acceptedDelivery.task.reviewed_by, "reviewer");
assert.equal(acceptedDelivery.task.context_updated_by, "steward");
assert.equal(acceptedDelivery.delivery.review.reviewed_by, "reviewer");
assert.equal(acceptedDelivery.delivery.review.context_steward_id, "steward");
assert.equal(acceptedDelivery.project.current_context_snapshot_id, "context-0003");
assert.equal(acceptedDelivery.followup_tasks.length, 1);

const auditEvents = jsonRun([
  "list-audit-events",
  "--project",
  "cli-demo",
  "--type",
  "delivery.accepted",
  "--json"
]);
assert.equal(auditEvents.events.length, 1);
assert.equal(auditEvents.events[0].task_id, publishedTask.task.id);
assert.equal(auditEvents.events[0].reviewer_id, "reviewer");
assert.equal(auditEvents.events[0].context_steward_id, "steward");

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

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ControlCenter } from "../src/control-center.mjs";

const root = resolve("data/demo");
const center = new ControlCenter({ root });
center.reset();

const contextSteward = center.registerAgent({
  id: "agent-context-steward",
  name: "Context Steward Agent",
  role: "context_steward",
  skills: ["context", "task-design", "project-memory"]
});

const builderAgent = center.registerAgent({
  id: "agent-builder-001",
  name: "Builder Agent 001",
  role: "executor",
  skills: ["node", "markdown", "workflow"]
});

const { project } = center.createProject({
  id: "codex-control-center-demo",
  title: "Codex Control Center Demo",
  goal: "Prove the first version of project-scoped Agent task orchestration.",
  repo_path: resolve("."),
  tech_stack: ["Node.js", "JSON file store", "Markdown templates"],
  constraints: [
    "Every task must belong to exactly one project.",
    "Execution agents should receive a prepared task package before claiming work.",
    "Project context must advance after accepted delivery."
  ],
  roadmap: [
    "Register agents in the employee center.",
    "Publish project-scoped tasks into the task hall.",
    "Prepare task context before execution.",
    "Accept delivery and generate follow-up work."
  ],
  context_summary:
    "The demo project validates the control loop for publishing, preparing, claiming, delivering, reviewing, and creating follow-up tasks.",
  created_by: "human-owner"
});

const draftTask = center.publishTask({
  project_id: project.id,
  title: "Run the core task-hall workflow",
  objective:
    "Demonstrate that a project task can move from draft to ready, then to execution, review, done, and follow-up creation.",
  priority: "high",
  required_skills: ["node", "workflow"],
  created_by: "human-owner"
});

assert.equal(draftTask.status, "draft");
assert.equal(draftTask.context_status, "missing");

const readyTask = center.prepareTask({
  project_id: project.id,
  task_id: draftTask.id,
  steward_id: contextSteward.id,
  task_brief:
    "Use the demo control center to show the full lifecycle of one project-level task. Keep all generated state inside data/demo.",
  relevant_files: [
    "src/control-center.mjs",
    "scripts/run-core-flow.mjs",
    "data/demo/projects/codex-control-center-demo/project.json"
  ],
  acceptance_criteria: [
    "Task status reaches done after delivery acceptance.",
    "Agent returns to available after the task is accepted.",
    "Project context advances to a newer snapshot.",
    "A follow-up task is published back into the task hall."
  ],
  deliverables: [
    "Accepted delivery record",
    "Updated project context snapshot",
    "Generated follow-up task"
  ],
  required_skills: ["node", "workflow"]
});

assert.equal(readyTask.status, "ready");
assert.equal(readyTask.context_status, "ready");
assert.equal(readyTask.context_snapshot_id, "context-0001");

const claimedTask = center.claimTask({
  project_id: project.id,
  task_id: readyTask.id,
  agent_id: builderAgent.id
});

assert.equal(claimedTask.status, "claimed");
assert.equal(center.getAgent(builderAgent.id).status, "busy");

const inProgressTask = center.startTask({
  project_id: project.id,
  task_id: claimedTask.id,
  agent_id: builderAgent.id
});

assert.equal(inProgressTask.status, "in_progress");

const { task: reviewTask, delivery } = center.deliverTask({
  project_id: project.id,
  task_id: inProgressTask.id,
  agent_id: builderAgent.id,
  summary:
    "Completed the demo workflow and produced the files needed to inspect each state transition.",
  files_changed: [
    "data/demo/agents/registry.json",
    "data/demo/projects/codex-control-center-demo/tasks/task-0001.json",
    "data/demo/projects/codex-control-center-demo/deliveries/delivery-0001.json"
  ],
  verification: [
    "Node assertions verified state transitions.",
    "Generated summary file records final task and context state."
  ],
  ai_detection: {
    status: "passed",
    summary: "No risky output or missing verification was detected in the demo delivery.",
    findings: ["Delivery evidence includes state transition verification."]
  },
  followups: [
    {
      title: "Prepare CLI commands for real project operations",
      objective:
        "Add commands for registering agents, publishing tasks, preparing context, claiming tasks, and accepting deliveries outside the demo flow."
    }
  ]
});

assert.equal(reviewTask.status, "review");
assert.equal(delivery.status, "submitted");
assert.equal(center.getAgent(builderAgent.id).status, "available");
assert.deepEqual(center.getAgent(builderAgent.id).active_task_ids, []);

const accepted = center.acceptDelivery({
  project_id: project.id,
  task_id: reviewTask.id,
  steward_id: contextSteward.id,
  context_update:
    "The project now has a verified V1 control loop. Future work should expose reusable commands instead of relying on the demo script.",
  review_summary:
    "Accepted because the delivery included assertions, changed-state evidence, and follow-up work.",
  followups: delivery.followups
});

assert.equal(accepted.task.status, "done");
assert.equal(accepted.delivery.status, "accepted");
assert.equal(accepted.delivery.ai_detection.status, "passed");
assert.equal(accepted.delivery.review.reviewed_by, contextSteward.id);
assert.equal(accepted.delivery.review.decision, "accepted");
assert.equal(accepted.project.current_context_snapshot_id, "context-0002");
assert.equal(center.getAgent(builderAgent.id).status, "available");
assert.equal(accepted.followup_tasks.length, 1);
assert.equal(accepted.followup_tasks[0].status, "draft");

const agentScores = center.listAgentScores();
const builderScore = agentScores.find((score) => score.agent_id === builderAgent.id);
assert.equal(builderScore.score_total, 10);
assert.equal(builderScore.score_completed_tasks, 1);
assert.match(builderScore.last_score_reason, /Accepted delivery/);

const auditEvents = center.listAuditEvents({
  project_id: project.id
});
const acceptedAuditEvent = auditEvents.find(
  (event) => event.type === "delivery.accepted"
);
assert.ok(acceptedAuditEvent);
assert.equal(acceptedAuditEvent.task_id, readyTask.id);
assert.equal(acceptedAuditEvent.delivery_id, delivery.id);
assert.equal(acceptedAuditEvent.context_steward_id, contextSteward.id);
assert.ok(acceptedAuditEvent.id.startsWith("audit-"));
const scoreAuditEvent = auditEvents.find(
  (event) => event.type === "agent.score_recorded"
);
assert.ok(scoreAuditEvent);
assert.equal(scoreAuditEvent.agent_id, builderAgent.id);
assert.equal(scoreAuditEvent.score_event.delta, 10);
assert.equal(scoreAuditEvent.score_event.total, 10);

const finalTasks = center.listTasks(project.id);
const dashboard = center.getProjectDashboard(project.id);
const completedTaskRecord = dashboard.task_index.find((task) => task.id === accepted.task.id);
assert.equal(dashboard.task_hall.length, 1);
assert.equal(completedTaskRecord.delivery.review.reviewed_by, contextSteward.id);
assert.equal(completedTaskRecord.delivery.ai_detection.status, "passed");
const summaryPath = join(root, "SUMMARY.md");
mkdirSync(root, { recursive: true });
writeFileSync(
  summaryPath,
  [
    "# Core Flow Summary",
    "",
    `- Project: ${project.id}`,
    `- Context steward: ${contextSteward.id}`,
    `- Executor: ${builderAgent.id}`,
    `- Completed task: ${accepted.task.id} (${accepted.task.status})`,
    `- Accepted delivery: ${accepted.delivery.id} (${accepted.delivery.status})`,
    `- Current context snapshot: ${accepted.project.current_context_snapshot_id}`,
    `- Follow-up task: ${accepted.followup_tasks[0].id} (${accepted.followup_tasks[0].status})`,
    "",
    "## Task Hall",
    "",
    ...finalTasks.map(
      (task) =>
        `- ${task.id}: ${task.title} | status=${task.status} | context=${task.context_status}`
    ),
    ""
  ].join("\n")
);

if (process.argv.includes("--check")) {
  console.log("check passed");
} else {
  console.log(`Core flow completed. Summary: ${summaryPath}`);
}

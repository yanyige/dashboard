import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { ControlCenter } from "../src/control-center.mjs";

const root = resolve("data/stale-smoke");
rmSync(root, { recursive: true, force: true });

const center = new ControlCenter({ root });

center.registerAgent({
  id: "steward",
  name: "Context Steward",
  role: "context_steward",
  skills: ["context", "task-design"]
});

center.registerAgent({
  id: "builder",
  name: "Builder",
  role: "executor",
  skills: ["node", "workflow"]
});

center.createProject({
  id: "stale-demo",
  title: "Stale Context Demo",
  goal: "Verify stale context handling when project memory advances.",
  context_summary: "Both initial tasks are prepared from context-0001.",
  created_by: "test"
});

assert.throws(
  () =>
    center.publishTask({
      project_id: "stale-demo",
      title: "Invalid priority task",
      objective: "This should fail validation.",
      priority: "invalid",
      created_by: "test"
    }),
  /Invalid task/
);

const taskA = center.publishTask({
  project_id: "stale-demo",
  title: "Complete first task",
  objective: "Advance project context by accepting this task.",
  priority: "high",
  required_skills: ["node", "workflow"],
  created_by: "test"
});

const taskB = center.publishTask({
  project_id: "stale-demo",
  title: "Prepared but not started task",
  objective: "Become stale after another task advances project context.",
  priority: "medium",
  required_skills: ["node", "workflow"],
  created_by: "test"
});

center.prepareTask({
  project_id: "stale-demo",
  task_id: taskA.id,
  steward_id: "steward",
  task_brief: "Complete task A to advance project context.",
  acceptance_criteria: ["Task A is accepted."],
  deliverables: ["Delivery for task A."],
  required_skills: ["node", "workflow"]
});

center.prepareTask({
  project_id: "stale-demo",
  task_id: taskB.id,
  steward_id: "steward",
  task_brief: "Task B is intentionally prepared before context changes.",
  acceptance_criteria: ["Task B can be re-prepared after becoming stale."],
  deliverables: ["Updated execution package."],
  required_skills: ["node", "workflow"]
});

center.claimTask({
  project_id: "stale-demo",
  task_id: taskA.id,
  agent_id: "builder"
});
center.startTask({
  project_id: "stale-demo",
  task_id: taskA.id,
  agent_id: "builder"
});
center.deliverTask({
  project_id: "stale-demo",
  task_id: taskA.id,
  agent_id: "builder",
  summary: "Task A completed to trigger a context update.",
  verification: ["Delivery submitted."]
});

const accepted = center.acceptDelivery({
  project_id: "stale-demo",
  task_id: taskA.id,
  steward_id: "steward",
  context_update: "Task A changed project context.",
  followups: []
});

assert.equal(accepted.context.id, "context-0002");
assert.deepEqual(
  accepted.stale_tasks.map((task) => task.id),
  [taskB.id]
);

const staleTask = center.getTask("stale-demo", taskB.id);
assert.equal(staleTask.status, "ready");
assert.equal(staleTask.context_status, "stale");
assert.equal(staleTask.context_snapshot_id, "context-0001");

assert.throws(
  () =>
    center.claimTask({
      project_id: "stale-demo",
      task_id: taskB.id,
      agent_id: "builder"
    }),
  /not claimable/
);

const refreshedTask = center.prepareTask({
  project_id: "stale-demo",
  task_id: taskB.id,
  steward_id: "steward",
  task_brief: "Task B has been refreshed against the latest project context.",
  acceptance_criteria: ["Task B points at context-0002."],
  deliverables: ["Fresh execution package."],
  required_skills: ["node", "workflow"]
});

assert.equal(refreshedTask.context_status, "ready");
assert.equal(refreshedTask.context_snapshot_id, "context-0002");

const claimedTask = center.claimTask({
  project_id: "stale-demo",
  task_id: taskB.id,
  agent_id: "builder"
});

assert.equal(claimedTask.status, "claimed");

console.log("stale context smoke passed");

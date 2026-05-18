import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { ControlCenter } from "../src/control-center.mjs";

const root = resolve("data/concurrency-smoke");
rmSync(root, { recursive: true, force: true });

const center = new ControlCenter({ root });

center.registerAgent({
  id: "steward",
  name: "Context Steward",
  role: "context_steward",
  skills: ["context", "task-design"]
});

center.registerAgent({
  id: "builder-a",
  name: "Builder A",
  role: "executor",
  skills: ["node", "workflow"]
});

center.registerAgent({
  id: "builder-b",
  name: "Builder B",
  role: "executor",
  skills: ["node", "workflow"]
});

center.createProject({
  id: "parallel-demo",
  title: "Parallel Demo",
  goal: "Verify multiple project tasks can be claimed and executed concurrently.",
  context_summary:
    "The project has two independent tasks and one dependent task.",
  created_by: "test"
});

const foundationTask = publishAndPrepare({
  title: "Build foundation",
  objective: "Complete the shared foundation work.",
  priority: "high"
});
const docsTask = publishAndPrepare({
  title: "Draft operator docs",
  objective: "Document the operator workflow independently.",
  priority: "medium"
});
const releaseTask = publishAndPrepare({
  title: "Prepare release",
  objective: "Prepare release only after foundation is complete.",
  priority: "urgent",
  dependencies: [foundationTask.id]
});

let dashboard = center.getProjectDashboard("parallel-demo");
assert.deepEqual(dashboard.task_summary.claimable_task_ids, [
  foundationTask.id,
  docsTask.id
]);
assert.deepEqual(dashboard.task_summary.dependency_blocked_task_ids, [
  releaseTask.id
]);

const builderAClaim = center.claimNextTask({
  project_id: "parallel-demo",
  agent_id: "builder-a"
});
assert.equal(builderAClaim.id, foundationTask.id);

const builderBClaim = center.claimNextTask({
  project_id: "parallel-demo",
  agent_id: "builder-b"
});
assert.equal(builderBClaim.id, docsTask.id);

center.startTask({
  project_id: "parallel-demo",
  task_id: foundationTask.id,
  agent_id: "builder-a"
});
center.startTask({
  project_id: "parallel-demo",
  task_id: docsTask.id,
  agent_id: "builder-b"
});

assert.deepEqual(center.getAgent("builder-a").active_task_ids, [
  `parallel-demo/${foundationTask.id}`
]);
assert.deepEqual(center.getAgent("builder-b").active_task_ids, [
  `parallel-demo/${docsTask.id}`
]);

dashboard = center.getProjectDashboard("parallel-demo");
assert.equal(dashboard.task_summary.by_status.in_progress, 2);
assert.deepEqual(dashboard.task_summary.claimable_task_ids, []);

assert.throws(
  () =>
    center.claimNextTask({
      project_id: "parallel-demo",
      agent_id: "builder-a"
    }),
  /no free task capacity/
);

center.deliverTask({
  project_id: "parallel-demo",
  task_id: foundationTask.id,
  agent_id: "builder-a",
  summary: "Foundation work completed.",
  verification: ["Concurrency smoke verified foundation delivery."]
});
assert.equal(center.getAgent("builder-a").status, "available");
center.acceptDelivery({
  project_id: "parallel-demo",
  task_id: foundationTask.id,
  steward_id: "steward",
  context_update:
    "Foundation is complete; dependent release work can be re-prepared.",
  followups: []
});

assert.equal(center.getAgent("builder-a").status, "available");
assert.equal(center.getAgent("builder-b").status, "busy");
assert.equal(center.getTask("parallel-demo", releaseTask.id).context_status, "stale");

center.prepareTask({
  project_id: "parallel-demo",
  task_id: releaseTask.id,
  steward_id: "steward",
  task_brief: "Prepare release after the foundation task was accepted.",
  acceptance_criteria: ["Release task can be claimed after dependency completion."],
  deliverables: ["Claimed release task."],
  required_skills: ["node", "workflow"]
});

const releaseClaim = center.claimNextTask({
  project_id: "parallel-demo",
  agent_id: "builder-a"
});
assert.equal(releaseClaim.id, releaseTask.id);

center.deliverTask({
  project_id: "parallel-demo",
  task_id: docsTask.id,
  agent_id: "builder-b",
  summary: "Docs completed from the original execution context.",
  verification: ["Delivery is allowed for already-started concurrent work."]
});
assert.equal(center.getTask("parallel-demo", docsTask.id).status, "review");
assert.equal(center.getAgent("builder-b").status, "available");

console.log("concurrency smoke passed");

function publishAndPrepare({ title, objective, priority, dependencies = [] }) {
  const task = center.publishTask({
    project_id: "parallel-demo",
    title,
    objective,
    priority,
    dependencies,
    required_skills: ["node", "workflow"],
    created_by: "test"
  });

  return center.prepareTask({
    project_id: "parallel-demo",
    task_id: task.id,
    steward_id: "steward",
    task_brief: objective,
    acceptance_criteria: [`${title} reaches an executable state.`],
    deliverables: [`${title} delivery.`],
    required_skills: ["node", "workflow"]
  });
}

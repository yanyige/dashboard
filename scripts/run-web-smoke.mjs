import assert from "node:assert/strict";
import { request } from "node:http";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { ControlCenter } from "../src/control-center.mjs";
import { createWebServer } from "../src/web-server.mjs";

const root = resolve("data/web-smoke");
rmSync(root, { recursive: true, force: true });

const center = new ControlCenter({ root });
center.registerAgent({
  id: "codex-thread",
  name: "Codex Thread",
  role: "context_steward",
  skills: ["context", "task-design"]
});
center.createProject({
  id: "web-demo",
  title: "Web Demo",
  goal: "Verify the web dashboard can read project status.",
  context_summary: "Web dashboard smoke test project.",
  created_by: "test"
});
const approvedDraft = center.publishTask({
  project_id: "web-demo",
  title: "Visible dashboard task",
  objective: "Show task state in the web dashboard.",
  priority: "high",
  created_by: "test"
});
const rejectedDraft = center.publishTask({
  project_id: "web-demo",
  title: "Rejected dashboard task",
  objective: "Show rejection from the web dashboard.",
  priority: "medium",
  created_by: "test"
});
center.checkProjects({
  updated_by: "test",
  note: "web smoke setup"
});

const server = createWebServer({ root });
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

try {
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await getJson(`${baseUrl}/api/health`);
  assert.equal(health.ok, true);

  const dashboard = await getJson(`${baseUrl}/api/dashboard`);
  assert.equal(dashboard.projects.length, 1);
  assert.equal(dashboard.projects[0].project.id, "web-demo");
  assert.equal(dashboard.projects[0].project.health, "at_risk");
  assert.equal(dashboard.latest_check.id, "check-0001");

  const project = await getJson(`${baseUrl}/api/projects/web-demo`);
  assert.equal(project.dashboard.task_summary.total, 2);
  assert.equal(project.dashboard.task_index.length, 2);
  assert.equal(project.dashboard.task_hall.length, 2);
  assert.equal(project.status_updates.length, 1);
  assert.deepEqual(project.dashboard.current_context.requirements, {
    p0: [],
    p1: [],
    p2: []
  });

  const contextUpdate = await postJson(`${baseUrl}/api/projects/web-demo/context`, {
    summary: "Updated web smoke context.",
    requirements: {
      p0: ["Review draft work before execution."],
      p1: ["Show context requirements in the dashboard."],
      p2: ["Keep historical context snapshots."]
    }
  });
  assert.equal(contextUpdate.context.id, "context-0002");
  assert.equal(contextUpdate.context.summary, "Updated web smoke context.");
  assert.deepEqual(contextUpdate.context.requirements.p0, [
    "Review draft work before execution."
  ]);

  const approved = await postJson(
    `${baseUrl}/api/projects/web-demo/tasks/${approvedDraft.id}/approve`
  );
  assert.equal(approved.task.status, "ready");
  assert.equal(approved.task.context_status, "ready");
  assert.equal(approved.task.context_snapshot_id, "context-0002");

  const rejected = await postJson(
    `${baseUrl}/api/projects/web-demo/tasks/${rejectedDraft.id}/reject`,
    {
      reason: "Not needed for the web smoke."
    }
  );
  assert.equal(rejected.task.status, "rejected");
  assert.equal(rejected.task.rejection_reason, "Not needed for the web smoke.");

  const manualCheck = await postJson(`${baseUrl}/api/checks/run`);
  assert.equal(manualCheck.check.id, "check-0002");
  assert.equal(manualCheck.results.length, 1);
  assert.equal(manualCheck.results[0].health, "on_track");

  const html = await getText(`${baseUrl}/`);
  assert.match(html, /Codex 控制中心/);
  assert.match(html, /项目看板/);

  console.log("web smoke passed");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function getJson(url) {
  return requestText("GET", url).then((body) => JSON.parse(body));
}

function postJson(url, body = {}) {
  return requestText("POST", url, body).then((responseBody) => JSON.parse(responseBody));
}

function getText(url) {
  return requestText("GET", url);
}

function requestText(method, url, body = null) {
  return new Promise((resolveRequest, rejectRequest) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = request(
      url,
      {
        method,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          rejectRequest(new Error(`${method} ${url} failed: ${res.statusCode} ${body}`));
          return;
        }
        resolveRequest(body);
      });
      }
    );
    req.on("error", rejectRequest);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

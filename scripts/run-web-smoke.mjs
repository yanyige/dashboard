import assert from "node:assert/strict";
import { request } from "node:http";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { ControlCenter } from "../src/control-center.mjs";
import { createWebServer } from "../src/web-server.mjs";

const root = resolve("data/web-smoke");
rmSync(root, { recursive: true, force: true });

const center = new ControlCenter({ root });
center.createProject({
  id: "web-demo",
  title: "Web Demo",
  goal: "Verify the web dashboard can read project status.",
  context_summary: "Web dashboard smoke test project.",
  created_by: "test"
});
center.publishTask({
  project_id: "web-demo",
  title: "Visible dashboard task",
  objective: "Show task state in the web dashboard.",
  priority: "high",
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
  assert.equal(project.dashboard.task_summary.total, 1);
  assert.equal(project.status_updates.length, 1);

  const manualCheck = await postJson(`${baseUrl}/api/checks/run`);
  assert.equal(manualCheck.check.id, "check-0002");
  assert.equal(manualCheck.results.length, 1);

  const html = await getText(`${baseUrl}/`);
  assert.match(html, /Codex Control Center/);

  console.log("web smoke passed");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function getJson(url) {
  return requestText("GET", url).then((body) => JSON.parse(body));
}

function postJson(url) {
  return requestText("POST", url).then((body) => JSON.parse(body));
}

function getText(url) {
  return requestText("GET", url);
}

function requestText(method, url) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request(url, { method }, (res) => {
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
    });
    req.on("error", rejectRequest);
    req.end();
  });
}

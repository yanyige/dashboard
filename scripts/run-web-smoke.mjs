import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ControlCenter } from "../src/control-center.mjs";
import { createWebServer } from "../src/web-server.mjs";

const root = resolve("data/web-smoke");
const repoRoot = resolve("data/web-smoke-repo");
rmSync(root, { recursive: true, force: true });
rmSync(repoRoot, { recursive: true, force: true });
mkdirSync(repoRoot, { recursive: true });
writeFileSync(
  resolve(repoRoot, "README.md"),
  [
    "# Web Smoke Project",
    "",
    "The README describes the latest web smoke state.",
    "",
    "## P0",
    "",
    "- Keep project context editable per requirement.",
    "",
    "## P1",
    "",
    "- Refresh project context from README.",
    "",
    "## Current Status",
    "",
    "- The dashboard can read README state.",
    ""
  ].join("\n")
);

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
  repo_path: repoRoot,
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
  assert.match(project.dashboard.owner_thread_prompt, /你现在是/);
  assert.match(project.dashboard.owner_thread_prompt, /执行 Agent/);
  assert.match(project.dashboard.owner_thread_prompt, /每 10 分钟运行的自动检查/);
  assert.match(project.dashboard.owner_thread_prompt, /claim-next-task/);
  assert.match(project.dashboard.owner_thread_prompt, /deliver-task/);
  assert.match(project.dashboard.owner_thread_prompt, /不要自己 approve-requirement-proposal/);
  assert.equal(project.dashboard.reported_context.source, "context_snapshot");
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

  const readmeRefresh = await postJson(`${baseUrl}/api/projects/web-demo/context/readme`);
  assert.equal(readmeRefresh.context.id, "context-0003");
  assert.match(readmeRefresh.context.summary, /Web Smoke Project/);
  assert.deepEqual(readmeRefresh.context.requirements.p0, [
    "Keep project context editable per requirement."
  ]);
  assert.equal(readmeRefresh.context.source_documents[0].type, "readme");

  const approved = await postJson(
    `${baseUrl}/api/projects/web-demo/tasks/${approvedDraft.id}/approve`
  );
  assert.equal(approved.task.status, "ready");
  assert.equal(approved.task.context_status, "ready");
  assert.equal(approved.task.context_snapshot_id, "context-0003");
  assert.match(approved.task.execution_package.handoff_prompt, /deliver-task/);

  const approvedDashboard = await getJson(`${baseUrl}/api/projects/web-demo`);
  const approvedTaskIndex = approvedDashboard.dashboard.task_index.find(
    (task) => task.id === approvedDraft.id
  );
  assert.match(approvedTaskIndex.context.handoff_prompt, /submit it for review/);
  assert.match(approvedTaskIndex.agent_commands.claim, /acceptance-note/);
  assert.match(approvedTaskIndex.agent_commands.submit_for_review, /deliver-task/);

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

  const ownerReport = await postJson(`${baseUrl}/api/projects/web-demo/owner-reports`, {
    thread_id: "codex-thread",
    thread_name: "Codex Thread",
    health: "on_track",
    summary: "Owner proposes a reviewed requirement.",
    proposed_tasks: [
      {
        title: "Review proposal from web",
        objective: "Keep proposed requirements out of the task hall until review.",
        priority: "high",
        required_skills: ["workflow"]
      }
    ]
  });
  assert.equal(ownerReport.requirement_proposals.length, 1);
  assert.ok(
    ownerReport.dashboard.requirement_proposal_summary.pending_ids.includes(
      ownerReport.requirement_proposals[0].id
    )
  );

  const approvedProposal = await postJson(
    `${baseUrl}/api/projects/web-demo/requirement-proposals/${ownerReport.requirement_proposals[0].id}/approve`
  );
  assert.equal(approvedProposal.proposal.status, "approved");
  assert.equal(approvedProposal.task.status, "draft");
  assert.equal(approvedProposal.dashboard.requirement_proposal_summary.approved_ids.length, 1);

  const directProposal = await postJson(`${baseUrl}/api/projects/web-demo/requirement-proposals`, {
    title: "Direct web requirement",
    objective: "Allow the owner to create project requirements from the dashboard.",
    priority: "urgent",
    required_skills: ["node", "frontend"]
  });
  assert.equal(directProposal.proposal.status, "pending");
  assert.equal(directProposal.proposal.proposed_by, "web-dashboard");
  assert.deepEqual(directProposal.proposal.required_skills, ["node", "frontend"]);
  assert.ok(
    directProposal.dashboard.requirement_proposal_summary.pending_ids.includes(
      directProposal.proposal.id
    )
  );

  const threadMessage = await postJson(`${baseUrl}/api/projects/web-demo/thread-inbox`, {
    sender_id: "web-owner",
    sender_name: "Dashboard User",
    content: "请汇报 task-0001 的当前状态。"
  });
  assert.equal(threadMessage.message.status, "pending");
  assert.equal(threadMessage.message.project_id, "web-demo");
  assert.equal(threadMessage.message.owner_thread_id, "codex-thread");
  assert.equal(threadMessage.dashboard.thread_inbox_summary.pending_ids.length, 1);

  const inbox = await getJson(`${baseUrl}/api/projects/web-demo/thread-inbox`);
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.summary.total, 1);

  const updatedThreadMessage = await postJson(
    `${baseUrl}/api/projects/web-demo/thread-inbox/${threadMessage.message.id}`,
    {
      status: "replied",
      processed_by: "codex-thread",
      reply: "task-0001 当前等待执行。"
    }
  );
  assert.equal(updatedThreadMessage.message.status, "replied");
  assert.equal(updatedThreadMessage.message.reply, "task-0001 当前等待执行。");
  assert.equal(updatedThreadMessage.dashboard.thread_inbox_summary.replied_ids.length, 1);

  const html = await getText(`${baseUrl}/`);
  assert.match(html, /Codex 控制中心/);
  assert.match(html, /项目看板/);
  assert.match(html, /taskFilterControls/);
  assert.match(html, /projectChatSection/);
  assert.match(html, /requirementProposalForm/);
  const appJs = await getText(`${baseUrl}/app.js`);
  assert.match(appJs, /data-task-filter/);
  assert.match(appJs, /已退回/);
  assert.match(appJs, /thread-inbox/);
  assert.match(appJs, /createRequirementProposal/);
  assert.match(appJs, /ownerPromptActions\.hidden = false/);

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

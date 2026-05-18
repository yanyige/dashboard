import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ControlCenter } from "./control-center.mjs";

const WEB_ROOT = fileURLToPath(new URL("../web", import.meta.url));
const WEB_STEWARD_ID = process.env.CCC_STEWARD_ID ?? "codex-thread";

export function createWebServer({ root }) {
  const center = new ControlCenter({ root });

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (url.pathname.startsWith("/api/")) {
        await handleApi({ center, request, response, url });
        return;
      }

      await serveStatic({ response, pathname: url.pathname });
    } catch (error) {
      sendJson(response, 500, {
        error: error.message
      });
    }
  });
}

async function handleApi({ center, request, response, url }) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      generated_at: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    sendJson(response, 200, buildDashboard(center));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/checks") {
    sendJson(response, 200, {
      checks: center.listProjectChecks()
    });
    return;
  }

  const checkMatch = url.pathname.match(/^\/api\/checks\/([^/]+)$/);
  if (request.method === "GET" && checkMatch) {
    sendJson(response, 200, {
      check: center.getProjectCheck(decodeURIComponent(checkMatch[1]))
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/checks/run") {
    const result = center.checkProjects({
      updated_by: "web-dashboard",
      note: "manual web dashboard check"
    });
    sendJson(response, 201, result);
    return;
  }

  const updateContextMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/context$/);
  if (request.method === "POST" && updateContextMatch) {
    const projectId = decodeURIComponent(updateContextMatch[1]);
    const body = await readJsonBody(request);
    const result = center.updateProjectContext({
      project_id: projectId,
      updated_by: body.updated_by ?? WEB_STEWARD_ID,
      summary: body.summary,
      requirements: body.requirements,
      note: body.note ?? "Updated from the web dashboard."
    });
    sendJson(response, 200, {
      ...result,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const refreshReadmeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/context\/readme$/);
  if (request.method === "POST" && refreshReadmeMatch) {
    const projectId = decodeURIComponent(refreshReadmeMatch[1]);
    const body = await readJsonBody(request);
    const result = center.refreshProjectContextFromReadme({
      project_id: projectId,
      updated_by: body.updated_by ?? WEB_STEWARD_ID,
      readme_path: body.readme_path,
      note: body.note ?? "Refreshed from README via the web dashboard."
    });
    sendJson(response, 200, {
      ...result,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const ownerThreadMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/owner-thread$/);
  if (request.method === "POST" && ownerThreadMatch) {
    const projectId = decodeURIComponent(ownerThreadMatch[1]);
    const body = await readJsonBody(request);
    const result = center.setProjectOwnerThread({
      project_id: projectId,
      thread_id: body.thread_id,
      name: body.name,
      role: body.role,
      note: body.note,
      assigned_by: body.assigned_by ?? WEB_STEWARD_ID
    });
    sendJson(response, 200, {
      ...result,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const ownerReportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/owner-reports$/);
  if (request.method === "POST" && ownerReportMatch) {
    const projectId = decodeURIComponent(ownerReportMatch[1]);
    const body = await readJsonBody(request);
    const result = center.submitProjectOwnerReport({
      project_id: projectId,
      thread_id: body.thread_id,
      thread_name: body.thread_name,
      health: body.health,
      summary: body.summary,
      context_summary: body.context_summary,
      requirements: body.requirements,
      progress: body.progress,
      risks: body.risks,
      blockers: body.blockers,
      next_actions: body.next_actions,
      proposed_tasks: body.proposed_tasks,
      asked_at: body.asked_at,
      answered_at: body.answered_at
    });
    sendJson(response, 201, {
      ...result,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const createProposalMatch = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/requirement-proposals$/
  );
  if (request.method === "POST" && createProposalMatch) {
    const projectId = decodeURIComponent(createProposalMatch[1]);
    const body = await readJsonBody(request);
    const proposal = center.createRequirementProposal({
      project_id: projectId,
      title: body.title,
      objective: body.objective,
      priority: body.priority,
      required_skills: normalizeRequiredSkills(body.required_skills ?? body.skills),
      proposed_by: body.proposed_by ?? "web-dashboard",
      owner_report_id: body.owner_report_id
    });
    sendJson(response, 201, {
      proposal,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const approveProposalMatch = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/requirement-proposals\/([^/]+)\/approve$/
  );
  if (request.method === "POST" && approveProposalMatch) {
    const projectId = decodeURIComponent(approveProposalMatch[1]);
    const proposalId = decodeURIComponent(approveProposalMatch[2]);
    const body = await readJsonBody(request);
    const result = center.approveRequirementProposal({
      project_id: projectId,
      proposal_id: proposalId,
      reviewed_by: body.reviewed_by ?? WEB_STEWARD_ID,
      review_note: body.review_note,
      title: body.title,
      objective: body.objective,
      priority: body.priority,
      required_skills: body.required_skills
    });
    sendJson(response, 200, {
      ...result,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const rejectProposalMatch = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/requirement-proposals\/([^/]+)\/reject$/
  );
  if (request.method === "POST" && rejectProposalMatch) {
    const projectId = decodeURIComponent(rejectProposalMatch[1]);
    const proposalId = decodeURIComponent(rejectProposalMatch[2]);
    const body = await readJsonBody(request);
    const result = center.rejectRequirementProposal({
      project_id: projectId,
      proposal_id: proposalId,
      reviewed_by: body.reviewed_by ?? WEB_STEWARD_ID,
      review_note: body.review_note ?? "Rejected from the web dashboard."
    });
    sendJson(response, 200, {
      ...result,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const approveTaskMatch = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/approve$/
  );
  if (request.method === "POST" && approveTaskMatch) {
    const projectId = decodeURIComponent(approveTaskMatch[1]);
    const taskId = decodeURIComponent(approveTaskMatch[2]);
    const body = await readJsonBody(request);
    const task = center.approveTask({
      project_id: projectId,
      task_id: taskId,
      steward_id: body.steward_id ?? WEB_STEWARD_ID,
      task_brief: body.task_brief,
      acceptance_criteria: body.acceptance_criteria,
      deliverables: body.deliverables,
      assumptions: body.assumptions,
      relevant_files: body.relevant_files,
      required_skills: body.required_skills
    });
    sendJson(response, 200, {
      task,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const rejectTaskMatch = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/reject$/
  );
  if (request.method === "POST" && rejectTaskMatch) {
    const projectId = decodeURIComponent(rejectTaskMatch[1]);
    const taskId = decodeURIComponent(rejectTaskMatch[2]);
    const body = await readJsonBody(request);
    const task = center.rejectTask({
      project_id: projectId,
      task_id: taskId,
      reviewed_by: body.reviewed_by ?? WEB_STEWARD_ID,
      reason: body.reason ?? "Rejected from the web dashboard."
    });
    sendJson(response, 200, {
      task,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const threadInboxMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/thread-inbox$/);
  if (request.method === "GET" && threadInboxMatch) {
    const projectId = decodeURIComponent(threadInboxMatch[1]);
    sendJson(response, 200, {
      messages: center.listProjectThreadMessages(projectId),
      summary: center.getProjectDashboard(projectId).thread_inbox_summary
    });
    return;
  }

  if (request.method === "POST" && threadInboxMatch) {
    const projectId = decodeURIComponent(threadInboxMatch[1]);
    const body = await readJsonBody(request);
    const message = center.createProjectThreadMessage({
      project_id: projectId,
      sender_id: body.sender_id,
      sender_name: body.sender_name,
      content: body.content ?? body.message ?? body.body
    });
    sendJson(response, 201, {
      message,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const threadMessageMatch = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/thread-inbox\/([^/]+)$/
  );
  if ((request.method === "POST" || request.method === "PATCH") && threadMessageMatch) {
    const projectId = decodeURIComponent(threadMessageMatch[1]);
    const messageId = decodeURIComponent(threadMessageMatch[2]);
    const body = await readJsonBody(request);
    const message = center.updateProjectThreadMessage({
      project_id: projectId,
      message_id: messageId,
      status: body.status,
      processed_by: body.processed_by ?? body.agent_id,
      reply: body.reply,
      error: body.error
    });
    sendJson(response, 200, {
      message,
      dashboard: center.getProjectDashboard(projectId)
    });
    return;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (request.method === "GET" && projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    sendJson(response, 200, {
      dashboard: center.getProjectDashboard(projectId),
      status_updates: center.listProjectStatusUpdates(projectId),
      owner_reports: center.listProjectOwnerReports(projectId)
    });
    return;
  }

  sendJson(response, 404, {
    error: "Not found"
  });
}

function readJsonBody(request) {
  return new Promise((resolveRead, rejectRead) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        rejectRead(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolveRead({});
        return;
      }

      try {
        resolveRead(JSON.parse(body));
      } catch {
        rejectRead(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", rejectRead);
  });
}

function buildDashboard(center) {
  const projects = center.listProjects();
  const dashboards = projects.map((project) => center.getProjectDashboard(project.id));
  const checks = center.listProjectChecks();
  const latestCheck = checks.at(-1) ?? null;

  return {
    generated_at: new Date().toISOString(),
    latest_check: latestCheck,
    checks: checks.slice(-20).reverse(),
    agents: center.listAgents(),
    projects: dashboards
  };
}

async function serveStatic({ response, pathname }) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(normalizedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(WEB_ROOT, safePath);

  if (!filePath.startsWith(WEB_ROOT)) {
    sendText(response, 403, "Forbidden", "text/plain");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": "no-store"
    });
    response.end(file);
  } catch {
    sendText(response, 404, "Not found", "text/plain");
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, payload, type) {
  response.writeHead(statusCode, {
    "content-type": `${type}; charset=utf-8`,
    "cache-control": "no-store"
  });
  response.end(payload);
}

function normalizeRequiredSkills(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

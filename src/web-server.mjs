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

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (request.method === "GET" && projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    sendJson(response, 200, {
      dashboard: center.getProjectDashboard(projectId),
      status_updates: center.listProjectStatusUpdates(projectId)
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

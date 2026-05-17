import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ControlCenter } from "./control-center.mjs";

const WEB_ROOT = fileURLToPath(new URL("../web", import.meta.url));

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

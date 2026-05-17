import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function importProjectFromGitHub(center, input) {
  if (!input.github_url) {
    throw new Error("GitHub import requires github_url.");
  }

  const repository = parseGitHubUrl(input.github_url);
  const projectId = input.id ?? repository.default_project_id;
  const title = input.title ?? repository.repo;
  const cloneParent = resolve(input.clone_parent ?? "..");
  const targetDir = resolve(input.repo_dir ?? join(cloneParent, repository.repo));
  const shouldClone = input.clone !== false;
  const repoPath = shouldClone
    ? ensureLocalRepository({
        repository,
        targetDir,
        branch: input.branch,
        shallow: input.shallow === true
      })
    : null;

  const techStack = repoPath ? inferTechStack(repoPath) : [];
  const imported = center.createProject({
    id: projectId,
    title,
    goal:
      input.goal ??
      `Manage Codex Agent work for GitHub repository ${repository.owner}/${repository.repo}.`,
    repo_path: repoPath,
    tech_stack: techStack,
    constraints: input.constraints ?? [],
    roadmap: input.roadmap ?? [],
    decisions: [
      {
        at: new Date().toISOString(),
        by: input.created_by ?? "human-owner",
        note: `Imported project from GitHub repository ${repository.web_url}.`
      }
    ],
    context_summary:
      input.context_summary ??
      buildImportedContextSummary({ repository, repoPath, techStack }),
    created_by: input.created_by ?? "human-owner",
    github: {
      host: repository.host,
      owner: repository.owner,
      repo: repository.repo,
      web_url: repository.web_url,
      clone_url: repository.clone_url,
      imported_from: input.github_url
    }
  });

  return {
    ...imported,
    import: {
      github: repository,
      cloned: shouldClone,
      repo_path: repoPath
    }
  };
}

export function parseGitHubUrl(value) {
  const input = value.trim();
  let owner = null;
  let repo = null;

  const sshMatch = input.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    owner = sshMatch[1];
    repo = sshMatch[2];
  }

  if (!owner) {
    const normalized = input.match(/^github\.com\//)
      ? `https://${input}`
      : input;
    const parsed = new URL(normalized);

    if (parsed.hostname !== "github.com") {
      throw new Error(`Only github.com URLs are supported: ${value}`);
    }

    const pathParts = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);

    if (pathParts.length < 2) {
      throw new Error(`GitHub URL must include owner and repo: ${value}`);
    }

    owner = pathParts[0];
    repo = pathParts[1].replace(/\.git$/i, "");
  }

  if (!owner || !repo) {
    throw new Error(`Could not parse GitHub repository URL: ${value}`);
  }

  const cleanOwner = sanitizeGitHubSegment(owner);
  const cleanRepo = sanitizeGitHubSegment(repo);

  return {
    host: "github.com",
    owner: cleanOwner,
    repo: cleanRepo,
    full_name: `${cleanOwner}/${cleanRepo}`,
    web_url: `https://github.com/${cleanOwner}/${cleanRepo}`,
    clone_url: `https://github.com/${cleanOwner}/${cleanRepo}.git`,
    default_project_id: toProjectId(`${cleanOwner}-${cleanRepo}`)
  };
}

function ensureLocalRepository({ repository, targetDir, branch, shallow }) {
  if (existsSync(targetDir)) {
    if (!existsSync(join(targetDir, ".git"))) {
      throw new Error(
        `Target path exists but is not a git repository: ${targetDir}`
      );
    }

    return targetDir;
  }

  mkdirSync(resolve(targetDir, ".."), { recursive: true });
  const args = ["clone"];
  if (shallow) {
    args.push("--depth", "1");
  }
  if (branch) {
    args.push("--branch", branch);
  }
  args.push(repository.clone_url, targetDir);

  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    throw new Error(
      `git clone failed for ${repository.web_url}: ${result.stderr.trim()}`
    );
  }

  return targetDir;
}

function inferTechStack(repoPath) {
  const entries = new Set(readdirSync(repoPath));
  const techStack = [];

  if (entries.has("package.json")) {
    techStack.push("Node.js");
  }
  if (entries.has("pyproject.toml") || entries.has("requirements.txt")) {
    techStack.push("Python");
  }
  if (entries.has("go.mod")) {
    techStack.push("Go");
  }
  if (entries.has("Cargo.toml")) {
    techStack.push("Rust");
  }
  if (entries.has("pom.xml")) {
    techStack.push("Java/Maven");
  }
  if (entries.has("build.gradle") || entries.has("build.gradle.kts")) {
    techStack.push("Java/Gradle");
  }
  if (entries.has("Dockerfile")) {
    techStack.push("Docker");
  }

  return techStack;
}

function buildImportedContextSummary({ repository, repoPath, techStack }) {
  const parts = [
    `Imported from GitHub repository ${repository.full_name}.`,
    repoPath ? `Local repo path: ${repoPath}.` : "No local clone was created.",
    techStack.length > 0
      ? `Detected tech stack: ${techStack.join(", ")}.`
      : "Tech stack has not been detected yet."
  ];

  return parts.join(" ");
}

function sanitizeGitHubSegment(value) {
  const segment = basename(value).replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(segment)) {
    throw new Error(`Invalid GitHub path segment: ${value}`);
  }
  return segment;
}

function toProjectId(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

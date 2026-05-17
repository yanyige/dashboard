import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseGitHubUrl } from "../src/github-import.mjs";

const root = resolve("data/import-smoke");
rmSync(root, { recursive: true, force: true });

assert.deepEqual(parseGitHubUrl("https://github.com/example/demo.git"), {
  host: "github.com",
  owner: "example",
  repo: "demo",
  full_name: "example/demo",
  web_url: "https://github.com/example/demo",
  clone_url: "https://github.com/example/demo.git",
  default_project_id: "example-demo"
});
assert.equal(
  parseGitHubUrl("git@github.com:OpenAI/codex.git").default_project_id,
  "openai-codex"
);
assert.equal(
  parseGitHubUrl("github.com/org/repo").clone_url,
  "https://github.com/org/repo.git"
);

assert.throws(
  () => parseGitHubUrl("https://gitlab.com/example/demo"),
  /Only github.com URLs/
);

const imported = jsonRun([
  "import-project",
  "--github-url",
  "https://github.com/example/demo.git",
  "--no-clone",
  "--roadmap",
  "Prepare imported repository context.",
  "--json"
]);

assert.equal(imported.project.id, "example-demo");
assert.equal(imported.project.title, "demo");
assert.equal(imported.project.github.owner, "example");
assert.equal(imported.project.github.repo, "demo");
assert.equal(imported.context.repo_path, null);
assert.equal(imported.context.repository.web_url, "https://github.com/example/demo");
assert.equal(imported.import.cloned, false);

const customImport = jsonRun([
  "import-project",
  "--github-url",
  "git@github.com:OpenAI/codex.git",
  "--id",
  "custom-codex",
  "--title",
  "Custom Codex",
  "--goal",
  "Manage imported Codex work.",
  "--no-clone",
  "--json"
]);

assert.equal(customImport.project.id, "custom-codex");
assert.equal(customImport.project.title, "Custom Codex");
assert.equal(customImport.project.github.clone_url, "https://github.com/OpenAI/codex.git");

const projects = jsonRun(["list-projects", "--json"]);
assert.equal(projects.projects.length, 2);

console.log("import smoke passed");

function run(args) {
  return execFileSync(process.execPath, [
    "scripts/ccc.mjs",
    "--root",
    root,
    ...args
  ], {
    cwd: resolve("."),
    encoding: "utf8"
  });
}

function jsonRun(args) {
  return JSON.parse(run(args));
}

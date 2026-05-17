#!/usr/bin/env node
import { resolve } from "node:path";
import { ControlCenter } from "../src/control-center.mjs";
import { importProjectFromGitHub } from "../src/github-import.mjs";

const USAGE = `
Codex Control Center CLI

Usage:
  npm run ccc -- [--root data/workspace] <command> [options]
  node scripts/ccc.mjs [--root data/workspace] <command> [options]

Commands:
  register-agent     Register an Agent in the employee center
  list-agents        List registered Agents
  create-project     Create a project with its first context snapshot
  import-project     Import a project directly from a GitHub repository URL
  list-projects      List projects
  show-project       Show one project
  update-project-status
                    Write a Context Steward project status snapshot
  show-project-dashboard
                    Show project status, context, and task hall summary
  list-project-status
                    List project status snapshots
  check-projects    Check every project and write status snapshots
  list-project-checks
                    List scheduled project check runs
  show-project-check
                    Show one scheduled project check run
  publish-task       Publish a project-scoped task as draft
  prepare-task       Context steward prepares a draft task
  list-tasks         List tasks in a project
  show-task          Show one task
  claim-task         Agent claims a ready task
  start-task         Agent starts a claimed task
  deliver-task       Agent submits delivery evidence
  accept-delivery    Context steward accepts a delivery and advances context

Global options:
  --root <path>      Data root. Defaults to CCC_ROOT or data/workspace
  --json            Print machine-readable JSON
  --help            Show help

Examples:
  npm run ccc -- register-agent --id steward --name "Context Steward" --role context_steward --skills context,task-design
  npm run ccc -- create-project --id my-project --title "My Project" --goal "Coordinate Codex work"
  npm run ccc -- publish-task --project my-project --title "Draft CLI docs" --objective "Document the first CLI workflow"
`;

const handlers = {
  "register-agent": handleRegisterAgent,
  "list-agents": handleListAgents,
  "create-project": handleCreateProject,
  "import-project": handleImportProject,
  "list-projects": handleListProjects,
  "show-project": handleShowProject,
  "update-project-status": handleUpdateProjectStatus,
  "show-project-dashboard": handleShowProjectDashboard,
  "list-project-status": handleListProjectStatus,
  "check-projects": handleCheckProjects,
  "list-project-checks": handleListProjectChecks,
  "show-project-check": handleShowProjectCheck,
  "publish-task": handlePublishTask,
  "prepare-task": handlePrepareTask,
  "list-tasks": handleListTasks,
  "show-task": handleShowTask,
  "claim-task": handleClaimTask,
  "start-task": handleStartTask,
  "deliver-task": handleDeliverTask,
  "accept-delivery": handleAcceptDelivery,
  help: handleHelp
};

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const parsed = parseArgv(process.argv.slice(2));

  if (parsed.flags.help || !parsed.command) {
    handleHelp();
    return;
  }

  const handler = handlers[parsed.command];
  if (!handler) {
    throw new Error(`Unknown command: ${parsed.command}`);
  }

  const root = resolve(
    stringFlag(parsed.flags, "root") ?? process.env.CCC_ROOT ?? "data/workspace"
  );
  const center = new ControlCenter({ root });
  const result = await handler(center, parsed.flags, parsed.positionals);

  if (result !== undefined) {
    printResult(parsed.command, result, parsed.flags);
  }
}

function handleHelp() {
  console.log(USAGE.trim());
}

function handleRegisterAgent(center, flags) {
  const agent = center.registerAgent({
    id: requiredFlag(flags, "id"),
    name: requiredFlag(flags, "name"),
    role: requiredFlag(flags, "role"),
    skills: csvFlag(flags, "skills"),
    status: stringFlag(flags, "status") ?? "available"
  });

  return { agent };
}

function handleListAgents(center) {
  return { agents: center.listAgents() };
}

function handleCreateProject(center, flags) {
  const created = center.createProject({
    id: requiredFlag(flags, "id"),
    title: requiredFlag(flags, "title"),
    goal: requiredFlag(flags, "goal"),
    repo_path: stringFlag(flags, "repo-path"),
    tech_stack: csvFlag(flags, "tech-stack"),
    constraints: collectFlags(flags, "constraint", "constraints"),
    roadmap: collectFlags(flags, "roadmap"),
    decisions: collectFlags(flags, "decision", "decisions"),
    context_summary: stringFlag(flags, "context-summary"),
    created_by: stringFlag(flags, "created-by") ?? "human-owner"
  });

  return created;
}

function handleImportProject(center, flags) {
  const imported = importProjectFromGitHub(center, {
    github_url: requiredAnyFlag(flags, "github-url", "url"),
    id: stringFlag(flags, "id"),
    title: stringFlag(flags, "title"),
    goal: stringFlag(flags, "goal"),
    clone_parent: stringFlag(flags, "clone-parent"),
    repo_dir: stringFlag(flags, "repo-dir"),
    branch: stringFlag(flags, "branch"),
    shallow: flags.shallow === true,
    clone: flags["no-clone"] !== true,
    constraints: collectFlags(flags, "constraint", "constraints"),
    roadmap: collectFlags(flags, "roadmap"),
    context_summary: stringFlag(flags, "context-summary"),
    created_by: stringFlag(flags, "created-by") ?? "human-owner"
  });

  return imported;
}

function handleListProjects(center) {
  return { projects: center.listProjects() };
}

function handleShowProject(center, flags) {
  const projectId = projectFlag(flags);
  const project = center.getProject(projectId);
  const context = center.getContext(projectId, project.current_context_snapshot_id);
  return { project, context };
}

function handleUpdateProjectStatus(center, flags) {
  const updated = center.updateProjectStatus({
    project_id: projectFlag(flags),
    health: requiredFlag(flags, "health"),
    summary: requiredFlag(flags, "summary"),
    updated_by: stringFlag(flags, "updated-by") ?? "codex-thread",
    progress: collectFlags(flags, "progress"),
    risks: collectFlags(flags, "risk"),
    blockers: collectFlags(flags, "blocker"),
    next_actions: collectFlags(flags, "next-action", "next")
  });

  return updated;
}

function handleShowProjectDashboard(center, flags) {
  return { dashboard: center.getProjectDashboard(projectFlag(flags)) };
}

function handleListProjectStatus(center, flags) {
  return { status_updates: center.listProjectStatusUpdates(projectFlag(flags)) };
}

function handleCheckProjects(center, flags) {
  return center.checkProjects({
    updated_by: stringFlag(flags, "updated-by") ?? "codex-thread",
    note: stringFlag(flags, "note") ?? ""
  });
}

function handleListProjectChecks(center) {
  return { checks: center.listProjectChecks() };
}

function handleShowProjectCheck(center, flags) {
  return { check: center.getProjectCheck(requiredAnyFlag(flags, "check", "check-id")) };
}

function handlePublishTask(center, flags) {
  const task = center.publishTask({
    project_id: projectFlag(flags),
    title: requiredFlag(flags, "title"),
    objective: requiredFlag(flags, "objective"),
    priority: stringFlag(flags, "priority") ?? "medium",
    required_skills: csvFlag(flags, "skills", "required-skills"),
    created_by: stringFlag(flags, "created-by") ?? "human-owner"
  });

  return { task };
}

function handlePrepareTask(center, flags) {
  const task = center.prepareTask({
    project_id: projectFlag(flags),
    task_id: taskFlag(flags),
    steward_id: requiredAnyFlag(flags, "steward", "steward-id"),
    task_brief: requiredAnyFlag(flags, "brief", "task-brief"),
    relevant_files: collectFlags(flags, "file", "relevant-file"),
    assumptions: collectFlags(flags, "assumption"),
    acceptance_criteria: collectFlags(flags, "criterion", "acceptance-criterion"),
    deliverables: collectFlags(flags, "deliverable"),
    required_skills: optionalCsvFlag(flags, "skills", "required-skills")
  });

  return { task };
}

function handleListTasks(center, flags) {
  const status = stringFlag(flags, "status");
  const skill = stringFlag(flags, "skill");
  const priority = stringFlag(flags, "priority");
  const assignedAgent = stringFlag(flags, "agent", "assigned-agent");
  let tasks = center.listTasks(projectFlag(flags));

  if (status) {
    tasks = tasks.filter((task) => task.status === status);
  }
  if (skill) {
    tasks = tasks.filter((task) => task.required_skills.includes(skill));
  }
  if (priority) {
    tasks = tasks.filter((task) => task.priority === priority);
  }
  if (assignedAgent) {
    tasks = tasks.filter((task) => task.assigned_agent_id === assignedAgent);
  }

  return { tasks };
}

function handleShowTask(center, flags) {
  return { task: center.getTask(projectFlag(flags), taskFlag(flags)) };
}

function handleClaimTask(center, flags) {
  const task = center.claimTask({
    project_id: projectFlag(flags),
    task_id: taskFlag(flags),
    agent_id: requiredAnyFlag(flags, "agent", "agent-id")
  });

  return { task };
}

function handleStartTask(center, flags) {
  const task = center.startTask({
    project_id: projectFlag(flags),
    task_id: taskFlag(flags),
    agent_id: requiredAnyFlag(flags, "agent", "agent-id")
  });

  return { task };
}

function handleDeliverTask(center, flags) {
  const delivered = center.deliverTask({
    project_id: projectFlag(flags),
    task_id: taskFlag(flags),
    agent_id: requiredAnyFlag(flags, "agent", "agent-id"),
    summary: requiredFlag(flags, "summary"),
    files_changed: collectFlags(flags, "changed-file", "file"),
    verification: collectFlags(flags, "verification"),
    followups: parseFollowups(collectFlags(flags, "followup"))
  });

  return delivered;
}

function handleAcceptDelivery(center, flags) {
  const projectId = projectFlag(flags);
  const taskId = taskFlag(flags);
  const task = center.getTask(projectId, taskId);
  const delivery = task.delivery_id
    ? center.getDelivery(projectId, task.delivery_id)
    : { followups: [] };
  const explicitFollowups = collectFlags(flags, "followup");
  const accepted = center.acceptDelivery({
    project_id: projectId,
    task_id: taskId,
    steward_id: requiredAnyFlag(flags, "steward", "steward-id"),
    context_update: requiredAnyFlag(flags, "context-update", "update"),
    followups:
      explicitFollowups.length > 0
        ? parseFollowups(explicitFollowups)
        : delivery.followups
  });

  return accepted;
}

function printResult(command, result, flags) {
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  switch (command) {
    case "register-agent":
      console.log(`registered agent ${result.agent.id} (${result.agent.status})`);
      break;
    case "list-agents":
      printRows(
        result.agents.map((agent) => [
          agent.id,
          agent.role,
          agent.status,
          agent.skills.join(",")
        ]),
        ["id", "role", "status", "skills"]
      );
      break;
    case "create-project":
      console.log(
        `created project ${result.project.id} with ${result.context.id}`
      );
      break;
    case "import-project":
      console.log(
        `imported project ${result.project.id} from ${result.import.github.web_url}`
      );
      console.log(
        result.import.repo_path
          ? `repo path: ${result.import.repo_path}`
          : "repo path: not cloned"
      );
      break;
    case "list-projects":
      printRows(
        result.projects.map((project) => [
          project.id,
          project.status,
          project.current_context_snapshot_id,
          project.title
        ]),
        ["id", "status", "context", "title"]
      );
      break;
    case "show-project":
      console.log(JSON.stringify(result, null, 2));
      break;
    case "update-project-status":
      console.log(
        `updated project status ${result.status_update.id}; health=${result.status_update.health}`
      );
      break;
    case "show-project-dashboard":
      printDashboard(result.dashboard);
      break;
    case "list-project-status":
      printRows(
        result.status_updates.map((statusUpdate) => [
          statusUpdate.id,
          statusUpdate.health,
          statusUpdate.context_snapshot_id,
          statusUpdate.created_at,
          statusUpdate.summary
        ]),
        ["id", "health", "context", "created_at", "summary"]
      );
      break;
    case "check-projects":
      console.log(
        `completed ${result.check.id}; checked ${result.check.project_count} project(s)`
      );
      printRows(
        result.results.map((projectResult) => [
          projectResult.project_id,
          projectResult.health,
          projectResult.status_update_id,
          projectResult.summary
        ]),
        ["project", "health", "status_update", "summary"]
      );
      break;
    case "list-project-checks":
      printRows(
        result.checks.map((check) => [
          check.id,
          check.project_count,
          check.created_at,
          check.note
        ]),
        ["id", "projects", "created_at", "note"]
      );
      break;
    case "show-project-check":
      console.log(JSON.stringify(result.check, null, 2));
      break;
    case "publish-task":
      console.log(`published task ${result.task.id} (${result.task.status})`);
      break;
    case "prepare-task":
      console.log(
        `prepared task ${result.task.id} with ${result.task.context_snapshot_id}`
      );
      break;
    case "list-tasks":
      printRows(
        result.tasks.map((task) => [
          task.id,
          task.status,
          task.context_status,
          task.priority,
          task.assigned_agent_id ?? "-",
          task.title
        ]),
        ["id", "status", "context", "priority", "agent", "title"]
      );
      break;
    case "show-task":
      console.log(JSON.stringify(result.task, null, 2));
      break;
    case "claim-task":
      console.log(
        `claimed task ${result.task.id} by ${result.task.assigned_agent_id}`
      );
      break;
    case "start-task":
      console.log(`started task ${result.task.id}`);
      break;
    case "deliver-task":
      console.log(
        `submitted delivery ${result.delivery.id} for ${result.task.id}`
      );
      break;
    case "accept-delivery":
      console.log(
        `accepted ${result.delivery.id}; task ${result.task.id} is ${result.task.status}; context is ${result.context.id}`
      );
      if (result.followup_tasks.length > 0) {
        console.log(
          `follow-up tasks: ${result.followup_tasks
            .map((task) => task.id)
            .join(", ")}`
        );
      }
      break;
    default:
      console.log(JSON.stringify(result, null, 2));
  }
}

function parseArgv(argv) {
  const flags = {};
  const positionals = [];
  let command = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "-h") {
      addFlag(flags, "help", true);
      continue;
    }

    if (token.startsWith("--")) {
      const raw = token.slice(2);
      const [key, inlineValue] = raw.split(/=(.*)/s);
      if (inlineValue !== undefined) {
        addFlag(flags, key, inlineValue);
        continue;
      }

      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        addFlag(flags, key, next);
        index += 1;
      } else {
        addFlag(flags, key, true);
      }
      continue;
    }

    if (!command) {
      command = token;
    } else {
      positionals.push(token);
    }
  }

  return { command, flags, positionals };
}

function addFlag(flags, key, value) {
  if (flags[key] === undefined) {
    flags[key] = value;
    return;
  }

  if (Array.isArray(flags[key])) {
    flags[key].push(value);
    return;
  }

  flags[key] = [flags[key], value];
}

function projectFlag(flags) {
  return requiredAnyFlag(flags, "project", "project-id");
}

function taskFlag(flags) {
  return requiredAnyFlag(flags, "task", "task-id");
}

function requiredFlag(flags, name) {
  const value = stringFlag(flags, name);
  if (!value) {
    throw new Error(`Missing required option: --${name}`);
  }
  return value;
}

function requiredAnyFlag(flags, ...names) {
  for (const name of names) {
    const value = stringFlag(flags, name);
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required option: ${names.map((name) => `--${name}`).join(" or ")}`);
}

function stringFlag(flags, ...names) {
  for (const name of names) {
    const value = flags[name];
    if (Array.isArray(value)) {
      return String(value.at(-1));
    }
    if (typeof value === "string") {
      return value;
    }
  }
  return null;
}

function collectFlags(flags, ...names) {
  return names.flatMap((name) => {
    const value = flags[name];
    if (value === undefined || value === true) {
      return [];
    }
    return Array.isArray(value) ? value.map(String) : [String(value)];
  });
}

function csvFlag(flags, ...names) {
  return optionalCsvFlag(flags, ...names) ?? [];
}

function optionalCsvFlag(flags, ...names) {
  const values = collectFlags(flags, ...names);
  if (values.length === 0) {
    return null;
  }
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseFollowups(values) {
  return values.map((value) => {
    const [title, objective, priority = "medium", skills = ""] = value
      .split("::")
      .map((part) => part.trim());

    if (!title || !objective) {
      throw new Error(
        "Follow-up must use format: title::objective[::priority][::skill1,skill2]"
      );
    }

    return {
      title,
      objective,
      priority,
      required_skills: skills
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean)
    };
  });
}

function printRows(rows, headers) {
  if (rows.length === 0) {
    console.log("(none)");
    return;
  }

  const allRows = [headers, ...rows];
  const widths = headers.map((_, columnIndex) =>
    Math.max(
      ...allRows.map((row) => String(row[columnIndex] ?? "").length)
    )
  );

  console.log(formatRow(headers, widths));
  console.log(formatRow(widths.map((width) => "-".repeat(width)), widths));
  for (const row of rows) {
    console.log(formatRow(row, widths));
  }
}

function printDashboard(dashboard) {
  const latestStatus = dashboard.latest_status;

  console.log(`${dashboard.project.id}: ${dashboard.project.title}`);
  console.log(`health: ${dashboard.project.health}`);
  console.log(`lifecycle: ${dashboard.project.status}`);
  console.log(`context: ${dashboard.current_context.id}`);
  if (latestStatus) {
    console.log(`latest update: ${latestStatus.id} by ${latestStatus.updated_by}`);
    console.log(`summary: ${latestStatus.summary}`);
  } else {
    console.log("latest update: none");
  }

  console.log("");
  console.log("task summary:");
  console.log(`total: ${dashboard.task_summary.total}`);
  console.log(
    `by status: ${JSON.stringify(dashboard.task_summary.by_status)}`
  );
  console.log(
    `by context: ${JSON.stringify(dashboard.task_summary.by_context_status)}`
  );

  if (dashboard.task_hall.length > 0) {
    console.log("");
    printRows(
      dashboard.task_hall.map((task) => [
        task.id,
        task.status,
        task.context_status,
        task.priority,
        task.assigned_agent_id ?? "-",
        task.title
      ]),
      ["id", "status", "context", "priority", "agent", "title"]
    );
  }
}

function formatRow(row, widths) {
  return row
    .map((cell, index) => String(cell ?? "").padEnd(widths[index]))
    .join("  ");
}

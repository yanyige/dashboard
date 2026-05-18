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
  archive-project    Archive a project and remove it from active work routing
  update-project-context
                    Update the versioned project context and P0/P1/P2 requirements
  refresh-project-context
                    Refresh project context by reading the local repository README
  set-project-owner Set the project owner Thread
  owner-report      Submit a project owner Thread status report and optional reported context
  list-owner-reports
                    List project owner Thread status reports
  list-requirement-proposals
                    List project requirement proposals waiting for review
  approve-requirement-proposal
                    Approve a requirement proposal into the task hall as a draft task
  reject-requirement-proposal
                    Reject a requirement proposal before it enters the task hall
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
  list-audit-events List persistent audit events
  publish-task       Publish a project-scoped task as draft
  prepare-task       Context steward prepares a draft task
  list-tasks         List tasks in a project
  show-task          Show one task
  list-claimable-tasks
                    List ready tasks whose dependencies and context allow claiming
  claim-task         Agent claims a ready task
  claim-next-task    Agent claims the highest-priority claimable task
  start-task         Agent starts a claimed task
  deliver-task       Agent submits delivery evidence, including optional AI detection notes
  accept-delivery    Context steward accepts a delivery and records review evidence

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
  "archive-project": handleArchiveProject,
  "update-project-context": handleUpdateProjectContext,
  "refresh-project-context": handleRefreshProjectContext,
  "set-project-owner": handleSetProjectOwner,
  "owner-report": handleOwnerReport,
  "submit-owner-report": handleOwnerReport,
  "list-owner-reports": handleListOwnerReports,
  "list-requirement-proposals": handleListRequirementProposals,
  "approve-requirement-proposal": handleApproveRequirementProposal,
  "reject-requirement-proposal": handleRejectRequirementProposal,
  "update-project-status": handleUpdateProjectStatus,
  "show-project-dashboard": handleShowProjectDashboard,
  "list-project-status": handleListProjectStatus,
  "check-projects": handleCheckProjects,
  "list-project-checks": handleListProjectChecks,
  "show-project-check": handleShowProjectCheck,
  "list-audit-events": handleListAuditEvents,
  "publish-task": handlePublishTask,
  "prepare-task": handlePrepareTask,
  "list-tasks": handleListTasks,
  "show-task": handleShowTask,
  "list-claimable-tasks": handleListClaimableTasks,
  "claim-task": handleClaimTask,
  "claim-next-task": handleClaimNextTask,
  "claim-next": handleClaimNextTask,
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
    status: stringFlag(flags, "status") ?? "available",
    max_parallel_tasks: positiveIntegerFlag(flags, "max-parallel-tasks") ?? 1
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
    requirements: requirementsFromFlags(flags),
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
    requirements: requirementsFromFlags(flags),
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

function handleArchiveProject(center, flags) {
  return center.archiveProject({
    project_id: projectFlag(flags),
    archived_by: stringFlag(flags, "archived-by") ?? "codex-thread",
    reason: stringFlag(flags, "reason") ?? ""
  });
}

function handleUpdateProjectContext(center, flags) {
  return center.updateProjectContext({
    project_id: projectFlag(flags),
    updated_by: stringFlag(flags, "updated-by") ?? "codex-thread",
    summary: stringFlag(flags, "summary", "context-summary"),
    requirements: requirementsFromFlags(flags),
    note: stringFlag(flags, "note") ?? "CLI project context update."
  });
}

function handleRefreshProjectContext(center, flags) {
  return center.refreshProjectContextFromReadme({
    project_id: projectFlag(flags),
    updated_by: stringFlag(flags, "updated-by") ?? "codex-thread",
    readme_path: stringFlag(flags, "readme", "readme-path"),
    note: stringFlag(flags, "note") ?? "CLI README context refresh."
  });
}

function handleSetProjectOwner(center, flags) {
  return center.setProjectOwnerThread({
    project_id: projectFlag(flags),
    thread_id: requiredAnyFlag(flags, "thread", "thread-id"),
    name: stringFlag(flags, "name", "thread-name"),
    role: stringFlag(flags, "role") ?? "project_owner",
    note: stringFlag(flags, "note") ?? "",
    assigned_by: stringFlag(flags, "assigned-by") ?? "codex-thread"
  });
}

function handleOwnerReport(center, flags) {
  return center.submitProjectOwnerReport({
    project_id: projectFlag(flags),
    thread_id: requiredAnyFlag(flags, "thread", "thread-id"),
    thread_name: stringFlag(flags, "thread-name", "name"),
    health: requiredFlag(flags, "health"),
    summary: requiredFlag(flags, "summary"),
    context_summary: stringFlag(flags, "context-summary"),
    requirements: requirementsFromFlags(flags),
    progress: collectFlags(flags, "progress"),
    risks: collectFlags(flags, "risk"),
    blockers: collectFlags(flags, "blocker"),
    next_actions: collectFlags(flags, "next-action", "next"),
    proposed_tasks: parseFollowups(collectFlags(flags, "proposed-task", "task-proposal")),
    asked_at: stringFlag(flags, "asked-at"),
    answered_at: stringFlag(flags, "answered-at")
  });
}

function handleListOwnerReports(center, flags) {
  return { owner_reports: center.listProjectOwnerReports(projectFlag(flags)) };
}

function handleListRequirementProposals(center, flags) {
  const status = stringFlag(flags, "status");
  let proposals = center.listRequirementProposals(projectFlag(flags));
  if (status) {
    proposals = proposals.filter((proposal) => proposal.status === status);
  }

  return { requirement_proposals: proposals };
}

function handleApproveRequirementProposal(center, flags) {
  return center.approveRequirementProposal({
    project_id: projectFlag(flags),
    proposal_id: requiredAnyFlag(flags, "proposal", "proposal-id"),
    reviewed_by: stringFlag(flags, "reviewed-by", "steward") ?? "codex-thread",
    review_note: stringFlag(flags, "review-note", "note"),
    title: stringFlag(flags, "title"),
    objective: stringFlag(flags, "objective"),
    priority: stringFlag(flags, "priority"),
    required_skills: optionalCsvFlag(flags, "skills", "required-skills")
  });
}

function handleRejectRequirementProposal(center, flags) {
  return center.rejectRequirementProposal({
    project_id: projectFlag(flags),
    proposal_id: requiredAnyFlag(flags, "proposal", "proposal-id"),
    reviewed_by: stringFlag(flags, "reviewed-by", "steward") ?? "codex-thread",
    review_note: stringFlag(flags, "review-note", "reason", "note")
  });
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

function handleListAuditEvents(center, flags) {
  return {
    events: center.listAuditEvents({
      type: stringFlag(flags, "type"),
      project_id: stringFlag(flags, "project"),
      task_id: stringFlag(flags, "task"),
      agent_id: stringFlag(flags, "agent"),
      limit: positiveIntegerFlag(flags, "limit")
    })
  };
}

function handlePublishTask(center, flags) {
  const task = center.publishTask({
    project_id: projectFlag(flags),
    title: requiredFlag(flags, "title"),
    objective: requiredFlag(flags, "objective"),
    priority: stringFlag(flags, "priority") ?? "medium",
    dependencies: collectFlags(flags, "depends-on", "dependency"),
    parallel_group: stringFlag(flags, "parallel-group") ?? "default",
    required_skills: csvFlag(flags, "skills", "required-skills"),
    created_by: stringFlag(flags, "created-by") ?? "human-owner"
  });

  return { task };
}

function handlePrepareTask(center, flags) {
  const dependencies = collectFlags(flags, "depends-on", "dependency");
  const task = center.prepareTask({
    project_id: projectFlag(flags),
    task_id: taskFlag(flags),
    steward_id: requiredAnyFlag(flags, "steward", "steward-id"),
    task_brief: requiredAnyFlag(flags, "brief", "task-brief"),
    relevant_files: collectFlags(flags, "file", "relevant-file"),
    assumptions: collectFlags(flags, "assumption"),
    acceptance_criteria: collectFlags(flags, "criterion", "acceptance-criterion"),
    deliverables: collectFlags(flags, "deliverable"),
    required_skills: optionalCsvFlag(flags, "skills", "required-skills"),
    dependencies: dependencies.length > 0 ? dependencies : undefined,
    parallel_group: stringFlag(flags, "parallel-group")
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

function handleListClaimableTasks(center, flags) {
  return {
    tasks: center.listClaimableTasks(projectFlag(flags), {
      agent_id: stringFlag(flags, "agent", "agent-id")
    })
  };
}

function handleClaimTask(center, flags) {
  const task = center.claimTask({
    project_id: projectFlag(flags),
    task_id: taskFlag(flags),
    agent_id: requiredAnyFlag(flags, "agent", "agent-id"),
    acceptance_note: stringFlag(flags, "acceptance-note", "note"),
    plan: stringFlag(flags, "plan"),
    eta: stringFlag(flags, "eta"),
    next_report_at: stringFlag(flags, "next-report-at")
  });

  return { task };
}

function handleClaimNextTask(center, flags) {
  const task = center.claimNextTask({
    project_id: projectFlag(flags),
    agent_id: requiredAnyFlag(flags, "agent", "agent-id"),
    acceptance_note: stringFlag(flags, "acceptance-note", "note"),
    plan: stringFlag(flags, "plan"),
    eta: stringFlag(flags, "eta"),
    next_report_at: stringFlag(flags, "next-report-at")
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
    followups: parseFollowups(collectFlags(flags, "followup")),
    ai_detection: aiDetectionFromFlags(flags)
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
    reviewer_id: stringFlag(flags, "reviewer", "reviewer-id"),
    context_update: requiredAnyFlag(flags, "context-update", "update"),
    review_method: stringFlag(flags, "review-method"),
    review_summary: stringFlag(flags, "review-summary", "review-note"),
    ai_detection: aiDetectionFromFlags(flags),
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
          `${agent.active_task_ids.length}/${agent.max_parallel_tasks}`,
          agent.skills.join(",")
        ]),
        ["id", "role", "status", "capacity", "skills"]
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
    case "archive-project":
      console.log(
        `archived project ${result.project.id}; health=${result.project.health}`
      );
      break;
    case "update-project-context":
      console.log(
        `updated context ${result.context.id}; stale tasks=${result.stale_tasks.length}`
      );
      break;
    case "refresh-project-context":
      console.log(
        `refreshed context ${result.context.id} from ${result.readme.path}; stale tasks=${result.stale_tasks.length}`
      );
      break;
    case "set-project-owner":
      console.log(
        `set owner thread ${result.project.owner_thread.thread_id} for ${result.project.id}`
      );
      break;
    case "owner-report":
    case "submit-owner-report":
      console.log(
        `submitted owner report ${result.owner_report.id}; health=${result.owner_report.health}`
      );
      if (result.requirement_proposals?.length > 0) {
        console.log(
          `requirement proposals: ${result.requirement_proposals
            .map((proposal) => proposal.id)
            .join(", ")}`
        );
      }
      break;
    case "list-owner-reports":
      printRows(
        result.owner_reports.map((report) => [
          report.id,
          report.thread_id,
          report.health,
          report.answered_at,
          report.summary
        ]),
        ["id", "thread", "health", "answered_at", "summary"]
      );
      break;
    case "list-requirement-proposals":
      printRows(
        result.requirement_proposals.map((proposal) => [
          proposal.id,
          proposal.status,
          proposal.priority,
          proposal.owner_report_id ?? "-",
          proposal.task_id ?? "-",
          proposal.title
        ]),
        ["id", "status", "priority", "owner_report", "task", "title"]
      );
      break;
    case "approve-requirement-proposal":
      console.log(
        `approved requirement proposal ${result.proposal.id}; created task ${result.task.id}`
      );
      break;
    case "reject-requirement-proposal":
      console.log(`rejected requirement proposal ${result.proposal.id}`);
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
    case "list-audit-events":
      printRows(
        result.events.map((event) => [
          event.id,
          event.type,
          event.at,
          event.project_id ?? "-",
          event.task_id ?? "-",
          event.delivery_id ?? "-",
          event.actor_id ?? "-"
        ]),
        ["id", "type", "at", "project", "task", "delivery", "actor"]
      );
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
          (task.dependencies ?? []).join(",") || "-",
          task.assigned_agent_id ?? "-",
          task.title
        ]),
        ["id", "status", "context", "priority", "depends_on", "agent", "title"]
      );
      break;
    case "show-task":
      console.log(JSON.stringify(result.task, null, 2));
      break;
    case "list-claimable-tasks":
      printRows(
        result.tasks.map((task) => [
          task.id,
          task.priority,
          (task.dependencies ?? []).join(",") || "-",
          task.title
        ]),
        ["id", "priority", "depends_on", "title"]
      );
      break;
    case "claim-task":
    case "claim-next-task":
    case "claim-next":
      console.log(
        `claimed task ${result.task.id} by ${result.task.assigned_agent_id}`
      );
      if (result.task.agent_acceptance?.note) {
        console.log(`acceptance note: ${result.task.agent_acceptance.note}`);
      }
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

function requirementsFromFlags(flags) {
  const requirements = {
    p0: collectFlags(flags, "p0", "p0-requirement"),
    p1: collectFlags(flags, "p1", "p1-requirement"),
    p2: collectFlags(flags, "p2", "p2-requirement")
  };
  return requirements.p0.length + requirements.p1.length + requirements.p2.length > 0
    ? requirements
    : undefined;
}

function aiDetectionFromFlags(flags) {
  const findings = collectFlags(flags, "ai-detection", "ai-finding");
  const status = stringFlag(flags, "ai-detection-status", "ai-status");
  const summary = stringFlag(flags, "ai-detection-summary", "ai-summary");

  if (!status && !summary && findings.length === 0) {
    return undefined;
  }

  return {
    status: status ?? (findings.length > 0 ? "recorded" : "not_run"),
    summary: summary ?? "",
    findings
  };
}

function positiveIntegerFlag(flags, ...names) {
  const value = stringFlag(flags, ...names);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected positive integer for --${names[0]}`);
  }
  return parsed;
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
  console.log(
    `owner thread: ${dashboard.owner_thread?.thread_id ?? "-"} (${dashboard.owner_report_status?.state ?? "unassigned"})`
  );
  if (dashboard.latest_owner_report) {
    console.log(
      `owner report: ${dashboard.latest_owner_report.id} ${dashboard.latest_owner_report.health} ${dashboard.latest_owner_report.summary}`
    );
  }
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
        task.is_claimable ? "yes" : "no",
        (task.blocked_by ?? []).join(",") || "-",
        task.assigned_agent_id ?? "-",
        task.title
      ]),
      ["id", "status", "context", "priority", "claimable", "blocked_by", "agent", "title"]
    );
  }
}

function formatRow(row, widths) {
  return row
    .map((cell, index) => String(cell ?? "").padEnd(widths[index]))
    .join("  ");
}

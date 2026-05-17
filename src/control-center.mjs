import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { validateRecord } from "./validation.mjs";

export class ControlCenter {
  constructor({ root }) {
    if (!root) {
      throw new Error("ControlCenter requires a root directory.");
    }

    this.root = root;
    this.ensureBase();
  }

  reset() {
    rmSync(this.root, { recursive: true, force: true });
    this.ensureBase();
  }

  registerAgent(agent) {
    requireFields(agent, ["id", "name", "role"]);

    const registry = this.readJson(this.agentRegistryPath(), {
      agents: [],
      updated_at: null
    });

    if (registry.agents.some((existing) => existing.id === agent.id)) {
      throw new Error(`Agent already exists: ${agent.id}`);
    }

    const nextAgent = {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      skills: agent.skills ?? [],
      status: agent.status ?? "available",
      current_task_id: null,
      created_at: now(),
      updated_at: now()
    };

    validateRecord("agent", nextAgent);
    registry.agents.push(nextAgent);
    registry.updated_at = now();
    this.writeRecord("agent-registry", this.agentRegistryPath(), registry);
    this.appendEvent("agent.registered", { agent_id: agent.id });

    return nextAgent;
  }

  createProject(project) {
    requireFields(project, ["id", "title", "goal"]);

    const projectDir = this.projectDir(project.id);
    if (existsSync(projectDir)) {
      throw new Error(`Project already exists: ${project.id}`);
    }

    mkdirSync(this.contextsDir(project.id), { recursive: true });
    mkdirSync(this.tasksDir(project.id), { recursive: true });
    mkdirSync(this.deliveriesDir(project.id), { recursive: true });
    mkdirSync(this.statusUpdatesDir(project.id), { recursive: true });

    const contextSnapshot = {
      id: "context-0001",
      project_id: project.id,
      version: 1,
      summary: project.context_summary ?? "",
      repo_path: project.repo_path ?? null,
      tech_stack: project.tech_stack ?? [],
      constraints: project.constraints ?? [],
      roadmap: project.roadmap ?? [],
      decisions: project.decisions ?? [],
      repository: project.github ?? null,
      completed_tasks: [],
      change_log: [
        {
          at: now(),
          by: project.created_by ?? "system",
          note: "Initial project context snapshot."
        }
      ],
      created_at: now()
    };

    const projectRecord = {
      id: project.id,
      title: project.title,
      goal: project.goal,
      status: project.status ?? "active",
      health: project.health ?? "unknown",
      current_context_snapshot_id: contextSnapshot.id,
      current_status_update_id: null,
      github: project.github ?? null,
      created_by: project.created_by ?? "system",
      created_at: now(),
      updated_at: now()
    };

    this.writeRecord("project", this.projectPath(project.id), projectRecord);
    this.writeRecord(
      "context",
      this.contextPath(project.id, contextSnapshot.id),
      contextSnapshot
    );
    this.appendEvent("project.created", {
      project_id: project.id,
      context_snapshot_id: contextSnapshot.id
    });

    return { project: projectRecord, context: contextSnapshot };
  }

  publishTask(task) {
    requireFields(task, ["project_id", "title", "objective", "created_by"]);
    this.getProject(task.project_id);

    const taskId = this.nextId(this.tasksDir(task.project_id), "task");
    const taskRecord = {
      id: taskId,
      project_id: task.project_id,
      title: task.title,
      objective: task.objective,
      priority: task.priority ?? "medium",
      status: "draft",
      context_status: "missing",
      context_snapshot_id: null,
      required_skills: task.required_skills ?? [],
      assigned_agent_id: null,
      execution_package: null,
      acceptance_criteria: [],
      deliverables: [],
      created_by: task.created_by,
      created_at: now(),
      updated_at: now()
    };

    this.writeRecord("task", this.taskPath(task.project_id, taskId), taskRecord);
    this.appendEvent("task.published", {
      project_id: task.project_id,
      task_id: taskId,
      status: taskRecord.status
    });

    return taskRecord;
  }

  prepareTask(input) {
    requireFields(input, ["project_id", "task_id", "steward_id", "task_brief"]);

    const steward = this.getAgent(input.steward_id);
    if (steward.role !== "context_steward") {
      throw new Error(`Agent is not a context steward: ${input.steward_id}`);
    }

    const project = this.getProject(input.project_id);
    const context = this.getContext(input.project_id, project.current_context_snapshot_id);
    const task = this.getTask(input.project_id, input.task_id);

    const canPrepareStaleReadyTask =
      task.status === "ready" && task.context_status === "stale";
    if (!["draft", "blocked"].includes(task.status) && !canPrepareStaleReadyTask) {
      throw new Error(`Task is not ready for context preparation: ${task.id}`);
    }

    const acceptanceCriteria = input.acceptance_criteria ?? [];
    const deliverables = input.deliverables ?? [];

    const preparedTask = {
      ...task,
      status: "ready",
      context_status: "ready",
      context_snapshot_id: context.id,
      required_skills: input.required_skills ?? task.required_skills,
      acceptance_criteria: acceptanceCriteria,
      deliverables,
      execution_package: {
        prepared_by: input.steward_id,
        prepared_at: now(),
        project_goal: project.goal,
        context_summary: context.summary,
        context_ref: `${input.project_id}/${context.id}`,
        task_brief: input.task_brief,
        relevant_files: input.relevant_files ?? [],
        assumptions: input.assumptions ?? [],
        handoff_prompt: buildHandoffPrompt({
          project,
          context,
          task,
          taskBrief: input.task_brief,
          acceptanceCriteria,
          deliverables
        })
      },
      updated_at: now()
    };

    this.writeRecord(
      "task",
      this.taskPath(input.project_id, input.task_id),
      preparedTask
    );
    this.appendEvent("task.prepared", {
      project_id: input.project_id,
      task_id: input.task_id,
      context_snapshot_id: context.id
    });

    return preparedTask;
  }

  claimTask(input) {
    requireFields(input, ["project_id", "task_id", "agent_id"]);

    const agent = this.getAgent(input.agent_id);
    const task = this.getTask(input.project_id, input.task_id);

    if (agent.status !== "available") {
      throw new Error(`Agent is not available: ${agent.id}`);
    }

    if (task.status !== "ready" || task.context_status !== "ready") {
      throw new Error(`Task must be ready before claim: ${task.id}`);
    }

    this.assertTaskContextIsCurrent(input.project_id, task);

    const missingSkills = task.required_skills.filter(
      (skill) => !agent.skills.includes(skill)
    );
    if (missingSkills.length > 0) {
      throw new Error(
        `Agent ${agent.id} is missing skills: ${missingSkills.join(", ")}`
      );
    }

    const claimedTask = {
      ...task,
      status: "claimed",
      assigned_agent_id: agent.id,
      claimed_at: now(),
      updated_at: now()
    };

    this.writeRecord(
      "task",
      this.taskPath(input.project_id, input.task_id),
      claimedTask
    );
    this.updateAgent(agent.id, {
      status: "busy",
      current_task_id: `${input.project_id}/${input.task_id}`
    });
    this.appendEvent("task.claimed", {
      project_id: input.project_id,
      task_id: input.task_id,
      agent_id: agent.id
    });

    return claimedTask;
  }

  startTask(input) {
    requireFields(input, ["project_id", "task_id", "agent_id"]);

    const task = this.getTask(input.project_id, input.task_id);
    if (task.status !== "claimed" || task.assigned_agent_id !== input.agent_id) {
      throw new Error(`Task is not claimed by agent: ${input.task_id}`);
    }

    const startedTask = {
      ...task,
      status: "in_progress",
      started_at: now(),
      updated_at: now()
    };

    this.assertTaskContextIsCurrent(input.project_id, task);
    this.writeRecord(
      "task",
      this.taskPath(input.project_id, input.task_id),
      startedTask
    );
    this.appendEvent("task.started", {
      project_id: input.project_id,
      task_id: input.task_id,
      agent_id: input.agent_id
    });

    return startedTask;
  }

  deliverTask(input) {
    requireFields(input, ["project_id", "task_id", "agent_id", "summary"]);

    const task = this.getTask(input.project_id, input.task_id);
    if (task.status !== "in_progress" || task.assigned_agent_id !== input.agent_id) {
      throw new Error(`Task is not in progress for agent: ${input.task_id}`);
    }

    this.assertTaskContextIsCurrent(input.project_id, task);

    const deliveryId = this.nextId(this.deliveriesDir(input.project_id), "delivery");
    const delivery = {
      id: deliveryId,
      project_id: input.project_id,
      task_id: input.task_id,
      agent_id: input.agent_id,
      summary: input.summary,
      files_changed: input.files_changed ?? [],
      verification: input.verification ?? [],
      followups: input.followups ?? [],
      status: "submitted",
      created_at: now()
    };

    const reviewedTask = {
      ...task,
      status: "review",
      delivery_id: deliveryId,
      delivered_at: now(),
      updated_at: now()
    };

    this.writeRecord("delivery", this.deliveryPath(input.project_id, deliveryId), delivery);
    this.writeRecord(
      "task",
      this.taskPath(input.project_id, input.task_id),
      reviewedTask
    );
    this.appendEvent("task.delivered", {
      project_id: input.project_id,
      task_id: input.task_id,
      delivery_id: deliveryId
    });

    return { task: reviewedTask, delivery };
  }

  acceptDelivery(input) {
    requireFields(input, ["project_id", "task_id", "steward_id", "context_update"]);

    const steward = this.getAgent(input.steward_id);
    if (steward.role !== "context_steward") {
      throw new Error(`Agent is not a context steward: ${input.steward_id}`);
    }

    const project = this.getProject(input.project_id);
    const task = this.getTask(input.project_id, input.task_id);
    if (task.status !== "review") {
      throw new Error(`Task is not waiting for review: ${task.id}`);
    }

    const delivery = this.getDelivery(input.project_id, task.delivery_id);
    const previousContext = this.getContext(
      input.project_id,
      project.current_context_snapshot_id
    );
    const nextContextId = this.nextId(this.contextsDir(input.project_id), "context");
    const nextContext = {
      ...deepClone(previousContext),
      id: nextContextId,
      version: previousContext.version + 1,
      based_on: previousContext.id,
      completed_tasks: [
        ...previousContext.completed_tasks,
        {
          task_id: task.id,
          title: task.title,
          delivery_id: delivery.id,
          summary: delivery.summary,
          completed_at: now()
        }
      ],
      change_log: [
        ...previousContext.change_log,
        {
          at: now(),
          by: input.steward_id,
          task_id: task.id,
          note: input.context_update
        }
      ],
      updated_at: now()
    };

    const doneTask = {
      ...task,
      status: "done",
      reviewed_by: input.steward_id,
      completed_at: now(),
      updated_at: now()
    };

    const acceptedDelivery = {
      ...delivery,
      status: "accepted",
      accepted_by: input.steward_id,
      accepted_at: now()
    };

    const updatedProject = {
      ...project,
      current_context_snapshot_id: nextContext.id,
      updated_at: now()
    };

    this.writeRecord("context", this.contextPath(input.project_id, nextContext.id), nextContext);
    this.writeRecord("project", this.projectPath(input.project_id), updatedProject);
    this.writeRecord("task", this.taskPath(input.project_id, input.task_id), doneTask);
    this.writeRecord(
      "delivery",
      this.deliveryPath(input.project_id, delivery.id),
      acceptedDelivery
    );

    if (doneTask.assigned_agent_id) {
      this.updateAgent(doneTask.assigned_agent_id, {
        status: "available",
        current_task_id: null
      });
    }

    const followupTasks = (input.followups ?? []).map((followup) =>
      this.publishTask({
        project_id: input.project_id,
        title: followup.title,
        objective: followup.objective,
        priority: followup.priority ?? "medium",
        required_skills: followup.required_skills ?? [],
        created_by: input.steward_id
      })
    );

    const staleTasks = this.markStalePreparedTasks(
      input.project_id,
      nextContext.id,
      doneTask.id
    );

    this.appendEvent("delivery.accepted", {
      project_id: input.project_id,
      task_id: input.task_id,
      next_context_snapshot_id: nextContext.id,
      followup_task_ids: followupTasks.map((followup) => followup.id),
      stale_task_ids: staleTasks.map((staleTask) => staleTask.id)
    });

    return {
      project: updatedProject,
      context: nextContext,
      task: doneTask,
      delivery: acceptedDelivery,
      followup_tasks: followupTasks,
      stale_tasks: staleTasks
    };
  }

  updateProjectStatus(input) {
    requireFields(input, ["project_id", "health", "summary", "updated_by"]);

    const project = this.getProject(input.project_id);
    const statusId = this.nextId(this.statusUpdatesDir(input.project_id), "status");
    const taskSnapshot = summarizeTasks(this.listTasks(input.project_id));
    const statusUpdate = {
      id: statusId,
      project_id: input.project_id,
      health: input.health,
      summary: input.summary,
      updated_by: input.updated_by,
      source: input.source ?? "manual",
      check_run_id: input.check_run_id,
      context_snapshot_id: project.current_context_snapshot_id,
      task_counts: {
        total: taskSnapshot.total,
        ...taskSnapshot.by_status
      },
      context_counts: {
        total: taskSnapshot.total,
        ...taskSnapshot.by_context_status
      },
      progress: input.progress ?? [],
      risks: input.risks ?? [],
      blockers: input.blockers ?? [],
      next_actions: input.next_actions ?? [],
      created_at: now()
    };

    const updatedProject = {
      ...project,
      health: statusUpdate.health,
      current_status_update_id: statusUpdate.id,
      updated_at: now()
    };

    this.writeRecord(
      "project-status",
      this.statusUpdatePath(input.project_id, statusId),
      statusUpdate
    );
    this.writeRecord("project", this.projectPath(input.project_id), updatedProject);
    this.appendEvent("project.status_updated", {
      project_id: input.project_id,
      status_update_id: statusId,
      health: statusUpdate.health
    });

    return { project: updatedProject, status_update: statusUpdate };
  }

  checkProjects(input = {}) {
    const updatedBy = input.updated_by ?? "codex-thread";
    const checkId = this.nextId(this.projectChecksDir(), "check");
    const projects = this.listProjects();
    const results = projects.map((project) => {
      const assessment = this.assessProject(project.id);
      const updated = this.updateProjectStatus({
        ...assessment,
        project_id: project.id,
        updated_by: updatedBy,
        source: "scheduled_check",
        check_run_id: checkId
      });

      return {
        project_id: project.id,
        project_title: project.title,
        health: updated.status_update.health,
        status_update_id: updated.status_update.id,
        context_snapshot_id: updated.status_update.context_snapshot_id,
        summary: updated.status_update.summary
      };
    });

    const checkRun = {
      id: checkId,
      updated_by: updatedBy,
      note: input.note ?? "",
      project_count: results.length,
      results,
      created_at: now()
    };

    this.writeRecord("project-check", this.projectCheckPath(checkId), checkRun);
    this.appendEvent("project.check_completed", {
      check_id: checkId,
      project_count: results.length
    });

    return { check: checkRun, results };
  }

  assessProject(projectId) {
    const dashboard = this.getProjectDashboard(projectId);
    const project = dashboard.project;
    const taskSummary = dashboard.task_summary;
    const byStatus = taskSummary.by_status;
    const byContext = taskSummary.by_context_status;
    const progress = [];
    const risks = [];
    const blockers = [];
    const nextActions = [];

    progress.push(`Current context is ${dashboard.current_context.id}.`);
    progress.push(`Task hall contains ${taskSummary.total} task(s).`);

    if (byStatus.done) {
      progress.push(`${byStatus.done} task(s) are done.`);
    }
    if (byStatus.in_progress) {
      progress.push(`${byStatus.in_progress} task(s) are in progress.`);
    }
    if (byStatus.review) {
      progress.push(`${byStatus.review} task(s) are waiting for review.`);
      nextActions.push(
        `Review submitted task(s): ${taskSummary.review_task_ids.join(", ")}.`
      );
    }
    if (byStatus.ready) {
      progress.push(`${byStatus.ready} task(s) are ready to claim.`);
      nextActions.push(
        `Assign or claim ready task(s): ${taskSummary.ready_task_ids.join(", ")}.`
      );
    }

    if (byStatus.blocked) {
      blockers.push(
        `Blocked task(s): ${taskSummary.blocked_task_ids.join(", ")}.`
      );
      nextActions.push("Resolve blocked tasks before publishing dependent work.");
    }

    if (byContext.stale) {
      risks.push(
        `Stale task context: ${taskSummary.stale_task_ids.join(", ")}.`
      );
      nextActions.push(
        `Re-prepare stale task(s): ${taskSummary.stale_task_ids.join(", ")}.`
      );
    }

    const draftCount = byStatus.draft ?? 0;
    const missingContextCount = byContext.missing ?? 0;
    if (draftCount > 0 || missingContextCount > 0) {
      risks.push(
        `${draftCount} draft task(s) and ${missingContextCount} task(s) with missing context need preparation.`
      );
      nextActions.push("Prepare draft tasks so executors can claim them.");
    }

    if (taskSummary.total === 0 && project.status === "active") {
      risks.push("No project-scoped tasks have been published yet.");
      nextActions.push("Publish the next project-scoped task.");
    }

    const health = deriveProjectHealth({
      project,
      taskSummary,
      risks,
      blockers
    });

    return {
      health,
      summary: buildProjectStatusSummary({
        project,
        health,
        taskSummary,
        risks,
        blockers
      }),
      progress,
      risks,
      blockers,
      next_actions: nextActions
    };
  }

  getAgent(agentId) {
    const registry = this.readJson(this.agentRegistryPath());
    const agent = registry.agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return agent;
  }

  listAgents() {
    return this.readJson(this.agentRegistryPath()).agents;
  }

  getProject(projectId) {
    return this.readJson(this.projectPath(projectId));
  }

  listProjects() {
    const projectsDir = join(this.root, "projects");
    if (!existsSync(projectsDir)) {
      return [];
    }

    return readdirSync(projectsDir)
      .sort()
      .filter((projectId) => existsSync(this.projectPath(projectId)))
      .map((projectId) => this.getProject(projectId));
  }

  getContext(projectId, contextId) {
    return this.readJson(this.contextPath(projectId, contextId));
  }

  getTask(projectId, taskId) {
    return this.readJson(this.taskPath(projectId, taskId));
  }

  getDelivery(projectId, deliveryId) {
    return this.readJson(this.deliveryPath(projectId, deliveryId));
  }

  getProjectStatusUpdate(projectId, statusUpdateId) {
    return this.readJson(this.statusUpdatePath(projectId, statusUpdateId));
  }

  getLatestProjectStatus(projectId) {
    const project = this.getProject(projectId);
    if (!project.current_status_update_id) {
      return null;
    }
    return this.getProjectStatusUpdate(projectId, project.current_status_update_id);
  }

  getProjectDashboard(projectId) {
    const project = this.getProject(projectId);
    const context = this.getContext(projectId, project.current_context_snapshot_id);
    const latestStatus = this.getLatestProjectStatus(projectId);
    const tasks = this.listTasks(projectId);

    return {
      project,
      latest_status: latestStatus,
      current_context: {
        id: context.id,
        version: context.version,
        summary: context.summary,
        completed_task_count: context.completed_tasks.length
      },
      task_summary: summarizeTasks(tasks),
      task_hall: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        context_status: task.context_status,
        priority: task.priority,
        assigned_agent_id: task.assigned_agent_id
      }))
    };
  }

  listProjectStatusUpdates(projectId) {
    const statusUpdatesDir = this.statusUpdatesDir(projectId);
    if (!existsSync(statusUpdatesDir)) {
      return [];
    }

    return readdirSync(statusUpdatesDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => this.readJson(join(statusUpdatesDir, fileName)));
  }

  getProjectCheck(checkId) {
    return this.readJson(this.projectCheckPath(checkId));
  }

  getLatestProjectCheck() {
    const checks = this.listProjectChecks();
    return checks.at(-1) ?? null;
  }

  listProjectChecks() {
    const checksDir = this.projectChecksDir();
    if (!existsSync(checksDir)) {
      return [];
    }

    return readdirSync(checksDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => this.readJson(join(checksDir, fileName)));
  }

  listTasks(projectId) {
    const tasksDir = this.tasksDir(projectId);
    if (!existsSync(tasksDir)) {
      return [];
    }

    return readdirSync(tasksDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => this.readJson(join(tasksDir, fileName)));
  }

  updateAgent(agentId, patch) {
    const registry = this.readJson(this.agentRegistryPath());
    const agentIndex = registry.agents.findIndex((agent) => agent.id === agentId);
    if (agentIndex === -1) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    registry.agents[agentIndex] = {
      ...registry.agents[agentIndex],
      ...patch,
      updated_at: now()
    };
    registry.updated_at = now();
    this.writeRecord("agent-registry", this.agentRegistryPath(), registry);

    return registry.agents[agentIndex];
  }

  assertTaskContextIsCurrent(projectId, task) {
    const project = this.getProject(projectId);
    if (task.context_snapshot_id !== project.current_context_snapshot_id) {
      throw new Error(
        `Task ${task.id} was prepared with ${task.context_snapshot_id}, but current project context is ${project.current_context_snapshot_id}`
      );
    }
  }

  markStalePreparedTasks(projectId, currentContextId, completedTaskId) {
    const staleTasks = [];

    for (const task of this.listTasks(projectId)) {
      if (
        task.id === completedTaskId ||
        task.status !== "ready" ||
        task.context_status !== "ready" ||
        task.context_snapshot_id === currentContextId
      ) {
        continue;
      }

      const staleTask = {
        ...task,
        context_status: "stale",
        updated_at: now(),
        stale_reason: `Project context advanced to ${currentContextId}. Re-prepare this task before claim.`
      };

      this.writeRecord("task", this.taskPath(projectId, task.id), staleTask);
      staleTasks.push(staleTask);
    }

    return staleTasks;
  }

  ensureBase() {
    mkdirSync(join(this.root, "agents"), { recursive: true });
    mkdirSync(join(this.root, "projects"), { recursive: true });
    mkdirSync(this.projectChecksDir(), { recursive: true });

    if (!existsSync(this.agentRegistryPath())) {
      this.writeJson(this.agentRegistryPath(), {
        agents: [],
        updated_at: now()
      });
    }

    if (!existsSync(this.eventsPath())) {
      this.writeJson(this.eventsPath(), []);
    }
  }

  appendEvent(type, payload) {
    const events = this.readJson(this.eventsPath(), []);
    events.push({
      type,
      payload,
      at: now()
    });
    this.writeJson(this.eventsPath(), events);
  }

  readJson(path, fallback = undefined) {
    if (!existsSync(path)) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`Missing JSON file: ${path}`);
    }
    return JSON.parse(readFileSync(path, "utf8"));
  }

  writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  writeRecord(type, path, value) {
    validateRecord(type, value);
    this.writeJson(path, value);
  }

  nextId(directory, prefix) {
    mkdirSync(directory, { recursive: true });
    const nextNumber =
      readdirSync(directory)
        .map((fileName) => {
          const match = fileName.match(new RegExp(`^${prefix}-(\\d+)\\.json$`));
          return match ? Number(match[1]) : 0;
        })
        .reduce((max, value) => Math.max(max, value), 0) + 1;

    return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
  }

  agentRegistryPath() {
    return join(this.root, "agents", "registry.json");
  }

  eventsPath() {
    return join(this.root, "events.json");
  }

  projectChecksDir() {
    return join(this.root, "checks");
  }

  projectCheckPath(checkId) {
    return join(this.projectChecksDir(), `${checkId}.json`);
  }

  projectDir(projectId) {
    return join(this.root, "projects", projectId);
  }

  projectPath(projectId) {
    return join(this.projectDir(projectId), "project.json");
  }

  contextsDir(projectId) {
    return join(this.projectDir(projectId), "contexts");
  }

  contextPath(projectId, contextId) {
    return join(this.contextsDir(projectId), `${contextId}.json`);
  }

  tasksDir(projectId) {
    return join(this.projectDir(projectId), "tasks");
  }

  taskPath(projectId, taskId) {
    return join(this.tasksDir(projectId), `${taskId}.json`);
  }

  deliveriesDir(projectId) {
    return join(this.projectDir(projectId), "deliveries");
  }

  deliveryPath(projectId, deliveryId) {
    return join(this.deliveriesDir(projectId), `${deliveryId}.json`);
  }

  statusUpdatesDir(projectId) {
    return join(this.projectDir(projectId), "status-updates");
  }

  statusUpdatePath(projectId, statusUpdateId) {
    return join(this.statusUpdatesDir(projectId), `${statusUpdateId}.json`);
  }
}

function buildHandoffPrompt({
  project,
  context,
  task,
  taskBrief,
  acceptanceCriteria,
  deliverables
}) {
  return [
    `Project: ${project.title}`,
    `Goal: ${project.goal}`,
    `Current context snapshot: ${context.id}`,
    `Task: ${task.title}`,
    `Objective: ${task.objective}`,
    `Brief: ${taskBrief}`,
    `Acceptance criteria: ${acceptanceCriteria.join("; ") || "Not specified"}`,
    `Deliverables: ${deliverables.join("; ") || "Not specified"}`
  ].join("\n");
}

function requireFields(value, fields) {
  for (const field of fields) {
    if (!value[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function summarizeTasks(tasks) {
  const byStatus = {};
  const byContextStatus = {};
  const highSignal = {
    ready: [],
    stale: [],
    blocked: [],
    in_progress: [],
    review: []
  };

  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    byContextStatus[task.context_status] =
      (byContextStatus[task.context_status] ?? 0) + 1;

    if (highSignal[task.status]) {
      highSignal[task.status].push(task.id);
    }
    if (task.context_status === "stale") {
      highSignal.stale.push(task.id);
    }
  }

  return {
    total: tasks.length,
    by_status: byStatus,
    by_context_status: byContextStatus,
    ready_task_ids: highSignal.ready,
    stale_task_ids: highSignal.stale,
    blocked_task_ids: highSignal.blocked,
    in_progress_task_ids: highSignal.in_progress,
    review_task_ids: highSignal.review
  };
}

function deriveProjectHealth({ project, taskSummary, risks, blockers }) {
  if (project.status === "done") {
    return "done";
  }
  if (project.status === "paused") {
    return "paused";
  }
  if (blockers.length > 0) {
    return "blocked";
  }
  if (risks.length > 0) {
    return "at_risk";
  }
  if (taskSummary.total === 0 && project.status === "active") {
    return "at_risk";
  }
  return "on_track";
}

function buildProjectStatusSummary({
  project,
  health,
  taskSummary,
  risks,
  blockers
}) {
  if (health === "done") {
    return "Project is marked done.";
  }
  if (health === "paused") {
    return "Project is paused.";
  }
  if (health === "blocked") {
    return `Project is blocked: ${blockers[0]}`;
  }
  if (health === "at_risk") {
    return `Project needs attention: ${risks[0]}`;
  }

  const activeWorkCount =
    (taskSummary.by_status.ready ?? 0) +
    (taskSummary.by_status.in_progress ?? 0) +
    (taskSummary.by_status.review ?? 0);
  return `${project.title} is on track with ${activeWorkCount} active task(s) and ${taskSummary.total} total task(s).`;
}

function now() {
  return new Date().toISOString();
}

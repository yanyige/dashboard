import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { validateRecord } from "./validation.mjs";

const DEFAULT_CONTROL_CENTER_PATH = "/Users/yyg/work/github/codex-control-center";

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
      active_task_ids: [],
      max_parallel_tasks: agent.max_parallel_tasks ?? 1,
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
    mkdirSync(this.ownerReportsDir(project.id), { recursive: true });
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
      requirements: normalizeRequirements(project.requirements),
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
      current_owner_report_id: null,
      owner_thread: normalizeOwnerThread(project.owner_thread),
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

  updateProjectContext(input) {
    requireFields(input, ["project_id", "updated_by"]);
    this.assertProjectAcceptsWork(input.project_id, "update context");

    const project = this.getProject(input.project_id);
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
      summary:
        input.summary !== undefined ? input.summary : previousContext.summary,
      requirements:
        input.requirements !== undefined
          ? normalizeRequirements(input.requirements)
          : normalizeRequirements(previousContext.requirements),
      change_log: [
        ...previousContext.change_log,
        {
          at: now(),
          by: input.updated_by,
          note: input.note ?? "Updated project context requirements."
        }
      ],
      updated_at: now()
    };
    const updatedProject = {
      ...project,
      current_context_snapshot_id: nextContext.id,
      updated_at: now()
    };

    this.writeRecord("context", this.contextPath(input.project_id, nextContext.id), nextContext);
    this.writeRecord("project", this.projectPath(input.project_id), updatedProject);
    const staleTasks = this.markStalePreparedTasks(
      input.project_id,
      nextContext.id,
      null
    );
    this.appendEvent("project.context_updated", {
      project_id: input.project_id,
      context_snapshot_id: nextContext.id,
      stale_task_ids: staleTasks.map((task) => task.id)
    });

    return {
      project: updatedProject,
      context: nextContext,
      stale_tasks: staleTasks
    };
  }

  refreshProjectContextFromReadme(input) {
    requireFields(input, ["project_id", "updated_by"]);
    this.assertProjectAcceptsWork(input.project_id, "refresh context from README");

    const project = this.getProject(input.project_id);
    const previousContext = this.getContext(
      input.project_id,
      project.current_context_snapshot_id
    );
    const readme = this.readProjectReadme(input.project_id, input.readme_path);
    const extracted = extractReadmeContext(readme.content, previousContext);
    const nextContextId = this.nextId(this.contextsDir(input.project_id), "context");
    const nowValue = now();
    const sourceDocument = {
      type: "readme",
      path: readme.path,
      scanned_at: nowValue,
      title: extracted.title,
      summary: extracted.summary,
      headings: extracted.headings.slice(0, 16),
      status_points: extracted.status_points.slice(0, 12)
    };
    const nextContext = {
      ...deepClone(previousContext),
      id: nextContextId,
      version: previousContext.version + 1,
      based_on: previousContext.id,
      summary: extracted.summary || previousContext.summary,
      requirements: extracted.has_requirements
        ? normalizeRequirements(extracted.requirements)
        : normalizeRequirements(previousContext.requirements),
      source_documents: [
        ...(previousContext.source_documents ?? []).filter(
          (source) => source.path !== readme.path
        ),
        sourceDocument
      ].slice(-8),
      change_log: [
        ...previousContext.change_log,
        {
          at: nowValue,
          by: input.updated_by,
          note:
            input.note ??
            `Refreshed project context from README: ${readme.path}`
        }
      ],
      updated_at: nowValue
    };
    const updatedProject = {
      ...project,
      current_context_snapshot_id: nextContext.id,
      updated_at: nowValue
    };

    this.writeRecord("context", this.contextPath(input.project_id, nextContext.id), nextContext);
    this.writeRecord("project", this.projectPath(input.project_id), updatedProject);
    const staleTasks = this.markStalePreparedTasks(
      input.project_id,
      nextContext.id,
      null
    );
    this.appendEvent("project.context_refreshed_from_readme", {
      project_id: input.project_id,
      context_snapshot_id: nextContext.id,
      readme_path: readme.path,
      stale_task_ids: staleTasks.map((task) => task.id)
    });

    return {
      project: updatedProject,
      context: nextContext,
      readme: sourceDocument,
      stale_tasks: staleTasks
    };
  }

  setProjectOwnerThread(input) {
    requireFields(input, ["project_id", "thread_id", "assigned_by"]);

    const project = this.getProject(input.project_id);
    const ownerThread = normalizeOwnerThread({
      thread_id: input.thread_id,
      name: input.name ?? input.thread_id,
      role: input.role ?? "project_owner",
      note: input.note ?? "",
      assigned_by: input.assigned_by,
      assigned_at: project.owner_thread?.assigned_at ?? now(),
      updated_at: now()
    });
    const updatedProject = {
      ...project,
      owner_thread: ownerThread,
      updated_at: now()
    };

    this.writeRecord("project", this.projectPath(input.project_id), updatedProject);
    this.appendEvent("project.owner_thread_set", {
      project_id: input.project_id,
      thread_id: ownerThread.thread_id,
      assigned_by: input.assigned_by
    });

    return { project: updatedProject };
  }

  submitProjectOwnerReport(input) {
    requireFields(input, ["project_id", "thread_id", "health", "summary"]);

    const project = this.getProject(input.project_id);
    if (
      project.owner_thread?.thread_id &&
      project.owner_thread.thread_id !== input.thread_id
    ) {
      throw new Error(
        `Project owner thread mismatch: expected ${project.owner_thread.thread_id}, got ${input.thread_id}`
      );
    }

    const reportId = this.nextId(this.ownerReportsDir(input.project_id), "owner-report");
    const report = {
      id: reportId,
      project_id: input.project_id,
      thread_id: input.thread_id,
      thread_name: input.thread_name ?? project.owner_thread?.name ?? input.thread_id,
      health: input.health,
      summary: input.summary,
      context: normalizeOwnerReportContext({
        summary: input.context_summary,
        requirements: input.requirements
      }),
      progress: input.progress ?? [],
      risks: input.risks ?? [],
      blockers: input.blockers ?? [],
      next_actions: input.next_actions ?? [],
      proposed_tasks: normalizeProposedTasks(input.proposed_tasks ?? []),
      asked_at: input.asked_at ?? null,
      answered_at: input.answered_at ?? now(),
      created_at: now()
    };
    const updatedProject = {
      ...project,
      owner_thread: project.owner_thread ?? normalizeOwnerThread({
        thread_id: input.thread_id,
        name: input.thread_name ?? input.thread_id,
        role: "project_owner",
        assigned_by: input.thread_id,
        assigned_at: now(),
        updated_at: now()
      }),
      current_owner_report_id: report.id,
      updated_at: now()
    };

    this.writeRecord(
      "owner-report",
      this.ownerReportPath(input.project_id, report.id),
      report
    );
    this.writeRecord("project", this.projectPath(input.project_id), updatedProject);
    this.appendEvent("project.owner_report_submitted", {
      project_id: input.project_id,
      thread_id: input.thread_id,
      owner_report_id: report.id,
      health: report.health
    });

    return { project: updatedProject, owner_report: report };
  }

  publishTask(task) {
    requireFields(task, ["project_id", "title", "objective", "created_by"]);
    this.assertProjectAcceptsWork(task.project_id, "publish tasks");

    const project = this.getProject(task.project_id);
    const taskId = this.nextId(this.tasksDir(task.project_id), "task");
    const taskRecord = {
      id: taskId,
      project_id: task.project_id,
      title: task.title,
      objective: task.objective,
      priority: task.priority ?? "medium",
      dependencies: uniqueStrings(task.dependencies ?? []),
      parallel_group: task.parallel_group ?? "default",
      status: "draft",
      context_status: "missing",
      context_snapshot_id: null,
      project_owner_thread_id:
        task.project_owner_thread_id ?? project.owner_thread?.thread_id ?? null,
      owner_report_id: task.owner_report_id ?? project.current_owner_report_id ?? null,
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
    this.assertProjectAcceptsWork(project.id, "prepare tasks");
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
      dependencies:
        input.dependencies !== undefined
          ? uniqueStrings(input.dependencies)
          : task.dependencies ?? [],
      parallel_group: input.parallel_group ?? task.parallel_group ?? "default",
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

  approveTask(input) {
    requireFields(input, ["project_id", "task_id", "steward_id"]);

    const task = this.getTask(input.project_id, input.task_id);
    if (task.status !== "draft") {
      throw new Error(`Only draft tasks can be approved: ${task.id}`);
    }

    return this.prepareTask({
      project_id: input.project_id,
      task_id: input.task_id,
      steward_id: input.steward_id,
      task_brief: input.task_brief ?? task.objective,
      relevant_files: input.relevant_files ?? [],
      assumptions: input.assumptions ?? [
        "Approved by the project owner from the web dashboard."
      ],
      acceptance_criteria: input.acceptance_criteria ?? [
        `${task.title} is implemented and verified.`
      ],
      deliverables: input.deliverables ?? [
        "Implementation changes",
        "Verification notes"
      ],
      required_skills: input.required_skills ?? task.required_skills
    });
  }

  rejectTask(input) {
    requireFields(input, ["project_id", "task_id", "reviewed_by"]);
    this.assertProjectAcceptsWork(input.project_id, "review tasks");

    const task = this.getTask(input.project_id, input.task_id);
    if (task.status !== "draft") {
      throw new Error(`Only draft tasks can be rejected: ${task.id}`);
    }

    const rejectedTask = {
      ...task,
      status: "rejected",
      reviewed_by: input.reviewed_by,
      reviewed_at: now(),
      rejection_reason: input.reason ?? "Rejected during project owner review.",
      updated_at: now()
    };

    this.writeRecord(
      "task",
      this.taskPath(input.project_id, input.task_id),
      rejectedTask
    );
    this.appendEvent("task.rejected", {
      project_id: input.project_id,
      task_id: input.task_id,
      reviewed_by: input.reviewed_by,
      reason: input.reason ?? ""
    });

    return rejectedTask;
  }

  claimTask(input) {
    requireFields(input, ["project_id", "task_id", "agent_id"]);

    const agent = this.getAgent(input.agent_id);
    const task = this.getTask(input.project_id, input.task_id);

    this.assertProjectAcceptsWork(input.project_id, "claim tasks");
    this.assertAgentCanAcceptTask(agent);
    this.assertTaskCanBeClaimed(input.project_id, task, agent);

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
    this.assignTaskToAgent(agent.id, `${input.project_id}/${input.task_id}`);
    this.appendEvent("task.claimed", {
      project_id: input.project_id,
      task_id: input.task_id,
      agent_id: agent.id
    });

    return claimedTask;
  }

  claimNextTask(input) {
    requireFields(input, ["project_id", "agent_id"]);

    this.assertProjectAcceptsWork(input.project_id, "claim tasks");
    this.assertAgentCanAcceptTask(this.getAgent(input.agent_id));
    const claimableTasks = this.listClaimableTasks(input.project_id, {
      agent_id: input.agent_id
    });
    const nextTask = claimableTasks[0];
    if (!nextTask) {
      throw new Error(`No claimable task for agent ${input.agent_id} in ${input.project_id}`);
    }

    return this.claimTask({
      project_id: input.project_id,
      task_id: nextTask.id,
      agent_id: input.agent_id
    });
  }

  startTask(input) {
    requireFields(input, ["project_id", "task_id", "agent_id"]);

    this.assertProjectAcceptsWork(input.project_id, "start tasks");
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

    const deliveryId = this.nextId(this.deliveriesDir(input.project_id), "delivery");
    const delivery = {
      id: deliveryId,
      project_id: input.project_id,
      task_id: input.task_id,
      agent_id: input.agent_id,
      context_snapshot_id: task.context_snapshot_id,
      summary: input.summary,
      files_changed: input.files_changed ?? [],
      verification: input.verification ?? [],
      followups: input.followups ?? [],
      ai_detection: normalizeAiDetection(input.ai_detection),
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
      accepted_at: now(),
      review: {
        decision: "accepted",
        reviewed_by: input.steward_id,
        reviewed_at: now(),
        method: input.review_method ?? "context_steward_review",
        summary:
          input.review_summary ??
          "Accepted by the Context Steward after reviewing the submitted delivery evidence.",
        context_update: input.context_update,
        ai_detection: normalizeAiDetection(input.ai_detection ?? delivery.ai_detection)
      }
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
      this.releaseTaskFromAgent(
        doneTask.assigned_agent_id,
        `${input.project_id}/${doneTask.id}`
      );
    }

    const followupTasks = (input.followups ?? []).map((followup) =>
      this.publishTask({
        project_id: input.project_id,
        title: followup.title,
        objective: followup.objective,
        priority: followup.priority ?? "medium",
        required_skills: followup.required_skills ?? [],
        dependencies: followup.dependencies ?? [],
        parallel_group: followup.parallel_group ?? "default",
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
      owner_report_id: input.owner_report_id,
      owner_report_status: input.owner_report_status,
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

  archiveProject(input) {
    requireFields(input, ["project_id", "archived_by"]);

    const project = this.getProject(input.project_id);
    if (project.status === "archived") {
      return {
        project,
        status_update: this.getLatestProjectStatus(input.project_id)
      };
    }

    const archivedProject = {
      ...project,
      status: "archived",
      health: "done",
      archived_by: input.archived_by,
      archived_at: now(),
      archive_reason: input.reason ?? "",
      updated_at: now()
    };

    this.writeRecord("project", this.projectPath(input.project_id), archivedProject);
    this.appendEvent("project.archived", {
      project_id: input.project_id,
      archived_by: input.archived_by,
      reason: input.reason ?? ""
    });

    return this.updateProjectStatus({
      project_id: input.project_id,
      health: "done",
      summary: input.reason
        ? `Project is archived: ${input.reason}`
        : "Project is archived.",
      updated_by: input.archived_by,
      source: "archive_project",
      progress: ["Project lifecycle changed to archived."],
      risks: [],
      blockers: [],
      next_actions: []
    });
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

    if (project.status === "archived") {
      return {
        health: "done",
        summary: "Project is archived.",
        owner_report_id: dashboard.latest_owner_report?.id,
        owner_report_status: dashboard.owner_report_status.state,
        progress: [
          `Project lifecycle is archived.`,
          `Task hall is retained with ${taskSummary.total} historical task(s).`
        ],
        risks: [],
        blockers: [],
        next_actions: []
      };
    }

    if (
      dashboard.owner_report_status.state === "fresh" &&
      dashboard.latest_owner_report
    ) {
      return buildAssessmentFromOwnerReport({
        report: dashboard.latest_owner_report,
        ownerStatus: dashboard.owner_report_status,
        taskSummary
      });
    }

    if (dashboard.owner_report_status.state === "missing") {
      risks.push(
        `Project owner thread ${dashboard.owner_thread.thread_id} has not submitted a status report yet.`
      );
      nextActions.push("Ask the project owner thread to submit its first owner report.");
    }

    if (dashboard.owner_report_status.state === "stale") {
      risks.push(
        `Project owner report ${dashboard.latest_owner_report.id} is stale; last answered at ${dashboard.latest_owner_report.answered_at}.`
      );
      nextActions.push("Ask the project owner thread to submit a fresh status report.");
    }

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
    if (taskSummary.claimable_task_ids.length > 0) {
      progress.push(
        `${taskSummary.claimable_task_ids.length} task(s) are claimable now.`
      );
      nextActions.push(
        `Agents can claim task(s): ${taskSummary.claimable_task_ids.join(", ")}.`
      );
    } else if (byStatus.ready) {
      progress.push(`${byStatus.ready} ready task(s) are waiting on dependencies or context.`);
    }
    if (taskSummary.dependency_blocked_task_ids.length > 0) {
      progress.push(
        `${taskSummary.dependency_blocked_task_ids.length} ready task(s) are waiting for dependencies: ${taskSummary.dependency_blocked_task_ids.join(", ")}.`
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
    const missingContextCount = taskSummary.needs_context_task_ids.length;
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
      owner_report_id: dashboard.latest_owner_report?.id,
      owner_report_status: dashboard.owner_report_status.state,
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
    return normalizeAgent(agent);
  }

  listAgents() {
    return this.readJson(this.agentRegistryPath()).agents.map(normalizeAgent);
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

  readProjectReadme(projectId, readmePath = undefined) {
    const project = this.getProject(projectId);
    const context = this.getContext(projectId, project.current_context_snapshot_id);
    const repoPath = context.repo_path;

    if (readmePath) {
      if (!repoPath && !isAbsolute(readmePath)) {
        throw new Error(
          `Project has no local repo_path for relative README refresh: ${projectId}`
        );
      }
      const resolvedPath = resolveReadmePath(repoPath ?? "", readmePath);
      return {
        path: resolvedPath,
        content: readFileSync(resolvedPath, "utf8")
      };
    }

    if (!repoPath) {
      throw new Error(`Project has no local repo_path for README refresh: ${projectId}`);
    }

    const resolvedPath = findReadmePath(repoPath);
    if (!resolvedPath) {
      throw new Error(`No README file found in ${repoPath}`);
    }

    return {
      path: resolvedPath,
      content: readFileSync(resolvedPath, "utf8")
    };
  }

  getTask(projectId, taskId) {
    return this.readJson(this.taskPath(projectId, taskId));
  }

  getDelivery(projectId, deliveryId) {
    return this.readJson(this.deliveryPath(projectId, deliveryId));
  }

  getProjectOwnerReport(projectId, reportId) {
    return this.readJson(this.ownerReportPath(projectId, reportId));
  }

  getLatestProjectOwnerReport(projectId) {
    const project = this.getProject(projectId);
    if (project.current_owner_report_id) {
      return this.getProjectOwnerReport(projectId, project.current_owner_report_id);
    }

    return this.listProjectOwnerReports(projectId).at(-1) ?? null;
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
    const latestOwnerReport = this.getLatestProjectOwnerReport(projectId);
    const ownerReportStatus = getOwnerReportStatus(project, latestOwnerReport);
    const ownerThreadPrompt = buildProjectOwnerThreadPrompt({
      project,
      context,
      ownerThread: project.owner_thread
    });
    const reportedContext = buildReportedContext({
      context,
      report: latestOwnerReport,
      ownerStatus: ownerReportStatus
    });
    const tasks = this.listTasks(projectId);
    const deliveriesById = new Map(
      this.listDeliveries(projectId).map((delivery) => [delivery.id, delivery])
    );
    const agentsById = new Map(this.listAgents().map((agent) => [agent.id, agent]));
    const taskIndex = tasks.map((task) => {
      const dependencyState = this.getTaskDependencyState(projectId, task);
      const claimability = this.getTaskClaimability(projectId, task);
      const delivery = task.delivery_id
        ? deliveriesById.get(task.delivery_id) ?? null
        : null;
      const agent = task.assigned_agent_id
        ? agentsById.get(task.assigned_agent_id) ?? null
        : null;

      return {
        id: task.id,
        title: task.title,
        objective: task.objective,
        status: task.status,
        context_status: task.context_status,
        priority: task.priority,
        project_owner_thread_id:
          task.project_owner_thread_id ?? project.owner_thread?.thread_id ?? null,
        owner_report_id:
          task.owner_report_id ?? project.current_owner_report_id ?? latestOwnerReport?.id ?? null,
        required_skills: task.required_skills ?? [],
        acceptance_criteria: task.acceptance_criteria ?? [],
        deliverables: task.deliverables ?? [],
        task_brief: task.execution_package?.task_brief ?? null,
        created_by: task.created_by ?? null,
        created_at: task.created_at ?? null,
        updated_at: task.updated_at ?? null,
        claimed_at: task.claimed_at ?? null,
        started_at: task.started_at ?? null,
        delivered_at: task.delivered_at ?? null,
        completed_at: task.completed_at ?? null,
        reviewed_by: task.reviewed_by ?? null,
        reviewed_at: task.reviewed_at ?? null,
        rejection_reason: task.rejection_reason ?? null,
        dependencies: dependencyState.dependencies,
        blocked_by: dependencyState.blocked_by,
        is_claimable: claimability.claimable,
        claim_blockers: claimability.reasons,
        parallel_group: task.parallel_group ?? "default",
        assigned_agent_id: task.assigned_agent_id,
        assigned_agent: agent
          ? {
              id: agent.id,
              name: agent.name,
              role: agent.role,
              status: agent.status
            }
          : null,
        context: {
          snapshot_id: task.context_snapshot_id,
          current_snapshot_id: project.current_context_snapshot_id,
          status: task.context_status,
          prepared_by: task.execution_package?.prepared_by ?? null,
          prepared_at: task.execution_package?.prepared_at ?? null,
          summary: task.execution_package?.context_summary ?? null,
          task_brief: task.execution_package?.task_brief ?? null,
          handoff_prompt: task.execution_package?.handoff_prompt ?? null,
          relevant_files: task.execution_package?.relevant_files ?? [],
          assumptions: task.execution_package?.assumptions ?? []
        },
        agent_commands: buildAgentTaskCommands({
          projectId,
          taskId: task.id,
          agentId: task.assigned_agent_id
        }),
        delivery: delivery
          ? {
              id: delivery.id,
              status: delivery.status,
              summary: delivery.summary,
              files_changed: delivery.files_changed ?? [],
              verification: delivery.verification ?? [],
              followups: delivery.followups ?? [],
              ai_detection: normalizeAiDetection(delivery.ai_detection),
              created_at: delivery.created_at ?? null,
              accepted_by: delivery.accepted_by ?? null,
              accepted_at: delivery.accepted_at ?? null,
              review: normalizeDeliveryReview(delivery)
            }
          : null
      };
    });
    const taskHall = taskIndex.filter((task) =>
      ["draft", "ready", "blocked"].includes(task.status)
    );
    const taskSummary = {
      ...summarizeTasks(tasks),
      claimable_task_ids: taskIndex
        .filter((task) => task.is_claimable)
        .map((task) => task.id),
      dependency_blocked_task_ids: taskIndex
        .filter((task) => task.status === "ready" && task.blocked_by.length > 0)
        .map((task) => task.id)
    };

    return {
      project,
      owner_thread: project.owner_thread ?? null,
      owner_thread_prompt: ownerThreadPrompt,
      latest_owner_report: latestOwnerReport,
      owner_report_status: ownerReportStatus,
      latest_status: latestStatus,
      reported_context: reportedContext,
      current_context: {
        id: context.id,
        version: context.version,
        summary: context.summary,
        requirements: normalizeRequirements(context.requirements),
        tech_stack: context.tech_stack ?? [],
        constraints: context.constraints ?? [],
        roadmap: context.roadmap ?? [],
        repo_path: context.repo_path ?? null,
        source_documents: context.source_documents ?? [],
        completed_task_count: context.completed_tasks.length
      },
      task_summary: taskSummary,
      task_index: taskIndex,
      task_hall: taskHall
    };
  }

  listClaimableTasks(projectId, options = {}) {
    const project = this.getProject(projectId);
    if (project.status === "archived") {
      return [];
    }

    const agent = options.agent_id ? this.getAgent(options.agent_id) : null;

    return this.listTasks(projectId)
      .map((task) => ({
        ...task,
        dependencies: task.dependencies ?? [],
        parallel_group: task.parallel_group ?? "default",
        claimability: this.getTaskClaimability(projectId, task, agent)
      }))
      .filter((task) => task.claimability.claimable)
      .sort(compareTasksForClaim);
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

  listProjectOwnerReports(projectId) {
    const ownerReportsDir = this.ownerReportsDir(projectId);
    if (!existsSync(ownerReportsDir)) {
      return [];
    }

    return readdirSync(ownerReportsDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => this.readJson(join(ownerReportsDir, fileName)));
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

  listDeliveries(projectId) {
    const deliveriesDir = this.deliveriesDir(projectId);
    if (!existsSync(deliveriesDir)) {
      return [];
    }

    return readdirSync(deliveriesDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => this.readJson(join(deliveriesDir, fileName)));
  }

  updateAgent(agentId, patch) {
    const registry = this.readJson(this.agentRegistryPath());
    const agentIndex = registry.agents.findIndex((agent) => agent.id === agentId);
    if (agentIndex === -1) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    registry.agents[agentIndex] = normalizeAgent({
      ...normalizeAgent(registry.agents[agentIndex]),
      ...patch,
      updated_at: now()
    });
    registry.updated_at = now();
    this.writeRecord("agent-registry", this.agentRegistryPath(), registry);

    return registry.agents[agentIndex];
  }

  assignTaskToAgent(agentId, taskRef) {
    const agent = this.getAgent(agentId);
    const activeTaskIds = uniqueStrings([...agent.active_task_ids, taskRef]);
    return this.updateAgent(agentId, {
      status: activeTaskIds.length > 0 ? "busy" : "available",
      current_task_id: activeTaskIds[0] ?? null,
      active_task_ids: activeTaskIds
    });
  }

  releaseTaskFromAgent(agentId, taskRef) {
    const agent = this.getAgent(agentId);
    const activeTaskIds = agent.active_task_ids.filter((id) => id !== taskRef);
    return this.updateAgent(agentId, {
      status: activeTaskIds.length > 0 ? "busy" : "available",
      current_task_id: activeTaskIds[0] ?? null,
      active_task_ids: activeTaskIds
    });
  }

  assertTaskContextIsCurrent(projectId, task) {
    const project = this.getProject(projectId);
    if (task.context_snapshot_id !== project.current_context_snapshot_id) {
      throw new Error(
        `Task ${task.id} was prepared with ${task.context_snapshot_id}, but current project context is ${project.current_context_snapshot_id}`
      );
    }
  }

  getTaskDependencyState(projectId, task) {
    const dependencies = uniqueStrings(task.dependencies ?? []);
    const blockedBy = [];

    for (const dependencyId of dependencies) {
      let dependencyTask = null;
      try {
        dependencyTask = this.getTask(projectId, dependencyId);
      } catch {
        blockedBy.push(dependencyId);
        continue;
      }

      if (dependencyTask.status !== "done") {
        blockedBy.push(dependencyId);
      }
    }

    return {
      dependencies,
      blocked_by: blockedBy,
      dependencies_satisfied: blockedBy.length === 0
    };
  }

  getTaskClaimability(projectId, task, agent = null) {
    const reasons = [];

    if (task.status !== "ready") {
      reasons.push(`status=${task.status}`);
    }
    if (task.context_status !== "ready") {
      reasons.push(`context=${task.context_status}`);
    }

    const project = this.getProject(projectId);
    if (task.context_snapshot_id !== project.current_context_snapshot_id) {
      reasons.push(`context_snapshot=${task.context_snapshot_id ?? "missing"}`);
    }

    const dependencyState = this.getTaskDependencyState(projectId, task);
    if (dependencyState.blocked_by.length > 0) {
      reasons.push(`blocked_by=${dependencyState.blocked_by.join(",")}`);
    }

    if (agent) {
      const capacity = getAgentCapacity(agent);
      if (agent.status === "offline") {
        reasons.push("agent=offline");
      }
      if (capacity.active >= capacity.max) {
        reasons.push(`agent_capacity=${capacity.active}/${capacity.max}`);
      }

      const missingSkills = (task.required_skills ?? []).filter(
        (skill) => !agent.skills.includes(skill)
      );
      if (missingSkills.length > 0) {
        reasons.push(`missing_skills=${missingSkills.join(",")}`);
      }
    }

    return {
      claimable: reasons.length === 0,
      reasons,
      blocked_by: dependencyState.blocked_by
    };
  }

  assertTaskCanBeClaimed(projectId, task, agent) {
    const claimability = this.getTaskClaimability(projectId, task, agent);
    if (!claimability.claimable) {
      throw new Error(
        `Task ${task.id} is not claimable: ${claimability.reasons.join("; ")}`
      );
    }
  }

  assertAgentCanAcceptTask(agent) {
    if (agent.status === "offline") {
      throw new Error(`Agent is offline: ${agent.id}`);
    }

    const capacity = getAgentCapacity(agent);
    if (capacity.active >= capacity.max) {
      throw new Error(
        `Agent ${agent.id} has no free task capacity: ${capacity.active}/${capacity.max}`
      );
    }
  }

  assertProjectAcceptsWork(projectId, action) {
    const project = this.getProject(projectId);
    if (project.status === "archived") {
      throw new Error(`Archived project cannot ${action}: ${projectId}`);
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

  ownerReportsDir(projectId) {
    return join(this.projectDir(projectId), "owner-reports");
  }

  ownerReportPath(projectId, reportId) {
    return join(this.ownerReportsDir(projectId), `${reportId}.json`);
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
  const commands = buildAgentTaskCommands({
    projectId: project.id,
    taskId: task.id,
    agentId: "<agent-id>"
  });

  return [
    `Project: ${project.title}`,
    `Goal: ${project.goal}`,
    `Current context snapshot: ${context.id}`,
    `Task: ${task.title}`,
    `Objective: ${task.objective}`,
    `Brief: ${taskBrief}`,
    `Acceptance criteria: ${acceptanceCriteria.join("; ") || "Not specified"}`,
    `Deliverables: ${deliverables.join("; ") || "Not specified"}`,
    "",
    "Agent operating contract:",
    "1. Claim and start the task before editing.",
    "2. When the work is complete, proactively submit it for review with `deliver-task`.",
    "3. `deliver-task` changes the task status to `review`; do not run `accept-delivery` yourself.",
    "4. The overall PM / Context Steward reviews the delivery evidence and accepts or sends it back.",
    "",
    "Claim:",
    commands.claim,
    "",
    "Start:",
    commands.start,
    "",
    "Submit for review after completion:",
    commands.submit_for_review,
    "",
    "If `dashboard-ccc` is not installed in your environment, run the same command from the control-center repository with `npm run ccc --` before the command name."
  ].join("\n");
}

function buildAgentTaskCommands({ projectId, taskId, agentId }) {
  const agent = agentId ?? "<agent-id>";
  const commandPrefix = "dashboard-ccc";
  const projectArg = shellArg(projectId);
  const taskArg = shellArg(taskId);
  const agentArg = shellArg(agent);

  return {
    claim: `${commandPrefix} claim-task --project ${projectArg} --task ${taskArg} --agent ${agentArg}`,
    start: `${commandPrefix} start-task --project ${projectArg} --task ${taskArg} --agent ${agentArg}`,
    submit_for_review: [
      `${commandPrefix} deliver-task \\`,
      `  --project ${projectArg} \\`,
      `  --task ${taskArg} \\`,
      `  --agent ${agentArg} \\`,
      `  --summary "<完成内容、影响范围和关键决策>" \\`,
      `  --changed-file "<变更文件路径，可重复多次>" \\`,
      `  --verification "<验证命令、结果或无法验证的原因，可重复多次>" \\`,
      `  --ai-detection-status passed \\`,
      `  --ai-detection-summary "<执行 Agent 对交付质量、风险和遗漏项的自检结论>"`
    ].join("\n")
  };
}

function shellArg(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
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

function normalizeAgent(agent) {
  const rawActiveTaskIds =
    Array.isArray(agent.active_task_ids) && agent.active_task_ids.length > 0
      ? agent.active_task_ids
      : agent.current_task_id
        ? [agent.current_task_id]
        : [];
  const activeTaskIds = uniqueStrings(
    rawActiveTaskIds
  );

  return {
    ...agent,
    skills: agent.skills ?? [],
    current_task_id: activeTaskIds[0] ?? null,
    active_task_ids: activeTaskIds,
    max_parallel_tasks:
      Number.isInteger(agent.max_parallel_tasks) && agent.max_parallel_tasks > 0
        ? agent.max_parallel_tasks
        : 1
  };
}

function getAgentCapacity(agent) {
  const normalized = normalizeAgent(agent);
  return {
    active: normalized.active_task_ids.length,
    max: normalized.max_parallel_tasks
  };
}

function uniqueStrings(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  ];
}

function normalizeRequirements(requirements = {}) {
  return {
    p0: uniqueStrings(requirements?.p0 ?? []),
    p1: uniqueStrings(requirements?.p1 ?? []),
    p2: uniqueStrings(requirements?.p2 ?? [])
  };
}

function normalizeOwnerThread(ownerThread = null) {
  if (!ownerThread?.thread_id) {
    return null;
  }

  const nowValue = now();
  return {
    thread_id: ownerThread.thread_id,
    name: ownerThread.name ?? ownerThread.thread_id,
    role: ownerThread.role ?? "project_owner",
    note: ownerThread.note ?? "",
    assigned_by: ownerThread.assigned_by ?? "system",
    assigned_at: ownerThread.assigned_at ?? nowValue,
    updated_at: ownerThread.updated_at ?? nowValue
  };
}

function normalizeOwnerReportContext(context = {}) {
  const summary = String(context.summary ?? "").trim();
  const requirements = normalizeRequirements(context.requirements ?? {});
  const hasRequirements =
    requirements.p0.length + requirements.p1.length + requirements.p2.length > 0;

  if (!summary && !hasRequirements) {
    return null;
  }

  return {
    summary,
    requirements,
    updated_at: now()
  };
}

function normalizeProposedTasks(tasks = []) {
  return tasks
    .map((task) => ({
      title: String(task.title ?? "").trim(),
      objective: String(task.objective ?? "").trim(),
      priority: task.priority ?? "medium",
      required_skills: uniqueStrings(task.required_skills ?? task.skills ?? [])
    }))
    .filter((task) => task.title && task.objective);
}

function buildReportedContext({ context, report, ownerStatus }) {
  if (report) {
    const reportContext = report.context ?? {};
    return {
      source: "owner_report",
      source_label: "项目经理上报",
      source_id: report.id,
      owner_thread_id: report.thread_id,
      owner_thread_name: report.thread_name ?? report.thread_id,
      health: report.health,
      freshness_minutes: ownerStatus?.freshness_minutes ?? null,
      summary: reportContext.summary || report.summary,
      requirements: normalizeRequirements(reportContext.requirements ?? context.requirements),
      progress: report.progress ?? [],
      risks: report.risks ?? [],
      blockers: report.blockers ?? [],
      next_actions: report.next_actions ?? [],
      proposed_tasks: report.proposed_tasks ?? [],
      reported_at: report.answered_at ?? report.created_at ?? null,
      context_snapshot_id: context.id,
      context_version: context.version
    };
  }

  return {
    source: "context_snapshot",
    source_label: "项目上下文快照",
    source_id: context.id,
    owner_thread_id: null,
    owner_thread_name: null,
    health: null,
    freshness_minutes: null,
    summary: context.summary,
    requirements: normalizeRequirements(context.requirements),
    progress: [],
    risks: [],
    blockers: [],
    next_actions: [],
    proposed_tasks: [],
    reported_at: null,
    context_snapshot_id: context.id,
    context_version: context.version
  };
}

function buildProjectOwnerThreadPrompt({ project, context, ownerThread }) {
  const threadId = ownerThread?.thread_id ?? `${project.id}-owner-thread`;
  const threadName = ownerThread?.name ?? `${project.title}负责人 Thread`;
  const requirements = normalizeRequirements(context.requirements);
  const githubUrl = project.github?.web_url ?? project.github?.clone_url ?? "未配置";
  const p0Flags = requirements.p0.map((item) => `  --p0 "${item}"`).join(" \\\n");
  const p1Flags = requirements.p1.map((item) => `  --p1 "${item}"`).join(" \\\n");
  const p2Flags = requirements.p2.map((item) => `  --p2 "${item}"`).join(" \\\n");
  const requirementFlags = [p0Flags, p1Flags, p2Flags].filter(Boolean).join(" \\\n");

  return [
    `你现在是「${project.title}」的项目负责人 Thread，不是普通执行 Agent。`,
    "",
    "你的职责：",
    `1. 负责项目 ${project.id} 的真实状态判断、上下文维护、风险识别和下一步任务建议。`,
    "2. 阅读项目仓库 README 和关键文件，理解当前项目进度。",
    "3. 把你的项目状态和项目上下文定期写回 Codex Control Center，让总项目经理 Thread 能在 Dashboard 中查看。",
    "4. 你提出的任务必须围绕项目 P0/P1/P2 需求，并保证任务清晰、可审核、可执行。",
    "",
    "项目资料：",
    `- 项目 ID：${project.id}`,
    `- GitHub 仓库：${githubUrl}`,
    `- 控制中心路径：${DEFAULT_CONTROL_CENTER_PATH}`,
    `- 你的负责人 Thread 标识：${threadId}`,
    `- 你的显示名称：${threadName}`,
    "",
    "请先执行：",
    "",
    `cd ${DEFAULT_CONTROL_CENTER_PATH}`,
    "",
    "npm run ccc -- set-project-owner \\",
    `  --project ${project.id} \\`,
    `  --thread ${threadId} \\`,
    `  --name "${threadName}" \\`,
    "  --assigned-by yyg \\",
    `  --note "负责 ${project.id} 项目状态、需求上下文、风险和任务建议上报"`,
    "",
    `npm run ccc -- show-project-dashboard --project ${project.id}`,
    "",
    "如果 README 或项目文件比控制中心上下文更新，请刷新上下文：",
    "",
    `npm run ccc -- refresh-project-context --project ${project.id} --updated-by ${threadId}`,
    "",
    "然后提交负责人报告。报告里的 --context-summary、--p0、--p1、--p2 会成为 Dashboard 中优先展示的项目上下文口径：",
    "",
    "npm run ccc -- owner-report \\",
    `  --project ${project.id} \\`,
    `  --thread ${threadId} \\`,
    `  --thread-name "${threadName}" \\`,
    "  --health at_risk \\",
    "  --summary \"这里写你对项目当前状态的简明判断。\" \\",
    "  --context-summary \"这里写项目经理上报的项目上下文摘要。\" \\",
    `${requirementFlags ? `${requirementFlags} \\\n` : ""}  --progress "这里写已确认的进展。" \\`,
    "  --risk \"这里写当前主要风险。\" \\",
    "  --next-action \"这里写下一步动作。\" \\",
    "  --proposed-task \"任务标题::任务目标描述::high::node,workflow\"",
    "",
    "完成后，把 owner report id、当前健康状态、P0/P1/P2 是否需要更新、优先审核的草稿任务、可交给 Agent 执行的任务告诉我。"
  ].join("\n");
}

function getOwnerReportStatus(project, report) {
  const ownerThread = project.owner_thread;
  if (!ownerThread?.thread_id) {
    return {
      state: "unassigned",
      label: "未绑定负责人 Thread",
      freshness_minutes: null
    };
  }
  if (!report) {
    return {
      state: "missing",
      label: "负责人尚未上报",
      freshness_minutes: null
    };
  }

  const answeredAt = Date.parse(report.answered_at ?? report.created_at ?? "");
  const ageMs = Number.isNaN(answeredAt) ? Infinity : Date.now() - answeredAt;
  const freshnessMinutes = Number.isFinite(ageMs)
    ? Math.max(0, Math.round(ageMs / 60000))
    : null;
  const isFresh = ageMs <= 30 * 60 * 1000;

  return {
    state: isFresh ? "fresh" : "stale",
    label: isFresh ? "负责人报告新鲜" : "负责人报告已过期",
    freshness_minutes: freshnessMinutes,
    stale_after_minutes: 30
  };
}

function buildAssessmentFromOwnerReport({ report, ownerStatus, taskSummary }) {
  const proposedTaskCount = report.proposed_tasks?.length ?? 0;
  const progress = [
    `Project owner thread ${report.thread_id} reported at ${report.answered_at}.`,
    ...report.progress
  ];
  const nextActions = [...report.next_actions];
  if (proposedTaskCount > 0) {
    nextActions.push(
      `Review ${proposedTaskCount} task proposal(s) from owner report ${report.id}.`
    );
  }

  return {
    health: report.health,
    summary: `Owner report: ${report.summary}`,
    owner_report_id: report.id,
    owner_report_status: ownerStatus.state,
    progress,
    risks: report.risks,
    blockers: report.blockers,
    next_actions: nextActions,
    task_counts: taskSummary
  };
}

function resolveReadmePath(repoPath, readmePath) {
  const resolvedPath = isAbsolute(readmePath)
    ? readmePath
    : resolve(repoPath, readmePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`README file does not exist: ${resolvedPath}`);
  }
  return resolvedPath;
}

function findReadmePath(repoPath) {
  const preferred = [
    "README.md",
    "README.MD",
    "readme.md",
    "README_CN.md",
    "README.zh-CN.md",
    "README.txt"
  ]
    .map((fileName) => join(repoPath, fileName))
    .find((path) => existsSync(path));
  if (preferred) {
    return preferred;
  }

  if (!existsSync(repoPath)) {
    return null;
  }

  const readmeFile = readdirSync(repoPath)
    .filter((fileName) => /^readme/i.test(fileName))
    .sort()[0];
  return readmeFile ? join(repoPath, readmeFile) : null;
}

function extractReadmeContext(content, previousContext) {
  const lines = content.split(/\r?\n/);
  const title = extractReadmeTitle(lines);
  const headings = extractHeadings(lines);
  const paragraphs = extractIntroParagraphs(lines);
  const statusPoints = uniqueStrings([
    ...extractExplicitStatusLines(lines),
    ...extractStatusPoints(lines)
  ]);
  const priorityRequirements = extractPriorityRequirements(lines);
  const summaryStatusPoints = prioritizeReadmeStatusPoints(statusPoints);
  const hasRequirements =
    priorityRequirements.p0.length +
      priorityRequirements.p1.length +
      priorityRequirements.p2.length >
    0;
  const summaryParts = [
    title ? `${title}.` : "",
    paragraphs.join(" "),
    summaryStatusPoints.length > 0
      ? `README 当前状态：${summaryStatusPoints.slice(0, 5).join("；")}。`
      : ""
  ].filter(Boolean);

  return {
    title,
    headings,
    status_points: statusPoints,
    requirements: hasRequirements
      ? priorityRequirements
      : normalizeRequirements(previousContext.requirements),
    has_requirements: hasRequirements,
    summary: compactWhitespace(summaryParts.join(" ")).slice(0, 1200)
  };
}

function extractReadmeTitle(lines) {
  const heading = lines.find((line) => /^#\s+/.test(line.trim()));
  return heading ? heading.replace(/^#\s+/, "").trim() : "";
}

function extractHeadings(lines) {
  return uniqueStrings(
    lines
      .map((line) => line.trim().match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
      .filter(Boolean)
  );
}

function extractIntroParagraphs(lines) {
  const paragraphs = [];
  let current = [];
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || line.startsWith("#") || isListLine(line)) {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      if (paragraphs.length >= 2) {
        break;
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0 && paragraphs.length < 2) {
    paragraphs.push(current.join(" "));
  }

  return paragraphs.map(compactWhitespace).filter(Boolean).slice(0, 2);
}

function extractStatusPoints(lines) {
  const points = [];
  let active = false;
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const heading = line.match(/^#{2,6}\s+(.+)$/)?.[1]?.trim() ?? "";
    if (heading) {
      active = /current|status|workflow|capabilit|progress|ecs|gpu|comfyui|credit|当前|状态|进度|能力|流程|资产|任务|额度/i.test(heading);
      if (active) {
        points.push(heading);
      }
      continue;
    }

    if (!active) {
      continue;
    }

    const point = cleanReadmeListLine(line);
    if (point) {
      points.push(point);
    }
  }

  return uniqueStrings(points)
    .filter((point) => point.length >= 4)
    .slice(0, 80);
}

function extractExplicitStatusLines(lines) {
  const points = [];
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const point = cleanReadmeListLine(line);
    if (/current|currently|now|latest|当前|现在|最新/i.test(point)) {
      points.push(point);
    }
  }

  return uniqueStrings(points).filter((point) => point.length >= 4);
}

function prioritizeReadmeStatusPoints(points) {
  const priorityPattern = /current|currently|supports|exposes|separates|stored|generated|preheat|worker|comfyui|musetalk|credits|ecs|gpu|workflow|当前|现在|支持|能力|生成|预热|任务|资产|额度|流程/i;
  const noisyPattern = /development workflow|commit messages|conventional commits|do not commit|meaningful change|ignored by git/i;
  const priority = points.filter(
    (point) => priorityPattern.test(point) && !noisyPattern.test(point)
  );
  const fallback = points.filter((point) => !noisyPattern.test(point));
  return uniqueStrings([...priority, ...fallback]);
}

function extractPriorityRequirements(lines) {
  const requirements = {
    p0: [],
    p1: [],
    p2: []
  };
  let currentPriority = null;
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const headingPriority = line.match(/^#{1,6}\s*(P[012])\b/i)?.[1]?.toLowerCase();
    if (headingPriority) {
      currentPriority = headingPriority;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      currentPriority = null;
      continue;
    }

    const inlinePriority = line.match(/^(?:[-*]\s*)?(P[012])\s*[:：-]\s*(.+)$/i);
    if (inlinePriority) {
      requirements[inlinePriority[1].toLowerCase()].push(inlinePriority[2].trim());
      continue;
    }

    if (currentPriority) {
      const requirement = cleanReadmeListLine(line);
      if (requirement) {
        requirements[currentPriority].push(requirement);
      }
    }
  }

  return normalizeRequirements(requirements);
}

function isListLine(line) {
  return /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
}

function cleanReadmeListLine(line) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .trim();
}

function compactWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeAiDetection(aiDetection = undefined) {
  if (!aiDetection) {
    return {
      status: "not_run",
      summary: "AI detection has not been recorded for this delivery.",
      findings: []
    };
  }

  if (Array.isArray(aiDetection)) {
    return {
      status: aiDetection.length > 0 ? "recorded" : "not_run",
      summary: "",
      findings: uniqueStrings(aiDetection)
    };
  }

  return {
    status: aiDetection.status ?? "recorded",
    summary: aiDetection.summary ?? "",
    findings: uniqueStrings(aiDetection.findings ?? [])
  };
}

function normalizeDeliveryReview(delivery) {
  if (delivery.review) {
    return {
      decision: delivery.review.decision ?? delivery.status,
      reviewed_by: delivery.review.reviewed_by ?? delivery.accepted_by ?? null,
      reviewed_at: delivery.review.reviewed_at ?? delivery.accepted_at ?? null,
      method: delivery.review.method ?? "context_steward_review",
      summary: delivery.review.summary ?? "",
      context_update: delivery.review.context_update ?? "",
      ai_detection: normalizeAiDetection(
        delivery.review.ai_detection ?? delivery.ai_detection
      )
    };
  }

  if (delivery.accepted_by || delivery.accepted_at) {
    return {
      decision: delivery.status,
      reviewed_by: delivery.accepted_by ?? null,
      reviewed_at: delivery.accepted_at ?? null,
      method: "context_steward_review",
      summary: "",
      context_update: "",
      ai_detection: normalizeAiDetection(delivery.ai_detection)
    };
  }

  return null;
}

function compareTasksForClaim(left, right) {
  const leftPriority = priorityRank(left.priority);
  const rightPriority = priorityRank(right.priority);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const createdCompare = String(left.created_at ?? "").localeCompare(
    String(right.created_at ?? "")
  );
  if (createdCompare !== 0) {
    return createdCompare;
  }

  return left.id.localeCompare(right.id);
}

function priorityRank(priority) {
  return {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3
  }[priority] ?? 2;
}

function summarizeTasks(tasks) {
  const byStatus = {};
  const byContextStatus = {};
  const highSignal = {
    ready: [],
    stale: [],
    blocked: [],
    in_progress: [],
    review: [],
    needs_context: []
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
    if (task.status === "draft" && task.context_status === "missing") {
      highSignal.needs_context.push(task.id);
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
    review_task_ids: highSignal.review,
    needs_context_task_ids: highSignal.needs_context
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

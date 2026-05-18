const state = {
  data: null,
  selectedProjectId: null,
  loading: false
};

const HEALTH_LABELS = {
  unknown: "未知",
  on_track: "正常",
  at_risk: "有风险",
  blocked: "阻塞",
  paused: "暂停",
  done: "完成"
};

const TASK_STATUS_LABELS = {
  draft: "待审核",
  ready: "待领取",
  claimed: "已领取",
  in_progress: "进行中",
  review: "待验收",
  done: "已完成",
  rejected: "已退回",
  blocked: "阻塞"
};

const CONTEXT_STATUS_LABELS = {
  missing: "缺上下文",
  ready: "已准备",
  stale: "需更新"
};

const PRIORITY_LABELS = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低"
};

const QUEUE_STATUSES = new Set(["ready", "claimed", "in_progress", "review", "blocked"]);
const ACTIVE_STATUSES = new Set(["claimed", "in_progress", "review"]);
const PRIORITY_ORDER = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3
};
const TASK_STATUS_ORDER = {
  in_progress: 0,
  claimed: 1,
  review: 2,
  ready: 3,
  blocked: 4,
  draft: 5,
  rejected: 6,
  done: 7
};

const elements = {
  generatedAt: document.getElementById("generatedAt"),
  projectList: document.getElementById("projectList"),
  activeProjectCount: document.getElementById("activeProjectCount"),
  completedProjectSection: document.getElementById("completedProjectSection"),
  completedProjectList: document.getElementById("completedProjectList"),
  completedProjectCount: document.getElementById("completedProjectCount"),
  refreshButton: document.getElementById("refreshButton"),
  runCheckButton: document.getElementById("runCheckButton"),
  projectTitle: document.getElementById("projectTitle"),
  projectGoal: document.getElementById("projectGoal"),
  healthBadge: document.getElementById("healthBadge"),
  metricTasks: document.getElementById("metricTasks"),
  metricQueued: document.getElementById("metricQueued"),
  metricActiveTasks: document.getElementById("metricActiveTasks"),
  metricUnissued: document.getElementById("metricUnissued"),
  metricBlocked: document.getElementById("metricBlocked"),
  ownerReportMeta: document.getElementById("ownerReportMeta"),
  ownerThreadName: document.getElementById("ownerThreadName"),
  ownerThreadStatus: document.getElementById("ownerThreadStatus"),
  ownerReportSummary: document.getElementById("ownerReportSummary"),
  ownerPromptActions: document.getElementById("ownerPromptActions"),
  copyOwnerPromptButton: document.getElementById("copyOwnerPromptButton"),
  ownerProgressList: document.getElementById("ownerProgressList"),
  ownerRiskList: document.getElementById("ownerRiskList"),
  ownerNextActionList: document.getElementById("ownerNextActionList"),
  contextMeta: document.getElementById("contextMeta"),
  contextSummaryText: document.getElementById("contextSummaryText"),
  contextP0List: document.getElementById("contextP0List"),
  contextP1List: document.getElementById("contextP1List"),
  contextP2List: document.getElementById("contextP2List"),
  activeTaskCountLabel: document.getElementById("activeTaskCountLabel"),
  activeTaskList: document.getElementById("activeTaskList"),
  taskCountLabel: document.getElementById("taskCountLabel"),
  taskQueueList: document.getElementById("taskQueueList")
};

elements.refreshButton.addEventListener("click", () => loadDashboard());
elements.runCheckButton.addEventListener("click", () => runProjectCheck());
elements.copyOwnerPromptButton.addEventListener("click", () => copyOwnerThreadPrompt());

loadDashboard();

async function loadDashboard() {
  setLoading(true);
  try {
    const response = await fetch("/api/dashboard", {
      cache: "no-store"
    });
    state.data = await response.json();
    if (!state.selectedProjectId && state.data.projects.length > 0) {
      state.selectedProjectId = getPreferredProjectId(state.data.projects);
    }
    if (
      state.selectedProjectId &&
      !state.data.projects.some((project) => project.project.id === state.selectedProjectId)
    ) {
      state.selectedProjectId = getPreferredProjectId(state.data.projects);
    }
    render();
  } catch (error) {
    elements.generatedAt.textContent = `加载失败：${error.message}`;
  } finally {
    setLoading(false);
  }
}

async function runProjectCheck() {
  setLoading(true);
  try {
    await fetch("/api/checks/run", {
      method: "POST"
    });
    await loadDashboard();
  } catch (error) {
    elements.generatedAt.textContent = `检查失败：${error.message}`;
  } finally {
    setLoading(false);
  }
}

async function reviewTask(task, action) {
  const selected = getSelectedProject();
  if (!selected) {
    return;
  }

  setLoading(true);
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(selected.project.id)}/tasks/${encodeURIComponent(task.id)}/${action}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error ?? `HTTP ${response.status}`);
    }

    await fetch("/api/checks/run", {
      method: "POST"
    });
    await loadDashboard();
  } catch (error) {
    elements.generatedAt.textContent = `审核失败：${error.message}`;
  } finally {
    setLoading(false);
  }
}

async function copyOwnerThreadPrompt() {
  const selected = getSelectedProject();
  const prompt = selected?.owner_thread_prompt ?? "";
  if (!prompt) {
    return;
  }

  await copyText(prompt, elements.copyOwnerPromptButton, "复制接入提示词");
}

async function copyText(value, button, defaultLabel) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      fallbackCopyText(value);
    }
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = defaultLabel;
    }, 1600);
  } catch (error) {
    try {
      fallbackCopyText(value);
      button.textContent = "已复制";
      setTimeout(() => {
        button.textContent = defaultLabel;
      }, 1600);
    } catch {
      elements.generatedAt.textContent = `复制失败：${error.message}`;
    }
  }
}

function fallbackCopyText(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("copy command failed");
  }
}

function render() {
  const data = state.data;
  const selected = getSelectedProject();
  elements.generatedAt.textContent = `更新于 ${formatDate(data.generated_at)}`;

  renderProjects(data.projects);
  renderProject(selected);
}

function renderProjects(projects) {
  const activeProjects = projects.filter((dashboard) => !isCompletedProject(dashboard));
  const completedProjects = projects.filter(isCompletedProject);

  elements.activeProjectCount.textContent = String(activeProjects.length);
  elements.projectList.replaceChildren(
    ...(activeProjects.length > 0
      ? activeProjects.map((dashboard) => createProjectButton(dashboard))
      : [createEmptyProjectState("暂无进行中的项目。")])
  );

  elements.completedProjectCount.textContent = String(completedProjects.length);
  elements.completedProjectSection.hidden = completedProjects.length === 0;
  elements.completedProjectList.replaceChildren(
    ...completedProjects.map((dashboard) => createProjectButton(dashboard, "completed"))
  );
}

function createProjectButton(dashboard, variant = "active") {
  const button = document.createElement("button");
  const isActive = dashboard.project.id === state.selectedProjectId;
  const tasks = getProjectTasks(dashboard);
  const queued = tasks.filter(isQueuedTask).length;
  const unissued = tasks.filter(isUnissuedTask).length;
  button.className = `project-item project-item-${variant}${isActive ? " active" : ""}`;
  button.type = "button";
  button.innerHTML = `
    <strong>${escapeHtml(dashboard.project.title)}</strong>
    <span>${escapeHtml(formatLifecycle(dashboard.project.status))} · ${escapeHtml(formatHealth(dashboard.project.health))}</span>
    <small>${escapeHtml(queued)} 队列中 · ${escapeHtml(unissued)} 未下发</small>
  `;
  button.addEventListener("click", () => {
    state.selectedProjectId = dashboard.project.id;
    render();
  });
  return button;
}

function createEmptyProjectState(message) {
  const empty = document.createElement("div");
  empty.className = "project-list-empty";
  empty.textContent = message;
  return empty;
}

function renderProject(dashboard) {
  if (!dashboard) {
    elements.projectTitle.textContent = "未选择项目";
    elements.projectGoal.textContent = "创建或导入项目后开始跟踪状态。";
    setHealth("unknown");
    renderMetrics([]);
    renderOwnerOverview(null);
    renderContextOverview(null);
    renderActiveTasks([]);
    renderTaskQueue([]);
    return;
  }

  const tasks = getProjectTasks(dashboard);
  elements.projectTitle.textContent = dashboard.project.title;
  elements.projectGoal.textContent = dashboard.project.goal;
  setHealth(dashboard.project.health);
  renderMetrics(tasks);
  renderOwnerOverview(dashboard);
  renderContextOverview(dashboard);
  renderActiveTasks(tasks);
  renderTaskQueue(tasks);
}

function renderMetrics(tasks) {
  elements.metricTasks.textContent = tasks.length;
  elements.metricQueued.textContent = tasks.filter(isQueuedTask).length;
  elements.metricActiveTasks.textContent = tasks.filter(isActiveTask).length;
  elements.metricUnissued.textContent = tasks.filter(isUnissuedTask).length;
  elements.metricBlocked.textContent = tasks.filter((task) => task.status === "blocked").length;
}

function renderOwnerOverview(dashboard) {
  if (!dashboard) {
    elements.ownerReportMeta.textContent = "暂无负责人报告";
    elements.ownerThreadName.textContent = "未绑定负责人 Thread";
    elements.ownerThreadStatus.textContent = "未绑定";
    elements.ownerThreadStatus.className = "pill owner-unassigned";
    elements.ownerReportSummary.textContent = "绑定项目负责人 Thread 后，这里会显示该 Thread 定时上报的项目状态。";
    elements.ownerPromptActions.hidden = true;
    renderList(elements.ownerProgressList, []);
    renderList(elements.ownerRiskList, []);
    renderList(elements.ownerNextActionList, []);
    return;
  }

  const ownerThread = dashboard.owner_thread;
  const report = dashboard.latest_owner_report;
  const ownerStatus = dashboard.owner_report_status ?? {};
  elements.ownerThreadName.textContent = ownerThread
    ? `${ownerThread.name} (${ownerThread.thread_id})`
    : "未绑定负责人 Thread";
  elements.ownerThreadStatus.textContent = ownerStatus.label ?? "未绑定";
  elements.ownerThreadStatus.className = `pill owner-${ownerStatus.state ?? "unassigned"}`;
  elements.ownerPromptActions.hidden = Boolean(ownerThread);
  elements.copyOwnerPromptButton.textContent = "复制接入提示词";

  if (!report) {
    elements.ownerReportMeta.textContent = ownerThread ? "等待负责人上报" : "暂无负责人报告";
    elements.ownerReportSummary.textContent = ownerThread
      ? "负责人 Thread 已绑定，但还没有提交项目状态报告。"
      : "绑定项目负责人 Thread 后，这里会显示该 Thread 定时上报的项目状态。";
    renderList(elements.ownerProgressList, []);
    renderList(elements.ownerRiskList, []);
    renderList(elements.ownerNextActionList, []);
    return;
  }

  const freshness = ownerStatus.freshness_minutes === null || ownerStatus.freshness_minutes === undefined
    ? ""
    : ` · ${ownerStatus.freshness_minutes} 分钟前`;
  elements.ownerReportMeta.textContent = `${report.id} · ${formatDate(report.answered_at)}${freshness}`;
  elements.ownerReportSummary.innerHTML = linkifyTaskReferences(translateStatusText(report.summary));
  renderList(elements.ownerProgressList, report.progress?.map(translateStatusText));
  renderList(
    elements.ownerRiskList,
    [...(report.risks ?? []), ...(report.blockers ?? [])].map(translateStatusText)
  );
  renderList(elements.ownerNextActionList, report.next_actions?.map(translateStatusText));
}

function renderContextOverview(dashboard) {
  const context = dashboard?.current_context ?? null;
  const reportedContext = dashboard?.reported_context ?? null;
  const displayContext = reportedContext ?? context;

  if (!context || !displayContext) {
    elements.contextMeta.textContent = "暂无上下文";
    elements.contextSummaryText.textContent = "上下文口径尚未建立。";
    renderList(elements.contextP0List, []);
    renderList(elements.contextP1List, []);
    renderList(elements.contextP2List, []);
    return;
  }

  const requirements = displayContext.requirements ?? {};
  const sourceMeta = displayContext.source === "owner_report"
    ? `${displayContext.source_label} ${displayContext.source_id} · ${formatDate(displayContext.reported_at)}`
    : `${displayContext.source_label} ${displayContext.source_id}`;
  elements.contextMeta.textContent = `${sourceMeta} · 快照 ${context.id} v${context.version}`;
  elements.contextSummaryText.innerHTML = linkifyTaskReferences(displayContext.summary ?? "暂无上下文摘要。");
  renderList(elements.contextP0List, requirements.p0 ?? []);
  renderList(elements.contextP1List, requirements.p1 ?? []);
  renderList(elements.contextP2List, requirements.p2 ?? []);
}

function renderActiveTasks(tasks) {
  const activeTasks = tasks.filter(isActiveTask).sort(compareTasksForQueue);
  elements.activeTaskCountLabel.textContent = `${activeTasks.length} 个任务`;

  if (activeTasks.length === 0) {
    elements.activeTaskList.innerHTML = `<div class="empty-state">当前没有正在执行或等待验收的任务。</div>`;
    return;
  }

  elements.activeTaskList.replaceChildren(
    ...activeTasks.map((task) => createTaskCard(task, { compact: false, active: true }))
  );
}

function renderTaskQueue(tasks) {
  const sortedTasks = [...tasks].sort(compareTasksForQueue);
  const queuedCount = sortedTasks.filter(isQueuedTask).length;
  const unissuedCount = sortedTasks.filter(isUnissuedTask).length;
  elements.taskCountLabel.textContent = `${queuedCount} 个队列中 / ${unissuedCount} 个未下发 / ${sortedTasks.length} 总计`;

  if (sortedTasks.length === 0) {
    elements.taskQueueList.innerHTML = `<div class="empty-state">当前项目还没有任务。</div>`;
    return;
  }

  elements.taskQueueList.replaceChildren(
    ...sortedTasks.map((task) => createTaskCard(task, { compact: false, active: false }))
  );
}

function createTaskCard(task, { active }) {
  const card = document.createElement("article");
  const bucketClass = getTaskBucketClass(task);
  card.className = `task-row task-row-${bucketClass}`;
  card.id = active ? `active-task-${task.id}` : `task-${task.id}`;
  card.dataset.taskId = task.id;
  card.tabIndex = -1;
  card.innerHTML = `
    <div class="task-row-header">
      <div class="task-title-block">
        <div class="task-title-line">
          <a class="task-id task-self-link" href="#task-${escapeHtml(task.id)}">${escapeHtml(task.id)}</a>
          <strong>${escapeHtml(task.title)}</strong>
        </div>
        <p>${linkifyTaskReferences(task.objective || "暂无任务描述。")}</p>
      </div>
      <div class="task-status-stack">
        <span class="queue-badge queue-badge-${bucketClass}">${escapeHtml(getTaskBucketLabel(task))}</span>
        ${statusPill(formatTaskOperationalStatus(task))}
      </div>
    </div>

    ${renderTaskBrief(task)}
    ${renderTaskMeta(task)}
    ${renderAgentAcceptanceBlock(task)}
    ${renderTaskDetailGrid(task, active)}
    ${renderAgentCommandBlock(task)}
    ${renderDeliveryBlock(task)}
    ${renderTaskActions(task)}
  `;
  card.querySelectorAll("[data-task-action]").forEach((button) => {
    button.addEventListener("click", () => reviewTask(task, button.dataset.taskAction));
  });
  card.querySelectorAll("[data-agent-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = getAgentCommand(task, button.dataset.agentCommand);
      if (command) {
        copyText(command, button, button.dataset.defaultLabel);
      }
    });
  });
  return card;
}

function renderTaskBrief(task) {
  if (!task.task_brief || task.task_brief === task.objective) {
    return "";
  }

  return `
    <div class="task-brief">
      <span>执行说明</span>
      <p>${linkifyTaskReferences(task.task_brief)}</p>
    </div>
  `;
}

function renderTaskMeta(task) {
  const values = [
    { label: "优先级", value: formatPriority(task.priority) },
    { label: "上下文", value: formatContextStatus(task.context_status) },
    { label: "Agent", value: formatAgent(task) },
    { label: "依赖", html: linkifyTaskReferences(formatDependencies(task)) },
    { label: "创建", value: formatDate(task.created_at) },
    { label: "更新", value: formatDate(task.updated_at) }
  ];

  return `
    <div class="task-meta-grid">
      ${values.map(({ label, value, html }) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${html ?? escapeHtml(value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAgentAcceptanceBlock(task) {
  const acceptance = task.agent_acceptance;
  if (!acceptance) {
    return "";
  }

  const rows = [
    ["接收说明", acceptance.note],
    ["执行计划", acceptance.plan],
    ["预计回报", acceptance.eta || acceptance.next_report_at],
    ["接收时间", formatDate(acceptance.accepted_at)]
  ].filter(([, value]) => value);

  if (rows.length === 0) {
    return "";
  }

  return `
    <div class="agent-acceptance-block">
      <span>Agent 接收回报</span>
      ${rows.map(([label, value]) => `
        <p><strong>${escapeHtml(label)}：</strong>${linkifyTaskReferences(value)}</p>
      `).join("")}
    </div>
  `;
}

function renderTaskDetailGrid(task, active) {
  const blocks = [
    renderTaskInfoBlock("验收标准", task.acceptance_criteria),
    renderTaskInfoBlock("交付物", task.deliverables),
    renderTaskInfoBlock("所需技能", task.required_skills)
  ];

  if (active) {
    blocks.push(renderTaskInfoBlock("运行上下文", [
      task.context?.task_brief,
      task.context?.summary,
      task.context?.handoff_prompt ? "任务交接提示词已生成，Agent 可按操作命令提交验收。" : null,
      task.owner_report_id ? `负责人报告：${task.owner_report_id}` : null,
      task.project_owner_thread_id ? `项目负责人：${task.project_owner_thread_id}` : null
    ]));
  }

  const renderedBlocks = blocks.filter(Boolean).join("");
  return renderedBlocks ? `<div class="task-detail-grid">${renderedBlocks}</div>` : "";
}

function renderTaskInfoBlock(title, values) {
  const normalizedValues = (values ?? []).filter(Boolean);
  if (normalizedValues.length === 0) {
    return "";
  }

  return `
    <section class="task-info-block">
      <h4>${escapeHtml(title)}</h4>
      <ul>
        ${normalizedValues.map((value) => `<li>${linkifyTaskReferences(value)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderAgentCommandBlock(task) {
  if (!task.agent_commands) {
    return "";
  }

  const nextAction = getAgentNextAction(task);
  if (!nextAction) {
    return "";
  }

  return `
    <div class="agent-command-block">
      <div>
        <span>Agent 下一步</span>
        <strong>${escapeHtml(nextAction.title)}</strong>
        <p>${escapeHtml(nextAction.description)}</p>
      </div>
      <button class="small-button primary-small" type="button" data-agent-command="${escapeHtml(nextAction.commandKey)}" data-default-label="${escapeHtml(nextAction.buttonLabel)}">${escapeHtml(nextAction.buttonLabel)}</button>
    </div>
  `;
}

function renderDeliveryBlock(task) {
  if (!task.delivery) {
    return "";
  }

  const verification = task.delivery.verification?.length
    ? task.delivery.verification.join(" / ")
    : "暂无验证记录。";
  const aiSummary = task.delivery.ai_detection?.summary
    ? `AI 自检：${task.delivery.ai_detection.summary}`
    : "AI 自检：暂无记录。";

  return `
    <div class="delivery-block">
      <span>交付记录</span>
      <strong>${escapeHtml(task.delivery.id)} · ${escapeHtml(formatDeliveryStatus(task.delivery.status))}</strong>
      <p>${linkifyTaskReferences(task.delivery.summary || "暂无交付摘要。")}</p>
      <p>${linkifyTaskReferences(verification)}</p>
      <p>${linkifyTaskReferences(aiSummary)}</p>
    </div>
  `;
}

function renderTaskActions(task) {
  if (task.status !== "draft") {
    return "";
  }

  return `
    <div class="action-row">
      <button class="small-button primary-small" type="button" data-task-action="approve">批准下放</button>
      <button class="small-button" type="button" data-task-action="reject">退回</button>
    </div>
  `;
}

function renderList(element, values) {
  const normalizedValues = (values ?? []).filter(Boolean);
  if (normalizedValues.length === 0) {
    element.innerHTML = `<li class="empty-list-item">暂无。</li>`;
    return;
  }

  element.replaceChildren(
    ...normalizedValues.map((value) => {
      const item = document.createElement("li");
      item.innerHTML = linkifyTaskReferences(value);
      return item;
    })
  );
}

function linkifyTaskReferences(value) {
  return escapeHtml(value).replace(
    /\b(task-\d{4,})\b/g,
    '<a class="inline-task-link" href="#task-$1">$1</a>'
  );
}

function getProjectTasks(dashboard) {
  return dashboard?.task_index ?? dashboard?.task_hall ?? [];
}

function getAgentNextAction(task) {
  if (task.status === "ready") {
    return {
      commandKey: "claim",
      title: "接受任务并上报计划",
      description: "执行 Agent 领取任务时需要把接收说明、执行计划和预计回报时间写入任务队列。",
      buttonLabel: "复制接受任务命令"
    };
  }

  if (task.status === "claimed") {
    return {
      commandKey: "start",
      title: "启动任务",
      description: "任务已由 Agent 接受；启动后进入正在完成，完成后必须提交验收，不能自审。",
      buttonLabel: "复制启动命令"
    };
  }

  if (task.status === "in_progress") {
    return {
      commandKey: "submit_for_review",
      title: "提交验收",
      description: "执行 Agent 完成后运行该命令，任务会进入待验收状态，由总项目经理验收。",
      buttonLabel: "复制提交验收命令"
    };
  }

  if (task.status === "review") {
    return {
      commandKey: "submit_for_review",
      title: "等待总项目经理验收",
      description: "Agent 已提交交付记录；下一步由总项目经理或 Reviewer 审核，不由执行 Agent 自行通过。",
      buttonLabel: "复制补充交付命令"
    };
  }

  return null;
}

function getAgentCommand(task, commandKey) {
  return task.agent_commands?.[commandKey] ?? "";
}

function getSelectedProject() {
  return state.data?.projects.find((dashboard) => dashboard.project.id === state.selectedProjectId) ?? null;
}

function getPreferredProjectId(projects) {
  return projects.find((dashboard) => !isCompletedProject(dashboard))?.project.id
    ?? projects[0]?.project.id
    ?? null;
}

function isCompletedProject(dashboard) {
  return ["done", "archived"].includes(dashboard.project.status) ||
    dashboard.project.health === "done";
}

function isQueuedTask(task) {
  return QUEUE_STATUSES.has(task.status) && task.context_status !== "missing";
}

function isActiveTask(task) {
  return ACTIVE_STATUSES.has(task.status);
}

function isUnissuedTask(task) {
  return task.status === "draft" || task.context_status === "missing";
}

function compareTasksForQueue(a, b) {
  const queueDelta = Number(!isQueuedTask(a)) - Number(!isQueuedTask(b));
  if (queueDelta !== 0) {
    return queueDelta;
  }

  const statusDelta = (TASK_STATUS_ORDER[a.status] ?? 99) - (TASK_STATUS_ORDER[b.status] ?? 99);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const priorityDelta = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return getTaskTimestamp(b) - getTaskTimestamp(a);
}

function getTaskTimestamp(task) {
  return new Date(task.updated_at ?? task.created_at ?? 0).getTime();
}

function getTaskBucketLabel(task) {
  if (isQueuedTask(task)) {
    return "任务队列";
  }
  if (task.status === "done") {
    return "已完成";
  }
  if (task.status === "rejected") {
    return "已退回";
  }
  return "未下发";
}

function getTaskBucketClass(task) {
  if (isQueuedTask(task)) {
    return "queued";
  }
  if (task.status === "done") {
    return "done";
  }
  if (task.status === "rejected") {
    return "rejected";
  }
  return "unissued";
}

function formatTaskOperationalStatus(task) {
  if (isUnissuedTask(task)) {
    return "未下发";
  }
  return formatTaskStatus(task.status);
}

function formatAgent(task) {
  if (task.assigned_agent?.name && task.assigned_agent?.id) {
    return `${task.assigned_agent.name} (${task.assigned_agent.id})`;
  }
  return task.assigned_agent_id ?? "-";
}

function formatDependencies(task) {
  const dependencies = task.dependencies ?? [];
  if (dependencies.length === 0) {
    return "-";
  }

  const blocked = new Set(task.blocked_by ?? []);
  return dependencies
    .map((dependency) => (blocked.has(dependency) ? `${dependency} 未完成` : dependency))
    .join(", ");
}

function setHealth(health) {
  elements.healthBadge.textContent = formatHealth(health);
  elements.healthBadge.className = `health-badge health-${health}`;
}

function statusPill(value) {
  return `<span class="pill">${escapeHtml(value)}</span>`;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  [
    elements.refreshButton,
    elements.runCheckButton,
    elements.copyOwnerPromptButton
  ].forEach((element) => {
    element.disabled = isLoading;
  });
  document.querySelectorAll("[data-task-action]").forEach((button) => {
    button.disabled = isLoading;
  });
  document.querySelectorAll("[data-agent-command]").forEach((button) => {
    button.disabled = isLoading;
  });
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatHealth(value) {
  return HEALTH_LABELS[value] ?? value ?? "-";
}

function formatLifecycle(value) {
  return {
    active: "进行中",
    paused: "暂停",
    done: "已完成",
    archived: "已归档"
  }[value] ?? value ?? "-";
}

function formatTaskStatus(value) {
  return TASK_STATUS_LABELS[value] ?? value ?? "-";
}

function formatDeliveryStatus(value) {
  return {
    submitted: "已提交验收",
    accepted: "已验收",
    rejected: "已退回"
  }[value] ?? value ?? "-";
}

function formatContextStatus(value) {
  return CONTEXT_STATUS_LABELS[value] ?? value ?? "-";
}

function formatPriority(value) {
  return PRIORITY_LABELS[value] ?? value ?? "-";
}

function translateStatusText(value) {
  return String(value ?? "")
    .replace(/Project needs attention:/g, "项目需要关注：")
    .replace(/Project is blocked:/g, "项目已阻塞：")
    .replace(/Project is marked done\./g, "项目已标记完成。")
    .replace(/Project is paused\./g, "项目已暂停。")
    .replace(/No project-scoped tasks have been published yet\./g, "还没有发布项目级任务。")
    .replace(/Current context is ([^.]+)\./g, "当前上下文是 $1。")
    .replace(/Task hall contains (\d+) task\(s\)\./g, "任务大厅共有 $1 个任务。")
    .replace(/(\d+) draft task\(s\) and (\d+) task\(s\) with missing context need preparation\./g, "$1 个待审核任务和 $2 个缺少上下文的任务需要处理。")
    .replace(/Prepare draft tasks so executors can claim them\./g, "请先审核并准备待审核任务，之后 Agent 才能领取。")
    .replace(/Agents can claim task\(s\): ([^.]+)\./g, "Agent 可领取任务：$1。")
    .replace(/(\d+) task\(s\) are claimable now\./g, "当前有 $1 个任务可领取。")
    .replace(/(\d+) task\(s\) are in progress\./g, "$1 个任务进行中。")
    .replace(/(\d+) task\(s\) are waiting for review\./g, "$1 个任务等待验收。")
    .replace(/Review submitted task\(s\): ([^.]+)\./g, "请验收已提交任务：$1。")
    .replace(/Stale task context: ([^.]+)\./g, "任务上下文需要更新：$1。")
    .replace(/Re-prepare stale task\(s\): ([^.]+)\./g, "请重新准备任务上下文：$1。")
    .replace(/Blocked task\(s\): ([^.]+)\./g, "阻塞任务：$1。");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

const elements = {
  generatedAt: document.getElementById("generatedAt"),
  projectList: document.getElementById("projectList"),
  refreshButton: document.getElementById("refreshButton"),
  runCheckButton: document.getElementById("runCheckButton"),
  projectTitle: document.getElementById("projectTitle"),
  projectGoal: document.getElementById("projectGoal"),
  healthBadge: document.getElementById("healthBadge"),
  metricTasks: document.getElementById("metricTasks"),
  metricReady: document.getElementById("metricReady"),
  metricDraft: document.getElementById("metricDraft"),
  metricStale: document.getElementById("metricStale"),
  metricBlocked: document.getElementById("metricBlocked"),
  contextMeta: document.getElementById("contextMeta"),
  contextSummaryInput: document.getElementById("contextSummaryInput"),
  contextP0List: document.getElementById("contextP0List"),
  contextP1List: document.getElementById("contextP1List"),
  contextP2List: document.getElementById("contextP2List"),
  contextP0Input: document.getElementById("contextP0Input"),
  contextP1Input: document.getElementById("contextP1Input"),
  contextP2Input: document.getElementById("contextP2Input"),
  saveContextButton: document.getElementById("saveContextButton"),
  latestStatusMeta: document.getElementById("latestStatusMeta"),
  latestStatusSummary: document.getElementById("latestStatusSummary"),
  riskList: document.getElementById("riskList"),
  nextActionList: document.getElementById("nextActionList"),
  latestCheckMeta: document.getElementById("latestCheckMeta"),
  checkResults: document.getElementById("checkResults"),
  taskCountLabel: document.getElementById("taskCountLabel"),
  taskRows: document.getElementById("taskRows"),
  checkHistory: document.getElementById("checkHistory")
};

elements.refreshButton.addEventListener("click", () => loadDashboard());
elements.runCheckButton.addEventListener("click", () => runProjectCheck());
elements.saveContextButton.addEventListener("click", () => saveProjectContext());

loadDashboard();

async function loadDashboard() {
  setLoading(true);
  try {
    const response = await fetch("/api/dashboard", {
      cache: "no-store"
    });
    state.data = await response.json();
    if (!state.selectedProjectId && state.data.projects.length > 0) {
      state.selectedProjectId = state.data.projects[0].project.id;
    }
    if (
      state.selectedProjectId &&
      !state.data.projects.some((project) => project.project.id === state.selectedProjectId)
    ) {
      state.selectedProjectId = state.data.projects[0]?.project.id ?? null;
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

async function saveProjectContext() {
  const selected = getSelectedProject();
  if (!selected) {
    return;
  }

  setLoading(true);
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(selected.project.id)}/context`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          summary: elements.contextSummaryInput.value.trim(),
          requirements: {
            p0: parseTextareaList(elements.contextP0Input.value),
            p1: parseTextareaList(elements.contextP1Input.value),
            p2: parseTextareaList(elements.contextP2Input.value)
          }
        })
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
    elements.generatedAt.textContent = `上下文保存失败：${error.message}`;
  } finally {
    setLoading(false);
  }
}

function render() {
  const data = state.data;
  const selected = getSelectedProject();
  elements.generatedAt.textContent = `更新于 ${formatDate(data.generated_at)}`;

  renderProjects(data.projects);
  renderProject(selected);
  renderLatestCheck(data.latest_check);
  renderCheckHistory(data.checks);
}

function renderProjects(projects) {
  elements.projectList.replaceChildren(
    ...projects.map((dashboard) => {
      const button = document.createElement("button");
      const isActive = dashboard.project.id === state.selectedProjectId;
      button.className = `project-item${isActive ? " active" : ""}`;
      button.type = "button";
      button.innerHTML = `
        <strong>${escapeHtml(dashboard.project.title)}</strong>
        <span>${escapeHtml(dashboard.project.id)} | ${escapeHtml(formatHealth(dashboard.project.health))}</span>
      `;
      button.addEventListener("click", () => {
        state.selectedProjectId = dashboard.project.id;
        render();
      });
      return button;
    })
  );
}

function renderProject(dashboard) {
  if (!dashboard) {
    elements.projectTitle.textContent = "未选择项目";
    elements.projectGoal.textContent = "创建或导入项目后开始跟踪状态。";
    setHealth("unknown");
    renderMetrics({});
    renderContext(null);
    renderStatus(null);
    renderTasks([]);
    return;
  }

  elements.projectTitle.textContent = dashboard.project.title;
  elements.projectGoal.textContent = dashboard.project.goal;
  setHealth(dashboard.project.health);
  renderMetrics(dashboard.task_summary);
  renderContext(dashboard.current_context);
  renderStatus(dashboard.latest_status);
  renderTasks(dashboard.task_hall);
}

function renderMetrics(summary) {
  const byStatus = summary.by_status ?? {};
  const byContext = summary.by_context_status ?? {};
  elements.metricTasks.textContent = summary.total ?? 0;
  elements.metricReady.textContent = summary.claimable_task_ids?.length ?? byStatus.ready ?? 0;
  elements.metricDraft.textContent = byStatus.draft ?? 0;
  elements.metricStale.textContent = byContext.stale ?? 0;
  elements.metricBlocked.textContent = byStatus.blocked ?? 0;
}

function renderStatus(status) {
  if (!status) {
    elements.latestStatusMeta.textContent = "暂无状态";
    elements.latestStatusSummary.textContent = "还没有写入项目状态快照。";
    renderList(elements.riskList, []);
    renderList(elements.nextActionList, []);
    return;
  }

  elements.latestStatusMeta.textContent = `${status.id} | ${formatDate(status.created_at)}`;
  elements.latestStatusSummary.textContent = translateStatusText(status.summary);
  renderList(elements.riskList, status.risks?.map(translateStatusText));
  renderList(elements.nextActionList, status.next_actions?.map(translateStatusText));
}

function renderContext(context) {
  if (!context) {
    elements.contextMeta.textContent = "暂无上下文";
    elements.contextSummaryInput.value = "";
    renderList(elements.contextP0List, []);
    renderList(elements.contextP1List, []);
    renderList(elements.contextP2List, []);
    elements.contextP0Input.value = "";
    elements.contextP1Input.value = "";
    elements.contextP2Input.value = "";
    return;
  }

  const requirements = context.requirements ?? {};
  elements.contextMeta.textContent = `${context.id} | v${context.version} | 已完成 ${context.completed_task_count} 个任务`;
  elements.contextSummaryInput.value = context.summary ?? "";
  renderList(elements.contextP0List, requirements.p0);
  renderList(elements.contextP1List, requirements.p1);
  renderList(elements.contextP2List, requirements.p2);
  elements.contextP0Input.value = formatTextareaList(requirements.p0);
  elements.contextP1Input.value = formatTextareaList(requirements.p1);
  elements.contextP2Input.value = formatTextareaList(requirements.p2);
}

function renderLatestCheck(check) {
  if (!check) {
    elements.latestCheckMeta.textContent = "暂无检查";
    elements.checkResults.innerHTML = `<div class="empty-state">暂无定时检查记录。</div>`;
    return;
  }

  elements.latestCheckMeta.textContent = `${check.id} | ${formatDate(check.created_at)}`;
  if (check.results.length === 0) {
    elements.checkResults.innerHTML = `<div class="empty-state">这次没有检查任何项目。</div>`;
    return;
  }

  elements.checkResults.replaceChildren(
    ...check.results.map((result) => {
      const item = document.createElement("div");
      item.className = "check-result";
      item.innerHTML = `
        <div class="panel-header">
          <strong>${escapeHtml(result.project_id)}</strong>
          ${healthPill(result.health)}
        </div>
        <p>${escapeHtml(translateStatusText(result.summary))}</p>
      `;
      return item;
    })
  );
}

function renderTasks(tasks) {
  elements.taskCountLabel.textContent = `${tasks.length} 个任务`;
  if (tasks.length === 0) {
    elements.taskRows.innerHTML = `<tr><td colspan="9" class="empty-state">这个项目还没有任务。</td></tr>`;
    return;
  }

  elements.taskRows.replaceChildren(
    ...tasks.map((task) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td data-label="ID">${escapeHtml(task.id)}</td>
        <td data-label="任务内容">${renderTaskDetail(task)}</td>
        <td data-label="状态">${statusPill(formatTaskStatus(task.status))}</td>
        <td data-label="上下文">${statusPill(formatContextStatus(task.context_status))}</td>
        <td data-label="优先级">${escapeHtml(formatPriority(task.priority))}</td>
        <td data-label="可领取">${statusPill(task.is_claimable ? "是" : "否")}</td>
        <td data-label="依赖">${escapeHtml(formatDependencies(task))}</td>
        <td data-label="Agent">${escapeHtml(task.assigned_agent_id ?? "-")}</td>
        <td data-label="操作">${renderTaskActions(task)}</td>
      `;
      row.querySelectorAll("[data-task-action]").forEach((button) => {
        button.addEventListener("click", () =>
          reviewTask(task, button.dataset.taskAction)
        );
      });
      return row;
    })
  );
}

function renderTaskDetail(task) {
  const meta = [
    `技能：${formatList(task.required_skills)}`,
    task.created_by ? `创建：${task.created_by}` : null,
    task.created_at ? `时间：${formatDate(task.created_at)}` : null
  ].filter(Boolean);
  const brief = task.task_brief && task.task_brief !== task.objective
    ? `<p class="task-subtext"><strong>执行说明：</strong>${escapeHtml(task.task_brief)}</p>`
    : "";
  const criteria = renderDetailList("验收标准", task.acceptance_criteria);
  const deliverables = renderDetailList("交付物", task.deliverables);

  return `
    <div class="task-detail">
      <strong>${escapeHtml(task.title)}</strong>
      <p>${escapeHtml(task.objective || "暂无任务描述。")}</p>
      ${brief}
      ${criteria}
      ${deliverables}
      <div class="task-meta">${meta.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
    </div>
  `;
}

function renderDetailList(label, values) {
  if (!values || values.length === 0) {
    return "";
  }

  return `
    <div class="task-detail-list">
      <span>${escapeHtml(label)}：</span>
      <ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderCheckHistory(checks) {
  if (!checks.length) {
    elements.checkHistory.innerHTML = `<div class="empty-state">暂无检查历史。</div>`;
    return;
  }

  elements.checkHistory.replaceChildren(
    ...checks.map((check) => {
      const item = document.createElement("div");
      item.className = "check-history-item";
      item.innerHTML = `
        <div class="panel-header">
          <strong>${escapeHtml(check.id)}</strong>
          <span class="muted">${formatDate(check.created_at)}</span>
        </div>
        <p>${escapeHtml(check.project_count)} 个项目 | ${escapeHtml(check.note || "无备注")}</p>
      `;
      return item;
    })
  );
}

function renderList(element, values) {
  if (!values || values.length === 0) {
    element.innerHTML = `<li>暂无。</li>`;
    return;
  }
  element.replaceChildren(
    ...values.map((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    })
  );
}

function renderTaskActions(task) {
  if (task.status !== "draft") {
    return `<span class="muted">-</span>`;
  }

  return `
    <div class="action-row">
      <button class="small-button primary-small" type="button" data-task-action="approve">批准下放</button>
      <button class="small-button" type="button" data-task-action="reject">退回</button>
    </div>
  `;
}

function formatList(values) {
  return values && values.length > 0 ? values.join(", ") : "未指定";
}

function getSelectedProject() {
  return state.data?.projects.find((dashboard) => dashboard.project.id === state.selectedProjectId) ?? null;
}

function setHealth(health) {
  elements.healthBadge.textContent = formatHealth(health);
  elements.healthBadge.className = `health-badge health-${health}`;
}

function statusPill(value) {
  return `<span class="pill">${escapeHtml(value)}</span>`;
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

function healthPill(value) {
  return `<span class="pill health-${escapeHtml(value)}">${escapeHtml(formatHealth(value))}</span>`;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.refreshButton.disabled = isLoading;
  elements.runCheckButton.disabled = isLoading;
  elements.saveContextButton.disabled = isLoading;
  document.querySelectorAll("[data-task-action]").forEach((button) => {
    button.disabled = isLoading;
  });
}

function parseTextareaList(value) {
  return value
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function formatTextareaList(values) {
  return (values ?? []).join("\n");
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

function formatTaskStatus(value) {
  return TASK_STATUS_LABELS[value] ?? value ?? "-";
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

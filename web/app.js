const state = {
  data: null,
  selectedProjectId: null,
  loading: false,
  taskSearch: "",
  taskStatusFilter: "all"
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
  ownerReportMeta: document.getElementById("ownerReportMeta"),
  ownerThreadName: document.getElementById("ownerThreadName"),
  ownerThreadStatus: document.getElementById("ownerThreadStatus"),
  ownerReportSummary: document.getElementById("ownerReportSummary"),
  ownerPromptActions: document.getElementById("ownerPromptActions"),
  copyOwnerPromptButton: document.getElementById("copyOwnerPromptButton"),
  ownerProgressList: document.getElementById("ownerProgressList"),
  ownerRiskList: document.getElementById("ownerRiskList"),
  ownerNextActionList: document.getElementById("ownerNextActionList"),
  ownerProposedTaskList: document.getElementById("ownerProposedTaskList"),
  contextMeta: document.getElementById("contextMeta"),
  contextSource: document.getElementById("contextSource"),
  contextSummaryInput: document.getElementById("contextSummaryInput"),
  contextP0List: document.getElementById("contextP0List"),
  contextP1List: document.getElementById("contextP1List"),
  contextP2List: document.getElementById("contextP2List"),
  contextP0NewInput: document.getElementById("contextP0NewInput"),
  contextP1NewInput: document.getElementById("contextP1NewInput"),
  contextP2NewInput: document.getElementById("contextP2NewInput"),
  saveContextSummaryButton: document.getElementById("saveContextSummaryButton"),
  refreshReadmeButton: document.getElementById("refreshReadmeButton"),
  readmeSource: document.getElementById("readmeSource"),
  latestStatusMeta: document.getElementById("latestStatusMeta"),
  latestStatusSummary: document.getElementById("latestStatusSummary"),
  riskList: document.getElementById("riskList"),
  nextActionList: document.getElementById("nextActionList"),
  latestCheckMeta: document.getElementById("latestCheckMeta"),
  checkResults: document.getElementById("checkResults"),
  taskCountLabel: document.getElementById("taskCountLabel"),
  taskRows: document.getElementById("taskRows"),
  taskArchiveCount: document.getElementById("taskArchiveCount"),
  taskSearchInput: document.getElementById("taskSearchInput"),
  taskStatusFilter: document.getElementById("taskStatusFilter"),
  taskArchiveList: document.getElementById("taskArchiveList"),
  checkHistory: document.getElementById("checkHistory")
};

elements.refreshButton.addEventListener("click", () => loadDashboard());
elements.runCheckButton.addEventListener("click", () => runProjectCheck());
elements.copyOwnerPromptButton.addEventListener("click", () => copyOwnerThreadPrompt());
elements.saveContextSummaryButton.addEventListener("click", () => saveContextSummary());
elements.refreshReadmeButton.addEventListener("click", () => refreshContextFromReadme());
document.querySelectorAll("[data-requirement-add]").forEach((button) => {
  button.addEventListener("click", () => addRequirement(button.dataset.requirementAdd));
});
elements.taskSearchInput.addEventListener("input", () => {
  state.taskSearch = elements.taskSearchInput.value;
  renderTaskArchive(getSelectedTaskIndex());
});
elements.taskStatusFilter.addEventListener("change", () => {
  state.taskStatusFilter = elements.taskStatusFilter.value;
  renderTaskArchive(getSelectedTaskIndex());
});

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

async function saveContextSummary() {
  const selected = getSelectedProject();
  if (!selected) {
    return;
  }

  await updateProjectContext({
    summary: elements.contextSummaryInput.value.trim(),
    note: "Updated context summary from the web dashboard."
  });
}

async function addRequirement(priority) {
  const input = getNewRequirementInput(priority);
  const value = input.value.trim();
  if (!value) {
    return;
  }

  const requirements = getSelectedRequirements();
  requirements[priority] = [...requirements[priority], value];
  input.value = "";

  await updateProjectContext({
    requirements,
    note: `Added ${priority.toUpperCase()} requirement from the web dashboard.`
  });
}

async function updateRequirement(priority, index, value) {
  const nextValue = value.trim();
  if (!nextValue) {
    return;
  }

  const requirements = getSelectedRequirements();
  requirements[priority][index] = nextValue;

  await updateProjectContext({
    requirements,
    note: `Updated ${priority.toUpperCase()} requirement from the web dashboard.`
  });
}

async function removeRequirement(priority, index) {
  const requirements = getSelectedRequirements();
  requirements[priority] = requirements[priority].filter((_, itemIndex) => itemIndex !== index);

  await updateProjectContext({
    requirements,
    note: `Removed ${priority.toUpperCase()} requirement from the web dashboard.`
  });
}

async function refreshContextFromReadme() {
  const selected = getSelectedProject();
  if (!selected) {
    return;
  }

  setLoading(true);
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(selected.project.id)}/context/readme`,
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
    elements.generatedAt.textContent = `README 更新失败：${error.message}`;
  } finally {
    setLoading(false);
  }
}

async function updateProjectContext(payload) {
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
        body: JSON.stringify(payload)
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
    elements.generatedAt.textContent = `上下文更新失败：${error.message}`;
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

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(prompt);
    } else {
      fallbackCopyText(prompt);
    }
    elements.copyOwnerPromptButton.textContent = "已复制";
    setTimeout(() => {
      elements.copyOwnerPromptButton.textContent = "复制接入提示词";
    }, 1600);
  } catch (error) {
    try {
      fallbackCopyText(prompt);
      elements.copyOwnerPromptButton.textContent = "已复制";
      setTimeout(() => {
        elements.copyOwnerPromptButton.textContent = "复制接入提示词";
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
    renderOwnerReport(null);
    renderContext(null);
    renderStatus(null);
    renderTasks([]);
    renderTaskArchive([]);
    return;
  }

  elements.projectTitle.textContent = dashboard.project.title;
  elements.projectGoal.textContent = dashboard.project.goal;
  setHealth(dashboard.project.health);
  renderMetrics(dashboard.task_summary);
  renderOwnerReport(dashboard);
  renderContext(dashboard);
  renderStatus(dashboard.latest_status);
  renderTasks(dashboard.task_hall);
  renderTaskArchive(dashboard.task_index ?? dashboard.task_hall);
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

function renderOwnerReport(dashboard) {
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
    renderList(elements.ownerProposedTaskList, []);
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
    renderList(elements.ownerProposedTaskList, []);
    return;
  }

  const freshness = ownerStatus.freshness_minutes === null || ownerStatus.freshness_minutes === undefined
    ? ""
    : ` | ${ownerStatus.freshness_minutes} 分钟前`;
  elements.ownerReportMeta.textContent = `${report.id} | ${formatDate(report.answered_at)}${freshness}`;
  elements.ownerReportSummary.textContent = report.summary;
  renderList(elements.ownerProgressList, report.progress?.map(translateStatusText));
  renderList(
    elements.ownerRiskList,
    [...(report.risks ?? []), ...(report.blockers ?? [])].map(translateStatusText)
  );
  renderList(elements.ownerNextActionList, report.next_actions?.map(translateStatusText));
  renderList(
    elements.ownerProposedTaskList,
    (report.proposed_tasks ?? []).map((task) => `${task.title}：${task.objective}`)
  );
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

function renderContext(dashboard) {
  const context = dashboard?.current_context ?? null;
  const reportedContext = dashboard?.reported_context ?? null;
  const displayContext = reportedContext ?? context;

  if (!context || !displayContext) {
    elements.contextMeta.textContent = "暂无上下文";
    elements.contextSource.textContent = "上下文口径尚未建立。";
    elements.contextSummaryInput.value = "";
    elements.readmeSource.textContent = "README 尚未读取。";
    renderRequirementList("p0", []);
    renderRequirementList("p1", []);
    renderRequirementList("p2", []);
    return;
  }

  const requirements = displayContext.requirements ?? {};
  const sourceMeta = displayContext.source === "owner_report"
    ? `${displayContext.source_label} ${displayContext.source_id} | ${formatDate(displayContext.reported_at)}`
    : `${displayContext.source_label} ${displayContext.source_id}`;
  elements.contextMeta.textContent = `${sourceMeta} | 快照 ${context.id} v${context.version} | 已完成 ${context.completed_task_count} 个任务`;
  elements.contextSource.textContent = displayContext.source === "owner_report"
    ? `当前上下文口径来自项目负责人 Thread 上报；README/快照仅作为辅助来源。`
    : `当前还没有负责人上报上下文，暂用版本化项目上下文快照。`;
  elements.contextSummaryInput.value = displayContext.summary ?? "";
  renderReadmeSource(context.source_documents);
  renderRequirementList("p0", requirements.p0 ?? []);
  renderRequirementList("p1", requirements.p1 ?? []);
  renderRequirementList("p2", requirements.p2 ?? []);
}

function renderReadmeSource(sourceDocuments) {
  const readme = [...(sourceDocuments ?? [])]
    .reverse()
    .find((source) => source.type === "readme");
  if (!readme) {
    elements.readmeSource.textContent = "README 尚未读取。";
    return;
  }

  const statusText = (readme.status_points ?? []).slice(0, 3).join(" / ");
  elements.readmeSource.textContent = `README：${readme.path} | ${formatDate(readme.scanned_at)}${statusText ? ` | ${statusText}` : ""}`;
}

function renderRequirementList(priority, values) {
  const element = getRequirementListElement(priority);
  if (!values || values.length === 0) {
    element.innerHTML = `<div class="empty-state">暂无。</div>`;
    return;
  }

  element.replaceChildren(
    ...values.map((value, index) => {
      const row = document.createElement("div");
      row.className = "requirement-item";
      row.innerHTML = `
        <input class="requirement-input" type="text" value="${escapeAttribute(value)}" aria-label="${priority.toUpperCase()} 需求">
        <button class="small-button primary-small" type="button" data-requirement-save>保存</button>
        <button class="small-button" type="button" data-requirement-remove>删除</button>
      `;
      const input = row.querySelector("input");
      row.querySelector("[data-requirement-save]").addEventListener("click", () =>
        updateRequirement(priority, index, input.value)
      );
      row.querySelector("[data-requirement-remove]").addEventListener("click", () =>
        removeRequirement(priority, index)
      );
      return row;
    })
  );
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
  elements.taskCountLabel.textContent = `${tasks.length} 个待下放/待领取任务`;
  if (tasks.length === 0) {
    elements.taskRows.innerHTML = `<tr><td colspan="9" class="empty-state">当前没有需要在任务大厅处理的任务。</td></tr>`;
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

function renderTaskArchive(tasks) {
  const taskList = tasks ?? [];
  const filteredTasks = filterTaskArchive(taskList);
  elements.taskArchiveCount.textContent = `${filteredTasks.length}/${taskList.length} 个任务`;

  if (filteredTasks.length === 0) {
    elements.taskArchiveList.innerHTML = `<div class="empty-state">没有匹配的任务记录。</div>`;
    return;
  }

  elements.taskArchiveList.replaceChildren(
    ...filteredTasks.map((task) => {
      const card = document.createElement("article");
      card.className = "task-card";
      card.innerHTML = renderTaskArchiveCard(task);
      return card;
    })
  );
}

function filterTaskArchive(tasks) {
  const query = state.taskSearch.trim().toLowerCase();
  const status = state.taskStatusFilter;

  return tasks.filter((task) => {
    if (status !== "all" && task.status !== status) {
      return false;
    }

    if (!query) {
      return true;
    }

    return taskSearchText(task).includes(query);
  });
}

function taskSearchText(task) {
  return [
    task.id,
    task.title,
    task.objective,
    task.status,
    task.priority,
    task.assigned_agent_id,
    task.project_owner_thread_id,
    task.owner_report_id,
    task.assigned_agent?.name,
    task.context?.summary,
    task.context?.task_brief,
    task.delivery?.summary,
    task.delivery?.review?.summary,
    task.delivery?.review?.reviewed_by,
    task.delivery?.review?.method,
    task.delivery?.ai_detection?.summary,
    ...(task.delivery?.ai_detection?.findings ?? []),
    ...(task.required_skills ?? []),
    ...(task.acceptance_criteria ?? []),
    ...(task.deliverables ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function renderTaskArchiveCard(task) {
  const agent = task.assigned_agent
    ? `${task.assigned_agent.name} (${task.assigned_agent.id})`
    : task.assigned_agent_id ?? "-";
  const aiDetection =
    task.delivery?.review?.ai_detection ?? task.delivery?.ai_detection ?? null;

  return `
    <div class="task-card-header">
      <div>
        <div class="task-card-title">${escapeHtml(task.id)} · ${escapeHtml(task.title)}</div>
        <p>${escapeHtml(task.objective || "暂无任务描述。")}</p>
      </div>
      <div class="task-card-pills">
        ${statusPill(formatTaskStatus(task.status))}
        ${statusPill(formatPriority(task.priority))}
      </div>
    </div>
    <div class="task-card-meta">
      <span>Agent：${escapeHtml(agent)}</span>
      <span>负责人：${escapeHtml(task.project_owner_thread_id ?? "-")}</span>
      <span>负责人报告：${escapeHtml(task.owner_report_id ?? "-")}</span>
      <span>上下文：${escapeHtml(task.context_snapshot_id ?? "-")} / ${escapeHtml(formatContextStatus(task.context_status))}</span>
      <span>创建：${escapeHtml(formatDate(task.created_at))}</span>
    </div>
    <div class="task-card-grid">
      ${renderTaskInfoBlock("执行上下文", [
        ["任务说明", task.context?.task_brief],
        ["项目上下文", task.context?.summary],
        ["准备人", task.context?.prepared_by],
        ["准备时间", formatDate(task.context?.prepared_at)],
        ["相关文件", formatOptionalList(task.context?.relevant_files)],
        ["假设", formatOptionalList(task.context?.assumptions)]
      ])}
      ${renderTaskInfoBlock("运行记录", [
        ["领取时间", formatDate(task.claimed_at)],
        ["开始时间", formatDate(task.started_at)],
        ["交付时间", formatDate(task.delivered_at)],
        ["完成时间", formatDate(task.completed_at)],
        ["阻塞依赖", formatOptionalList(task.blocked_by)]
      ])}
      ${renderTaskDeliveryBlock(task.delivery)}
      ${renderTaskAiBlock(aiDetection)}
      ${renderTaskReviewBlock(task)}
    </div>
  `;
}

function renderTaskInfoBlock(title, pairs) {
  const rows = pairs
    .filter(([, value]) => value && value !== "-")
    .map(
      ([label, value]) => `
        <div class="task-field">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `
    )
    .join("");

  return `
    <section class="task-info-block">
      <h4>${escapeHtml(title)}</h4>
      ${rows || `<p class="muted">暂无。</p>`}
    </section>
  `;
}

function renderTaskDeliveryBlock(delivery) {
  if (!delivery) {
    return renderTaskInfoBlock("交付记录", [["状态", "暂无交付"]]);
  }

  return renderTaskInfoBlock("交付记录", [
    ["交付ID", delivery.id],
    ["交付状态", delivery.status],
    ["交付摘要", delivery.summary],
    ["交付时间", formatDate(delivery.created_at)],
    ["变更文件", formatOptionalList(delivery.files_changed)],
    ["验证记录", formatOptionalList(delivery.verification)]
  ]);
}

function renderTaskAiBlock(aiDetection) {
  if (!aiDetection) {
    return renderTaskInfoBlock("AI检测", [["状态", "暂无记录"]]);
  }

  return renderTaskInfoBlock("AI检测", [
    ["状态", aiDetection.status],
    ["摘要", aiDetection.summary],
    ["发现", formatOptionalList(aiDetection.findings)]
  ]);
}

function renderTaskReviewBlock(task) {
  const review = task.delivery?.review;
  if (review) {
    return renderTaskInfoBlock("审核记录", [
      ["结论", review.decision],
      ["审核人", review.reviewed_by],
      ["审核时间", formatDate(review.reviewed_at)],
      ["审核方式", review.method],
      ["通过说明", review.summary],
      ["上下文更新", review.context_update]
    ]);
  }

  if (task.status === "rejected") {
    return renderTaskInfoBlock("审核记录", [
      ["结论", "rejected"],
      ["审核人", task.reviewed_by],
      ["审核时间", formatDate(task.reviewed_at)],
      ["退回原因", task.rejection_reason]
    ]);
  }

  return renderTaskInfoBlock("审核记录", [["状态", task.status === "review" ? "等待审核" : "暂无审核"]]);
}

function renderTaskDetail(task) {
  const meta = [
    `技能：${formatList(task.required_skills)}`,
    task.project_owner_thread_id ? `负责人：${task.project_owner_thread_id}` : null,
    task.owner_report_id ? `报告：${task.owner_report_id}` : null,
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

function formatOptionalList(values) {
  return values && values.length > 0 ? values.join(", ") : null;
}

function getSelectedProject() {
  return state.data?.projects.find((dashboard) => dashboard.project.id === state.selectedProjectId) ?? null;
}

function getSelectedTaskIndex() {
  const selected = getSelectedProject();
  return selected?.task_index ?? selected?.task_hall ?? [];
}

function getSelectedRequirements() {
  const selected = getSelectedProject();
  const requirements =
    selected?.reported_context?.requirements ?? selected?.current_context?.requirements ?? {};
  return {
    p0: [...(requirements.p0 ?? [])],
    p1: [...(requirements.p1 ?? [])],
    p2: [...(requirements.p2 ?? [])]
  };
}

function getRequirementListElement(priority) {
  return {
    p0: elements.contextP0List,
    p1: elements.contextP1List,
    p2: elements.contextP2List
  }[priority];
}

function getNewRequirementInput(priority) {
  return {
    p0: elements.contextP0NewInput,
    p1: elements.contextP1NewInput,
    p2: elements.contextP2NewInput
  }[priority];
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
  elements.copyOwnerPromptButton.disabled = isLoading;
  elements.saveContextSummaryButton.disabled = isLoading;
  elements.refreshReadmeButton.disabled = isLoading;
  elements.contextP0NewInput.disabled = isLoading;
  elements.contextP1NewInput.disabled = isLoading;
  elements.contextP2NewInput.disabled = isLoading;
  elements.taskSearchInput.disabled = isLoading;
  elements.taskStatusFilter.disabled = isLoading;
  document.querySelectorAll("[data-task-action], [data-requirement-save], [data-requirement-remove], [data-requirement-add]").forEach((button) => {
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

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

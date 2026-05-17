const state = {
  data: null,
  selectedProjectId: null,
  loading: false
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
    elements.generatedAt.textContent = `Load failed: ${error.message}`;
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
    elements.generatedAt.textContent = `Check failed: ${error.message}`;
  } finally {
    setLoading(false);
  }
}

function render() {
  const data = state.data;
  const selected = getSelectedProject();
  elements.generatedAt.textContent = `Updated ${formatDate(data.generated_at)}`;

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
        <span>${escapeHtml(dashboard.project.id)} | ${escapeHtml(dashboard.project.health)}</span>
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
    elements.projectTitle.textContent = "No project selected";
    elements.projectGoal.textContent = "Create or import a project to start tracking status.";
    setHealth("unknown");
    renderMetrics({});
    renderStatus(null);
    renderTasks([]);
    return;
  }

  elements.projectTitle.textContent = dashboard.project.title;
  elements.projectGoal.textContent = dashboard.project.goal;
  setHealth(dashboard.project.health);
  renderMetrics(dashboard.task_summary);
  renderStatus(dashboard.latest_status);
  renderTasks(dashboard.task_hall);
}

function renderMetrics(summary) {
  const byStatus = summary.by_status ?? {};
  const byContext = summary.by_context_status ?? {};
  elements.metricTasks.textContent = summary.total ?? 0;
  elements.metricReady.textContent = byStatus.ready ?? 0;
  elements.metricDraft.textContent = byStatus.draft ?? 0;
  elements.metricStale.textContent = byContext.stale ?? 0;
  elements.metricBlocked.textContent = byStatus.blocked ?? 0;
}

function renderStatus(status) {
  if (!status) {
    elements.latestStatusMeta.textContent = "No status yet";
    elements.latestStatusSummary.textContent = "No project status snapshot has been written.";
    renderList(elements.riskList, []);
    renderList(elements.nextActionList, []);
    return;
  }

  elements.latestStatusMeta.textContent = `${status.id} | ${formatDate(status.created_at)}`;
  elements.latestStatusSummary.textContent = status.summary;
  renderList(elements.riskList, status.risks);
  renderList(elements.nextActionList, status.next_actions);
}

function renderLatestCheck(check) {
  if (!check) {
    elements.latestCheckMeta.textContent = "No check yet";
    elements.checkResults.innerHTML = `<div class="empty-state">No scheduled checks have run.</div>`;
    return;
  }

  elements.latestCheckMeta.textContent = `${check.id} | ${formatDate(check.created_at)}`;
  if (check.results.length === 0) {
    elements.checkResults.innerHTML = `<div class="empty-state">No projects were checked.</div>`;
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
        <p>${escapeHtml(result.summary)}</p>
      `;
      return item;
    })
  );
}

function renderTasks(tasks) {
  elements.taskCountLabel.textContent = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  if (tasks.length === 0) {
    elements.taskRows.innerHTML = `<tr><td colspan="6" class="empty-state">No tasks in this project.</td></tr>`;
    return;
  }

  elements.taskRows.replaceChildren(
    ...tasks.map((task) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(task.id)}</td>
        <td>${escapeHtml(task.title)}</td>
        <td>${statusPill(task.status)}</td>
        <td>${statusPill(task.context_status)}</td>
        <td>${escapeHtml(task.priority)}</td>
        <td>${escapeHtml(task.assigned_agent_id ?? "-")}</td>
      `;
      return row;
    })
  );
}

function renderCheckHistory(checks) {
  if (!checks.length) {
    elements.checkHistory.innerHTML = `<div class="empty-state">No check history yet.</div>`;
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
        <p>${escapeHtml(check.project_count)} project(s) | ${escapeHtml(check.note || "No note")}</p>
      `;
      return item;
    })
  );
}

function renderList(element, values) {
  if (!values || values.length === 0) {
    element.innerHTML = `<li>No items.</li>`;
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

function getSelectedProject() {
  return state.data?.projects.find((dashboard) => dashboard.project.id === state.selectedProjectId) ?? null;
}

function setHealth(health) {
  elements.healthBadge.textContent = health;
  elements.healthBadge.className = `health-badge health-${health}`;
}

function statusPill(value) {
  return `<span class="pill">${escapeHtml(value)}</span>`;
}

function healthPill(value) {
  return `<span class="pill health-${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.refreshButton.disabled = isLoading;
  elements.runCheckButton.disabled = isLoading;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

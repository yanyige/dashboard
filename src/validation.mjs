const AGENT_ROLES = ["context_steward", "executor", "reviewer"];
const AGENT_STATUSES = ["available", "busy", "offline"];
const PROJECT_STATUSES = ["active", "paused", "done", "archived"];
const PROJECT_HEALTH = ["unknown", "on_track", "at_risk", "blocked", "paused", "done"];
const TASK_STATUSES = [
  "draft",
  "ready",
  "claimed",
  "in_progress",
  "review",
  "done",
  "rejected",
  "blocked"
];
const CONTEXT_STATUSES = ["missing", "ready", "stale"];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const DELIVERY_STATUSES = ["submitted", "accepted", "rejected"];

export function validateRecord(type, value) {
  const errors = [];

  switch (type) {
    case "agent":
      validateAgent(value, errors);
      break;
    case "agent-registry":
      validateAgentRegistry(value, errors);
      break;
    case "project":
      validateProject(value, errors);
      break;
    case "context":
      validateContext(value, errors);
      break;
    case "project-status":
      validateProjectStatus(value, errors);
      break;
    case "project-check":
      validateProjectCheck(value, errors);
      break;
    case "task":
      validateTask(value, errors);
      break;
    case "delivery":
      validateDelivery(value, errors);
      break;
    default:
      throw new Error(`Unknown validation record type: ${type}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid ${type}: ${errors.join("; ")}`);
  }
}

function validateAgent(value, errors) {
  requiredString(value, "id", errors);
  requiredString(value, "name", errors);
  enumValue(value, "role", AGENT_ROLES, errors);
  enumValue(value, "status", AGENT_STATUSES, errors);
  arrayOfStrings(value, "skills", errors);
  optionalStringOrNull(value, "current_task_id", errors);
  optionalArrayOfStrings(value, "active_task_ids", errors);
  optionalPositiveInteger(value, "max_parallel_tasks", errors);
}

function validateAgentRegistry(value, errors) {
  arrayValue(value, "agents", errors);
  if (Array.isArray(value?.agents)) {
    const ids = new Set();
    value.agents.forEach((agent, index) => {
      const before = errors.length;
      validateAgent(agent, errors);
      if (errors.length > before) {
        errors.push(`agents[${index}] is invalid`);
      }
      if (agent?.id) {
        if (ids.has(agent.id)) {
          errors.push(`duplicate agent id: ${agent.id}`);
        }
        ids.add(agent.id);
      }
    });
  }
}

function validateProject(value, errors) {
  requiredString(value, "id", errors);
  requiredString(value, "title", errors);
  requiredString(value, "goal", errors);
  enumValue(value, "status", PROJECT_STATUSES, errors);
  enumValue(value, "health", PROJECT_HEALTH, errors);
  requiredString(value, "current_context_snapshot_id", errors);
  optionalStringOrNull(value, "current_status_update_id", errors);
  optionalString(value, "created_by", errors);
}

function validateContext(value, errors) {
  requiredString(value, "id", errors);
  requiredString(value, "project_id", errors);
  numberValue(value, "version", errors);
  optionalString(value, "summary", errors);
  optionalStringOrNull(value, "repo_path", errors);
  arrayOfStrings(value, "tech_stack", errors);
  arrayOfStrings(value, "constraints", errors);
  arrayOfStrings(value, "roadmap", errors);
  optionalRequirements(value, "requirements", errors);
  optionalArrayValue(value, "source_documents", errors);
  arrayValue(value, "decisions", errors);
  arrayValue(value, "completed_tasks", errors);
  arrayValue(value, "change_log", errors);
}

function validateTask(value, errors) {
  requiredString(value, "id", errors);
  requiredString(value, "project_id", errors);
  requiredString(value, "title", errors);
  requiredString(value, "objective", errors);
  enumValue(value, "priority", PRIORITIES, errors);
  enumValue(value, "status", TASK_STATUSES, errors);
  enumValue(value, "context_status", CONTEXT_STATUSES, errors);
  optionalStringOrNull(value, "context_snapshot_id", errors);
  arrayOfStrings(value, "required_skills", errors);
  optionalArrayOfStrings(value, "dependencies", errors);
  optionalString(value, "parallel_group", errors);
  optionalStringOrNull(value, "assigned_agent_id", errors);
  arrayOfStrings(value, "acceptance_criteria", errors);
  arrayOfStrings(value, "deliverables", errors);
  optionalString(value, "created_by", errors);

  if (["ready", "claimed", "in_progress", "review", "done"].includes(value?.status)) {
    requiredString(value, "context_snapshot_id", errors);
  }

  if (value?.status === "draft" && value?.context_status !== "missing") {
    errors.push("draft tasks must have context_status=missing");
  }

  if (
    ["claimed", "in_progress", "review", "done"].includes(value?.status) &&
    !value?.assigned_agent_id
  ) {
    errors.push(`${value.status} tasks must have assigned_agent_id`);
  }
}

function validateDelivery(value, errors) {
  requiredString(value, "id", errors);
  requiredString(value, "project_id", errors);
  requiredString(value, "task_id", errors);
  requiredString(value, "agent_id", errors);
  optionalStringOrNull(value, "context_snapshot_id", errors);
  requiredString(value, "summary", errors);
  arrayOfStrings(value, "files_changed", errors);
  arrayOfStrings(value, "verification", errors);
  arrayValue(value, "followups", errors);
  optionalAiDetection(value, "ai_detection", errors);
  optionalDeliveryReview(value, "review", errors);
  enumValue(value, "status", DELIVERY_STATUSES, errors);
}

function validateProjectStatus(value, errors) {
  requiredString(value, "id", errors);
  requiredString(value, "project_id", errors);
  enumValue(value, "health", PROJECT_HEALTH.filter((health) => health !== "unknown"), errors);
  requiredString(value, "summary", errors);
  requiredString(value, "updated_by", errors);
  requiredString(value, "context_snapshot_id", errors);
  optionalString(value, "source", errors);
  optionalString(value, "check_run_id", errors);
  objectValue(value, "task_counts", errors);
  objectValue(value, "context_counts", errors);
  arrayOfStrings(value, "progress", errors);
  arrayOfStrings(value, "risks", errors);
  arrayOfStrings(value, "blockers", errors);
  arrayOfStrings(value, "next_actions", errors);
}

function validateProjectCheck(value, errors) {
  requiredString(value, "id", errors);
  requiredString(value, "updated_by", errors);
  optionalString(value, "note", errors);
  numberValue(value, "project_count", errors);
  arrayValue(value, "results", errors);
}

function requiredString(value, field, errors) {
  if (typeof value?.[field] !== "string" || value[field].trim() === "") {
    errors.push(`${field} must be a non-empty string`);
  }
}

function optionalString(value, field, errors) {
  if (value?.[field] !== undefined && typeof value[field] !== "string") {
    errors.push(`${field} must be a string when present`);
  }
}

function optionalStringOrNull(value, field, errors) {
  if (
    value?.[field] !== undefined &&
    value[field] !== null &&
    typeof value[field] !== "string"
  ) {
    errors.push(`${field} must be a string or null when present`);
  }
}

function enumValue(value, field, allowed, errors) {
  if (!allowed.includes(value?.[field])) {
    errors.push(`${field} must be one of: ${allowed.join(", ")}`);
  }
}

function arrayValue(value, field, errors) {
  if (!Array.isArray(value?.[field])) {
    errors.push(`${field} must be an array`);
  }
}

function optionalArrayValue(value, field, errors) {
  if (value?.[field] === undefined) {
    return;
  }

  arrayValue(value, field, errors);
}

function arrayOfStrings(value, field, errors) {
  arrayValue(value, field, errors);
  if (
    Array.isArray(value?.[field]) &&
    value[field].some((item) => typeof item !== "string")
  ) {
    errors.push(`${field} must contain only strings`);
  }
}

function optionalArrayOfStrings(value, field, errors) {
  if (value?.[field] === undefined) {
    return;
  }

  arrayOfStrings(value, field, errors);
}

function objectValue(value, field, errors) {
  if (
    value?.[field] === null ||
    Array.isArray(value?.[field]) ||
    typeof value?.[field] !== "object"
  ) {
    errors.push(`${field} must be an object`);
  }
}

function optionalRequirements(value, field, errors) {
  if (value?.[field] === undefined) {
    return;
  }

  objectValue(value, field, errors);
  for (const priority of ["p0", "p1", "p2"]) {
    optionalArrayOfStrings(value[field], priority, errors);
  }
}

function optionalAiDetection(value, field, errors) {
  if (value?.[field] === undefined) {
    return;
  }

  objectValue(value, field, errors);
  optionalString(value[field], "status", errors);
  optionalString(value[field], "summary", errors);
  optionalArrayOfStrings(value[field], "findings", errors);
}

function optionalDeliveryReview(value, field, errors) {
  if (value?.[field] === undefined) {
    return;
  }

  objectValue(value, field, errors);
  optionalString(value[field], "decision", errors);
  optionalString(value[field], "reviewed_by", errors);
  optionalString(value[field], "reviewed_at", errors);
  optionalString(value[field], "method", errors);
  optionalString(value[field], "summary", errors);
  optionalString(value[field], "context_update", errors);
  optionalAiDetection(value[field], "ai_detection", errors);
}

function numberValue(value, field, errors) {
  if (typeof value?.[field] !== "number" || Number.isNaN(value[field])) {
    errors.push(`${field} must be a number`);
  }
}

function optionalPositiveInteger(value, field, errors) {
  if (value?.[field] === undefined) {
    return;
  }

  if (!Number.isInteger(value[field]) || value[field] < 1) {
    errors.push(`${field} must be a positive integer when present`);
  }
}

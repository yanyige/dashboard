# Codex Control Center

Codex Control Center is a file-backed control hub for managing Codex Agent work at the project level.

It has three first-class ideas:

- **Employee center**: registers Agents, their roles, skills, availability, and current work.
- **Project center**: stores each project's goal, repo path, constraints, roadmap, and versioned context snapshots.
- **Task hall**: stores project-scoped tasks that move through context preparation, execution, review, completion, and follow-up creation.
- **Status dashboard**: stores periodic Context Steward status updates so the owner can inspect project health at any time.

## V1 Flow

```text
Human publishes task
  -> task is draft with missing context
Context Steward prepares task
  -> task is ready and points to a project context snapshot
Executor claims task
  -> task is claimed, Agent is busy
Executor starts and delivers task
  -> task is in review with a delivery record
Context Steward accepts delivery
  -> task is done, Agent is available, project context advances, follow-up tasks are published
```

## Project-Level Context

Tasks do not carry the entire project background. Instead, every ready task points to a project context snapshot:

```text
task.context_snapshot_id -> project.contexts/context-0001.json
```

When a delivery is accepted, the project creates a new context snapshot. This makes context changes explicit and lets future tasks decide whether their prepared context is current or stale.

If a `ready` task was prepared against an older snapshot, accepting another delivery marks it as `context_status=stale`. A stale task must be prepared again before an Agent can claim it.

Known records are validated before they are written: Agent registry, project, context snapshot, task, and delivery. The runtime checks the same practical constraints described by `schemas/`, including required fields, enums, array fields, and task state invariants.

## Thread-Owned Context Steward

The intended Context Steward can be this Codex thread. In that mode, the thread periodically writes project status updates instead of acting like a normal registered worker Agent.

Use `update-project-status` to write a status snapshot:

```bash
npm run ccc -- update-project-status \
  --project my-project \
  --health on_track \
  --summary "Project is moving according to plan." \
  --updated-by codex-thread \
  --progress "Task hall is initialized." \
  --next-action "Prepare the next ready task."
```

Health values:

- `on_track`
- `at_risk`
- `blocked`
- `paused`
- `done`

Use `show-project-dashboard` when the owner wants the current state:

```bash
npm run ccc -- show-project-dashboard --project my-project
```

The dashboard includes project health, latest status update, current context snapshot, task counts by state, context freshness counts, and the task hall.

Use `check-projects` for the periodic Context Steward pass. It checks every project, writes one status snapshot per project, and records the full check run under `checks/`.

```bash
npm run ccc -- check-projects \
  --updated-by codex-thread \
  --note "10-minute scheduled status check"
```

View check history:

```bash
npm run ccc -- list-project-checks
npm run ccc -- show-project-check --check check-0001
```

## Run the Core Flow

```bash
npm run demo
```

The demo resets only `data/demo`, then creates:

- two Agents: a context steward and an executor
- one demo project
- one task that moves from `draft` to `done`
- one accepted delivery
- one generated follow-up task
- one new project context snapshot

Use the assertion-backed check:

```bash
npm run check
```

After running, inspect:

- `data/demo/SUMMARY.md`
- `data/demo/agents/registry.json`
- `data/demo/projects/codex-control-center-demo/project.json`
- `data/demo/projects/codex-control-center-demo/contexts/`
- `data/demo/projects/codex-control-center-demo/tasks/`
- `data/demo/projects/codex-control-center-demo/deliveries/`

## CLI

The reusable CLI uses `data/workspace` by default. You can override it with `--root <path>` or `CCC_ROOT`.

`data/workspace` is runtime state for local operation and is ignored by git. Status history remains available through the CLI and files under that directory.

```bash
npm run ccc -- register-agent --id steward --name "Context Steward" --role context_steward --skills context,task-design
npm run ccc -- register-agent --id builder --name "Builder" --role executor --skills node,workflow
```

Create a project:

```bash
npm run ccc -- create-project \
  --id my-project \
  --title "My Project" \
  --goal "Coordinate Codex Agent work" \
  --context-summary "Initial project context"
```

Import a project from GitHub:

```bash
npm run ccc -- import-project \
  --github-url https://github.com/owner/repo \
  --goal "Manage Codex Agent work for this repository"
```

By default, imports clone into the parent directory of this control center checkout. From `/Users/yyg/work/github/codex-control-center`, that means `/Users/yyg/work/github/<repo>`. If that path already exists and is a git repository, the import reuses it.

Useful import options:

```bash
npm run ccc -- import-project \
  --github-url git@github.com:owner/repo.git \
  --id custom-project-id \
  --clone-parent /Users/yyg/work/github \
  --branch main \
  --shallow
```

Use `--no-clone` when you only want to register the GitHub repository without creating a local checkout.

Publish and prepare a task:

```bash
npm run ccc -- publish-task \
  --project my-project \
  --title "Draft operating docs" \
  --objective "Create the first project operating notes" \
  --skills markdown,workflow

npm run ccc -- prepare-task \
  --project my-project \
  --task task-0001 \
  --steward steward \
  --brief "Use the project context to draft concise operating notes." \
  --criterion "Task has clear acceptance criteria." \
  --deliverable "Markdown operating notes" \
  --skills markdown,workflow
```

Execute and accept:

```bash
npm run ccc -- claim-task --project my-project --task task-0001 --agent builder
npm run ccc -- start-task --project my-project --task task-0001 --agent builder
npm run ccc -- deliver-task \
  --project my-project \
  --task task-0001 \
  --agent builder \
  --summary "Delivered the first operating notes." \
  --verification "Reviewed generated file." \
  --followup "Add CLI examples::Document every command in README.::medium::markdown"

npm run ccc -- accept-delivery \
  --project my-project \
  --task task-0001 \
  --steward steward \
  --context-update "The project now has first-pass operating notes."
```

Useful queries:

```bash
npm run ccc -- list-agents
npm run ccc -- list-projects
npm run ccc -- list-tasks --project my-project
npm run ccc -- show-task --project my-project --task task-0001
npm run ccc -- show-project-dashboard --project my-project
npm run ccc -- list-project-status --project my-project
npm run ccc -- list-project-checks
```

Run the CLI smoke test:

```bash
npm run check:cli
```

Run stale-context and write-validation checks:

```bash
npm run check:stale
```

Run project status dashboard checks:

```bash
npm run check:status
```

Run all-project check checks:

```bash
npm run check:projects
```

Run GitHub import checks:

```bash
npm run check:import
```

## Roles

### Context Steward

Maintains project context and prepares tasks before execution. In the preferred operating model, this Codex thread can act as the Context Steward. It decides whether a task is clear enough to become `ready`, attaches the relevant context snapshot, defines acceptance criteria, updates project context after accepted delivery, and writes periodic project status snapshots.

### Executor Agent

Claims `ready` tasks that match its skills, works from the prepared execution package, submits delivery evidence, and becomes available again after acceptance.

## Task States

- `draft`: published but not executable yet
- `ready`: context steward prepared the task
- `claimed`: an executor reserved the task
- `in_progress`: executor started work
- `review`: delivery was submitted
- `done`: delivery was accepted
- `blocked`: task needs intervention

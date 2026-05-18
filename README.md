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
Executor claims a claimable task from the project task pool
  -> task is claimed, Agent is busy; other Agents can claim other claimable tasks
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

Tasks can declare `dependencies` as task IDs from the same project. A task can be `ready` but not claimable until all dependencies are `done`. Already started concurrent tasks may still deliver against the context snapshot they started from; the Context Steward reconciles that delivery when accepting it into the latest project context.

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

Archive duplicate or retired project records when they should remain visible but stop producing active work:

```bash
npm run ccc -- archive-project \
  --project old-project \
  --archived-by codex-thread \
  --reason "Merged into dashboard."
```

Archived projects remain in project lists and dashboards, but scheduled checks report them as `done` and active task routing rejects new publish/prepare/claim/start operations.

Use `check-projects` for the periodic Context Steward pass. It checks every project, writes one status snapshot per project, records the full check run under `checks/`, and creates de-duplicated requirement proposals when the status check finds project-manager work that should be reviewed before execution. Generated proposals cover signals such as stale owner reports, review tasks, stale task context, draft tasks that still need context, blocked tasks, empty active projects, and claimable work that needs Agent routing. They are never published directly into the task hall.

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

Add `--depends-on task-0001` when a task must wait for another task in the same project.

Execute and accept:

```bash
npm run ccc -- list-claimable-tasks --project my-project --agent builder
npm run ccc -- claim-next-task \
  --project my-project \
  --agent builder \
  --acceptance-note "I understand the task and am taking ownership now." \
  --plan "Implement the change, run verification, then submit delivery evidence." \
  --eta "Next report within 30 minutes."
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
  --reviewer reviewer \
  --context-update "The project now has first-pass operating notes."
```

Useful queries:

```bash
npm run ccc -- list-agents
npm run ccc -- list-projects
npm run ccc -- list-tasks --project my-project
npm run ccc -- list-claimable-tasks --project my-project
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

## Web Dashboard

Run the web dashboard locally:

```bash
PORT=3000 CCC_ROOT=data/workspace npm run web
```

Open:

```text
http://localhost:3000
```

The web dashboard exposes:

- project health and lifecycle state
- latest project status snapshot
- latest scheduled check
- requirement proposal review queue from project owner reports
- project Thread Inbox messages for browser-to-project conversations
- task hall table
- draft review actions to approve requirements into ready tasks or reject them
- recent check history
- a manual `Run Check` action

API endpoints:

```text
GET  /api/health
GET  /api/dashboard
GET  /api/projects/:projectId
GET  /api/checks
GET  /api/checks/:checkId
POST /api/checks/run
POST /api/projects/:projectId/requirement-proposals
POST /api/projects/:projectId/requirement-proposals/:proposalId/approve
POST /api/projects/:projectId/requirement-proposals/:proposalId/reject
GET  /api/projects/:projectId/thread-inbox
POST /api/projects/:projectId/thread-inbox
POST /api/projects/:projectId/thread-inbox/:messageId
```

The Thread Inbox API is V2-lite plumbing. It records browser messages as
project-scoped `pending` items with owner Thread metadata, then lets automation
or a later bridge move them through `processing`, `replied`, or `failed` while
preserving reply and error evidence.

On the server deployment, the stable entrypoint is:

```bash
dashboard-ccc show-project-dashboard --project codex-control-center
```

The web service is intended to run with:

```bash
HOST=0.0.0.0 PORT=3000 CCC_ROOT=/opt/dashboard/data/workspace node /opt/dashboard/scripts/dashboard-server.mjs
```

## Roles

### Context Steward

Maintains project context and prepares tasks before execution. In the preferred operating model, this Codex thread can act as the Context Steward. It decides whether a task is clear enough to become `ready`, attaches the relevant context snapshot, defines acceptance criteria, updates project context after accepted delivery, and writes periodic project status snapshots.

### Reviewer

Reviews submitted delivery evidence and records the review decision, method, and conclusion. A Reviewer can be separate from the Context Steward: `accept-delivery` still requires `--steward` for context advancement, and can also receive `--reviewer` to record who made the delivery review decision.

### Requirement Proposal Review

Project owner reports can include `--proposed-task` entries. Those entries are stored as requirement proposals first, not executable task hall work. A human owner or steward reviews each proposal with `approve-requirement-proposal` or `reject-requirement-proposal`; approval creates a draft task in the task hall, where it can then be prepared and released to Agents.

### Executor Agent

Claims `ready` tasks that match its skills and writes an acceptance note, execution plan, and expected next report time into the task record. Claiming moves the task queue status from `ready` to `claimed`, so the overall PM can see who accepted the work and how it will proceed. The executor then works from the prepared execution package and proactively runs `deliver-task` after completion. That moves the task to `review` with delivery evidence and releases the executor's capacity, so the Agent can claim more work while the overall PM / Context Steward reviews the submitted delivery. Executor Agents must not run `accept-delivery` for their own work.

## Task States

- `draft`: published but not executable yet
- `ready`: context steward prepared the task
- `claimed`: an executor reserved the task
- `in_progress`: executor started work
- `review`: delivery was submitted and no longer occupies executor capacity
- `done`: delivery was accepted
- `blocked`: task needs intervention

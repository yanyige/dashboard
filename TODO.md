# TODO

## Done in V1

- [x] Create the project skeleton.
- [x] Register agents in an employee center.
- [x] Create a project with a versioned context snapshot.
- [x] Publish a project-scoped task into the task hall.
- [x] Let a context steward prepare the task into an executable work package.
- [x] Let an executor claim, start, and deliver the task.
- [x] Accept the delivery, mark the task done, update project context, and publish a follow-up task.

## Next

- [x] Add reusable CLI commands for each lifecycle action.
- [x] Add a CLI smoke test that exercises the full lifecycle through commands.
- [x] Add task filtering by project, status, skill, and priority.
- [x] Add schema validation during writes.
- [x] Add stale-context detection when project context advances after a task was prepared.
- [x] Add thread-owned project status update and dashboard interfaces.
- [x] Add all-project scheduled check records.
- [x] Add GitHub URL project import.
- [ ] Add a reviewer role separate from the context steward.
- [ ] Add a persistent audit log format suitable for Git diffs.

# Agent start packet

Before editing:

1. Read repository `AGENTS.md`.
2. Read `MASTER_PLAN.md`, your sprint `SPRINT.md`, and the complete selected task card.
3. Read direct prerequisite handoffs/current source at the coordinator-provided revision.
4. Confirm your isolated worktree and owned paths.
5. Identify every protected shared file you will need before editing.
6. Restate the invariant/outcome, not merely the file list.

During work:

- Preserve unrelated current changes.
- Keep policy in domain/application, transactions in store, TUI as service client.
- Preserve failed/unknown operation evidence and use readback before retry.
- Do not use Global to claim/finish project execution.
- Run a focused task-local check only when your output is consumed by another task before sprint close or when needed to avoid handing downstream code an unvalidated API.

Handoff using `templates/TASK_HANDOFF.md`.

## Active revision 4

Read GENERAL_WORK_CONTRACT.md and execution/REVISION_V4.md. Use the current stored V4 graph after supported adoption; a repository update alone is not adoption. General work has optional outputs/dates and selected rigor. Nested workers are allowed with disjoint grants, but every claim/review/closeout uses the canonical protocol. Keep legacy IDs, receipts and active S00-T05 authority intact.

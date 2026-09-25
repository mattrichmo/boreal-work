# Prompt for the implementation model

You are receiving a current Boreal v2 source archive. Read
`BWRK_IMPLEMENTATION_HANDOFF.md` first. Treat it as the active implementation
plan for this pass. The older `project/build-plan/production-completion/` plan
documents are reference material; do not recreate their 22-sprint validation
ceremony or stop after producing another plan.

Implement the handoff completely, in order, while using parallel work internally
when file ownership is disjoint. Continue through every sprint instead of
returning a partial slice after the first compile or environment inconvenience.
Keep the existing Rust domain/application/store/service architecture and the
project-local model authoritative. Do not replace the backend, port v1
wholesale, create a browser UI, fabricate dashboard data, fabricate receipts,
or silently weaken requirements to make a check pass.

When an environment lacks an optional tool, continue with the work that does
not require it, record the limitation, and do not declare the entire task
finished. Use the repository's existing toolchain and generated-file rules.
Keep user-facing language clean and non-internal.

For each task:

- inspect the existing implementation and the referenced files before editing;
- make the smallest coherent code/schema/protocol change;
- preserve compatibility where the existing contract requires it;
- update the focused tests or fixtures needed to demonstrate the behavior;
- record the task as implemented, partially implemented, or blocked with the
  exact reason;
- keep moving to the next unblocked task.

At the end, create `IMPLEMENTATION_REPORT.md` and a final archive. The report
must include the exact source revision, every changed/added path, a concise
description of each change, commands run and outcomes, remaining blockers, and
the merge order. Also provide a mini git log with commit ID, message, and
purpose for each commit. Do not claim release readiness if any required handoff
item remains incomplete.

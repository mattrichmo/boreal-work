---
name: boreal-finish
description: "Boreal v2 finish skill. Use when attaching evidence, verifying work, composing a summary, or closing or releasing work."
---

# Boreal v2 Finish

Use this thin adapter to carry one work item through evidence, verification, review, and closeout.

## Contract

- Read `boreal.yaml` and resolve `boreal.workflow.finish.v1` with `bwrk workflows show <ref> --json`.
- Confirm the active attempt, fence, current revision, required gates, and close intent before adding evidence or changing lifecycle state.
- Use application-owned evidence, verification, summary, finish, close, release, sprint-close, and gate actions. Do not claim completion from prose, a green local command, or an unverified summary.
- Preserve failed evidence and historical attempts. Attach evidence to the typed work/attempt and report its receipt.
- Preserve the authenticated worker actor, project, session, harness, transport, work, attempt, fence, source/configuration identities, revisions, and operation identity from Boreal's current action descriptor. Guidance does not grant authority; never impersonate an Operator or Reviewer.
- After implementation, leave the produced result in its declared project workspace/output. Use the current authorization policy for `source add`; when an Operator must capture the exact result, request that capture and continue as the enrolled worker.
- Bind the captured source version and content digest to the current worker attempt before verification with `bwrk evidence bind-result --project PROJECT --work WORK_ID --attempt ATTEMPT_ID --fence N --source-version SOURCE_VERSION_ID --content-digest SHA --expected-revision N --expected-entity-revision N --expected-proof-revision N --actor ACTOR_ID --session SESSION_ID --operation-id OPERATION_ID --json`. Take project/entity/proof revisions, the current fence, actor, session, and operation identity from the current scoped context/action descriptor. Reuse an operation ID only for an identical payload; read back an uncertain result before retrying.
- Confirm the durable binding names the current project, work, worker attempt/fence, exact result source and digest. Keep the original claim source immutable; run proof against the bound result and pinned configuration with the required gate inputs, such as `bwrk evidence run --project PROJECT --work WORK_ID --gate GATE_ID --attempt ATTEMPT_ID --fence N --json`.
- Submit only through Boreal's current authorized `attempt.submit/v1` action with the same project, worker, session, attempt and fence. The supported CLI spelling is `bwrk work finish PROJECT WORK_ID --attempt ATTEMPT_ID --fence N`; do not substitute an invented `agent submit` command. Continue with the returned review-wait, finish/close, release, or recovery guidance, and require submission and proof to remain bound to the same final result.
- Inspect returned trusted directives/action descriptors and required gates after each action; execute only one state-changing action per response.

## Completion

Report evidence IDs, verification outcome, review/gate status, close or release intent, commit/dependency state, receipt, and any remaining blocker.

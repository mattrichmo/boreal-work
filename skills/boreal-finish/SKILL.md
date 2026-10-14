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
- Inspect the returned trusted directive/action descriptors and required gates after each action; execute only one state-changing action per response.
- After implementation, leave the produced artifact in its declared workspace/output and request the authorized Operator to capture that exact result through `source add`. Bind the registered source identity and digest with the fenced `evidence bind-result` action before verification. Supply the current project, entity and proof revisions plus work, attempt and fence; the service request/readback uses the versioned `boreal.final_result_capture.v1` contract, while actor/session/operation identity comes from the authenticated envelope. Reuse the operation ID only for the same payload; stale revisions and changed-payload replay are rejected. The application reloads the pinned profile/config and invalidates stale proof applicability.
- For a typed general-work output result, write a strict `boreal.artifact_result_bind.v1` request file and call `artifact result bind --project PROJECT --input REQUEST.json` with the current actor, session, and operation ID. Include work, attempt/fence, expected project/entity/proof revisions, result ID, contract revision, exact project-scoped source version identities, relationship IDs, and any rights provenance; never supply inspection facts or host catalog paths. The application rereads and inspects the exact source bytes under the pinned profile/contract, binds the immutable result, and reports source-relationship IDs plus lineage-pending work. Reuse an operation ID only for the identical request. Read the durable record with `artifact result attempt --project PROJECT --work WORK --attempt ATTEMPT --fence N` or `artifact result operation --project PROJECT OPERATION_ID`; the latter operation ID is a lookup target, while the current request operation ID remains envelope-owned. Schema-v2 stores report unavailable without migration.
- Inspect and verify captured bytes with `source show` and `source verify`. Their service DTOs identify one exact source version; the catalog root is resolved from the workspace binding and is not caller input.
- `intake bucket` and `intake capture` require an expected project revision. The service routes reject an older store without work-model/3 and leave schema-v2 unchanged; direct CLI commands retain their existing additive schema ensure behavior.
- Before requesting closeout, use `work close-readiness PROJECT WORK_ID` to inspect the authoritative, read-only snapshot. The versioned result includes its project revision, current attempt/fence when present, gate states, and exact blockers; callers do not provide readiness facts. The service reports schema-v2 as unavailable without migration or mutation.
- Run verification against the bound result identity. The original claim source remains immutable provenance and must not be substituted for the delivered result.
- Compose with `summary compose --work ID`; save immutable summary bodies with `summary create` bound to the current attempt, fence and expected revision. Historical `summary backfill` records cannot satisfy live proof.

## Completion

Report evidence IDs, verification outcome, review/gate status, close or release intent, commit/dependency state, receipt, and any remaining blocker.

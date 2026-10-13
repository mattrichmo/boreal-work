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
- After implementation, leave the produced artifact in its declared workspace/output and request the authorized Operator to capture that exact result through `source add`. Bind the registered source identity and digest with the fenced `evidence bind-result` action before verification; the application reloads the pinned profile/config and invalidates stale proof applicability.
- Run verification against the bound result identity. The original claim source remains immutable provenance and must not be substituted for the delivered result.
- Compose with `summary compose --work ID`; save immutable summary bodies with `summary create` bound to the current attempt, fence and expected revision. Historical `summary backfill` records cannot satisfy live proof.

## Completion

Report evidence IDs, verification outcome, review/gate status, close or release intent, commit/dependency state, receipt, and any remaining blocker.

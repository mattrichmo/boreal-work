# PF-S00-T06 — coordinator handoff

## Outcome

The coordinator completed the bounded dispatch/evidence setup after the first
assigned worker stalled. The stalled attempt remains preserved at
`attempt-1/START.md`; it was not overwritten or treated as successful.

## Changed paths

- `project/validation/production/evidence-contract.md`
- `project/validation/production/dispatch/README.md`
- `project/validation/production/dispatch/AGENT_DISPATCH.md`
- `project/validation/production/dispatch/CHANGE_REQUEST.md`
- `project/validation/production/tasks/PF-S00-T06/attempt-2/`

No production source, schema, protocol, plan authority, or live database path
was edited.

## Invariants handed forward

- `plan.json` remains the task/dependency authority; `execution/STATE.json`
  records execution facts and coordinator acceptance.
- Effective write sets are whole-file/directory boundaries and are checked for
  overlap before dispatch.
- A handoff cannot self-accept a task, sprint, review, or release.
- Unknown outcomes and failed attempts remain durable evidence.
- Shared roots and manifests require a serialized steward change request.

## Verification

The final evidence record lists the JSON, graph, conflict, and whitespace
checks. The current combined-tree identity is recorded in `EVIDENCE.md`.

## Residual risk and next safe action

The controls do not create missing compiler/platform/reviewer capacity and do
not prove the product contract. Dispatch PF-S00-T07 only after recording this
handoff and rerunning graph readiness. Then send the complete entry packet to
the independent S00 review chain: PF-S00-T90 → PF-S00-T91 → PF-S00-T92.

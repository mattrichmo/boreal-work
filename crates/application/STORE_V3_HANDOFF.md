# Application → store v3 handoff

This note records the boundary used by the hierarchy/intake application
vertical. It is intentionally not a plan ledger. The application owns typed
requests, actor/session scope, expected-revision checks, domain validation and
operation intent. The store owns the short transaction, revision bump,
operation replay and audit persistence.

## Connected seams

The application currently uses these store-owned operations after checking the
project revision and, when supplied, the active session/actor binding:

- `apply_work_model_v3` / `work_model_v3_enabled`
- `create_work_node_v3`
- `create_cycle_series_v3`, `create_cycle_template_v3`, `create_cycle_v3`
- `assign_cycle_work_v3`
- `create_intake_bucket_v3`, `create_intake_item_v3`
- `promote_intake_v3`
- `append_container_disposition_v3`
- exact v3 reads used for template, assignment and promotion provenance
- `list_incomplete_evidence_executions` for read-only recovery assessment

The application does not issue raw SQL and does not treat a successful plan
as a durable mutation.

## Required follow-up store seams

These are the remaining seams needed before the corresponding application
plans can be exposed as complete CLI/service mutations:

1. **Work edit:** transactional update of v3 parent/execution mode and the
   schema-2 title/description/planning fields, with expected project revision,
   operation replay, and descendant validation in the same transaction.
2. **Dependencies:** list exact v3 dependency edges plus transactional add and
   remove. Both operations need DAG validation and expected revision; the
   existing schema-2 `add_dependency_operation` has no expected-revision or
   session field and is not a substitute for the v3 edge API.
3. **Holds/dispatch:** an application adapter over the existing schema-2 work
   and hold tables with a single expected-revision mutation. A read-before-
   write check alone is not sufficient because it can race another writer.
4. **Cycle lifecycle:** update/activate/pause/retire cycle series and cycle
   instances with their own revision/precondition checks. Creation is wired;
   activation currently remains an application plan.
5. **Assignments:** update/remove/commit/carry-over operations and a query for
   all assignments in a project. Creation has foreign-key and direct-task
   guards; full lineage and uniqueness policy should be rechecked transactionally
   for updates as well.
6. **Intake updates:** update content/lifecycle/revisit time using an expected
   content revision and exact digest. Capture and promotion are wired, but an
   update seam is required for the full intake journey.
7. **Promotion fan-out:** one durable parent operation or outbox record that
   links the intake promotion to the created draft-work/source-version/memory-
   draft target. The current row records immutable provenance and target ID; it
   deliberately does not pretend the target library was committed.
8. **Session end:** an atomic operation that verifies actor/session ownership,
   refuses a live current attempt unless a fenced release/stop confirmation is
   part of the same workflow, writes `ended_at`, and is replayable. The current
   application API returns an explicit `SessionEndPlan` and never silently
   releases work.
9. **Recovery reconciliation:** durable readback and state transitions for
   admitted/running/exited/unknown external evidence executions, plus restart
   reconciliation for attempts and worktrees. The application currently exposes
   a read-only `OperatorRecoveryAssessment` only.
10. **Context propagation:** add `session_id` to `V3MutationContext` and persist
    it in v3 operation/audit records. The application includes session scope in
    canonical request digests and rejects inactive/wrong sessions, but the
    current store context drops the field when appending the durable records.

## Release criteria for this boundary

The missing operations should be added to the store before adding CLI/TUI
handlers. Each must have a typed request, one transaction, expected revision,
actor/session subject checks, same-operation replay with request-digest
conflict, audit payload, and an application integration test that performs the
operation through `WorkApplication` rather than direct SQL.

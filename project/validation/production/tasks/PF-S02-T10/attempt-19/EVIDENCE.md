# PF-S02-T10 attempt 19 — evidence

## Disposition

This is a **bounded, unaccepted handoff**. The two required combined-tree
failures remain reproducible. The safety invariant has not been weakened and
no acceptance claim is made.

## Finding 1 — status projection still has an N+1 planning read

`read_project_status_in_transaction` already batches attempts, holds, gates,
receipts, reviews, summaries and dependencies. It still calls
`status_planning_facts(project_id, work_id)` inside the per-work row loop in
`crates/store/src/lib.rs`. That helper checks the cycle tables and prepares a
planning query for each work row in `crates/store/src/status_evaluation.rs`.

The 250-work regression therefore prepares 762 statements. The required fix is
to materialize cycle/schedule activation facts once per project, keyed by
`work_id`, then combine them with each decoded row. The batch must preserve:

- project-scoped filtering;
- earliest applicable activation precedence;
- absent v3 planning tables returning no schedule/activation;
- malformed/negative activation diagnostics;
- exact status rows and corruption diagnostics.

Do not remove the query metric or raise the threshold.

## Finding 2 — resource ownership is safe but recovery resolution is incomplete

The claim path in `crates/store/src/lib.rs` reserves the canonical key
`work:{project_id}:{work_id}`. This is the correct granularity for one live
execution resource per work item: `w-red`, `w-blue`, and `w-green` do not
share a key, and the first three distinct claims in the guided-flow scenario
proceed.

Terminal expiry requests canonical release, which changes the old attempt's
reservation to `release_pending`. The unique partial index
`boreal_resource_live_key` intentionally keeps that key unavailable until an
acknowledgement. The guided-flow test then calls the plain
`resolve_recovery_obligation` path with `resource_state = 'released'`; that
path resolves the obligation but does not transition the associated canonical
reservation to `released`. The subsequent replacement claim is consequently
rejected by the live-resource uniqueness constraint.

This is not evidence that distinct work items should use attempt-scoped keys,
nor permission to drop the unique index. The fix must preserve genuine same-
resource conflicts and make the recovery/acknowledgement contract explicit.

## Required regression coverage

Add a store/application regression that proves both:

1. distinct work IDs receive distinct canonical work resource keys and can be
   claimed concurrently; and
2. two live reservations for the same project/resource key are rejected until
   the first reservation has a valid release acknowledgement.

The replacement-after-expiry case must also prove that resolution cannot make a
resource reusable before the canonical release evidence is committed.

## Residual status

The status batching implementation and the canonical recovery release wiring
are still required. The attempt is ready for an independent review of this
diagnosis and for a new bounded implementation attempt.

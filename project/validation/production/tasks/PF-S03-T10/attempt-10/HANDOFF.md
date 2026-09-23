# PF-S03-T10 attempt 10 — handoff

## Result

Ready for independent review as a bounded pure-domain validation patch. The
new table-driven oracle target is four-for-four under focused test execution
and passes strict Clippy. No production source was changed.

## Changed paths

- `crates/domain/tests/production_t10_oracle.rs`
- `project/validation/production/tasks/PF-S03-T10/attempt-10/START.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-10/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-10/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-10/HANDOFF.md`

## Acceptance mapping

- Deterministic precedence: covered by the table-driven status matrix.
- Primary/secondary reasons: primary is asserted first; secondary facts are
  asserted and stable-order invariance is checked.
- Exact deadlines: lease and hard-budget equality are tested explicitly.
- Queued versus hard blocked: separate vectors assert distinct statuses,
  reasons, and claimability.
- Expiry recovery: expiry-review status remains after the attempt reaches the
  expired historical phase; no blind claim is enabled.
- Override truth: a scoped dependency waiver satisfies only the target edge,
  retains the raw open prerequisite, and stops satisfying it at revocation.
- Action descriptors: descriptors are replay-deterministic and retain target
  and revision bindings; inspection remains available while claim is denied.

## Production integration gap

The domain API can express the decisions, but this worker does not prove that
the store supplies immutable requirements, recovery obligations, authenticated
actor identity, or durable scoped override records to that API. It also does
not prove that application/service/TUI actions consume the same descriptors.
Those remain integration and transaction-level acceptance work for PF-S03-T09,
PF-S03-T90/T91/T92, and the PF-S02/PF-S04 cross-sprint gates.

The full domain package gate is not green until the prior
`production_properties` source-bound oracle is revalidated at the current
integrated revision. Preserve that failed result; do not mark this task or the
sprint accepted from the focused pass alone.

## Coordinator next action

Have an independent reviewer inspect the new test target and evidence at the
exact integrated source identity, then reconcile the stale prior oracle binding
through its owning task before using a full-domain run as sprint evidence.

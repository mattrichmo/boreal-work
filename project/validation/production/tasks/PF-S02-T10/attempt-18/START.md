# PF-S02-T10 attempt 18 — store remediation start

## Source and disposition

- Task: `PF-S02-T10`
- Attempt: `attempt-18`
- Input source: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`); current
  working tree is still uncommitted and includes the store-side status
  reconciliation recorded below.
- Branch: `codex/apply-responsive-terminal-overlay`
- Started: 2026-09-22
- Disposition: implementation/remediation attempt; not accepted
- Plan/state files: read-only; no commit or push is authorized

The working tree contains unaccepted PF-S02-T11 application edits and PF-S03-T10
domain/evidence edits. Those paths are outside this attempt and must remain
untouched. The prior PF-S02-T10 attempt-17 handoff and independent review
identified the blockers addressed here.

## Invariants to preserve

1. Strict profile definitions remain content-addressed. A placeholder or empty
   profile definition must fail closed; no fixture or compatibility path may
   weaken digest validation.
2. Pinned requirement declarations are authoritative, immutable observations of
   what a work revision required. Deleting a gate/receipt/observation cannot
   delete or reduce the requirement set used by reads or mutation authorization.
3. Schema installation is ordered and deterministic. Read paths do not create
   production tables; fresh, upgrade, reopen and concurrent-open paths either
   observe the registered schema or fail closed.
4. Operation identity, audit identity, subject, project/database lineage,
   actor/session and request digest remain bound to one transaction. Exact
   replay returns the original outcome; changed context is rejected without a
   second mutation/audit effect.
5. Every terminal attempt/close/stop/fail/cancel/expiry path releases the
   canonical reservation through the durable release/acknowledgement boundary
   and retains an unresolved recovery obligation until safe disposition. Legacy
   rows may be compatibility projections but cannot be the only canonical
   release record.
6. Valid work in one project/database remains isolated from another project,
   including after restart, rollback, copied metadata and concurrent access.

## Authorized write set

- `crates/store/src/lib.rs`
- `crates/store/src/profiles.rs`
- `crates/store/tests/production_store_seams.rs`
- `crates/store/tests/production_integration.rs`
- `project/spec/schema-production.sql` or exact migration/opening registration
  only if required to move authoritative DDL into the ordered production path
- `project/validation/production/tasks/PF-S02-T10/attempt-18/`

All other production files, plan/state/acceptance records, application/service/
memory/update paths, live databases and prior evidence are read-only. Any
needed changes outside this set will be recorded as an integration request.

## Required implementation and verification

- Reconcile the strict profile-seam digest fixture without weakening code.
- Remove lazy pinned-requirement DDL from read paths and register it in the
  ordered production schema/open path, with fresh/upgrade/reopen coverage.
- Add the missing combined `production_integration` target covering migration,
  deletion/drift quarantine, identity-bound replay/rollback, restart,
  concurrency, and project/database boundaries.
- Audit and integrate canonical reservation release/recovery acknowledgement
  across terminal attempt and close writers in the authorized store boundary.
- Run focused integration tests, the full `boreal-store` suite, strict store
  Clippy, formatting, contract validation and relevant compilation checks.
- Record exact commands, source identity, failures and residual blockers in
  `COMMANDS.md`, `EVIDENCE.md`, `INTEGRATION-REQUESTS.md` and `HANDOFF.md`.

## Protected integration requests

- Application/service/memory/update call sites remain out of scope; their
  identity-bound integration needs must be named rather than silently bypassed.
- Any canonical operation writer outside `crates/store` remains a coordinator
  integration request and is not claimed as fixed by this attempt.
- Acceptance requires independent review and exact-tree revalidation; this
  attempt cannot update `STATE.json` or declare PF-S02-T10 accepted.

## Store-side status reconciliation recorded during attempt-18

The concurrent PF-S03-T10 domain change added `schedule` and `activation_at`
to `StatusContext`. Within the authorized store boundary, the adapter now
passes those fields and reads the earliest activation instant from live v3
cycle assignments. No work-level schedule is fabricated from retry timing; it
remains absent until a canonical persisted schedule projection exists.

# PF-S02-T10 attempt 17 — integration requests

These requests are intentionally bounded and are not acceptance claims.

## Required before re-review

- **PF-S02-T04 / coordinator:** update or reconcile
  `crates/store/tests/production_store_seams.rs` so the fixture uses the
  canonical profile digest derived from its definition. Keep strict drift
  rejection intact, then rerun the full store suite.
- **PF-S02-T10 follow-up:** create the missing
  `crates/store/tests/production_integration.rs` in the authorized test path.
  It must exercise the combined opener and source-bound persistence
  invariants listed in the task card.
- **Store integration steward:** inspect every terminal root writer in
  `crates/store/src/lib.rs`; pair legacy reservation updates with durable
  `boreal_resource_reservation` release requests/acknowledgements and retain
  unresolved recovery obligations until authenticated resolution.

## Outside this write set

- Application/service project binding and authenticated workspace onboarding.
- Verifier, memory publication, update, backup, and stop external-job call
  sites described by PF-S02-T11 attempt 12.
- Plan/state ledger changes and acceptance decisions.

The outside-scope items must be completed through their owning streams and
revalidated on the same integrated source before PF-S02-T10 can be accepted.

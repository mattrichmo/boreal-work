# PF-S02-T10 attempt 21R — integration requests

These are follow-ups for the coordinator/reviewer; they are not acceptance
claims.

1. Independently review `recovery.rs` and the guided/recovery regressions on
   the exact combined tree.
2. In a separately scoped store-test remediation, update
   `crates/store/tests/store_contracts.rs` to use the authenticated
   identity-bound release path or explicitly assert that plain released
   resolution is rejected. Do not weaken the new guard.
3. Decide whether the unused public recovery-adapter methods should be wired
   through a production caller or explicitly documented/annotated.
4. Re-run the full store and strict application-Clippy suites after those
   follow-ups, then repeat production integration and guided-flow checks.
5. Keep PF-S02-T10 unaccepted until combined-tree review and plan-level gates
   pass. Do not commit or push this bounded attempt as final acceptance.

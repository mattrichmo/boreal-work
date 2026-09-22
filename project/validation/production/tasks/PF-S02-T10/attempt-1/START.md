# PF-S02-T10 — attempt 1 start

## Identity and scope

- Task: `PF-S02-T10` — integrate canonical profile, recovery and operation persistence.
- Input source: `784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined worktree.
- Worker boundary: `crates/store/src/lib.rs`, `project/spec/schema-production.sql`,
  `crates/store/tests/production_integration.rs`, and this attempt directory only.
- Shared integration token: coordinator-managed root and production schema paths.
- Prior evidence is read-only and retained, including rejected PF-S02-T04, T06 and T07 reviews.

## Baseline hashes

```text
b9febd62257e36c1ae691fcf76e1610dcbce2efc606c0bb8d83d69f1c4cb7420  crates/store/src/lib.rs
3fd0d323955cf4d52ec06cf366fdf7abe47ac0a27b4ac2768492b5835095e1cf  project/spec/schema-production.sql
```

## Invariant and strategy

The canonical production opener must install and verify the complete additive
store contract through the ordered migration boundary. Requirements are
immutable declarations separate from gate observations; legacy or missing
definitions fail closed. Operation identity/outcome/audit and recovery/job
records must be available at the root transaction boundary, while module-local
helpers remain non-authorizing storage primitives.

The implementation will add the additive tables to the fresh production
schema and the v2→v3 migration payload, replace lazy-only opener behavior with
presence and contract verification, pin declarations during canonical work
creation, and exercise fresh/upgrade/reopen, deletion/drift, replay and
rollback cases against the actual store.

No application-service or external-adapter success is claimed by this leaf.

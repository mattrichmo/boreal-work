# PF-S02-T10 attempt 19 — integration requests

## 1. Batch planning facts in the store status snapshot

Owner: PF-S02 store integration steward.

Add a project-level planning-facts loader under the protected store boundary.
Use one guarded table-availability check and one project-scoped relation scan,
then pass a `BTreeMap<work_id, (schedule, activation_at)>` into the status row
loop. Keep the single-work helper only if another callsite needs it; it must
not be called once per work by a project snapshot.

Required reruns:

```text
cargo test --locked --offline -p boreal-store --test storage_remediation status_gate_queries_are_batched_for_large_projects -- --exact
cargo test --locked --offline -p boreal-store --test storage_remediation
cargo test --locked --offline -p boreal-store
cargo clippy --locked --offline -p boreal-store --all-targets -- -D warnings
cargo fmt --all -- --check
python3 project/spec/validate_contracts.py
git diff --check
```

## 2. Reconcile recovery resolution with canonical resource acknowledgement

Owner: PF-S02 recovery/store integration steward.

Choose and document one authoritative contract without weakening the safety
boundary:

- a recovery resolution marked `released` must atomically perform or validate
  the exact canonical release acknowledgement, using the obligation's bound
  project/attempt/fence/resource reservation; or
- the guided-flow/application path must call the existing explicit
  `acknowledge_resource_release` operation before resolving/reusing the
  obligation, with the test proving that plain resolution alone remains
  blocked.

The chosen contract must preserve audit/readback, idempotency, project and
attempt identity, and the `boreal_resource_live_key` uniqueness constraint.
Do not change the key to an attempt ID or suppress the constraint.

Required reruns include the guided-flow test, the full application suite, the
production recovery/resource tests, and the combined store integration target.

## 3. Independent review gate

Do not update `execution/STATE.json` or mark PF-S02-T10 accepted from this
attempt. Review the exact combined tree after implementation, verify the
distinct-work and same-resource conflict regressions, and rerun the complete
store/application checks before any ledger disposition.

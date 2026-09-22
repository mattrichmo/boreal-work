# PF-S03-T06 — Attempt 4 Commands

Independent review command record. No source, `STATE.json`, or manifest changes were made by this review.

| Command | Result |
| --- | --- |
| `cargo test --locked -p boreal-domain --test production_action_policy` | exit 0; 7 passed, 0 failed |
| `nl -ba crates/domain/src/actions.rs` | inspected policy, descriptors, authorization, recovery routes, role/delegation and scope checks |
| `nl -ba crates/domain/src/lib.rs` | confirmed `pub mod actions;` at line 10 |
| `nl -ba crates/domain/tests/production_action_policy.rs` | inspected focused coverage and public-boundary imports |
| `shasum -a 256 crates/domain/src/actions.rs crates/domain/src/lib.rs crates/domain/tests/production_action_policy.rs` | recorded below |

## Reviewed source hashes

```text
8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7  crates/domain/src/actions.rs
8c8293e61be01be9d699f405d38bcbfd34d35033440ad6f757c233645c05c2e7  crates/domain/src/lib.rs
dbde282e8907f30bc72eb67d877bfa4669b8198e78c8e2444a7a34c383183f80  crates/domain/tests/production_action_policy.rs
```

Prior integration hashes were compared against `attempt-1/COORDINATOR-INTEGRATION.md`; the reviewed integrated files match those recorded hashes.

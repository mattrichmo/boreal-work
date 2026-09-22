# PF-S02-T11 attempt-19 evidence

## Source evidence

| File | SHA-256 |
|---|---|
| `crates/cli/src/main.rs` | `84141f70531ff9c765a84a1570b46ad775337056b0a6b34fb025dd80d4ca9144` |
| `crates/cli/src/service.rs` | `1e96889db113687e445a215034082eb24c1341e970106bedf91976a84e8e84f7` |

Current owned diff: `crates/cli/src/main.rs` 12 insertions/1 deletion;
`crates/cli/src/service.rs` 615 insertions/5 deletions.

## Validation

- `cargo check --locked -p boreal-cli`: PASS.
- `cargo test --locked -p boreal-cli`: PASS — 78 unit tests plus all CLI
  integration targets.
- Focused update adapter tests: PASS, 9/9.
- `cargo fmt --all -- --check`: PASS.
- Owned-file `git diff --check`: PASS.

The update route is now fail-closed around the durable identity chain:
operation/audit admission → external-job registration → sole acquisition →
installer callback → attributable binary/manifest readback → reconciliation.
The route returns `unknown`/readback-required for unresolved states.

## Limitation evidence

The existing parent writers remain direct at the exact symbols listed in
`HANDOFF.md`; converting them through `append_identity_operation_audit` was
validated and failed on the store's unique `(project_id, revision)` audit
constraint. Verifier execution remains covered by the existing durable
`evidence_execution` state machine but not by the external-job sidecar. The
service has no independent recovery DTO/route; lifecycle release delegates to
the application runtime hook.

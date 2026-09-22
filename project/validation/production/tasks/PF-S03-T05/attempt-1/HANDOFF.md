# Task handoff — PF-S03-T05 implementation attempt 1

## Identity and disposition

- Task / plan / attempt: `PF-S03-T05` / production-completion plan /
  `attempt-1`.
- Worker: implementation worker; independent reviewer not yet assigned in this
  handoff.
- State requested: `ready_for_review`; current combined-tree revalidation is
  complete, with independent review and task-level acceptance still required.
- Input/final combined source: HEAD
  `784a41b3802c29a76721c55eef2e9493283396c2`, dirty branch
  `codex/apply-responsive-terminal-overlay`; final owned-file hashes and
  command identity are in `EVIDENCE.md` and `COMMANDS.md`.
- Prerequisites: accepted bounded PF-S01-T92 attempt 3, PF-S03-T01 attempt 2,
  and PF-S03-T04 attempt 4; exact handoff hashes are in `EVIDENCE.md`.
- Contract: `boreal.work-dependency/2` and the accepted production contract
  manifest were read at the recorded digests. This handoff does not claim
  acceptance of PF-S03-T05 or PF-S03 as a sprint.

## Changes and invariant

### Exact worker-owned changed paths

- `crates/domain/src/dependencies.rs`
- `crates/domain/tests/production_dependency_policy.rs`
- `project/validation/production/tasks/PF-S03-T05/attempt-1/`

No other production path was edited by this worker. The coordinator-owned
`crates/domain/src/lib.rs` registration and public-import conversion are
present in the combined tree but are not this worker's patch.

### Implemented behavior

- `validate_dependency_graph` canonicalizes nodes/edges before checking
  project scope, endpoint existence/kind, duplicate IDs/pairs, self-edges, and
  DFS cycles; rejection codes and cycle paths are insertion-order stable.
- `evaluate_dependencies` requires exact edge revision, predecessor identity,
  accepted current closed outcome, and proof generation. It keeps all other
  raw outcomes unmet and retains raw prerequisite/waiver context.
- `EdgeWaiver` is bound to one edge ID/revision/project/successor and an
  effective revision interval; expired/revoked or mis-scoped waivers cannot
  leak to another edge.
- `affected_subgraph` returns canonical roots, shortest distances, and sorted
  edges. `dependency_impact` previews direct/transitive invalidation from
  reopen, accepted-outcome revocation, or waiver revocation; pending and active
  successors require reconciliation while historically closed/cancelled
  successors remain history-preserved.

### Coordinator integration request for `crates/domain/src/lib.rs`

The coordinator has already applied the required registration at the module
boundary (`pub mod dependencies;`, currently visible at `lib.rs:11`) and the
focused test now imports `boreal_domain::dependencies`. Please retain that
registration and public import on the combined tree; no additional root
re-export is required because the API is intentionally namespaced under
`boreal_domain::dependencies`.

The coordinator has reconciled the shared root formatting and the application/
store integration should call `validate_dependency_graph`,
`evaluate_dependencies`, and `dependency_impact` as the authoritative
versioned dependency policy and should not introduce a second waiver or
close-satisfaction predicate. This request does not authorize this worker to
edit `lib.rs` or other production paths.

## Validation

| Case / command argv and cwd | Source/runtime identity | Expected assertion | Actual outcome / exit | Raw evidence |
| --- | --- | --- | --- | --- |
| `cargo test --locked -p boreal-domain --test production_dependency_policy -- --test-threads=1` from repository root | Public coordinator-integrated module; Rust 1.85.0 | Focused dependency policy passes | `11 passed, 0 failed` / `0` | `COMMANDS.md`; owned test SHA recorded in `EVIDENCE.md` |
| `cargo check --locked -p boreal-domain --test production_dependency_policy` from repository root | Same | Focused target compiles | Passed / `0` | `COMMANDS.md` |
| `cargo check --locked -p boreal-domain --tests` from repository root | Same dirty combined tree | All domain test targets compile | Passed / `0` | `COMMANDS.md` |
| `rustfmt --check` on both owned Rust files | Owned source | Worker files formatted | Passed / `0` | `COMMANDS.md` |
| `cargo fmt --all -- --check` from repository root | Current combined tree | Workspace formatted | Passed / `0` | Coordinator reconciled shared module ordering |
| `cargo test --locked -p boreal-domain` from repository root | Current combined tree | Full domain package passes | Passed / `0` | All targets passed; dependency-policy target `11 passed, 0 failed` |
| `cargo clippy --locked -p boreal-domain --tests -- -D warnings` from repository root | Current combined tree | No warnings/errors | Passed / `0` | Strict domain test clippy passed |
| `git diff --check` from repository root | Dirty tree | No whitespace errors | Passed / `0` | `COMMANDS.md` |

Real service operation/readback IDs: none; this is pure-domain evidence.
Verifier receipts, native/published identities, schema/migration changes, and
runtime operations: not applicable and not run.

## Impact and residual work

- Schema/migration/rollback: none introduced.
- Protocol/CLI/status/action compatibility: no transport change; the public
  domain module supplies typed graph/evaluation/impact values for later
  adapters. Existing legacy/schema-2 helpers remain untouched and require
  coordinator selection of this boundary.
- Authority/isolation/history: project scope, exact edge revision and proof
  identity, edge-scoped waiver validity, and append-only-compatible impact
  semantics are represented. Pure evaluation never mutates historical facts.
- Source/memory/package: no effect.
- Limitations: results are from a dirty combined tree, and task/sprint
  acceptance plus independent review remain outstanding. The earlier shared
  blockers were resolved by the coordinator and are retained historically in
  `COMMANDS.md`.
- Next safe action: independent PF-S03-T05 review and coordinator/application
  integration review; rerun the exact combined-tree gates if additional
  changes land. Do not mark this leaf accepted from the focused suite alone.

- [x] No test/run/peer/native success was inferred or fabricated.
- [x] Failures/history retained; secrets excluded from evidence.
- [x] Worker changes remain within the granted boundary.
- [x] Shared `lib.rs` registration is present and called by the focused public
      test; coordinator acceptance and task-level review remain separate.

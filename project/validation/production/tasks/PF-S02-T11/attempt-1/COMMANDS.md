# PF-S02-T11 — attempt 1 commands

Repository: `/Users/cybertron/Code/boreal-work`  
Branch: `codex/apply-responsive-terminal-overlay`  
HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Worktree: dirty; no pre-existing source changes were reset or overwritten.  
Host: macOS ARM64  
Rust: `rustc 1.85.0`, `cargo 1.85.0`

## Source inspection

```text
rg -n 'register_external_job|advance_external_job|mark_external_job_readback_required|RecoveryObligationInput|create_recovery|request_resource_release|acknowledge_resource_release|ensure_external_job_schema|ensure_recovery_schema' crates/application crates/cli crates/memory crates/service --glob '*.rs'
```

Exit `0`. No application, CLI, memory, or service call sites were found for
the durable external-job/recovery APIs. The store root registers the modules
and currently calls the additive schema seams from its opener, but lifecycle
and adapter call-site wiring remains outside this leaf.

```text
for f in crates/application/src/runtime.rs crates/application/src/evidence.rs crates/memory/src/publisher.rs crates/cli/src/update.rs crates/application/tests/production_external_jobs.rs; do ...; done
```

Observed: `runtime.rs`, `evidence.rs`, and `update.rs` are present;
`crates/memory/src/publisher.rs` and the proposed integration-test file are
missing. `Publisher` is defined in protected `crates/memory/src/lib.rs`.

## Validation checks

| Command | Exit | Observed result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-application` | 0 | All application unit/integration/doc tests passed, including evidence execution, unknown readback, lifecycle, and project-scoped proof tests. |
| `cargo test --locked -p boreal-memory` (run concurrently with the other package checks) | 101 | 21/22 publisher tests reached completion; `concurrent_distinct_publications_serialize_without_lost_entries` failed because one publication saw the existing lock conflict. |
| `cargo test --locked -p boreal-memory --test publisher` (isolated rerun) | 101 | 20/22 passed; `concurrent_same_operation_publication_has_one_commit_identity` and `concurrent_distinct_publications_serialize_without_lost_entries` failed with `another publication owns the memory root lock; retry after it exits`. |
| `cargo test --locked -p boreal-cli` | 0 | All CLI unit/integration/doc tests passed, including evidence timeout/readback and service restart fixtures. |
| `python3 project/spec/validate_contracts.py` | 0 | Contract validation passed: protocol envelopes, guidance/workflow fixtures, transition vectors, clocks/dependencies, conformance mappings, and SQLite schema parsing. |
| `git diff --check` | 0 | No whitespace errors. |

The memory failures are retained as existing combined-tree test evidence; no
retry was converted into a success claim and no production source was changed
to mask them.

## Source hashes at end of attempt

```text
0fe0aa504fbe93b750a80e8639efaefba130cf9054c04ebf4f35e6dd2ddf7c60  crates/application/src/runtime.rs
855a672f1eafe9354524c20c80620a681367bf80c1281e20a59dd49884c40590  crates/application/src/evidence.rs
0a3c680ed8dabaab392d4f9e4fb536662cd6300b37a8ed69259541abd5663da2  crates/cli/src/update.rs
f0a149a7c0cb93154df2c40134d5472aa437eef3ede06d11854ee9b48d1bf13b  crates/memory/src/lib.rs
ccdc4f17606cf0f25fcd5b1802deeeae8dd3d51b9617b1769f48e0dd7a344b38  project/validation/production/tasks/PF-S02-T11/attempt-1/START.md
```

No binary, service lifecycle operation, verifier receipt, Git publication
operation, backup job, update job, or native release artifact was produced by
this blocked attempt.

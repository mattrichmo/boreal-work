# PF-S02-T11 — attempt 2 commands

Repository: `/Users/cybertron/Code/boreal-work`  
Branch: `codex/apply-responsive-terminal-overlay`  
Starting HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Worktree: dirty; unrelated and inherited changes were preserved.

## Source inspection

```text
find crates -path '*publisher.rs' -o -path '*memory*'
```

`crates/memory/src/publisher.rs` is absent. The `Publisher` implementation is
embedded in the protected `crates/memory/src/lib.rs`; no disconnected module
was created.

```text
rg -n 'register_external_job|advance_external_job|mark_external_job_readback_required|create_recovery_obligation' crates/application crates/cli crates/memory crates/service --glob '*.rs'
```

The new application adapter is the only call site in the granted application
scope. Canonical evidence/store transaction wiring and lifecycle recovery
call sites remain outside the grant.

## Validation commands

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | 0 | Passed on the final source. |
| `cargo test --locked -p boreal-application --test production_external_jobs` | 0 | 3 tests passed against an actual SQLite-backed application/store setup. |
| `cargo test --locked -p boreal-application` | 0 | Full application package passed, including the 3 focused external-job tests. |
| `cargo test --locked -p boreal-cli` | 0 | Full CLI package passed. |
| `cargo test --locked -p boreal-memory` | 101 | 20/22 publisher tests passed; two concurrent publisher tests failed with the existing lock-conflict result. The failure was not changed or masked. |
| `python3 project/spec/validate_contracts.py` | 0 | Contract validation passed. |
| `git diff --check` | 0 | Passed. |

The memory failures were:

- `concurrent_same_operation_publication_has_one_commit_identity`
- `concurrent_distinct_publications_serialize_without_lost_entries`

Both report `another publication owns the memory root lock; retry after it
exits` for some concurrent callers. This attempt did not edit the publisher or
its tests.

## Final source hashes

```text
486f9784d68a984ee13f5086afc7f1252841794ca1d4d036ed818b629b179c79  crates/application/src/evidence.rs
0fe0aa504fbe93b750a80e8639efaefba130cf9054c04ebf4f35e6dd2ddf7c60  crates/application/src/runtime.rs
0a3c680ed8dabaab392d4f9e4fb536662cd6300b37a8ed69259541abd5663da2  crates/cli/src/update.rs
2cf5ef33fe941dbd50cd48459a20b758c52f5106d6d8cd481136d26b1233fcf5  crates/application/tests/production_external_jobs.rs
```

`crates/memory/src/publisher.rs` does not exist in this revision.

# PF-S02-T11 — attempt 8 independent review commands

Repository: `/Users/cybertron/Code/boreal-work`  
Branch: `codex/apply-responsive-terminal-overlay`  
Source: dirty combined worktree, `HEAD` `784a41b3802c29a76721c55eef2e9493283396c2`.

| Command | Exit | Exact result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-store --test production_external_job_boundary` | 0 | 4 passed, 0 failed, 0 ignored. |
| `cargo test --locked -p boreal-store --test production_recovery_records --test production_operation_audit` | 0 | `production_operation_audit`: 15 passed, 0 failed; `production_recovery_records`: 7 passed, 0 failed. |
| `cargo test --locked -p boreal-store` | 0 | All executed store unit/integration/doc tests passed; 1 release benchmark test ignored by its test annotation. Relevant bounded suites included 4 external-job, 7 recovery, and 15 operation/audit tests. |
| `cargo fmt --all -- --check` | 0 | Passed with no output. |
| `git diff --check` | 0 | Passed with no output. |

No command was left running or awaiting output. The source was not a clean
checkout: `git status --porcelain=v1` reported 98 dirty/untracked paths, so
these results are attributable to the inspected dirty worktree rather than a
published or release source identity.

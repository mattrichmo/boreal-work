# PF-S02-T10 — attempt 1 commands

Repository: `/Users/cybertron/Code/boreal-work`  
Input revision: `784a41b3802c29a76721c55eef2e9493283396c2`  
Worktree: dirty; pre-existing changes were preserved.

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | 0 | Passed. |
| `cargo test --locked -p boreal-store --test production_migrations` | 101 | First run was intentionally retained as a failed probe after the partial schema edit: fresh production open failed because the new identity tables existed without an installed identity row. The attempted schema edit was reverted. |
| `cargo test --locked -p boreal-store --test store_contracts` | 101 | Same first-run consequence: 24 tests failed at setup because the partial schema edit caused `invalid database_identity: database identity is not installed`. |
| `cargo test --locked -p boreal-store --test store_contracts` | 0 | Rerun after reverting the partial schema edit: 24 passed. |
| `cargo test --locked -p boreal-store --test production_migrations` | 0 | Rerun after reverting the partial schema edit: 16 passed. |
| `python3 project/spec/validate_contracts.py` | 0 | Passed; SQLite schema parsed and contract fixtures validated. |
| `git diff --check` | 0 | Passed. |

No `production_integration.rs` target was created or run. No service,
application, external-job, native-package, or release evidence was attempted.

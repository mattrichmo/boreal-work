# PF-S02-T10 — attempt 16 coordinator correction commands

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-cli --test project_setup` | 0 | 2/2 passed, including repeat init. |
| `cargo test --locked -p boreal-cli --test dashboard_launcher` | 0 | 6/6 passed. |
| `cargo test --workspace --locked --quiet` | 0 | All workspace test groups passed; one release benchmark remains intentionally ignored. |
| `cargo build --locked -p boreal-cli --bin bwrk --quiet` | 0 | CLI binary built. |
| `cargo fmt --all -- --check` | 0 | Passed. |
| `git diff --check` | 0 | Passed. |

The full workspace run was executed after both corrections were applied.

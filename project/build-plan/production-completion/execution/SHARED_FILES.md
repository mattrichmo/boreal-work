# Shared-file and schema integration ownership

The file, not a function name, is the write-lock unit. Existing large root modules are intentionally protected. New independent implementation files can be developed concurrently, but the task is not integrated until their actual registration/call sites compile and pass the required behavior checks.

## Protected classes

| Class | Owner and operation |
| --- | --- |
| `Cargo.toml`, `Cargo.lock`, crate manifests | Dependency/integration steward; one resolver update with exact version, compatibility and supply-chain review. |
| `crates/*/src/lib.rs`, CLI `main.rs` | Crate integration steward; module/trait/export additions and existing monolith changes serialized. |
| `crates/cli/src/service.rs`, `command_registry.rs` | Interface coordinator; route/name/descriptor changes cannot be edited concurrently. |
| Protocol models/manifests and accepted contract manifest | Version steward; coordinated schema versions, compatibility vectors and consumer updates. |
| Schema manifests, SQL migrations and migration ordering | Store/migration steward; unique order/checksum and fresh/upgrade verification. |
| Workflow/skill registries | Workflow/interface steward; exported assets and executable command references agree. |
| Installer/release generators, embedded installer, release IDs, CI workflows | Release/integration steward; source/generated/embedded identity and full asset inventory verified. |
| Plan graph, state ledger and acceptance records | Coordinator; agents submit changes as proposals, not self-acceptance. |

The precise `shared_exact_paths` registry is in plan.json. A directory write grant does not override these protections. Unanticipated shared files require a path-change request and an updated conflict check.

## Integration patch request

Supply the exact base digest, proposed patch, dependent task IDs, exported contract/module names, migration/protocol impact, tests required and proof that no registration is left disconnected. The steward applies/reconciles it under a token and records the resulting combined tree. If another lane already changed the file, the original worker reviews the reconciliation and reruns affected checks.

When two tasks genuinely need to modify the same monolith, serialize them or first create a separately accepted extraction/refactor task preserving behavior. Do not promise imaginary parallelism based on nonoverlapping line numbers. Do not perform a broad refactor merely to satisfy a parallelism target.

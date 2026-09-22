# PF-S02-T03 — Attempt 2 validation commands

## Execution identity

- Repository: `/Users/cybertron/Code/boreal-work`
- Branch: `codex/apply-responsive-terminal-overlay`
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Worktree: dirty before and during review; unrelated pre-existing changes were
  preserved. No source, `STATE.json`, or manifest file was edited by this
  validation attempt.
- Runtime: Darwin ARM64, `xnu-11215.61.5`; `rustc 1.85.0`, `cargo 1.85.0`,
  `rustfmt 1.8.0`.
- Relevant source hashes at validation:

  ```text
  e353bd204b59f90aca94a5040b8561d958c5824aed4bea80231457ce4dcc3817  crates/store/src/lib.rs
  6eace3d9af29f3df635db000758e0ec486f166e529cd94d8b098a42e03b8d5ed  crates/store/src/identity.rs
  16a4b192aa0489ddef01c63b0a0a925ef8b69ef756686e0c4cea662c1ea289a1  crates/store/tests/production_identity_revisions.rs
  ```

All commands below ran from `/Users/cybertron/Code/boreal-work`. The focused
commands completed; none is running or blocked.

## Required executable gates

| Command | Exit | Exact result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-store --test production_identity_revisions` | 0 | `6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out` |
| `cargo test --locked -p boreal-store` | 0 | Package tests: `98 passed; 0 failed; 1 ignored`; doc-tests: `0 passed; 0 failed` |
| `cargo check --locked -p boreal-store` | 0 | Store package checked successfully |
| `cargo clippy --locked -p boreal-store --all-targets -- -D warnings` | 0 | Strict clippy clean |
| `cargo fmt --all -- --check` | 0 | Formatting clean |
| `git diff --check` | 0 | No whitespace errors |

The full package total is the sum of the store library target, all store
integration targets, and doc-tests; the one ignored test is the existing
release benchmark.

## Static review commands

| Command / inspection | Result |
| --- | --- |
| `rg -c '^pub mod identity;' crates/store/src/lib.rs` | `1`; public registration is present exactly once |
| Search for `IdentityStore` construction/installation and mutation calls outside `identity.rs` and `production_identity_revisions.rs` | No production root/application call sites found; this is the acceptance blocker |
| Search `crates/store/src/identity.rs` for transaction control | No `BEGIN`, `COMMIT`, or `ROLLBACK`; the only `execute_batch` is additive identity DDL, so mutation methods retain caller-owned transaction control |
| Review `identity.rs` checked conversions, scope checks, separated cursors, composite FKs, restore invalidation, and integrated `lib.rs` cleanup | Completed; details are in `EVIDENCE.md` |

## Read-only audit protocol attempt

The required read-only workflow resolution attempt was:

```text
bwrk workflows show boreal.workflow.audit.v1 --json
```

It returned `outcome: busy` because the direct offline path could not acquire
the existing database owner (`process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`). No
lifecycle mutation or acceptance action was attempted, and this did not block
the source review or the requested Rust validation commands.

## Scope control

No command was used to edit source, `project/build-plan/production-completion/execution/STATE.json`,
or `project/spec/manifest.json`. Existing dirty paths, including the
coordinator-integrated `crates/store/src/lib.rs`, were read-only inputs.

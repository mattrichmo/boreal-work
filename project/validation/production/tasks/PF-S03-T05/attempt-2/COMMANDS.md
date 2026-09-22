# PF-S03-T05 independent review attempt 2 — commands and results

## Identity and environment

- Workspace/CWD: `/Users/cybertron/Code/boreal-work`
- Review window: `2026-09-22T09:26:58Z` through `2026-09-22T09:31:21Z`.
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; the pre-existing combined tree was left untouched.
- Host/toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)
  (Homebrew)`; `cargo 1.85.0`.
- Reviewed source hashes:
  - `crates/domain/src/dependencies.rs`:
    `fd383467d213bcb956c9e54b92e1a2feae0397ee8f9443b394b15bbda2490cf8`
  - `crates/domain/src/lib.rs`:
    `504bb99b658217c8bb3d605f6e7b30b3f4080f14ed1f4928ca4b37121ef45538`
  - `crates/domain/tests/production_dependency_policy.rs`:
    `434e3cac5f04bfc886ff7c94b94ad0b06703e8f464387bacd6730c18ceeef555`

## Read-only Boreal workflow probes

All commands ran from the workspace root. The application adapter returned a
typed `outcome: busy` / `error.code: service_busy`; no lock was broken and no
state-changing workflow was attempted.

| Command | Exit | Result |
| --- | ---: | --- |
| `bwrk workflows show boreal.workflow.review.v1 --json` | `6` | Local database owner already held by `process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`. |
| `bwrk work show boreal-work PF-S03-T05 --json` | `6` | Typed `service_busy`; candidate readback unavailable. |
| `bwrk work list boreal-work --json` | `6` | Typed `service_busy`; candidate listing unavailable. |

## Required exact-tree validation

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | `0` | Passed; no output. |
| `cargo test --locked -p boreal-domain --test production_dependency_policy` | `0` | `11 passed, 0 failed, 0 ignored`. |
| `cargo test --locked -p boreal-domain` | `0` | `96 passed, 0 failed, 0 ignored` across unit, hierarchy, status, acceptance, decision-input, dependency, time, and work-model targets; `0` doc tests. |
| `cargo check --locked -p boreal-domain --tests` | `0` | All domain library and test targets compiled. |
| `cargo clippy --locked -p boreal-domain --tests -- -D warnings` | `0` | Strict package/test clippy passed. |
| `cargo clippy --locked -p boreal-domain --lib -- -D warnings` | `0` | Strict domain-library clippy passed. |
| `cargo clippy --locked -p boreal-domain --test production_dependency_policy -- -D warnings` | `0` | Strict focused-target clippy passed. |
| `git diff --check` | `0` | Passed; no whitespace errors. |

These results are validation evidence only. They do not override the source
findings recorded in `EVIDENCE.md`, and they are not service or release proof.

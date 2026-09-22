# PF-S02-T04 — Attempt 2 independent review commands

Repository: `/Users/cybertron/Code/boreal-work`  
Input: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined worktree  
Review time: `2026-09-22T11:54Z`

## Commands and results

| Command | Exit | Result |
| --- | ---: | --- |
| `git rev-parse HEAD` | 0 | `784a41b3802c29a76721c55eef2e9493283396c2` |
| `openssl dgst -sha256 crates/store/src/profiles.rs crates/store/src/lib.rs project/spec/schema-production.sql crates/store/tests/production_profile_requirements.rs` | 0 | Hashes recorded in `START.md`; the shell loop invoked `openssl dgst -sha256` once per file. |
| `cargo test --locked -p boreal-store --test production_profile_requirements` | 0 | 6 passed, 0 failed. These are public module/contract tests; they do not open SQLite or exercise status/claim/close. |
| `cargo test --locked -p boreal-store` | 0 | All store targets passed; release acceptance reported 1 intentional ignored benchmark. No PF-S02-T04 durable-declaration test exists in this suite. |
| `cargo clippy --locked -p boreal-store --all-targets -- -D warnings` | 0 | Passed. |
| `cargo fmt --all -- --check` | 0 | Passed on the exact combined tree. |
| `python3 project/spec/validate_contracts.py` | 0 | Passed: protocol, guidance, workflow, transition, conformance, clock/dependency, and SQLite schema checks. |
| `rg -n "PinnedRequirements|ProfileStore|audit_observations|classify_legacy_definition|requirement_id|resolved_digest|acceptance_profile" crates --glob '*.rs'` | 0 | Found the new module and tests, but no durable requirement table, root readback, or lifecycle invocation of `audit_observations`. |

## Review-only source inspection

- `project/spec/schema-production.sql:50-57` defines only `acceptance_profile`; there is no immutable profile-gate declaration or task/container pinned-requirement table.
- `crates/store/src/lib.rs:2311-2354` checks raw profile row equality but permits `{}` legacy placeholders and does not persist resolved declarations.
- `crates/store/src/lib.rs:2362-2370` calls `ensure_acceptance_profile` with a synthetic digest and literal `{}` during canonical work creation.
- `crates/store/src/lib.rs:3849-4050` builds status gate diagnostics by selecting observed `gate` rows and derives missing requirements from those rows; it does not load a declaration set.
- `crates/store/src/profiles.rs:466-541` explicitly describes `ProfileRegistry` and `ProfileStore` as a coordinator integration seam; registration delegates to the existing root profile method, and no durable pinned write is present.
- `crates/store/tests/production_profile_requirements.rs:1-188` explicitly states that durable root registration is intentionally not hidden behind a test-local module. The deletion test calls the pure `audit_observations` function with an in-memory empty observation slice.

No production source, task card, state ledger, manifest, or prior evidence was edited by this review.

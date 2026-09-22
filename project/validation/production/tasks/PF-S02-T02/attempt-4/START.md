# PF-S02-T02 — Attempt 4 independent re-review start

## Identity and bounded scope

- Task / attempt: `PF-S02-T02` / `attempt-4`.
- Reviewer: Codex, independent re-reviewer of the attempt-3 correction; this
  review did not implement the correction.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: `2026-09-22` (America/Regina); validation completed at
  `2026-09-22T09:46:21Z` or later.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined
  worktree.
- Review output boundary: only this attempt-4 directory. No production source,
  prior evidence, or `project/build-plan/production-completion/execution/STATE.json`
  was edited.
- Decision scope: PF-S02-T02 leaf only. No sprint, service, native,
  publication, release, or parent-gate acceptance is claimed.

## Review inputs loaded

The full PF-S02-T02 card, PF-S02 sprint context, production-completion master
plan, root dispatch handoff, startup and parallel/write-boundary guidance, the
production contract manifest, all four attempt-2 rejection records, all four
attempt-3 correction records, and the current source were read.

The source review covered the complete current files:

- `crates/store/src/transactions.rs`
- `crates/store/src/profiles.rs`
- `crates/store/src/execution.rs`
- `crates/store/src/operations.rs`
- `crates/store/src/acceptance.rs`
- `crates/store/tests/production_store_seams.rs`
- `crates/store/src/lib.rs`

## Prior rejection retained

Attempt-2 rejected the leaf for:

- `F-PF-S02-T02-02-001`: a second transaction/revision owner in
  `transactions.rs`, a raw `ProjectWrite::store()` escape, and no integrated
  root-mutation proof.
- `F-PF-S02-T02-02-002`: the focused target mounted local seam modules with
  `#[path]` instead of exercising the public qualified crate exports.

The attempt-2 files remain unchanged and are the preserved rejection record.
Attempt-3 was a bounded correction only; it explicitly made no independent
review or coordinator acceptance claim.

## Required invariant for this re-review

The bounded store seam must have one transaction/revision authority: the root
`SqliteStore` mutation owns the `BEGIN IMMEDIATE`, expected-revision check,
revision bump, commit, and rollback. The new adapter must not open a nested
transaction, duplicate revision policy, expose a raw root store, or bypass the
root boundary. A real qualified adapter call must prove committed mutation and
stale-revision rollback with unchanged state. The focused target must use the
qualified public `boreal_store::{acceptance, execution, operations, profiles,
transactions}` modules.

## Source identity under review

| Path | SHA-256 |
| --- | --- |
| `crates/store/src/transactions.rs` | `d155e88e1de5b7b6b37cae660a1d4005d2c8579199d1d1ea8aa0b5b9ef0bc628` |
| `crates/store/src/profiles.rs` | `93b263ded09b47effdd1494280bcf7952f8c7bc69f64f21ee20170a94755ec8f` |
| `crates/store/src/execution.rs` | `c588e7a6b53796334e4c7cabaa599caca5efff191846e224e1a0baebf50eb614` |
| `crates/store/src/operations.rs` | `a009aefdf2a6e28a9faf8586e393d9152758e1332d594b728caa6c7069cc1449` |
| `crates/store/src/acceptance.rs` | `d44e02b31cc46b0a7ccf5bf1bb93621c326043973f3b4af22506ae6c2f7164b2` |
| `crates/store/tests/production_store_seams.rs` | `76f210e0fb1bc8f5a8b53354e253a1cd19e082ca0d06a74d8d01e87fddc91554` |
| `crates/store/src/lib.rs` | `f3efd3db72cae5250c1b5a7b6a9d2f8c03abbc28e0c01a63b5821977cfb0ffb6` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |

## Application workflow authority

The resolved review workflow, review-candidate query, and work-show query were
run read-only. Each returned typed `service_busy` because the local database
owner is `process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`.
No lock was broken, no lifecycle mutation was attempted, and no typed review
receipt was fabricated. The file-bounded task card and exact current source
remain the review subject.


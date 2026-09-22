# PF-S02-T02 — Attempt 2 independent review handoff

## Identity and disposition

- Task / plan / attempt: `PF-S02-T02` / PF production-completion plan v1 /
  `attempt-2`.
- Reviewer: Codex, independent of the attempt-1 implementation worker.
- Decision: **REJECTED for this leaf only**.
- Input/final reviewed source: `HEAD
  784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined worktree; current
  root hash and all seam/test hashes are in `START.md` and `COMMANDS.md`.
- Prerequisite: accepted `PF-S02-T01/attempt-8`, limited to T01.
- Coordinator/Boreal state: no `STATE.json` or workflow state was edited; the
  installed workflow probes were `service_busy` because process `68913` owns
  the project database.

## Audited invariant and findings

The bounded leaf must expose real, public qualified store seams while keeping
one transaction/revision owner, preserving project-scoped readback and failed/
unknown history, and leaving policy outside SQL.

- `F-PF-S02-T02-02-001` — **major/blocking**: `transactions.rs` adds a second
  transaction/revision owner beside root `finish_transaction` and
  `check_expected_revision`; existing root writes are not routed through it,
  and `ProjectWrite::store()` permits nested transaction-owner calls.
- `F-PF-S02-T02-02-002` — **observation/evidence limitation**: the focused
  test mounts local `#[path]` modules instead of exercising the public
  `boreal_store::<module>` exports, although root registration itself compiles.

The other requested properties are observed as follows: all five root module
declarations are public; operation readback rejects a foreign project;
execution unknown/incomplete records remain readable; profile/execution/
operation/acceptance modules delegate existing behavior; and no policy SQL was
added in the seam files.

## Verification receipt

| Check | Result |
| --- | --- |
| `cargo fmt --all -- --check` | exit 0 |
| `cargo check --locked -p boreal-store` | exit 0; existing migration dead-code warning |
| `cargo test --locked -p boreal-store --test production_store_seams` | exit 0; 6 passed, 0 failed |
| `cargo test --locked -p boreal-store` | exit 0; 93 passed, 1 intentional ignored, 0 failed; doc-tests 0/0 |
| `git diff --check` | exit 0 |

## Reconciliation and authority limits

The duplicate-writer/hash reconciliation observation is retained: the six
attempt-1 worker/test hashes match the current files byte-for-byte, while the
current `lib.rs` integration is separately identified as dirty combined-tree
source. No production code, prior attempt, unrelated path, or `STATE.json` was
changed by this review; only the four attempt-2 records were written.

This handoff does not accept PF-S02-T02, PF-S02, or any service, native,
publication, release, sprint, or parent-gate scope. No live lock was broken.

## Required correction / next safe action

Consolidate the transaction/revision owner so the new seams and existing root
mutations share one boundary, add a qualified public-export regression, and
rerun the focused/full store checks on the corrected exact source. Then assign
an independent re-review of this leaf. The coordinator must record any later
decision separately; this handoff records rejection only.

- [x] Required commands were actually rerun and their outcomes recorded.
- [x] Prior failed/intermediate evidence and hash identity were preserved.
- [x] No production source or `STATE.json` was edited.
- [ ] Leaf acceptance: not granted; F-PF-S02-T02-02-001 remains open.

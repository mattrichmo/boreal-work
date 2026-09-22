# PF-S02-T07 — Attempt 3 handoff

## Status

**Ready for independent review as a bounded corrective contribution; not
accepted.**

Task: `PF-S02-T07` — persist command registration, outcomes and audit atomically.  
Attempt: `attempt-3` corrective implementation.  
Repository: `/Users/cybertron/Code/boreal-work`  
Input: branch `codex/apply-responsive-terminal-overlay`, commit
`784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree.

## What changed

The worker-owned operation/audit seam now has a transaction-friendly
register-or-replay API. It validates immutable identity fields, binds the
operation to the current project/database identity through `IdentityStore`,
returns the original outcome on exact replay, rejects changed request digests
and audit subjects, distinguishes `busy` and `unknown` readback, and bounds
redacted operation/audit JSON. The focused tests exercise the real SQLite
adapter and caller-owned transaction boundary.

## Verification

Passed:

- `cargo test --locked -p boreal-store --test production_operation_audit` —
  15/15;
- `cargo test --locked -p boreal-store` — all store targets passed;
- production store seams — 5/5;
- session registration — 3/3;
- task-target clippy with the unrelated `profiles.rs` argument-count lint
  explicitly excluded;
- workspace formatting, changed-file diff check, contract validation, plan
  validation, and plan-package verification.

Not passed / retained:

- Full `cargo clippy --locked -p boreal-store --all-targets -- -D warnings`
  remains blocked by the existing out-of-scope
  `crates/store/src/profiles.rs:505` `clippy::too_many_arguments` warning.
  This attempt did not edit that file.

## Coordinator integration request

Under the shared `crates/store/src/lib.rs` token, the coordinator must:

1. route every consequential root mutation through
   `register_or_replay_in_transaction_with_identity` (or an equivalent
   root-owned adapter) so semantic mutation, identity context, outcome, and
   redacted audit share one commit/rollback boundary;
2. preserve exact replay before re-running semantic policy or external side
   effects, and return the stored outcome/readback for the same operation ID;
3. migrate the initialization, claim, planning/hold, attempt, finish/close,
   service, and CLI parent-operation call sites, including rejected and
   unknown outcomes;
4. rerun combined-tree store, application/service, native race/unknown,
   project-isolation, and release checks after integration.

The standalone seam is not an acceptance shortcut. Existing failed review,
attempt, and test evidence remains preserved in attempts 1 and 2.

## Reviewer request

Please independently inspect the three changed source files and attempt-3
evidence, then verify the exact hashes and focused checks. Review the replay
transaction boundary, audit redaction/limits, project/epoch binding, and the
explicit shared-root integration gap. Accept only the bounded contribution if
those facts hold; do not mark PF-S02-T07 complete until the coordinator has
integrated and exercised all canonical production call sites.

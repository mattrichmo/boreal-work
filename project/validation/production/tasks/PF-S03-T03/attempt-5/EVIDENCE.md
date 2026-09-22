# PF-S03-T03 attempt 5 — coordinator-integration evidence

## Record and disposition

- Record: `PF-S03-T03 / attempt-5 / AC-09`.
- Evidence class: current-source inspection plus fresh pure-domain and public
  domain-boundary checks.
- Disposition: **prepared for fresh independent re-review; no acceptance is
  claimed**.
- Scope: the bounded PF-S03-T03 time-policy leaf only. Sprint, service,
  reconciliation, revalidation, native, publication, and release decisions
  remain outside this record.

Attempt 4 rejected only `PF-S03-T03-R5` and `PF-S03-T03-R6`: the existing
public `Attempt` API diverged from the corrected `time_policy` module for
expiry-reason selection and renewal candidate validation. The coordinator
correction is now present and the focused public-boundary regression passes.

## Exact coordinator changes inspected

The following changes were already in the shared dirty tree before this worker
started; this worker did not edit them.

### `crates/domain/src/lib.rs`

At the public `Attempt` boundary:

1. `Attempt::renew_lease` now computes `candidate = at.checked_add(lease_ttl_ms)`.
   It rejects `candidate <= at` and `candidate < self.lease_deadline` with the
   new typed `DomainError::InvalidLeaseRenewal`, leaving the attempt unchanged
   on rejection. A valid renewal still changes only the lease deadline; the
   immutable hard deadline remains untouched.
2. `Attempt::expiry_reason` no longer returns hard-budget expiry merely because
   the phase is `ExpiryPending` or `Expired`. It selects
   `HardBudgetElapsed` when the hard deadline has elapsed, then
   `LeaseElapsed` when only the lease deadline has elapsed, otherwise `None`.
   `DeadlineView` therefore no longer manufactures a phase-only hard-budget
   reason.
3. `DomainError::InvalidLeaseRenewal` and its display string
   `invalid_lease_renewal` are part of the public error surface.

The current shared file also contains pre-existing broader v2 integration
changes (module registrations and status-evaluator extraction). They are not
new claims in this evidence; the bounded attempt-5 correction is the
renewal/expiry public API alignment above.

### `crates/domain/tests/production_time_policy.rs`

The coordinator added
`public_attempt_api_matches_canonical_expiry_and_renewal_guards` (current
lines 251–272). It asserts:

- a live public attempt at its lease deadline reports `LeaseElapsed`;
- a phase-only `ExpiryPending` attempt whose deadlines are still future reports
  `None` rather than a manufactured hard-budget reason;
- a zero renewal returns `DomainError::InvalidLeaseRenewal` and does not move
  the lease deadline;
- a shortening renewal returns the same typed error and does not move the
  lease deadline.

### `crates/domain/src/time_policy.rs`

The canonical pure module is unchanged from the attempt-4 reviewed bytes
(`58ee17cd...`). Its already-present rules were revalidated here: earliest
deadline trigger selection, retained-reason/phase-only fail-closed behavior,
renewal candidate guards, expiry-review suppression, restart reconciliation,
and immutable hard budget.

## Finding-to-evidence mapping

| Prior finding | Current evidence |
| --- | --- |
| `PF-S03-T03-R5` — public phase/lease expiry reason diverged | The public regression passes for lease-only `LeaseElapsed` and phase-only `None`; current `lib.rs` removes the phase shortcut. The focused target reports 17/17 passed. |
| `PF-S03-T03-R6` — public renewal accepted zero/shortening candidates | The public regression passes for zero and shortening candidates, both rejected as `InvalidLeaseRenewal`, with the existing lease deadline unchanged. The focused target reports 17/17 passed. |
| Canonical R1–R4 corrections from attempt 3/4 | Full focused target still passes lease trigger, retained reason, timer suppression, restart suppression, historical clock, retry, schedule, and hard-budget vectors. |

## Fresh results

| Check | Result |
| --- | --- |
| Focused public time-policy target | `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture`; exit 0; 17 passed, 0 failed, 0 ignored. |
| Full `boreal-domain` package | `cargo test --locked -p boreal-domain`; exit 0; 104 package tests passed, 0 failed, 0 ignored; doc-tests 0/0. |
| Package test-target check | `cargo check --locked -p boreal-domain --tests`; exit 0. |
| Strict clippy | `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings`; exit 0, no warnings. |
| Rustfmt | `cargo fmt --all -- --check`; exit 0. |
| Diff whitespace check | `git diff --check`; exit 0. |

Tool identity: Darwin arm64, `rustc 1.85.0 (4d91de4e4 2025-02-17)`,
`cargo 1.85.0`, `rustfmt 1.8.0`.

## Current source identity

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/lib.rs` | `460b6e4dcd8e365b1318a32d9d11f80238418259550717e90d497ce25ced1bed` |
| `crates/domain/src/time_policy.rs` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` |
| `crates/domain/tests/production_time_policy.rs` | `31ba7ce120d547ffd86c6fa8eeaf7247b9cb84b6f86dde07b849ac7653508fe7` |

Source identity is `working-tree:codex/apply-responsive-terminal-overlay@784a41b3`
with unrelated dirty changes preserved. It is not a release identity.

## Residual pure-domain limits

This evidence proves deterministic Rust predicate behavior and the corrected
public `Attempt` API only. It does not prove:

- store transaction/revision ownership, durable recovery obligations, or
  persistence of the expiry trigger;
- service/API/CLI/TUI behavior, real lifecycle races, cross-process fencing,
  runtime stop acknowledgement, or native timer behavior;
- sealed submission, review, closeout, publication, packaging, or release
  behavior;
- acceptance of the task or any PF-S03 sprint gate.

The focused tests use controlled in-memory domain fixtures and direct Rust
calls. A fresh independent reviewer must inspect the exact current bytes and
run the required review/reconciliation/revalidation sequence. The read-only
Boreal workflow resolver was `service_busy`; no workflow receipt or lifecycle
decision is represented here.

# PF-S02-T07 — Attempt 5 start

- Task: `PF-S02-T07` — persist command registration, outcomes and audit atomically.
- Attempt: `attempt-5` corrective worker implementation.
- Started: 2026-09-22 America/Regina.
- Repository: `/Users/cybertron/Code/boreal-work`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Input HEAD: `b543d41008301f7745c899e95f5cb7203ca64917`.
- Worktree: dirty only from pre-existing untracked `memory/`; it is preserved.
- Worker scope: only `crates/store/src/operations.rs`, `crates/store/src/audit.rs`, `crates/store/tests/production_operation_audit.rs`, and this attempt directory.

## Context and prior-attempt disposition

The accepted PF-S02-T02 and PF-S02-T03 handoffs are bounded prerequisites. Attempts 1–4 are preserved. Attempt 2 rejected the standalone contribution because canonical store/application/CLI writers still bypassed identity-bound registration; attempt 4 accepted only the bounded seam and retained that integration finding. The current HEAD has a protected `crates/store/src/lib.rs` helper that uses the identity-bound append path for bound projects, but it does not yet call register-or-replay before every semantic mutation.

The execution adapter could not resolve its documented `bwrk workflows show` command in the installed v2 binary; this is recorded as a tooling limitation, not a plan-state mutation. The repository file-based dispatch instructions remain authoritative.

## Invariant for this attempt

One operation ID is an immutable, project/epoch-scoped request identity. The command, actor/session, expected revision, attempt/fence, target subject, and canonical request digest must match on replay. An exact retry returns the original stored outcome without running a second mutation or side effect. Busy/unknown outcomes remain non-terminal and readable. A semantic mutation, operation outcome, identity context, and redacted audit event share the caller-owned commit/rollback boundary; audit validation or persistence failure cannot be acknowledged as success. Readback is project-scoped, indexed by operation identity, bounded, and redacts credential-like details.

## Baseline checks before edits

- `cargo test --locked -p boreal-store --test production_operation_audit` — passed, 15 tests.
- `cargo test --locked -p boreal-store` — passed, all store targets; one release benchmark remained ignored by its test declaration.
- `cargo clippy --locked -p boreal-store --test production_operation_audit -- -D warnings` — blocked by the existing out-of-scope `crates/store/src/profiles.rs:505` `clippy::too_many_arguments` lint.

## Intended bounded correction

- Prevalidate schema-owned audit event/subject identities before any operation row is written.
- Add explicit transaction rollback coverage where a semantic target mutation accompanies a failed audit write.
- Add exact duplicate request, changed request digest, actor mismatch, and foreign-project replay/readback coverage through the register-or-replay seam.
- Keep canonical root call-site migration out of scope and submit a precise integration request for the protected `crates/store/src/lib.rs` path.

## Verification strategy

Run the focused operation/audit target, the full `boreal-store` package, changed-file formatting/diff checks, task-target Clippy (recording the existing profile lint), contract validation, and source/hash inspection. No service, crash-process, native, or release acceptance claim will be made from this bounded store attempt.

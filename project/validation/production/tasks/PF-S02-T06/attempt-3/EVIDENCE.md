# PF-S02-T06 — attempt 3 evidence

## Identity and scope

- Task: `PF-S02-T06`
- Attempt: `3`
- Input HEAD: `b543d41008301f7745c899e95f5cb7203ca64917`
- Branch: `codex/apply-responsive-terminal-overlay`
- Worker files after edits:
  - `crates/store/src/recovery.rs` — SHA-256 `5f7cd9b00fe5430eec9e089adeba0d10b26833f2578c5a97cf2f14cc4e600ad4`
  - `crates/store/src/jobs.rs` — SHA-256 `eb6b10356e8adf5c87dd9ed6ef0bbb6750fc4c83b7e537174c34d469bd16aa49`
  - `crates/store/tests/production_recovery_records.rs` — SHA-256 `826cc693a813ce430286760b6cf5b7895f3082ea65926c1876388318c1de146b`
- Evidence start marker — SHA-256 `4c7b94c90484f663600082f38360be975d8b08f9116c67ff5ae9d8282b1896b5`
- No protected root, plan ledger, schema manifest, manifest, application/service
  path, prior attempt, or live database was edited.

## Implemented behavior

1. External readback marking now accepts both `side_effect_started` and
   `side_effect_finished`, and an already-marked job with the same effect
   identity returns its original record. A changed side-effect identity is a
   conflict.
2. External side-effect and result digests are immutable once recorded.
   `committed`/`reconciled` transitions require a result digest, and
   `readback_required` requires an effect identity, preventing guessed success.
3. Resource reservations can only be created for a current attempt. Release
   requests and acknowledgements are idempotent readbacks when the event ID and
   actor/evidence identity match; a different request cannot replace a pending
   release or a completed acknowledgement.
4. Focused tests now cover retry-safe readback after a finished effect,
   release-pending ownership and acknowledgement replay, and a file-backed
   production reopen that retains an unresolved recovery obligation after the
   current attempt is terminal. The canonical expiry mutation test also
   verifies that recovery is recorded before the current-attempt pointer is
   cleared.

## Focused observations

The isolated real-SQLite target passed all 11 tests:

- clearing `current` leaves an unresolved obligation queryable;
- canonical expiry records recovery before clearing the current-attempt
  pointer;
- duplicate current work/session and live resource ownership are rejected;
- side-effect crash/readback remains non-committed and operation replay is
  idempotent;
- a finished-effect readback marker is retry-safe and effect identity cannot
  change;
- terminal recovery decisions remain readable;
- release-pending resources remain in the live-resource query until explicit
  acknowledgement, then acknowledgement replay is stable;
- unresolved recovery survives closing and reopening a production-schema file;
- recovery/job keyset queries enforce bounded limits and continuation;
- identity-bound recovery resolution remains revisioned, audited, fenced, and
  idempotent.

## Source and artifact limitations

The worker source is validated in a clean-head temporary tree because the
shared checkout has concurrent unrelated edits. The actual checkout's focused
test and strict clippy commands stop before T06 execution at the unrelated
`profiles.rs` compile/lint errors recorded in `COMMANDS.md`. The full isolated
store suite passes; strict isolated clippy still exposes a pre-existing
`profiles.rs` too-many-arguments warning, while clippy with that one unrelated
lint allowed passes.

No service process, verifier, Git, backup, update process, native package, or
external receipt was run. These are store/module tests, not service acceptance.

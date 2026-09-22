# PF-S02-T11 — attempt 2 start

## Scope

This bounded attempt evaluates and implements application-side admission and
readback seams for external verifier, memory publication, backup, and update
adapters. Production edits are limited to:

- `crates/application/src/runtime.rs`
- `crates/application/src/evidence.rs`
- `crates/memory/src/publisher.rs`
- `crates/cli/src/update.rs`
- `crates/application/tests/production_external_jobs.rs`
- this attempt directory

Store root, schema/migration, crate-root registration, service call sites,
plan state, manifest, prior evidence, and unrelated source remain outside the
grant. No adapter may fabricate a receipt, accepted proof, or successful
external effect. An uncertain side effect must remain readback-required until
an attributable store result reconciles it.

## Starting identity

Repository: `/Users/cybertron/Code/boreal-work`  
Branch: `codex/apply-responsive-terminal-overlay`  
Starting HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Worktree: dirty; existing user and coordinator changes are preserved.

## Inherited findings

PF-S02-T06 and PF-S02-T07 were independently rejected because the durable
job/recovery records are not wired through canonical lifecycle mutations and
many existing operation writes bypass the identity-bound journal. PF-S02-T11
attempt 1 confirmed that `Publisher` is embedded in protected
`crates/memory/src/lib.rs`, not the granted `publisher.rs` path, and that the
application evidence path has no transaction bundle joining evidence admission,
external-job state, operation identity, audit, and revision.

## Safe working rule

Only add code where the existing public store seams can preserve identity and
readback semantics within this grant. If a safe canonical seam does not exist,
leave that adapter unchanged and record the exact blocker in `EVIDENCE.md` and
`HANDOFF.md` rather than creating a disconnected second state machine.

## Verification intent

Run the focused external-job test if a real application/store seam can be
exercised, the existing application, memory, and CLI suites, formatting, and
`git diff --check`. Record exact source hashes, command outcomes, and an honest
`ready_for_review` or `blocked` disposition. Acceptance is not claimed by this
attempt.

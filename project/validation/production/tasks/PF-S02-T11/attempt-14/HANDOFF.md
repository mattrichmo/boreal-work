# PF-S02-T11 — attempt 14 handoff

## Status

**Ready for independent review with a bounded blocker.** Do not mark
PF-S02-T11 accepted and do not advance PF-S02 from this attempt alone.

## Changed paths

- `/Users/cybertron/Code/boreal-work/crates/application/src/evidence.rs`
- `/Users/cybertron/Code/boreal-work/crates/application/tests/production_external_jobs.rs`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T11/attempt-14/`

No plan/state files, protected store/service/memory paths, commit, or push were
changed by this attempt.

## Concrete result

Attempt 14 replaces replay-flag-based callback permission with a typed,
durable acquisition result. `start_acquisition` is the only path that can
return `Won`; it atomically attempts `admitted -> running`, re-reads a
transition conflict, and classifies the losing caller without granting it
external-effect authority. `execute` invokes its callback only for `Won`.

The new file-backed concurrent regression launches two independent SQLite
connections against one pre-admitted job and asserts exactly one callback/effect
under competing callers. The sequential running-replay regression and the
existing identity, restart, pending, rejection, readback, and digest tests are
retained.

## Checks

Passed: owned rustfmt, owned diff check, contract validation, and the full
memory crate test set (31 tests plus doc-tests).

The required application, CLI, and store checks could not reach this code. The
combined tree currently fails in protected code because
`crates/store/src/status_evaluation.rs:146` does not initialize the newly
required `StatusContext.activation_at` and `StatusContext.schedule` fields.
The full format check also reports unrelated concurrent drift in domain/store
files. Exact commands and output are in `COMMANDS.md`.

## Independent review focus

Reviewers should inspect that:

- only `Won` reaches the external callback;
- a transition conflict is re-read before classification;
- terminal/readback states cannot be retried;
- the compatibility `start` wrapper does not grant callback authority;
- the concurrent test uses separate connections and proves one effect;
- public identity, pending/unknown, timeout/cancellation and bounded payload
  semantics remain unchanged.

## Next safe action

The coordinator/protected store integration steward must reconcile the
`StatusContext` initializer, then rerun the blocked commands on the exact
combined source. A separate reviewer must inspect this attempt and the
protected integration requests before any ledger change. The canonical
verifier, recovery, memory, update, and backup call sites remain open and are
not claimed by this attempt.

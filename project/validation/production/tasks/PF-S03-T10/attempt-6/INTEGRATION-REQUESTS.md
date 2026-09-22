# PF-S03-T10 — attempt 6 integration requests

This attempt intentionally stops at the granted pure-domain boundary. These
requests are proposals for the named integration stewards; they are not
implemented here and do not authorize a plan/state change.

## IR-1 — Wire the new status inputs through protected readers

**Owner:** PF-S02 store/application integration steward.

The domain `StatusContext` now has two canonical optional inputs:

- `schedule: Option<WorkSchedule>` for a work row's `not_before_at` gate;
- `activation_at: Option<TimestampMs>` for a resolved cycle/assignment
  activation instant.

The following protected direct struct literals must be reconciled before the
workspace compiles:

- `crates/store/src/status_evaluation.rs:146`
- `crates/application/src/status.rs:291`

The steward must source these values from canonical snapshot/projection facts,
not from TUI labels or a default fabricated timestamp. If the current reader
does not yet have the v3 schedule/assignment facts, it must pass `None`, record
that status/3 activation is unavailable for that read, and add the appropriate
compatibility/integrity diagnostic. It must not silently treat a future
constraint as ready.

Required checks after integration:

1. fresh store/application compilation and tests;
2. a future `not_before_at` and future explicit assignment activation both
   produce domain `scheduled` at `< instant`, and become eligible at equality;
3. status/2 adapters project `scheduled` as `queued` with the stable
   `scheduled_start` compatibility reason and continue to deny claim;
4. due dates remain badges/timers and never block a claim;
5. terminal, hold, expiry, pause, retry, and dependency precedence remains
   unchanged across store/application readers.

## IR-2 — Reconcile status/2 adapter mapping

**Owner:** protocol/service interface steward; no adapter files were touched by
this attempt.

`DerivedStatus::Scheduled` is a status/3 domain value. Existing status/2
envelopes must map it to `queued` plus `scheduled_start` and preserve the
no-claim decision. The mapping belongs in the versioned adapter/protocol
boundary, not in this domain crate and not in the TUI. Add capability-aware
readback tests for both status versions, including exact start equality.

## IR-3 — Contract acceptance dependency

The source artifact `project/spec/production/status-and-actions.md` still
labels `boreal.work-status/3` as a proposed PF-S01-T05 artifact. Attempt 6
implements its explicitly requested additive domain semantics without editing
that contract file. PF-S01 contract ownership and the applicable independent
review must either accept the artifact or record a versioned amendment before
this task can be accepted as a production contract change.

## Evidence limitation

No store/service/protocol behavior is claimed by this attempt. The workspace
check is expected to remain blocked until IR-1 is integrated. The exact
command and compiler diagnostic are recorded in `COMMANDS.md` and
`EVIDENCE.md`.

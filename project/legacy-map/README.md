# P0-04 legacy-to-v2 mapping

Owner: S00 legacy mapper. Read-only inspection of representative v1 files,
records, command registry, and tests; never use `bwrk` to mutate live state.
For each behavior or record shape, capture source path/version, observed
meaning, v2 target, `keep|rework|defer|historical_only|unsupported`, loss or
user-impact risk, and a migration/validation fixture.

Prioritize statuses and dependency edges (`verified`/`cancelled` legacy
satisfaction), reservations and expiry, attempts/assignments, failed and
passed evidence, closeout gates/summaries, raw/source/wiki/decision/context,
CLI aliases, Git refs, and no-goal guidance. Unknown state is explicit
operator review, not guessed success. The required inventory is in
[P0 vertical handoff](../build-plan/verticals/00-contracts-baseline.md) and
[S00](../../milestones/M01-v2-product/sprints/S00-contracts/SPRINT.md).

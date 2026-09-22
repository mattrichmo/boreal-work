# PF-S03-T10 — attempt 5 evidence

## Exact source and artifact binding

The oracle now reads `PF-S03-T10-ORACLE-SOURCE.md`, verifies the current Git
`HEAD` with `git rev-parse HEAD`, and computes SHA-256 over the actual included
bytes for these normative artifacts:

- `project/spec/production/contract-manifest.json`
- `project/spec/production/status-and-actions.md`
- `project/spec/transition-table.md`
- `project/spec/production/reason-registry.json`

The test also checks the accepted status/3 and transition contract identifiers
in the actual artifacts. This replaces the previous test behavior that only
compared duplicated literals and marker strings.

## Pure-domain behavior covered by the final target

- deterministic generated status decisions, ordering, idempotence and
  serialized shrinking/replay;
- terminal, expiry, hold, proof, review, pause, retry, prerequisite and ready
  precedence;
- schedule availability boundaries and fail-closed compatible queued claim
  behavior;
- availability and integrity action allow/deny behavior;
- actor-specific actions, stale revision/proof/fence denials and recovery
  routes;
- lifecycle and attempt transition matrices, close readiness, dependency
  satisfaction/cycles, receipt subjects, independent review, and historical
  submission/review/attempt/reopen invariance;
- normative T01–T18 and I01–I15 crosswalk presence and pure-domain anchors,
  with service-only boundaries explicitly retained rather than represented by
  fabricated domain behavior.

## Bounded blockers / findings

The accepted `boreal.work-status/3` artifact specifies a distinct
`scheduled` product status and `scheduled_start` reason. The current pure
domain source exposes `ScheduleDecision::scheduled` and the compatible queued
fail-closed behavior, but it does not define `DerivedStatus::Scheduled` or
`ReasonCode::ScheduledStart`. A test-only change cannot make the public status
contract executable without changing production domain API/policy files,
which are outside this attempt's grant. The exact request is recorded in
`project/validation/production/domain/PF-S03-T10-ORACLE-SOURCE.md`.

The attempt therefore proves the available pure schedule primitive and refuses
to claim the missing status enum. It is ready for independent review with this
finding unresolved; it is not task, sprint, or release acceptance.

The T/I crosswalk is complete as an inventory and retains pure-domain anchors,
but it is not yet an independent semantic assertion for every individual
legal/illegal ID. T18 and I14 are service-only boundaries, and some pure rows
share one domain anchor. A reviewer must either add per-vector assertions where
the domain API supports them or explicitly narrow the crosswalk claims; this
attempt does not convert shared anchors into false service evidence.

## Negative evidence boundaries

These checks do not prove store transactions, service authentication,
operation replay, real verifier execution, durable recovery, migration,
installation, platform release, or T90/T91/T92 acceptance. No such claim is
made here.

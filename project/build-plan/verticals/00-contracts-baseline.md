# Vertical 00 — decisions, contracts, and baseline

Task IDs: P0-01–P0-07. This is the entry gate for all implementation. Read
the [v2 project packet](../../README.md), [decision record](../../DECISIONS.md),
[portable audit baseline](../../AUDIT_BASELINE.md), and
[task graph](../TASK_INDEX.md). Use the [CLI keep contract](../../CLI_COMMANDS.md)
as the command-path and purpose inventory, and
[status model](../../STATUS_MODEL.md) as the conditional-state contract.

## Outcome and ownership

Future agents receive stable typed contracts, representative fixtures, and
measured legacy behavior. They do not need to choose memory authority,
attempt semantics, conditional statuses, trusted directive behavior, JSON
shape, or migration rules while implementing a leaf.

Own `project/spec/`, `project/legacy-map/`, `project/build-plan/baseline/`, and
decision/fixture documents. Do not change v2 persisted code or live v1
`.boreal` state in this phase. One architecture steward integrates the spec;
legacy and benchmark analysts can work on disjoint fixtures in parallel.

## Ordered tasks

1. **P0-01 decisions:** Record same-host launch scope, memory publication
   authority and Git branch/worktree policy, service startup/offline policy,
   supported platforms, actor/publisher permissions, completion evidence
   policy, and one-current-attempt rule. Each decision names an alternative,
   reason, affected schema/protocol, and owner. Unsettled policies are explicit
   blockers, not hidden defaults.
2. **P0-02 baseline:** On a pinned v1 fixture, reproduce the reported
   read/write contention, response sizes, lifecycle drift, evidence matching,
   no-goal guide/next and agent-finish call counts, contextual payload size,
   and repair behavior where safe. Capture command startup, compatibility,
   lock wait/hold, replay, serialization, payload bytes, retries, and
   lifecycle timestamps. Mark hypotheses not reproduced; never break a live
   lock or alter the user's current project to make a benchmark run.
3. **P0-03 contracts:** Freeze work kinds/statuses, parent rules, dependency
   direction, eligibility, attempt/session/fence transitions, operation
   idempotency, receipt fields, SQLite schema, audit/revision contract,
   versioned JSON envelopes, status/list/guide DTOs, trusted directive
   registry/gap fixtures, core workflow asset schema (refs, allowed commands,
   typed inputs, finish criteria, and next refs), exact-action trust rules,
   typed error codes, and the CLI grammar/alias/output contract for the kept
   paths. Do not silently repurpose v1 `status` or invent a v1 `task`,
   `milestone`, or `memory` namespace. Distinguish normal `queued` prerequisites
   from hard `blocked` intervention, technical `complete` from accepted
   `closed`, and expired attempts from open work. Specify close-intent
   auto-finalization, lease versus hard time limit, default dependency
   satisfaction, and expiry review with a virtual clock. Add
   success, empty, conflict, busy, stale, invalid, service-unavailable, and
   unknown-outcome fixtures. Include no-goal, active-attempt, dependency
   blocked, operator-only, paused, open-gate, finish-ready, and idle guidance
   fixtures, plus source and Git-memory manifest schemas.
4. **P0-04 migration inventory:** Inspect representative v1 object/file
   snapshots and define mapping for work, graph, reservations, evidence,
   history, raw sources, notes, decisions, Git refs, directive registry,
   guide/next actions, claim/start/finish behavior, and canonical workflow
   assets. Give every current command in the CLI keep contract a path/use-case
   fixture; give the other used v1 commands an explicit parity disposition.
   Distinguish preserved, reworked, deferred, historical-only, and
   unsupported records or behaviors. Report loss and parity risks.
5. **P0-05 independent review:** Reviewer checks schema constraints, failure
   boundaries, migration coverage, multi-harness behavior, memory authority,
   whether every proposed conditional status is derivable from canonical
   data, and whether a no-goal agent can still follow trusted guidance.
6. **P0-06 reconciliation:** Resolve every review finding or record a named
   no-change/deferral with owner and follow-up. Update affected fixtures,
   decisions, task dependencies, and docs.
7. **P0-07 revalidation:** Parse schema/protocol/guidance fixtures, check their
   examples against the state-transition table, review the migration/parity
   matrix, and rerun
   the affected baseline/review checks. Only then unlock P1.

## Required artifacts

- `project/spec/transition-table.md`
- `project/spec/schema-v2.sql` or an equivalent migration spec
- `project/spec/protocol/*.json` examples plus a version/error registry
- `project/spec/guidance/*.json` for conditional states, registry-selected
  directives, safe argv, blocked/recovery, and no-goal/idle outcomes
- `project/spec/workflows/*.json` for packaged core routes, version/ref
  validation, typed inputs, allowed commands, and finish criteria
- `project/spec/memory-manifest.*` and source-version examples
- `project/legacy-map/RECORD_MAPPING.md` and workflow-parity inventory with
  fixture manifest
- `project/build-plan/baseline/` measurement method and reproducible results
- Updated [`../../DECISIONS.md`](../../DECISIONS.md) and a findings ledger

These names are planned outputs, not files that already exist. Keep the
contract compact enough to implement; defer speculative graph, user-authored
workflow packs, knowledge, and cross-project types. Do **not** defer the
trusted core guidance and claim/evidence/finish loop.

## Acceptance and handoff

P0 ends when every persisted/transport field has one owner and version,
every state transition has a legal/illegal fixture, legacy baseline limits are
explicit, and an independent reviewer has reconciled findings. Handoff names
the exact fixture revision, unsupported v1 records, unresolved decisions,
measurement gaps, and next ready P1 leaves. If the v1 toolchain cannot be
pinned safely, record the missing baseline data and its effect on future
speedup claims rather than improvising a live upgrade.

# PF-S03-T01 independent review — attempt 2 evidence

## Decision and evidence class

**Decision: ACCEPTED for the PF-S03-T01 typed decision-input artifact and its
integrated public domain boundary only.** This is an independent review
recommendation/record for the leaf boundary; it is not a coordinator ledger
mutation and is not acceptance of PF-S03, service/runtime, native,
publication, or release behavior.

- Task / attempt: `PF-S03-T01` / `attempt-2`
- Evidence class: pure domain source, public-boundary integration, and focused
  deterministic tests
- Reviewer: independent reviewer; did not implement PF-S03-T01
- Worker evidence preserved: `attempt-1/COMMANDS.md`, `attempt-1/EVIDENCE.md`,
  and `attempt-1/HANDOFF.md`
- Input/final source: dirty combined tree at
  `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`; branch
  `codex/apply-responsive-terminal-overlay`
- Contract manifest SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`
- PF-S01-T92 gate: `project/validation/production/sprints/PF-S01/gate.json`,
  attempt 3, decision `accepted`, scope `AC-01` only

## Contract and source findings

No new review finding blocks this bounded decision.

1. `crates/domain/src/decision_inputs.rs:104-184` supplies distinct entity,
   proof, attempt/fence, profile, and proof-context identities. The test at
   `production_decision_inputs.rs:115-128` confirms equal numeric values do not
   become interchangeable typed identities.
2. `decision_inputs.rs:329-416` keeps present, absent, unreadable, stale, and
   failed facts distinct, with typed diagnostics and required versus allowed
   absence. The focused tests at lines 132-190 cover these paths and confirm
   required absence blocks without fabricating a lifecycle.
3. `decision_inputs.rs:187-203` carries the injected evaluation and next-change
   timestamps. The valid-builder test confirms both values are preserved.
4. `decision_inputs.rs:449-730` models actor authority, pinned requirements,
   dependency outcomes, holds, execution, submissions, reviews, and recovery;
   `DecisionInputs::diagnostics/validate` at lines 806-876 reports
   contradictory, cross-project, duplicate, malformed, proof-binding,
   self-review, recovery, integrity, and action-conflict conditions.
5. `decision_inputs.rs:567-639` keeps integrity scope/level and permitted or
   denied actions as domain inputs independent of transport availability. The
   focused test changes availability to `Unavailable` while validating the
   integrity/action inputs successfully.
6. The module imports only domain value types and `std` collections/formatting;
   it has no store, service, process, terminal, JSON, or transport dependency.
   `crates/domain/src/lib.rs:9` registers it publicly, and the focused test
   imports it through that public boundary at line 11.

The worker's source-path shim limitation is therefore resolved by the
coordinator's additive `lib.rs` registration and public-test update, as
recorded in the preserved attempt-1 coordinator integration record. No
worker history was rewritten.

## Fresh command evidence

All commands, CWDs, exit codes, source identity, and raw result summaries are
in `COMMANDS.md`. The decisive results are:

| Acceptance area | Result |
| --- | --- |
| Workspace formatting | `cargo fmt --all -- --check` passed, exit `0`. |
| Domain compile | `cargo check --locked -p boreal-domain` passed, exit `0`. |
| Domain test-target check | `cargo check --locked -p boreal-domain --tests` passed, exit `0`. |
| Focused public test | `10 passed, 0 failed`, exit `0`. |
| Full domain package | `53 passed, 0 failed`, `0` doc tests, exit `0`. |
| Strict clippy | Exit `101` only for pre-existing protected `status_evaluator.rs:75-77` `filter-map-bool-then`. |
| Scoped clippy rerun | Exit `0` with only `-A clippy::filter-map-bool-then`. |

## Limitations and authority boundary

- Strict clippy remains limited by the pre-existing warning in protected
  `crates/domain/src/status_evaluator.rs:75-77`. This review did not edit that
  file and does not claim the warning is fixed.
- Read-only Boreal workflow resolution returned typed `service_busy` because a
  live local database owner already held the lock. No live lock was broken and
  no application-owned review/finish/close action was inferred.
- The current coordinator `STATE.json` digest differs from the historical
  PF-S01-T92 review-time digest because the ledger has since changed; the
  accepted T92 gate remains read as AC-01-only historical prerequisite. No
  state or plan file was edited.
- These are pure-domain and public-boundary results. No service/runtime,
  database migration, genuine verifier, race/fault, TUI, native, installer,
  publication, performance, signing, or release evidence was run or claimed.

## Artifact digests

- `crates/domain/src/lib.rs`: `a58a91d074a5d7f7a69cff6f8736fc11fa6440509be5149865390f4f20ed428e`
- `crates/domain/src/decision_inputs.rs`: `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d`
- `crates/domain/tests/production_decision_inputs.rs`: `b6f093098c603f34a12cc571df00c1b4c0d308395c6536fffbd93a34a8df64d8`
- Preserved worker `attempt-1/HANDOFF.md`: `38c6278621e6e68f27d7999841d86a67347a8396a01db878bd22374e54ec9960`
- Preserved worker `attempt-1/EVIDENCE.md`: `c4498c55d4caf8ceacd31d031ec617369ba65ed4f569f902feef972c91102c08`

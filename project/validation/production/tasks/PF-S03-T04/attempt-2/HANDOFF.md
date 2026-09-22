# PF-S03-T04 attempt 2 — independent validation handoff

## Identity and decision

- Task / plan / attempt: `PF-S03-T04` / production-completion plan / `attempt-2`.
- Reviewer: Codex independent validation reviewer.
- Source: HEAD `784a41b3802c29a76721c55eef2e9493283396c2`, branch `codex/apply-responsive-terminal-overlay`, dirty combined tree.
- Decision: **rejected** for PF-S03-T04 only.
- Acceptance state requested: `rejected` / reconciliation required; no coordinator ledger was edited.
- Fresh checks: format, domain test-target check, focused tests, full domain tests, and strict focused/library clippy all passed.

The decision is attributable to the reviewer named above and is limited to
the bounded requirement/evidence/review interpretation leaf. It does not
accept or reject PF-S03 as a sprint and makes no service, native, publication,
or release claim.

## Findings requiring reconciliation

1. **F-PF-S03-T04-01 (P1): invalidated exact proof can shadow valid proof.**
   Evidence is sorted by recency at `crates/domain/src/acceptance.rs:804-818`
   and the last candidate is interpreted for `Superseded`, `Late`, or
   `Revoked` disposition only afterward at `:839-873`. The production contract
   requires exclusion from authoritative recency before choosing the newest
   valid observation. Add superseded/late/revoked-over-valid regressions while
   retaining their historical diagnostics.
2. **F-PF-S03-T04-02 (P1): review selection is not bound to a sealed
   submission.** `ReviewDecision.submission_id` exists at
   `crates/domain/src/acceptance.rs:273-284`, but selection at `:961-980`
   compares only requirement and proof subject. Bind reviews to the expected
   current submission and add a regression preventing another submission's
   newer approval from satisfying the current requirement.

These findings are source-level defects in the PF-S03-T04 interpretation
slice, not failures of the fresh compilation/test commands.

## Integrated boundary and changed paths

The reviewed public boundary is integrated at `crates/domain/src/lib.rs:9`
(`pub mod acceptance;`), and the focused test imports the public module.
This review wrote only:

- `project/validation/production/tasks/PF-S03-T04/attempt-2/START.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-2/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-2/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-2/HANDOFF.md`

No product source, `STATE.json`, prior evidence, unrelated file, or
coordinator record was changed. The worker attempt-1 evidence and the accepted
PF-S03-T01 handoff remain preserved.

## Exact reviewed identities

- `crates/domain/src/acceptance.rs`: `cc1f3e25fc1b5399c592aa793bf1ca70cc37f46a86b5c85bd8db525637bc5ffd`.
- `crates/domain/tests/production_acceptance_policy.rs`: `6aa0a3bf8178107e88b2a1d39fa9571814a3758f87d1993776d5a8931a702ff4`.
- `crates/domain/src/lib.rs`: `6f75fcd37496dbff5bc0d5a51b593696781f47818a44edffcd8617d6ef4f78b2`.
- `crates/domain/src/decision_inputs.rs`: `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d`.
- PF-S03-T04 card: `cda28b913779aaf8e8e36159548e46872cdc832c32c5122c37bc11d3acee5a12`.
- Accepted PF-S03-T01 handoff: `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
- Acceptance/proof contract: `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245`.
- Contract manifest: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.

## Next safe action

The coordinator should preserve this rejected review, route both findings to
bounded PF-S03-T04 reconciliation, then assign exact-tree revalidation after
the corrections. No dependent task or sprint is authorized by this handoff.

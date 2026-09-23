# PF-S03-T08 — attempt 5 evidence

## Record and source identity

- Evidence class: source-bound pure-domain property, differential, and
  exhaustive transition evidence.
- Exact source subject: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Source record:
  `project/validation/production/domain/PF-S03-T08-ORACLE-SOURCE.md`.
- Oracle description:
  `project/validation/production/domain/PF-S03-T08-ORACLE.md`.
- Bound policy identities: `boreal.work-status/3` and
  `boreal.work-transition/2`.
- Fixture revision: `m02-candidate.1`.

The focused executable target verifies the committed `HEAD`, the four
normative contract artifacts, the six domain implementation files, the
production property target, and the T08 oracle document against the hashes in
the source record. The final run passed all of those identity checks.

## Coverage and results

- Four deterministic LCG seeds generate 1,024 status cases with repeat,
  permutation, reason-ordering, and shrink/replay assertions.
- Normative status, action, transition, dependency, deadline, review,
  receipt, availability, integrity, stale-fence, and history invariants are
  covered by the executable vectors.
- Every legal `T01`–`T18` and illegal `I01`–`I15` row is checked against the
  normative transition table; service-only persistence rows remain explicitly
  bounded rather than simulated.
- The focused oracle passed 23/23 tests.
- The complete boreal-domain suite passed 139 tests, with no failures and no
  doc-test failures.
- Strict domain Clippy, contract validation, workspace formatting, and diff
  checks passed.

## Preserved failure history

The first focused run after rebinding exited 101 because the owned oracle
document had been edited after its digest was first recorded. That is the
intended fail-closed behavior of the source binding. The recorded digest was
corrected in the T08 source record, and the final focused run passed without
changing executable assertions or weakening any contract check.

## Layer boundary

This evidence establishes only deterministic pure-domain behavior and exact
source/artifact identity. It does not establish:

- application/store/service integration of action descriptors;
- authenticated actor ownership or delegation;
- durable recovery-obligation projection after expiry;
- preservation of rejected-review state in the public status projection;
- row-scoped quarantine for malformed gate, receipt, review, or summary rows;
- status/2 expiry compatibility behavior through the shipped CLI/TUI;
- operation replay/readback, SQLite transaction behavior, or real verifier
  execution;
- native process/resource recovery, installation, or release qualification.

Those boundaries remain open findings for PF-S03-T90/T91/T92 and the linked
application, store, service, TUI, and release tasks. This attempt does not
claim PF-S03 integration acceptance.

## Remaining P1 integration findings

The independent PF-S03 review at the current source identity reports these
must-have integration findings:

1. `evaluate_actions()` is not wired through application/store/service paths;
   the TUI still computes action availability independently.
2. Rejected review can still project as open/missing proof rather than a typed
   reconciliation intervention.
3. Recovery obligations are enforced during claim but are absent from the
   status snapshot after current-attempt cleanup.
4. Malformed project-wide gate, receipt, review, or summary rows can still
   abort the whole snapshot instead of quarantining only the affected row.
5. The status/2 compatibility mapping does not yet implement the specified
   `expired_review` compatibility behavior.
6. Actor identity is caller-selected at the service boundary; durable role
   lookup is not proof of caller authentication.
7. Container status remains a provisional planning label, not a complete
   descendant rollup.

These are intentionally recorded, not hidden behind the pure-domain pass.

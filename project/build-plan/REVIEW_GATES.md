# Reviews, findings, reconciliation, and advancement gates

This plan uses the granular planning mode. Each phase review or validation can
produce findings. A finding-producing step is never the final prerequisite
for the next phase: review/check -> reconcile findings and update artifacts ->
revalidate -> advance. A pass with no findings still has an explicit
`no_findings` disposition. A revalidation failure returns to reconciliation
and reruns affected checks; it does not advance the phase.

## Finding record

Every review, critique, fault test, migration probe, benchmark, or security
check records:

```text
finding_id
source_task_id and inspected artifact/source revision
severity: blocker | major | minor | observation
behavior and reproduction
affected invariant / user outcome
disposition: fixed | no_change | deferred
owner and follow-up task for deferrals
changed code/schema/protocol/docs/work records
checks to rerun
```

Do not narrow acceptance criteria, erase failed evidence, or call a scoped
check a full release pass to make a gate green. If a finding lies outside the
current leaf, create explicit follow-up work and a dependency if it blocks
safe advancement.

## Phase gates

| Phase | Finding producer | Reconciliation | Revalidation | Advances to |
| --- | --- | --- | --- | --- |
| P0 contracts | P0-05 | P0-06 | P0-07 | P1 implementation |
| P1 domain/store | P1-07 | P1-08 | P1-09 | P2 runtime |
| P2 runtime/protocol | P2-07 | P2-08 | P2-09 | P3 memory and P4 API client |
| P3 source/memory | P3-07 | P3-08 | P3-09 | P4 migration and release integration |
| P4 UI/migration | P4-07 | P4-08 | P4-09 | P5 load/release checks |
| P5 release | P5-05 | P5-06 | P5-07 | P5-08 cutover decision |

The integration owner verifies that all leaf acceptance evidence is linked,
the phase reviewer is independent of the implementation where practical,
and the revalidation uses the updated artifact/source snapshot. Before
advancement the owner records `pass`, `blocked`, or `approved_deferral` with
the exact reasons and owners. Integrity/security blockers cannot be approved
away by changing a UI label or test fixture.

## Required phase evidence

- **P0:** frozen decisions, conditional state transition table, schema/JSON/
  guidance fixtures, v1 failure/baseline and workflow-parity matrix,
  migration inventory, review disposition.
- **P1:** domain/property tests, schema constraints, transaction/crash tests,
  read snapshot and count checks, review disposition.
- **P2:** competing claimers, duplicate operations, stale attempt fencing,
  service restart, compact status, manual adoption, trusted directive/next
  action fixtures, no-goal multi-harness claim/evidence/finish transcripts,
  and review disposition.
- **P3:** source/version citations, parser failure retention, Git publication
  recovery, fresh-clone import, stable doctor/repair, review disposition.
- **P4:** mounted TUI action checks, core canonical workflow and v1 parity
  matrix, actual no-goal create/finish/handoff walkthrough, dry-run import,
  clean install/update/rollback, docs commands, review disposition.
- **P5:** measured concurrency and calls-per-useful-transition, fault matrix,
  security boundaries, full suite, no-goal workflow parity, supported-platform
  and standalone-checkout proof, final disposition.

The legacy `bwrk doctor --strict` is not a v2 release gate. V2 needs its own
doctor once implemented. The unhealthy legacy workspace is used only through
read-only fixtures until its toolchain is reconciled by an explicitly scoped
legacy maintenance task.

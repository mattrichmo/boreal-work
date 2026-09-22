# PF-S01 reconciliation — PF-S01-T91 attempt 2

## Status and authority

**Status: accepted at PF-S01-T91's bounded provenance-remediation layer.**
This is a coordinator-owned, bounded provenance remediation. It does not accept
PF-S01-T90, PF-S01, PF-S01-T92, or any successor gate, and it makes no product,
runtime, service, native, publication, or release claim.

The input is PF-S01-T90 attempt 7, whose three findings are preserved in
`project/validation/production/sprints/PF-S01/findings.json` and
`project/validation/production/tasks/PF-S01-T90/attempt-7/`. PF-S01-T91
attempt 1 remains unchanged historical evidence; its `no_change` result
predates the attempt-7 findings and is superseded only for this reconciliation.

The observed source is `HEAD 784a41b3802c29a76721c55eef2e9493283396c2` on
`codex/apply-responsive-terminal-overlay` with a dirty worktree. The current
contract-manifest digest is
`131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
No contract-manifest bytes are changed by this attempt.

## Finding dispositions

| Finding | Severity | Disposition | Bounded action | Current gate effect |
| --- | --- | --- | --- | --- |
| `PF-S01-T90-7-001` accepted T11 source identity drift | blocker | `fixed_by_coordinator_state_only_correction` | T11 accepted-source now binds the exact current manifest digest; the manifest bytes were not edited, and the stale digest remains historical. | Verified by valid state readback; T90/T92/product gates remain separate. |
| `PF-S01-T90-7-002` 21 accepted task/attempt pointers bind `START.md` | blocker | `fixed_by_coordinator_handoff_pointer_correction` | Ten accepted task-level T02–T11 slots and eleven accepted-attempt T01–T11 slots now resolve to complete `HANDOFF.md` records. Every `START.md` and prior attempt remains preserved. | Verified by the 21-pointer assertion; T90/T92/product gates remain separate. |
| `PF-S01-T90-7-003` stale T01 attempt-2 handoff text | major | `fixed_by_preserving_history_and_using_superseding_attempt_3` | T01 attempt-2 remains unchanged historical text. The task-level accepted pointer and coordinator attempt-3 record use `PF-S01-T01/attempt-3/HANDOFF.md`. | Verified by T01 content/hash/state readback; T90/T92/product gates remain separate. |

These dispositions are accepted only at T91's provenance-remediation layer.
The coordinator applied the state-only corrections, the ledger parses as valid
JSON, and the post-correction reruns below pass on the exact combined tree.
They are not T90 acceptance, T92 acceptance, product acceptance, or release
acceptance.

## Exact pointer repair set

T90 recorded 21 broken accepted pointers: ten task-level pointers for T02–T11
and eleven accepted-attempt pointers for T01–T11. The required targets are:

### Ten accepted task-level slots

| Task | Required `handoff` target |
| --- | --- |
| `PF-S01-T02` | `project/validation/production/tasks/PF-S01-T02/attempt-2/HANDOFF.md` |
| `PF-S01-T03` | `project/validation/production/tasks/PF-S01-T03/attempt-2/HANDOFF.md` |
| `PF-S01-T04` | `project/validation/production/tasks/PF-S01-T04/attempt-2/HANDOFF.md` |
| `PF-S01-T05` | `project/validation/production/tasks/PF-S01-T05/attempt-2/HANDOFF.md` |
| `PF-S01-T06` | `project/validation/production/tasks/PF-S01-T06/attempt-2/HANDOFF.md` |
| `PF-S01-T07` | `project/validation/production/tasks/PF-S01-T07/attempt-1/HANDOFF.md` |
| `PF-S01-T08` | `project/validation/production/tasks/PF-S01-T08/attempt-1/HANDOFF.md` |
| `PF-S01-T09` | `project/validation/production/tasks/PF-S01-T09/attempt-2/HANDOFF.md` |
| `PF-S01-T10` | `project/validation/production/tasks/PF-S01-T10/attempt-1/HANDOFF.md` |
| `PF-S01-T11` | `project/validation/production/tasks/PF-S01-T11/attempt-2/HANDOFF.md` |

The accepted task-level T01 record must continue to use the superseding
`project/validation/production/tasks/PF-S01-T01/attempt-3/HANDOFF.md`.

### Eleven accepted-attempt slots

| Accepted task | Required canonical attempt handoff |
| --- | --- |
| `PF-S01-T01` | `project/validation/production/tasks/PF-S01-T01/attempt-2/HANDOFF.md` |
| `PF-S01-T02` | `project/validation/production/tasks/PF-S01-T02/attempt-2/HANDOFF.md` |
| `PF-S01-T03` | `project/validation/production/tasks/PF-S01-T03/attempt-2/HANDOFF.md` |
| `PF-S01-T04` | `project/validation/production/tasks/PF-S01-T04/attempt-2/HANDOFF.md` |
| `PF-S01-T05` | `project/validation/production/tasks/PF-S01-T05/attempt-2/HANDOFF.md` |
| `PF-S01-T06` | `project/validation/production/tasks/PF-S01-T06/attempt-2/HANDOFF.md` |
| `PF-S01-T07` | `project/validation/production/tasks/PF-S01-T07/attempt-1/HANDOFF.md` |
| `PF-S01-T08` | `project/validation/production/tasks/PF-S01-T08/attempt-1/HANDOFF.md` |
| `PF-S01-T09` | `project/validation/production/tasks/PF-S01-T09/attempt-2/HANDOFF.md` |
| `PF-S01-T10` | `project/validation/production/tasks/PF-S01-T10/attempt-1/HANDOFF.md` |
| `PF-S01-T11` | `project/validation/production/tasks/PF-S01-T11/attempt-2/HANDOFF.md` |

The T01 attempt-2 handoff is the repaired accepted-attempt pointer and remains
preserved historical text. Separately, the task-level accepted pointer and the
new coordinator attempt-3 record select
`project/validation/production/tasks/PF-S01-T01/attempt-3/HANDOFF.md` as the
superseding prerequisite handoff. No historical file is deleted, rewritten, or
relabeled.

## Coordinator correction order

1. Preserve the T90 finding record, T90 attempt-7 evidence, T91 attempt-1
   reconciliation, T01 attempt-2 handoff, and all `START.md` records.
2. In coordinator state only, bind T11's accepted source to the exact current
   contract-manifest digest. The stale T90-observed digest
   `dcb757903063fd1aef64f910ebc3f1a5c6fa01990c38bb955f1901aa644fad99` remains
   historical evidence; it is not silently erased.
3. In coordinator state only, repair the 21 accepted pointer slots above to
   `HANDOFF.md`, using T01 attempt 3 as the superseding accepted record.
4. Ensure the coordinator ledger is valid JSON and read back the corrected
   state. The coordinator correction has repaired the prior line-413 parse
   failure, and the successful `json.tool` readback is recorded below.
5. Run the exact post-correction matrix below. All bounded checks passed; any
   later product or gate failure remains owned by its named T90/T92 or
   downstream task and does not retroactively broaden this acceptance.

## Exact reruns required after coordinator corrections

Run these on the corrected combined tree, recording command, cwd, exit code,
source identity, and raw output:

1. `python3 -m json.tool project/build-plan/production-completion/execution/STATE.json`
2. Read back the T11 `accepted_source` and assert that the exact current
   `contract-manifest.json` SHA-256 is present; assert that the historical stale
   digest remains retained only in historical evidence.
3. Assert all 21 repaired accepted task/attempt pointers target existing
   `HANDOFF.md` files, with zero `START.md` targets in those accepted slots;
   assert the T01 canonical target is attempt 3.
4. Read back T01 attempt 2, T01 attempt 3, the accepted T01 review record, and
   the coordinator state. Assert attempt 2 is byte-preserved historical text,
   attempt 3 states the artifact-only acceptance, and state/review/pointer
   provenance agrees.
5. `python3 project/spec/validate_contracts.py`
6. From `project/build-plan/production-completion`,
   `python3 tools/plan.py validate` and require zero errors.
7. From the same directory, `python3 tools/plan.py graph-ready`; record it as
   advisory only and never as authorization.
8. From the same directory, `python3 tools/plan.py verify-package`; require
   zero package mismatches.
9. Re-run the read-only manifest/conformance join: 19 manifest entries, 48
   obligations, 49 vectors, 49 vector-metadata rows, no dangling or join
   differences, and all vector evidence dispositions still `unmeasured`.
10. Run `git diff --check` and capture the exact dirty-path/source identity.
11. PF-S01-T92 independently repeats the exact-tree identity, T01–T11
    prerequisite handoff audit, T11 digest assertion, pointer audit, contract
    validator, plan validator, graph advisory, package validator, and
    manifest/conformance readback before deciding AC-01. T92 must not recycle
    pre-correction output and must not claim runtime or release acceptance.

## Attempt-2 validation observations

After the coordinator corrections, `STATE.json` parses successfully. The T11
digest assertion, 21 repaired pointer assertion, and T01 preservation/
supersession assertion pass. The contract validator passes; plan validation
passes with 22 sprints, 265 tasks, 48 obligations, 56 acceptance rows, an
acyclic 265-task graph, and 17,134 local links; graph readiness returns only
the advisory PF-S01-T90 candidate; package verification checks 444 files with
zero mismatches; the manifest/conformance join passes with 19 entries, 48
obligations, 49 vectors, 49 vector-metadata rows, no dangling/join differences,
and all dispositions `unmeasured`; and `git diff --check` passes.

The validated source is `HEAD 784a41b3802c29a76721c55eef2e9493283396c2` on
`codex/apply-responsive-terminal-overlay`, dirty. The corrected STATE digest is
`7d97fcf03c9051736e180968670cd061bc97f0b352c551a2fb17abd5c3ed7fee`; the
contract-manifest digest remains
`131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.

## Acceptance guard

This reconciliation is **accepted only at T91's provenance-remediation layer**:
the three T90 findings are corrected and the bounded post-correction matrix
passes. T90's independent review disposition remains its own record, and T92
must independently revalidate the exact corrected tree before any PF-S01 exit
or successor decision. Product, runtime, service, native, publication, and
release gates remain separate and unclaimed.

# BW-S03 — True machine update and paired package/Global recovery

**Goal:** Remove machine update from arbitrary project authority and make package plus invoking-user Global migration recoverable as one journaled operation.

**Entry dependency:** BW-S01-T90, BW-S02-T90  
**Sprint close:** `BW-S03-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S03-T01](tasks/BW-S03-T01.md) | Route update and upgrade --machine before project resolution | HOST_UPDATE | automatic | BW-S02-T90, BW-S01-T90 |
| [BW-S03-T02](tasks/BW-S03-T02.md) | Move durable machine update state out of project SQLite | HOST_UPDATE | automatic | BW-S02-T90, BW-S01-T90 |
| [BW-S03-T03](tasks/BW-S03-T03.md) | Pair installer package rollback with invoking-user Global database recovery | RELEASE | automatic | BW-S02-T90, BW-S01-T90, BW-S03-T02, BW-S01-T03 |
| [BW-S03-T04](tasks/BW-S03-T04.md) | Make incompatible Global migration recovery-capable from first open and enforce predecessor policy | GLOBAL_STORE | automatic | BW-S02-T90, BW-S01-T90, BW-S03-T01, BW-S03-T02, BW-S01-T02 |
| [BW-S03-T05](tasks/BW-S03-T05.md) | Document third-party package-manager downgrade and per-user recovery semantics | DOCS | operator_only | BW-S02-T90, BW-S01-T90, BW-S03-T04 |
| [BW-S03-T06](tasks/BW-S03-T06.md) | Build package+database update fault-injection matrix | VALIDATION | automatic | BW-S02-T90, BW-S01-T90, BW-S03-T02 |
| [BW-S03-T90](tasks/BW-S03-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S03-T01, BW-S03-T02, BW-S03-T03, BW-S03-T04, BW-S03-T05, BW-S03-T06 |

## Parallelism

- T01 routing and T02 journal can proceed in parallel on separate files after interface agreement.
- T03 installer pairing consumes T02 and R1 backup/restore.
- T04 migration bridge consumes T01/T02 and can parallel T03 until final integration.
- T05 package-manager policy/docs can run alongside implementation.
- T06 builds the fault matrix while implementation stabilizes.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S03-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] bwrk update works from arbitrary cwd with no project database or actor.
- [ ] Running update inside a project does not read/write that project DB as update authority.
- [ ] A verified pre-migration physical Global backup exists before incompatible mutation.
- [ ] Failures before, during and after migration recover a compatible known-good package/DB pair.
- [ ] Unknown/in-progress update status is read back from durable journal; stale lock is reconciled, not blindly removed.
- [ ] Direct installer only coordinates the invoking user Global DB; shared/system package flows never enumerate other users.
- [ ] Old clients that cannot honor maintenance admission are handled by an explicit recovery-capable bridge/minimum-version policy.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.

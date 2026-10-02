# BW-S06 — Global schema 3, Personal Inbox and capture provenance

**Goal:** After recovery is proven, add the minimum persistent metadata that turns quick capture into a real triage workflow and preserves future handoff identity without inventing history.

**Entry dependency:** BW-S03-T90, BW-S05-T90  
**Sprint close:** `BW-S06-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S06-T01](tasks/BW-S06-T01.md) | Introduce Global schema 3 with compatible optional item metadata and strong new IDs | GLOBAL_STORE | automatic | BW-S05-T90, BW-S03-T90 |
| [BW-S06-T02](tasks/BW-S06-T02.md) | Provision a distinct Personal Inbox workflow status and make explicit capture enter it | GLOBAL_APP | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T01 |
| [BW-S06-T03](tasks/BW-S06-T03.md) | Record immutable capture digest and retain a verifiable original-text witness | GLOBAL_APP | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T01 |
| [BW-S06-T04](tasks/BW-S06-T04.md) | Import v1 raw capture provenance without fabricating missing history | MIGRATION | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T03 |
| [BW-S06-T05](tasks/BW-S06-T05.md) | Make triage atomically map destination, parent, workflow and scheduling metadata | GLOBAL_APP | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T02, BW-S05-T05 |
| [BW-S06-T06](tasks/BW-S06-T06.md) | Version logical schema-3 transfer and preserve capture/future handoff metadata | GLOBAL_APP | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T01, BW-S06-T03, BW-S06-T05 |
| [BW-S06-T90](tasks/BW-S06-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S06-T01, BW-S06-T02, BW-S06-T03, BW-S06-T04, BW-S06-T05, BW-S06-T06 |

## Parallelism

- T01 owns the schema/migration contract and must land first.
- T02 Personal Inbox and T03 provenance can then proceed in parallel.
- T04 legacy import consumes provenance.
- T05 triage consumes Inbox semantics.
- T06 transfer compatibility consumes all persistent fields.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S06-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] Schema 2→3 migration is preceded by verified recovery capability and preserves all existing records/history.
- [ ] Existing v2 items receive no fabricated capture origin.
- [ ] Quick capture works with zero projects and enters a distinct Personal Inbox status.
- [ ] A Personal Inbox item can be triaged to Personal/To do and actually leave Inbox.
- [ ] Capture origin digest/source witness survives edits, archive/restore, physical backup and logical transfer.
- [ ] v1 raw imports are idempotent when identity+digest match and conflicts are explicit when the same source identity changed.
- [ ] Future pending_send/accepted_intake fields are optional and inert until Send ships.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.

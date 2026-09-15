# M01 — Standalone Boreal Work v2

The [master plan](../../MASTER_PLAN.md) dispatches this milestone. Each
subfolder has one `SPRINT.md` containing its leaf tasks, parallel lanes,
assignment ledger, evidence requirements, and review/reconciliation/
revalidation gates. These are planning files, not Boreal work records.

| Sprint | Folder | Main outcome |
| --- | --- | --- |
| S00 | [contracts](sprints/S00-contracts/SPRINT.md) | Frozen behavior/schema/protocol and honest legacy baseline |
| S01 | [domain-store](sprints/S01-domain-store/SPRINT.md) | Canonical status, graph, transactions, and snapshot store |
| S02 | [runtime-cli](sprints/S02-runtime-cli/SPRINT.md) | Fenced attempts, proof-gated finish, service, CLI, guidance |
| S03 | [source-memory](sprints/S03-source-memory/SPRINT.md) | Versioned sources and Git-published cited memory |
| S04 | [tui](sprints/S04-tui/SPRINT.md) | Mounted TS workflow and monitoring; overlaps S03 |
| S05 | [integration](sprints/S05-integration/SPRINT.md) | Import, workflows, packaging, docs, parity |
| S06 | [release](sprints/S06-release/SPRINT.md) | Load/fault/security and standalone cutover decision |

Scope and release exclusions are defined in
[project/build-plan/README.md](../../project/build-plan/README.md) and
[deferred verticals](../../project/build-plan/DEFERRED_VERTICALS.md). A sprint
can finish only through its documented gate, not by checking off every
implementation row. Independent findings always go through reconciliation
and revalidation before downstream advancement.

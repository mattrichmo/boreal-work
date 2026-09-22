# S00-T01 — parity inventory and unresolved evidence

Basis: supplied `project/WORKFLOW_PARITY.md`, `project/legacy-map/`, command
registry, Rust sources and checked-in fixtures. The v1 runtime/archive is NOT
present; links to `../../packages/` are historical references, not inspected
files. No claim of an exhaustive independently reverified v1 inventory is made.
`COMMAND_INVENTORY.json` enumerates all registry routes and explicit gaps in
this v2 snapshot; it is source evidence, not proof that every route passes.

| Retained behavior | Disposition | v2 authority | Migration impact | Owner/task and acceptance |
| --- | --- | --- | --- | --- |
| Work records and hierarchy | rework | domain/application/store | Translate lifecycle; preserve original record | L3 S03-T01, complete two-sprint tree |
| Derived readiness | replace | domain evaluator | Never trust persisted v1 readiness | L1 S01-T01/T02, combined-condition tests |
| Dependency edges | rework | domain/store | Verified/cancelled need explicit edge disposition | L2 S02-T03/T04, closed-only and waiver tests |
| Reservations/attempts | rework | store/application | Preserve failed/expired attempts; reconstruct only sound fences | L2 S02-T01/T02/T06, race and expiry tests |
| Sprint launch/current/board/report | preserve | application/service | Fixed compatibility ID mapping, later cycle adapter | L3/L4 S03-T04/S04-T02, service-backed sample |
| Technical receipts | rework | evidence application/store | Old prose is not attestation; keep failed receipts | L3 S03-T03/S05-T03, provenance and stale-subject tests |
| Independent review | preserve | domain/application/store | Preserve rejects and reviewer identity | L3 S02-T05, independent review public E2E |
| Gate force/waiver | replace | typed audited operations | Map only valid legacy decisions, report unsupported | L3 S02-T04/S05-T03, denied role and readback |
| Summary/closeout | preserve | application/store | Keep immutable summaries and close intent | L3 S02-T02/S03-T03, genuine close fixture |
| Workflows/show/discovery | preserve | trusted Rust registry | Version old workflow references; no stale file authority | L5 S04-T01/T05, guided no-goal loop |
| Agent plan/claim/finish/handoff | preserve | application/guidance | Retain conditional directives, never prose transitions | L5 S04-T05, unfamiliar-agent E2E |
| Memory/source references | preserve | memory/source/store | Retain provenance and exact project scope | Migration steward S05-T03, two-project import |
| V1 web console/MCP/global manager | defer | documented adapter boundary | Do not import v1 runtime | Coordinator, existing DEFERRED_VERTICALS; no silent parity claim |
| Historical commands/aliases | historical-only or preserve per route | command registry | Unavailable paths stay explicit typed gaps | L0/L4 S00-T01/S04, compare actual v1 registry before signoff |

S00-T01 acceptance remains incomplete until a validator supplies the actual
v1 command/behavior inventory and reconciles every omission. Import parity
(S05-T03) and release (S06) remain blocked; no imported data was fabricated.

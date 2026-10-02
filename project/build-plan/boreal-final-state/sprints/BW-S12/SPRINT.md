# BW-S12 — Complete project workflows and portable agent access

**Goal:** Make the existing project product usable end to end by an unfamiliar authorized agent, then prove that a typed client and a restartable isolated environment can use the same Rust authority without terminal-specific logic.

**Entry dependency:** BW-S00-T90.
**Sprint close:** BW-S12-T90. S11 requires this gate; S12 is not a post-release extra.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S12-T01](tasks/BW-S12-T01.md) | Freeze callable general-work, artifact and acceptance contracts | PROTOCOL | operator_only | BW-S00-T90 |
| [BW-S12-T02](tasks/BW-S12-T02.md) | Complete planning, optional deliverables and safe plan revision | PROJECT_PLANNING | automatic | BW-S12-T01 |
| [BW-S12-T03](tasks/BW-S12-T03.md) | Complete typed acceptance, enrolled execution and recovery | PROJECT_EXECUTION | automatic | BW-S12-T01 |
| [BW-S12-T04](tasks/BW-S12-T04.md) | Make context, accepted artifacts and handoffs portable | PROJECT_KNOWLEDGE | automatic | BW-S12-T01 |
| [BW-S12-T05](tasks/BW-S12-T05.md) | Expose general-work workflows through one typed contract | AGENT_INTERFACE | automatic | BW-S12-T02, BW-S12-T03, BW-S12-T04 |
| [BW-S12-T06](tasks/BW-S12-T06.md) | Qualify headless installs and portable mixed-work recovery | ENVIRONMENT_VALIDATION | automatic | BW-S12-T05, BW-S02-T90 |
| [BW-S12-T90](tasks/BW-S12-T90.md) | Integrate general-work execution and the portable contract | INTEGRATION | operator_only | BW-S12-T01, BW-S12-T02, BW-S12-T03, BW-S12-T04, BW-S12-T05, BW-S12-T06 |

## Parallelism and scope

T01 produces the shared capability/identity fixtures. T02 (planning), T03 (execution/review) and T04 (knowledge/handoff) may proceed on disjoint modules after that handoff; shared CLI/protocol/store files remain single-steward resources. T05 integrates callable clients/skills, then T06 uses the qualified packaging from S02. T90 validates the combined result. S08 consumes T01 while Global lanes continue independently.

Read `../../WORKFLOW_CONTRACT.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md` and repository contributor rules. Existing production-completion F1-F5 records are requirements/evidence only. Do not create a second implementation graph, change active S00 recovery ownership, or add another application state machine.

## Sprint validation

- Draft/Intake/planning/publish/cycle changes are usable without hidden database edits.
- Ordinary enrolled workers, scoped sessions and independent reviewers complete the guided lifecycle; Operator-only demos do not count as agent readiness.
- Changed-result verification, canonical review history and durable summary/receipt readback survive session restart.
- Context and handoffs retain source/result/proof identity and bounded citations; unknown or missing material stays explicit.
- Every advertised required Project action maps to a callable typed handler, or produces an actionable input/permission/environment boundary rather than a false success. Global/Send route completion belongs to S05-S09 and is joined at S11, not a hidden S12 predecessor.
- CLI and a minimal non-CLI client produce equivalent persisted outcomes through the same Rust use cases.
- Headless compiled-binary use, isolated persistent-root restart, same-task contention and stale-owner rejection are exercised on declared supported environments.
- Full MCP packaging, remote HTTP, SaaS and provider spawning are not smuggled into this sprint. See `../../INTERFACE_ROADMAP.md` for the separate bounded successor.

The integration record names exact source/binary/protocol identities, fixtures, checks, skipped/unsupported cases and residual required defects. Only S11's final artifact/native journeys qualify the release.

## Revision 4 extension

T01 freezes GENERAL_WORK_CONTRACT.md; T02 owns requirement planning, T03 typed acceptance, T04 artifact/input identity, T05 callable parity and T06 recovery. Preserve original scope and use separate module grants. S13 consumes these capabilities for waits, visual surfaces and non-software fixtures. S11 requires both sprint gates.

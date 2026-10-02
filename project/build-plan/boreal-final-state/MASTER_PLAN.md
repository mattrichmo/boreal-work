# Boreal final-state master plan

**Plan ID:** `BW-final-state-2026-10-01`  
**Baseline:** `main@6ab1c078150993936d5d381822e7774d9e5cfade`  
**Import root:** one milestone `BW-M01` containing the sprints below.

## Objective

Finish Boreal as two explicit authorities that compose cleanly:

1. **Global Manager** — installation-wide personal/business capture, triage, dates, notes, management projects, management completion, portfolio attention, and read-only linked execution context. It remains useful with zero projects/workspaces.
2. **Project Boreal** — project-scoped execution authority: guide/next, claim/attempt/fence, evidence, required gates, review, finish/release.
3. **Explicit bridge** — later `Send to project` transfers an eligible Global capture into Project Intake, then archives (never completes) the Global source.

The plan intentionally retains current correct implementation and concentrates most validation at the **sprint integration task (`T90`)**, not at every leaf. A leaf has a required local check only when another task consumes that interface before sprint close.

## Sprint map

| Sprint | Outcome | Entry task(s) | Tasks incl. close |
| --- | --- | --- | ---: |
| BW-S00 | Current-head qualification and parallel execution baseline | None | 6 |
| BW-S01 | Physical Global backup, restore and maintenance ownership | BW-S00-T90 | 6 |
| BW-S02 | Packaging, runtime and release-surface hardening | BW-S00-T90 | 6 |
| BW-S03 | True machine update and paired package/Global recovery | BW-S01-T90, BW-S02-T90 | 7 |
| BW-S04 | Complete bounded Global reads, transfer and linked-workspace isolation | BW-S00-T90 | 6 |
| BW-S05 | Civil-time daily semantics and dependency-honest management attention | BW-S04-T90 | 6 |
| BW-S06 | Global schema 3, Personal Inbox and capture provenance | BW-S03-T90, BW-S05-T90 | 7 |
| BW-S07 | Complete standalone Global daily product and authority guidance | BW-S06-T90 | 7 |
| BW-S08 | Project restore identity and immutable Intake delivery receipt | BW-S07-T90 | 6 |
| BW-S09 | Explicit Global Send with frozen intent and deterministic reconciliation | BW-S08-T90 | 6 |
| BW-S10 | Scale qualification and evidence-driven product refinement | BW-S07-T90 | 7 |
| BW-S11 | Integrated release qualification, v1 parity and operational handover | BW-S09-T90, BW-S10-T90 | 7 |

## Parallel dependency waves

```text
BW-S00  baseline qualification
   │
   ├──────────────┬──────────────┐
   ▼              ▼              ▼
BW-S01          BW-S02          BW-S04
Global recovery Packaging       Bounded reads
   │              │              │
   └──────┬───────┘              ▼
          ▼                    BW-S05
       BW-S03                  Daily semantics
       Machine update             │
          └──────────┬────────────┘
                     ▼
                  BW-S06
            Schema3 + Inbox/provenance
                     ▼
                  BW-S07
             Complete local Global
                ┌────┴─────┐
                ▼          ▼
             BW-S08      BW-S10
          Intake receipt Scale evidence
                ▼          │
             BW-S09        │
               Send        │
                └────┬─────┘
                     ▼
                  BW-S11
              Release/handover
```

## Final state

- Install/update is recoverable across package + invoking-user Global DB.
- Full physical Global backup/restore exists and is distinct from logical transfer.
- Personal Inbox is a real workflow state; capture is classification-free.
- Daily review has exact civil-time semantics and dependency-honest management Next.
- Existing management TUI/CLI features remain; no unnecessary new top-level routes.
- Agent routing distinguishes Global management from project execution without adding Global claim/evidence/finish.
- Explicit Send lands in immutable Project Intake delivery receipt; uncertainty never authorizes duplication.
- Storage changes after the local release are measurement-driven, not assumed.

## Working rule

One agent gets one leaf task and an isolated worktree. Shared existing monoliths (`main.rs`, `service.rs`, command registries, `global_manager.rs`, store `lib.rs`, manifests, migrations, installer/CI) are whole-file integration resources. Agents may work in parallel on disjoint modules/tests, then the sprint integrator serializes shared-file patches.

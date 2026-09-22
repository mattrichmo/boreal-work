# Sprint and task dependency graph

Solid arrows are mandatory sprint-entry gates (`-T92`). Dotted arrows are extra joins on named leaves: early independent planning work may proceed, but its joined task and exit cannot pass early. The complete task graph is in `plan.json` and every task card. This is a DAG, not a calendar or a duration estimate.

```mermaid
flowchart TD
  PFS00["PF-S00: Baseline, provenance, toolchain and evidence recovery"]
  PFS01["PF-S01: Final product contracts and explicit owner decisions"]
  PFS00 --> PFS01
  PFS02["PF-S02: Canonical persistence, revisions and migration foundations"]
  PFS01 --> PFS02
  PFS03["PF-S03: One deterministic domain decision and action model"]
  PFS01 --> PFS03
  PFS04["PF-S04: Authenticated actors and project/workspace isolation"]
  PFS02 --> PFS04
  PFS05["PF-S05: Versioned service, durable operations and snapshot plumbing"]
  PFS02 --> PFS05
  PFS03 --> PFS05
  PFS04 --> PFS05
  PFS06["PF-S06: Fenced multi-agent execution, leases and safe recovery"]
  PFS05 --> PFS06
  PFS07["PF-S07: Profiles, genuine verification and immutable submissions"]
  PFS05 --> PFS07
  PFS08["PF-S08: Independent review, closeout, overrides and lifecycle reconciliation"]
  PFS06 --> PFS08
  PFS07 --> PFS08
  PFS09["PF-S09: Milestones, cycle-backed sprints and dependency planning"]
  PFS02 --> PFS09
  PFS03 --> PFS09
  PFS04 --> PFS09
  PFS08 -. "named leaf join" .-> PFS09
  PFS10["PF-S10: Exact projections, launch readiness and actionable queues"]
  PFS08 --> PFS10
  PFS09 --> PFS10
  PFS11["PF-S11: Versioned sources, curated memory and recoverable handoff"]
  PFS05 --> PFS11
  PFS07 --> PFS11
  PFS12["PF-S12: Legacy parity, backup/restore and explicit maintenance recovery"]
  PFS08 --> PFS12
  PFS09 --> PFS12
  PFS11 --> PFS12
  PFS13["PF-S13: Complete human and machine CLI/service parity"]
  PFS10 --> PFS13
  PFS12 --> PFS13
  PFS14["PF-S14: Trusted workflows and no-goal multi-harness agent guidance"]
  PFS13 --> PFS14
  PFS15["PF-S15: Production terminal workspace and recovery UX"]
  PFS13 --> PFS15
  PFS16["PF-S16: Integrated real-service product conformance"]
  PFS14 --> PFS16
  PFS15 --> PFS16
  PFS17["PF-S17: Adversarial security, fault tolerance, scale and soak"]
  PFS16 --> PFS17
  PFS18["PF-S18: Reproducible packaging, installer and recoverable upgrades"]
  PFS15 --> PFS18
  PFS12 --> PFS18
  PFS19["PF-S19: User onboarding, operator runbooks and support readiness"]
  PFS14 --> PFS19
  PFS15 --> PFS19
  PFS18 --> PFS19
  PFS20["PF-S20: Exact-artifact release qualification and independent cutover"]
  PFS17 --> PFS20
  PFS18 --> PFS20
  PFS19 --> PFS20
  PFS21["PF-S21: Authorized publication, clean-install verification and operational handover"]
  PFS20 --> PFS21
```

## Explicit sprint dependencies

| Sprint | Entry gates | Additional leaf joins | Exit |
| --- | --- | --- | --- |
| [PF-S00](sprints/PF-S00/SPRINT.md) | None | None | PF-S00-T92 |
| [PF-S01](sprints/PF-S01/SPRINT.md) | PF-S00-T92 | None | PF-S01-T92 |
| [PF-S02](sprints/PF-S02/SPRINT.md) | PF-S01-T92 | None | PF-S02-T92 |
| [PF-S03](sprints/PF-S03/SPRINT.md) | PF-S01-T92 | None | PF-S03-T92 |
| [PF-S04](sprints/PF-S04/SPRINT.md) | PF-S02-T92 | None | PF-S04-T92 |
| [PF-S05](sprints/PF-S05/SPRINT.md) | PF-S02-T92, PF-S03-T92, PF-S04-T92 | None | PF-S05-T92 |
| [PF-S06](sprints/PF-S06/SPRINT.md) | PF-S05-T92 | None | PF-S06-T92 |
| [PF-S07](sprints/PF-S07/SPRINT.md) | PF-S05-T92 | None | PF-S07-T92 |
| [PF-S08](sprints/PF-S08/SPRINT.md) | PF-S06-T92, PF-S07-T92 | None | PF-S08-T92 |
| [PF-S09](sprints/PF-S09/SPRINT.md) | PF-S02-T92, PF-S03-T92, PF-S04-T92 | PF-S08 | PF-S09-T92 |
| [PF-S10](sprints/PF-S10/SPRINT.md) | PF-S08-T92, PF-S09-T92 | None | PF-S10-T92 |
| [PF-S11](sprints/PF-S11/SPRINT.md) | PF-S05-T92, PF-S07-T92 | None | PF-S11-T92 |
| [PF-S12](sprints/PF-S12/SPRINT.md) | PF-S08-T92, PF-S09-T92, PF-S11-T92 | None | PF-S12-T92 |
| [PF-S13](sprints/PF-S13/SPRINT.md) | PF-S10-T92, PF-S12-T92 | None | PF-S13-T92 |
| [PF-S14](sprints/PF-S14/SPRINT.md) | PF-S13-T92 | None | PF-S14-T92 |
| [PF-S15](sprints/PF-S15/SPRINT.md) | PF-S13-T92 | None | PF-S15-T92 |
| [PF-S16](sprints/PF-S16/SPRINT.md) | PF-S14-T92, PF-S15-T92 | None | PF-S16-T92 |
| [PF-S17](sprints/PF-S17/SPRINT.md) | PF-S16-T92 | None | PF-S17-T92 |
| [PF-S18](sprints/PF-S18/SPRINT.md) | PF-S15-T92, PF-S12-T92 | None | PF-S18-T92 |
| [PF-S19](sprints/PF-S19/SPRINT.md) | PF-S14-T92, PF-S15-T92, PF-S18-T92 | None | PF-S19-T92 |
| [PF-S20](sprints/PF-S20/SPRINT.md) | PF-S17-T92, PF-S18-T92, PF-S19-T92 | None | PF-S20-T92 |
| [PF-S21](sprints/PF-S21/SPRINT.md) | PF-S20-T92 | None | PF-S21-T92 |

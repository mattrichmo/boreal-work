# BW-S13 — General-work planning, visual delivery and reusable workflows

**Goal:** Complete general-purpose planning, artifact-visible TUI and reusable mixed-work journeys on the existing local product.

**Entry:** task dependencies control dispatch; T01 can begin after S12-T01 and S05-T01. T02 and T03 have independent write sets once their dependencies pass.
**Sprint close:** BW-S13-T90; required by all S11 release leaves.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S13-T01](tasks/BW-S13-T01.md) | Complete deadlines, follow-ups and external decision waits | GENERAL_SCHEDULING | automatic | BW-S12-T01, BW-S05-T01 |
| [BW-S13-T02](tasks/BW-S13-T02.md) | Build a clear general-work TUI and visual planning surface | GENERAL_TUI | automatic | BW-S12-T05, BW-S13-T01 |
| [BW-S13-T03](tasks/BW-S13-T03.md) | Qualify reusable templates and a non-software production journey | GENERAL_WORKFLOW | automatic | BW-S12-T90, BW-S13-T01 |
| [BW-S13-T90](tasks/BW-S13-T90.md) | Integrate and qualify general-purpose work management | INTEGRATION | operator_only | BW-S13-T01, BW-S13-T02, BW-S13-T03 |

## Parallelism and acceptance

T01 owns scheduling/waits, T02 project TUI, T03 test/reference templates. Use one integration steward for common protocol/store/CLI files; nested workers need disjoint granted modules. Validate actual artifact and decision workflows, not only screenshots. Preserve lightweight and software modes. Full provider signup, banking and commercial business operations remain outside this code milestone.

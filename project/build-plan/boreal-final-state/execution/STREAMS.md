# Multi-agent streams

Streams group related work for scheduling and expertise. A stream is never an
ownership wildcard: each task packet's exact write boundary, prerequisites,
current worktree, and Boreal attempt lease control the assignment.

| Stream | Task lanes | Primary sprints | Concern |
| --- | --- | --- | --- |
| Coordinator and integration | `COORD`, `INTEGRATION` | All; especially BW-S00 and each sprint's T90 | Dispatch, source identity, path-conflict checks, shared-patch stewardship, combined sprint integration, and final handoff. |
| Validation and qualification | `VALIDATION` | BW-S00, BW-S02–BW-S04, BW-S08–BW-S11 | CI coverage, portable PTY paths, fault and saturation checks, exact-artifact qualification, and retained evidence. |
| Global storage and recovery | `GLOBAL_STORE`, `MIGRATION` | BW-S01, BW-S03, BW-S06, BW-S10, BW-S11 | Physical backup and restore, maintenance, schema evolution, provenance migration, and Global persistence. |
| Host, update, and release | `HOST_RUNTIME`, `HOST_UPDATE`, `RELEASE` | BW-S02, BW-S03, BW-S11 | Runtime layout, machine update, installation, package identity, release generation, and recovery across package and Global data. |
| Global domain and application | `GLOBAL_DOMAIN`, `GLOBAL_APP`, `GLOBAL_API`, `GLOBAL_LINKS` | BW-S01, BW-S04–BW-S06, BW-S09 | Global use cases, civil-time behavior, attention, Inbox/provenance, linked project context, and explicit Send. |
| Global terminal UI | `GLOBAL_TUI` | BW-S04, BW-S07, BW-S09 | Daily workflow, complete pickers, actionable linked context, and Send/handoff presentation through the service. |
| CLI and agent guidance | `CLI`, `GUIDANCE` | BW-S05, BW-S07, BW-S11 | Command parity, route selection, authority boundaries, and discoverable operator guidance. |
| Project execution and Intake | `PROJECT_STORE`, `PROJECT_APP`, `PROJECT_SERVICE` | BW-S08 | Restore identity, immutable Intake delivery receipts, receive behavior, and project-service boundaries. |
| Portable project workflows | `PROTOCOL`, `PROJECT_PLANNING`, `PROJECT_EXECUTION`, `PROJECT_KNOWLEDGE`, `AGENT_INTERFACE`, `ENVIRONMENT_VALIDATION` | BW-S12 | Optional deliverables, typed acceptance and decision proof, accepted input lineage, portable artifacts, safe recovery, and headless enrolled execution. |
| General work and scheduling | `GENERAL_SCHEDULING`, `GENERAL_TUI`, `GENERAL_WORKFLOW` | BW-S13 | Deadlines, follow-ups, external decision waits, visual planning, reusable mixed-work templates, and a non-software production journey. |
| Performance and product decisions | `PERFORMANCE`, `ARCHITECTURE`, `PRODUCT` | BW-S10 | Scale fixtures, reproducible measurements, conditional architecture experiments, and evidence-backed decisions. |
| Documentation and parity | `DOCS`, `MIGRATION` | BW-S02, BW-S03, BW-S06, BW-S07, BW-S11 | Installation and authority documentation, explicit v1 parity disposition, and supported operational boundaries. |

## Scheduling rules

- Use the V4 task graph and `REVISION_V4.md` for sequencing; do not use older
  wave prose to bypass a task dependency or start a sprint integration early.
- Tasks inside one stream can still conflict when their paths overlap. Check
  exact task paths across all streams before dispatch.
- A task may touch another stream's concern only when its packet names those
  paths. Ask the coordinator to adjust the boundary or submit a shared patch
  when the task needs additional files.
- When a task uses a shared file, the file steward serializes that edit. The
  agent keeps implementation in its isolated task worktree and supplies a
  bounded patch for integration.
- BW-S12-T01 freezes the callable contracts before its core owners proceed.
  BW-S12-T02 and BW-S12-T03 can overlap only with disjoint exact write sets.
  BW-S13-T01 waits for BW-S12-T01 and BW-S05-T01; T02 and T03 then follow the
  separate inputs recorded in `REVISION_V4.md`.
- BW-S11 leaves wait for BW-S09-T90, BW-S10-T90, BW-S12-T90, and BW-S13-T90.
- Validation agents remain independent of the implementation they validate.
  Sprint T90 owns the combined validation and records its source identity.

The coordinator maintains the active assignment list, attempt/worktree
identities, dependency state, and conflict decisions in the canonical task
system and sprint evidence. This document defines stream scope only; it is not
a second task ledger.

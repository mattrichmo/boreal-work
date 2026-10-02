# Task index — plan revision 4

Plan `BW-final-state-2026-10-01`: **14 sprints, 85 required task cards and one milestone (100 imported work items)**. Three historical conditional S10 cards remain deferred. Historical V1–V3 templates are unchanged.

`BOREAL_TEMPLATE_V4.json` and `PLAN_CONTEXT.json` carry task-only dependencies; containers have none. Work IDs and runtime claims are separate. New general-work contract: [GENERAL_WORK_CONTRACT.md](GENERAL_WORK_CONTRACT.md).

## BW-S00 — Current-head qualification and parallel execution baseline

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S00-T01](sprints/BW-S00/tasks/BW-S00-T01.md) | Freeze exact source baseline and reconcile the current audit inventory | COORD | operator_only | None |
| [BW-S00-T02](sprints/BW-S00/tasks/BW-S00-T02.md) | Add Global TUI and portable PTY coverage to normal validation | VALIDATION | automatic | BW-S00-T01 |
| [BW-S00-T03](sprints/BW-S00/tasks/BW-S00-T03.md) | Exercise the real release download and checksum verification path | RELEASE | automatic | BW-S00-T01 |
| [BW-S00-T04](sprints/BW-S00/tasks/BW-S00-T04.md) | Establish multi-agent worktrees, write ownership and integration stewardship | COORD | operator_only | None |
| [BW-S00-T05](sprints/BW-S00/tasks/BW-S00-T05.md) | Expose the trusted attempt recovery action through CLI and service | CLI | operator_only | None |
| [BW-S00-T90](sprints/BW-S00/tasks/BW-S00-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S00-T01, BW-S00-T02, BW-S00-T03, BW-S00-T04, BW-S00-T05 |

## BW-S01 — Physical Global backup, restore and maintenance ownership

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S01-T01](sprints/BW-S01/tasks/BW-S01-T01.md) | Implement reusable Global SQLite online backup and manifest validation | GLOBAL_STORE | automatic | BW-S00-T90 |
| [BW-S01-T02](sprints/BW-S01/tasks/BW-S01-T02.md) | Expose Global physical backup through application, CLI and service | GLOBAL_API | automatic | BW-S00-T90, BW-S01-T01 |
| [BW-S01-T03](sprints/BW-S01/tasks/BW-S01-T03.md) | Implement staged Global restore with retained previous database and fresh active identity | GLOBAL_STORE | automatic | BW-S00-T90, BW-S01-T01, BW-S01-T04 |
| [BW-S01-T04](sprints/BW-S01/tasks/BW-S01-T04.md) | Add Global maintenance admission and non-destructive ownership locking | GLOBAL_STORE | automatic | BW-S00-T90 |
| [BW-S01-T05](sprints/BW-S01/tasks/BW-S01-T05.md) | Make logical Global transfer symmetric and explicitly separate from backup | GLOBAL_APP | automatic | BW-S00-T90 |
| [BW-S01-T90](sprints/BW-S01/tasks/BW-S01-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S01-T01, BW-S01-T02, BW-S01-T03, BW-S01-T04, BW-S01-T05 |

## BW-S02 — Packaging, runtime and release-surface hardening

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S02-T01](sprints/BW-S02/tasks/BW-S02-T01.md) | Fix release checksum provenance path and test the download-style installer | RELEASE | automatic | BW-S00-T90 |
| [BW-S02-T02](sprints/BW-S02/tasks/BW-S02-T02.md) | Preflight dashboard Node runtime before service startup | HOST_RUNTIME | automatic | BW-S00-T90 |
| [BW-S02-T03](sprints/BW-S02/tasks/BW-S02-T03.md) | Make Global TUI source and interaction tests part of release identity/validation | VALIDATION | automatic | BW-S00-T90, BW-S00-T02 |
| [BW-S02-T04](sprints/BW-S02/tasks/BW-S02-T04.md) | Qualify supported target install/launch surfaces without widening platform claims | RELEASE | automatic | BW-S00-T90, BW-S02-T01, BW-S02-T02, BW-S02-T03 |
| [BW-S02-T05](sprints/BW-S02/tasks/BW-S02-T05.md) | Align install, uninstall/data-retention and supply-chain documentation with real behavior | DOCS | operator_only | BW-S00-T90 |
| [BW-S02-T90](sprints/BW-S02/tasks/BW-S02-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S02-T01, BW-S02-T02, BW-S02-T03, BW-S02-T04, BW-S02-T05 |

## BW-S03 — True machine update and paired package/Global recovery

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S03-T01](sprints/BW-S03/tasks/BW-S03-T01.md) | Route update and upgrade --machine before project resolution | HOST_UPDATE | automatic | BW-S02-T90, BW-S01-T90 |
| [BW-S03-T02](sprints/BW-S03/tasks/BW-S03-T02.md) | Move durable machine update state out of project SQLite | HOST_UPDATE | automatic | BW-S02-T90, BW-S01-T90 |
| [BW-S03-T03](sprints/BW-S03/tasks/BW-S03-T03.md) | Pair installer package rollback with invoking-user Global database recovery | RELEASE | automatic | BW-S02-T90, BW-S01-T90, BW-S03-T02, BW-S01-T03 |
| [BW-S03-T04](sprints/BW-S03/tasks/BW-S03-T04.md) | Make incompatible Global migration recovery-capable from first open and enforce predecessor policy | GLOBAL_STORE | automatic | BW-S02-T90, BW-S01-T90, BW-S03-T01, BW-S03-T02, BW-S01-T02 |
| [BW-S03-T05](sprints/BW-S03/tasks/BW-S03-T05.md) | Document third-party package-manager downgrade and per-user recovery semantics | DOCS | operator_only | BW-S02-T90, BW-S01-T90, BW-S03-T04 |
| [BW-S03-T06](sprints/BW-S03/tasks/BW-S03-T06.md) | Build package+database update fault-injection matrix | VALIDATION | automatic | BW-S02-T90, BW-S01-T90, BW-S03-T02 |
| [BW-S03-T90](sprints/BW-S03/tasks/BW-S03-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S03-T01, BW-S03-T02, BW-S03-T03, BW-S03-T04, BW-S03-T05, BW-S03-T06 |

## BW-S04 — Complete bounded Global reads, transfer and linked-workspace isolation

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S04-T01](sprints/BW-S04/tasks/BW-S04-T01.md) | Bound project attention and add complete paged attention/detail reads | GLOBAL_APP | automatic | BW-S00-T90 |
| [BW-S04-T02](sprints/BW-S04/tasks/BW-S04-T02.md) | Make search and triage pickers complete beyond the snapshot sample | GLOBAL_TUI | automatic | BW-S00-T90, BW-S04-T01 |
| [BW-S04-T03](sprints/BW-S04/tasks/BW-S04-T03.md) | Make linked association enumeration and global next complete beyond summary caps | GLOBAL_LINKS | automatic | BW-S00-T90 |
| [BW-S04-T04](sprints/BW-S04/tasks/BW-S04-T04.md) | Qualify linked worker saturation, deadlines and last-good isolation | VALIDATION | automatic | BW-S00-T90, BW-S04-T03 |
| [BW-S04-T05](sprints/BW-S04/tasks/BW-S04-T05.md) | Harden logical export/import size, history and replacement invariants | GLOBAL_APP | automatic | BW-S00-T90, BW-S01-T05 |
| [BW-S04-T90](sprints/BW-S04/tasks/BW-S04-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S04-T01, BW-S04-T02, BW-S04-T03, BW-S04-T04, BW-S04-T05 |

## BW-S05 — Civil-time daily semantics and dependency-honest management attention

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S05-T01](sprints/BW-S05/tasks/BW-S05-T01.md) | Introduce one application-owned system civil-time context | GLOBAL_DOMAIN | automatic | BW-S04-T90 |
| [BW-S05-T02](sprints/BW-S05/tasks/BW-S05-T02.md) | Replace Today predicate with explicit grouped daily classification | GLOBAL_DOMAIN | automatic | BW-S04-T90, BW-S05-T01 |
| [BW-S05-T03](sprints/BW-S05/tasks/BW-S05-T03.md) | Make management next action dependency-honest with bounded blocker reasons | GLOBAL_DOMAIN | automatic | BW-S04-T90 |
| [BW-S05-T04](sprints/BW-S05/tasks/BW-S05-T04.md) | Rebuild Home attention contract around truthful management summaries | GLOBAL_APP | automatic | BW-S04-T90, BW-S05-T01, BW-S05-T03, BW-S04-T01 |
| [BW-S05-T05](sprints/BW-S05/tasks/BW-S05-T05.md) | Expose the same daily filters through CLI and service | CLI | automatic | BW-S04-T90, BW-S05-T02, BW-S05-T04, BW-S12-T01 |
| [BW-S05-T90](sprints/BW-S05/tasks/BW-S05-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S05-T01, BW-S05-T02, BW-S05-T03, BW-S05-T04, BW-S05-T05 |

## BW-S06 — Global schema 3, Personal Inbox and capture provenance

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S06-T01](sprints/BW-S06/tasks/BW-S06-T01.md) | Introduce Global schema 3 with compatible optional item metadata and strong new IDs | GLOBAL_STORE | automatic | BW-S05-T90, BW-S03-T90 |
| [BW-S06-T02](sprints/BW-S06/tasks/BW-S06-T02.md) | Provision a distinct Personal Inbox workflow status and make explicit capture enter it | GLOBAL_APP | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T01 |
| [BW-S06-T03](sprints/BW-S06/tasks/BW-S06-T03.md) | Record immutable capture digest and retain a verifiable original-text witness | GLOBAL_APP | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T01 |
| [BW-S06-T04](sprints/BW-S06/tasks/BW-S06-T04.md) | Import v1 raw capture provenance without fabricating missing history | MIGRATION | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T03 |
| [BW-S06-T05](sprints/BW-S06/tasks/BW-S06-T05.md) | Make triage atomically map destination, parent, workflow and scheduling metadata | GLOBAL_APP | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T02, BW-S05-T05 |
| [BW-S06-T06](sprints/BW-S06/tasks/BW-S06-T06.md) | Version logical schema-3 transfer and preserve capture/future handoff metadata | GLOBAL_APP | automatic | BW-S05-T90, BW-S03-T90, BW-S06-T01, BW-S06-T03, BW-S06-T05 |
| [BW-S06-T90](sprints/BW-S06/tasks/BW-S06-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S06-T01, BW-S06-T02, BW-S06-T03, BW-S06-T04, BW-S06-T05, BW-S06-T06 |

## BW-S07 — Complete standalone Global daily product and authority guidance

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S07-T01](sprints/BW-S07/tasks/BW-S07-T01.md) | Make quick capture and Inbox triage a keyboard decision queue | GLOBAL_TUI | automatic | BW-S06-T90 |
| [BW-S07-T02](sprints/BW-S07/tasks/BW-S07-T02.md) | Render grouped Today/Open and management project heartbeat | GLOBAL_TUI | automatic | BW-S06-T90, BW-S05-T90 |
| [BW-S07-T03](sprints/BW-S07/tasks/BW-S07-T03.md) | Polish archive/restore/history and capture provenance inspection | GLOBAL_TUI | automatic | BW-S06-T90, BW-S06-T03 |
| [BW-S07-T04](sprints/BW-S07/tasks/BW-S07-T04.md) | Expose daily filters and atomic bulk triage truthfully through public CLI help | CLI | automatic | BW-S06-T90, BW-S05-T05, BW-S06-T05 |
| [BW-S07-T05](sprints/BW-S07/tasks/BW-S07-T05.md) | Make boreal-route choose Global management or project execution first | GUIDANCE | automatic | BW-S06-T90, BW-S12-T05 |
| [BW-S07-T06](sprints/BW-S07/tasks/BW-S07-T06.md) | Add two-door help and reconcile Global docs with the callable registry | DOCS | operator_only | BW-S06-T90, BW-S07-T04, BW-S07-T05 |
| [BW-S07-T90](sprints/BW-S07/tasks/BW-S07-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S07-T01, BW-S07-T02, BW-S07-T03, BW-S07-T04, BW-S07-T05, BW-S07-T06 |

## BW-S08 — Project restore identity and immutable Intake delivery receipt

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S08-T01](sprints/BW-S08/tasks/BW-S08-T01.md) | Give each project restore activation a genuinely unique physical identity | PROJECT_STORE | automatic | BW-S00-T90 |
| [BW-S08-T02](sprints/BW-S08/tasks/BW-S08-T02.md) | Install immutable intake_delivery v1 as an additive feature schema | PROJECT_STORE | automatic | BW-S00-T90, BW-S12-T01 |
| [BW-S08-T03](sprints/BW-S08/tasks/BW-S08-T03.md) | Implement project-owned Intake receive transaction and idempotent resolution | PROJECT_APP | automatic | BW-S00-T90, BW-S08-T02 |
| [BW-S08-T04](sprints/BW-S08/tasks/BW-S08-T04.md) | Expose service-addressable Intake receive and receipt-bearing readback | PROJECT_SERVICE | automatic | BW-S00-T90, BW-S08-T03 |
| [BW-S08-T05](sprints/BW-S08/tasks/BW-S08-T05.md) | Qualify additive feature compatibility and receipt behavior across project restore | VALIDATION | automatic | BW-S00-T90, BW-S08-T01, BW-S08-T02, BW-S08-T04 |
| [BW-S08-T90](sprints/BW-S08/tasks/BW-S08-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S08-T01, BW-S08-T02, BW-S08-T03, BW-S08-T04, BW-S08-T05 |

## BW-S09 — Explicit Global Send with frozen intent and deterministic reconciliation

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S09-T01](sprints/BW-S09/tasks/BW-S09-T01.md) | Implement Global Send eligibility and frozen pending intent state | GLOBAL_APP | automatic | BW-S08-T90, BW-S07-T90 |
| [BW-S09-T02](sprints/BW-S09/tasks/BW-S09-T02.md) | Add contextual Send to project interaction without a new top-level route | GLOBAL_TUI | automatic | BW-S08-T90, BW-S09-T01, BW-S07-T90 |
| [BW-S09-T03](sprints/BW-S09/tasks/BW-S09-T03.md) | Implement cross-store receive, readback and attempt reconciliation adapter | GLOBAL_LINKS | automatic | BW-S08-T90, BW-S09-T01, BW-S08-T04, BW-S07-T90 |
| [BW-S09-T04](sprints/BW-S09/tasks/BW-S09-T04.md) | Record accepted Intake reference and archive-not-complete the Global source | GLOBAL_APP | automatic | BW-S08-T90, BW-S09-T03, BW-S07-T90 |
| [BW-S09-T05](sprints/BW-S09/tasks/BW-S09-T05.md) | Exercise clone, restore, import and ambiguous-delivery failure matrix | VALIDATION | automatic | BW-S08-T90, BW-S09-T03, BW-S08-T05, BW-S07-T90 |
| [BW-S09-T90](sprints/BW-S09/tasks/BW-S09-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S09-T01, BW-S09-T02, BW-S09-T03, BW-S09-T04, BW-S09-T05 |

## BW-S10 — Scale qualification and explicit release-scope decision

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S10-T01](sprints/BW-S10/tasks/BW-S10-T01.md) | Build deterministic representative and stretch Global portfolio fixtures | PERFORMANCE | automatic | BW-S07-T90 |
| [BW-S10-T02](sprints/BW-S10/tasks/BW-S10-T02.md) | Benchmark Global read/write/history/backup behavior on both fixtures | PERFORMANCE | operator_only | BW-S07-T90, BW-S10-T01 |
| [BW-S10-T03](sprints/BW-S10/tasks/BW-S10-T03.md) | Decide release fitness and any measured follow-on storage work | ARCHITECTURE | operator_only | BW-S07-T90, BW-S10-T02 |
| [BW-S10-T90](sprints/BW-S10/tasks/BW-S10-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S10-T01, BW-S10-T02, BW-S10-T03 |

## BW-S12 — Complete project workflows and portable agent access

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S12-T01](sprints/BW-S12/tasks/BW-S12-T01.md) | Freeze callable general-work, artifact and acceptance contracts | PROTOCOL | operator_only | BW-S00-T90 |
| [BW-S12-T02](sprints/BW-S12/tasks/BW-S12-T02.md) | Complete planning, optional deliverables and safe plan revision | PROJECT_PLANNING | automatic | BW-S12-T01 |
| [BW-S12-T03](sprints/BW-S12/tasks/BW-S12-T03.md) | Complete typed acceptance, enrolled execution and recovery | PROJECT_EXECUTION | automatic | BW-S12-T01 |
| [BW-S12-T04](sprints/BW-S12/tasks/BW-S12-T04.md) | Make context, accepted artifacts and handoffs portable | PROJECT_KNOWLEDGE | automatic | BW-S12-T01 |
| [BW-S12-T05](sprints/BW-S12/tasks/BW-S12-T05.md) | Expose general-work workflows through one typed contract | AGENT_INTERFACE | automatic | BW-S12-T02, BW-S12-T03, BW-S12-T04 |
| [BW-S12-T06](sprints/BW-S12/tasks/BW-S12-T06.md) | Qualify headless installs and portable mixed-work recovery | ENVIRONMENT_VALIDATION | automatic | BW-S12-T05, BW-S02-T90 |
| [BW-S12-T90](sprints/BW-S12/tasks/BW-S12-T90.md) | Integrate general-work execution and the portable contract | INTEGRATION | operator_only | BW-S12-T01, BW-S12-T02, BW-S12-T03, BW-S12-T04, BW-S12-T05, BW-S12-T06 |

## BW-S13 — General-work planning, visual delivery and reusable workflows

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S13-T01](sprints/BW-S13/tasks/BW-S13-T01.md) | Complete deadlines, follow-ups and external decision waits | GENERAL_SCHEDULING | automatic | BW-S12-T01, BW-S05-T01 |
| [BW-S13-T02](sprints/BW-S13/tasks/BW-S13-T02.md) | Build a clear general-work TUI and visual planning surface | GENERAL_TUI | automatic | BW-S12-T05, BW-S13-T01 |
| [BW-S13-T03](sprints/BW-S13/tasks/BW-S13-T03.md) | Qualify reusable templates and a non-software production journey | GENERAL_WORKFLOW | automatic | BW-S12-T90, BW-S13-T01 |
| [BW-S13-T90](sprints/BW-S13/tasks/BW-S13-T90.md) | Integrate and qualify general-purpose work management | INTEGRATION | operator_only | BW-S13-T01, BW-S13-T02, BW-S13-T03 |

## BW-S11 — Integrated release qualification, v1 parity and operational handover

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S11-T01](sprints/BW-S11/tasks/BW-S11-T01.md) | Build and smoke exact supported release artifacts on the declared platform matrix | RELEASE | automatic | BW-S10-T90, BW-S09-T90, BW-S12-T90, BW-S13-T90 |
| [BW-S11-T02](sprints/BW-S11/tasks/BW-S11-T02.md) | Run exact-artifact end-to-end Global and project authority journeys | VALIDATION | automatic | BW-S10-T90, BW-S09-T90, BW-S11-T01, BW-S12-T90, BW-S13-T90 |
| [BW-S11-T03](sprints/BW-S11/tasks/BW-S11-T03.md) | Bring install, recovery, Global manager, CLI and agent docs to the shipped final state | DOCS | operator_only | BW-S10-T90, BW-S09-T90, BW-S07-T06, BW-S09-T04, BW-S12-T90, BW-S13-T90 |
| [BW-S11-T04](sprints/BW-S11/tasks/BW-S11-T04.md) | Execute explicit v1 parity and deliberate-departure review | MIGRATION | operator_only | BW-S10-T90, BW-S09-T90, BW-S12-T90, BW-S13-T90 |
| [BW-S11-T05](sprints/BW-S11/tasks/BW-S11-T05.md) | Run final recovery, authority, security and representative performance regression | VALIDATION | automatic | BW-S10-T90, BW-S09-T90, BW-S11-T01, BW-S11-T02, BW-S10-T02, BW-S12-T90, BW-S13-T90 |
| [BW-S11-T06](sprints/BW-S11/tasks/BW-S11-T06.md) | Finalize operator runbooks, support boundaries and next measured backlog | COORD | operator_only | BW-S10-T90, BW-S09-T90, BW-S11-T03, BW-S11-T04, BW-S11-T05, BW-S12-T90, BW-S13-T90 |
| [BW-S11-T90](sprints/BW-S11/tasks/BW-S11-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S11-T01, BW-S11-T02, BW-S11-T03, BW-S11-T04, BW-S11-T05, BW-S11-T06 |

## Preserved outside the required release

BW-S10-T04/T05/T06 remain governed by DEFERRED.md. They are neither erased nor completed by revision 4.

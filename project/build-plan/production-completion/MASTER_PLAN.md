# Master production-completion plan

## Objective and authority

Deliver the final declared local Boreal Work product through the existing Rust authority and versioned local service. Preserve useful implementations that satisfy the accepted contract; do not replace the application with a new scaffold, import the v1 runtime, or equate authored tests with accepted behavior.

The plan has 22 sprints and 265 task IDs. IDs prefixed `PF-` avoid collisions with historical M01/M02. All original M02 obligations remain mapped in the crosswalk. PF-S00-T08 is a bounded coordinator-approved remediation for the missing executable workflow-discovery route; it does not authorize PF-S01 or change the approved product contract. The final architecture review motivates additional work, but recommendations do not outrank approved project decisions. PF-S01 resolves this explicitly before implementation.

The scope is finite and testable, not a guarantee that no future vulnerability or bug can exist. "Complete" means all mandatory behaviors, failure boundaries, supported installations and operator responsibilities in this plan have passed attributable acceptance. Newly discovered findings enter the same controlled graph rather than being hidden to maintain the original task count.

## Sprint strategy

| Sprint | Outcome | Mandatory entry sprints |
| --- | --- | --- |
| PF-S00 | Establish exact baseline, runnable toolchains, legacy/context inventory and trustworthy evidence. | None. |
| PF-S01 | Resolve final product contracts, authority, cycles, budgets, proof, scope and compatibility. | PF-S00. |
| PF-S02 | Canonical schema, revisions, immutable requirements, operations, integrity and migration foundations. | PF-S01. |
| PF-S03 | One pure deterministic domain decision, action, acceptance, dependency and rollup model. | PF-S01. |
| PF-S04 | Authenticated principals, safe bootstrap and project/workspace isolation. | PF-S02. |
| PF-S05 | Versioned service, durable operations, consistent snapshots and transaction plumbing. | PF-S02, PF-S03, PF-S04. |
| PF-S06 | Fenced multi-agent execution, resource ownership, leases, expiry and safe recovery. | PF-S05. |
| PF-S07 | Immutable profiles, genuine verification, receipts and sealed submissions. | PF-S05. |
| PF-S08 | Independent review, accepted closeout, explicit overrides and lifecycle reconciliation. | PF-S06, PF-S07. |
| PF-S09 | Milestones, cycle-backed sprints, assignments, dependencies and planning mutations. | PF-S02, PF-S03, PF-S04; T06 additionally joins PF-S08-T92. |
| PF-S10 | Exact read projections, rollups, readiness, reporting and actionable queues. | PF-S08, PF-S09. |
| PF-S11 | Versioned sources, citations, curated memory, recoverable publication and handoff. | PF-S05, PF-S07. |
| PF-S12 | v1 disposition/parity, migrations, consistent backup/restore and maintenance recovery. | PF-S08, PF-S09, PF-S11. |
| PF-S13 | Complete human and machine CLI/service parity. | PF-S10, PF-S12. |
| PF-S14 | Trusted workflow discovery and unfamiliar-agent, no-goal guidance across supported harnesses. | PF-S13. |
| PF-S15 | Complete terminal planning, execution, review, diagnostics and recovery experience. | PF-S13. |
| PF-S16 | Integrated real-service product conformance, including human and agent paths. | PF-S14, PF-S15. |
| PF-S17 | Adversarial security, fault injection, operational performance and sustained reliability. | PF-S16. |
| PF-S18 | Reproducible package identity, full installer payload and recoverable update paths. | PF-S12, PF-S15. |
| PF-S19 | Installed user onboarding, operator recovery, support and current documentation. | PF-S14, PF-S15, PF-S18. |
| PF-S20 | Exact-artifact, native-platform release qualification and independent cutover decision. | PF-S17, PF-S18, PF-S19. |
| PF-S21 | Explicitly authorized publication, published-channel installation and operational handover. | PF-S20. |

All named entry sprints mean their **T92 accepted revalidation**, not "development mostly finished." The task cards add precise leaf dependencies. [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) and `plan.json` are definitive if a summary omits a leaf join.

## Parallelism with real integration boundaries

The initial useful parallel branches are contracts-after-baseline, then domain versus persistence; later runtime versus verification and early planning; then source/memory versus lifecycle; then workflow versus TUI; then qualification/load versus packaging. Work in one sprint can also branch on disjoint files. These opportunities are eligibility sets, not guaranteed simultaneous throughput: a shared file or external reviewer can serialize them.

One task has one accountable worker. Additional reviewers are separately named. A worker cannot finish a task by leaving a patch for an unregistered root module or an unmodified shared command registry. The task remains awaiting integration until its root/module/schema/manifest changes are integrated and checked. The coordinator owns the merge queue, not the semantics of every lane.

Do not extract the critical graph into one giant issue and call it a sprint. Nor should every crate change become a new architecture. Existing monolithic `lib.rs`, service route and registry files are explicitly protected whole-file resources. A function boundary is not an edit lock.

## Required gates inside every sprint

`T90` independently reviews the integrated leaf work and records every finding or explicit `no_findings`. `T91` reconciles those findings, coordinates bounded corrective tasks and records the resulting source identity. `T92` reruns required checks on that exact combined tree and explicitly accepts or blocks successors.

A completed review with findings is not a passed sprint. A reconciliation is not a runtime pass. Revalidation never recycles a prior source's test totals as evidence for changed bytes. Corrective tasks are added explicitly with dependencies and write boundaries; prior failed attempts remain in history.

## Implementation approach

First recover the ability to compile/test and identify actual baseline failures. Next freeze the difficult product choices and executable oracles. Then establish canonical storage/authority and pure predicates before expanding commands and screens. Complete each vertical through domain, store, application, service and actual readback; do not leave ten new types disconnected behind an unavailable command.

Finalize legacy mapping and maintenance before promising upgrades. Run product conformance through the supported binary and service before native packaging qualification. Rebuild all package surfaces together; qualification applies to exact hashes. Documentation is independently exercised against installed bytes. Publication is the last externally authorized operation, followed by proof that future installations receive the qualified behavior.

## Definition of complete

Every mandatory task has an accepted handoff and appropriately scoped evidence; each sprint gate is accepted in graph order; all 56 cross-product acceptance requirements are proven; no required critical/high safety finding is open; decisions and migration effects are explicit; supported native packages and actual published installs are validated; operational ownership and rollback/incident paths are handed over. The declared release scope cannot be reduced through a hidden deferral in a sprint report.

No schedule or headcount is inferred from task count. Use actual accepted dependencies and available writers/reviewers to dispatch. See [BACKLOG_AND_NON_GOALS.md](BACKLOG_AND_NON_GOALS.md) for optional improvements that do not masquerade as completion blockers or excuse missing core behavior.

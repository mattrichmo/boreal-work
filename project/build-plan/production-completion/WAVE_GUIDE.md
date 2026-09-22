# Dependency waves and suggested lane allocation

These are dependency opportunities, not estimates or a calendar. A wave does not override leaf prerequisites or whole-file locks. PF-S00-T08 is a coordinator-approved remediation wave for the missing read-only workflow discovery capability; it must finish and be independently reviewed before PF-S00-T91/T92 can advance.

**Bootstrap:** PF-S00-T01 and T02 can start separately. Subsequent baseline tasks identify real toolchain, evidence and legacy/harness/native gaps. Complete the independent S00 chain before contracting.

**Contract freeze:** Independent topic drafting within PF-S01 can branch where its cards allow, while canonical decisions/manifest integration are serialized. No downstream lane chooses its own status or budget model.

**Foundations:** PF-S02 persistence and PF-S03 domain run in parallel after S01. PF-S04 identity follows S02. PF-S09 early planning starts after S02/S03/S04; its later lifecycle join remains blocked. PF-S05 service foundations integrate the core branches.

**Execution/proof/planning:** PF-S06 execution and PF-S07 verification branch from S05. PF-S08 joins both. PF-S11 source/memory begins after S05/S07. Early S09 continues on disjoint planning files; T06 waits for S08. Shared store/application/service roots remain serialized even across these sprints.

**Projection/maintenance:** PF-S10 joins S08/S09. PF-S12 joins S08/S09/S11. The two can progress in parallel where file scopes permit. PF-S13 public parity waits for both; do not expose unavailable routes as production features.

**Agent/terminal:** PF-S14 workflows and PF-S15 TUI branch after S13. PF-S16 real-service conformance joins them. PF-S18 package engineering begins after S12/S15 in parallel with conformance/security qualification; it cannot produce a final release decision early.

**Qualification/distribution:** PF-S17 adversarial/soak follows S16. PF-S19 installed documentation/support follows S14/S15/S18. PF-S20 joins S17/S18/S19 for exact-source/native qualification and independent cutover. PF-S21 publishes only with actual authorization, then validates the published channels and hands over operations.

Use the task cards to allocate a persistence steward, domain steward, interface steward, TUI worker, workflow/source worker, independent validators and release/native operators as they become eligible. This is a role model, not an assumption all those agents or machines are available. Fewer workers may serialize eligible tasks without changing the correctness graph.

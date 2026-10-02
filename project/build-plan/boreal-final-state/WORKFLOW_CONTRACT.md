# Required feature and workflow contract — revision 4

This is the release contract for the existing local product, not evidence that these workflows already pass. Each owner must start from the dispatched implementation, retain working behavior, repair the named seams and provide integrated evidence. Historical production-completion F1-F5 and `project/INTERFACES.md` supply inherited requirements; they are not new greenfield projects.

## Required journeys and owners

| Journey | Feature/workflow | Required observable outcome | Owning tasks |
| --- | --- | --- | --- |
| J01 | Install, choose authority, initialize/select | Folderless Global works. Project setup binds the intended project explicitly. Wrong/missing/ambiguous binding gives an actionable error, not a different database. | BW-S02-T04, BW-S07-T06, BW-S12-T06 |
| J02 | Capture first | Capture requires no category/project choice; it durably enters Inbox. Original text witness and digest remain distinguishable from edits; old provenance is not invented. | BW-S06-T02, BW-S06-T03, BW-S06-T04, BW-S07-T01 |
| J03 | Triage and bulk decisions | Classify, move, defer, link or archive through one authoritative mutation. Stale revisions reject safely; cancel/failed bulk triage loses neither draft text nor obligations. | BW-S06-T05, BW-S07-T01 |
| J04 | Daily review and Next | Overdue/due-today/waiting/unscheduled/later have explicit civil-time rules. Follow-up is not due; overdue survives midnight. Readiness respects unresolved dependencies, not only status labels. | BW-S05-T01, BW-S05-T02, BW-S05-T03, BW-S05-T04, BW-S05-T05, BW-S07-T02 |
| J05 | Manage the ongoing obligation | Edit/reparent relationships, reopen, archive, restore and inspect history without lost children or fake completion. A restored handed-off item cannot resend silently. | BW-S06-T05, BW-S07-T03, BW-S09-T04 |
| J06 | Find complete and truthful context | Search/pickers/pages are complete beyond snapshot samples. Pages name revision/freshness; invalid cursors request resnapshot. Unavailable linked work is not zero/complete and path reuse cannot silently retarget identity. | BW-S04-T01, BW-S04-T02, BW-S04-T03, BW-S04-T04, BW-S04-T05 |
| J07 | Intake to actionable plan | Capture/triage/defer/resolve/archive/promote Intake; draft hierarchy, acceptance configuration and publication produce eligible tasks. Publishing a parent does not implicitly publish or accept descendants. | BW-S12-T02 |
| J08 | Enroll and start ordinary workers | Empty-project onboarding yields authorized source/configuration, enrolled Agent and scoped session. Start/next carries identity and exact required inputs; no Operator impersonation is used to make automatic dispatch pass. | BW-S12-T03, BW-S07-T05 |
| J09 | Work to verified changed result | Claims retain immutable inputs. The actual changed result is captured/bound before proof. Wrong source/config/result/proof/fence or self-attested trusted evidence cannot earn acceptance. | BW-S12-T03, BW-S11-T05 |
| J10 | Interrupt, expire and resume | Define the harness owner of heartbeat and renewal separately. Restart/expiry/unknown replies require canonical readback and authorized recovery; stale workers cannot write or reclaim resources. | BW-S00-T05, BW-S12-T03, BW-S12-T06 |
| J11 | Independent review and accepted close | Review queues and approve/reject/return/revoke readback name the exact submission and role. Restart recovers receipts/summary; accepted close advances dependencies without erasing failed attempts or reviews. | BW-S12-T03 |
| J12 | Source, decision, memory and handoff | Source/decision/citation and curated memory flows are usable. Bounded context and final summary bytes survive the originating chat and temporary file. Missing, superseded, denied and stale material are explicit. | BW-S12-T04 |
| J13 | Revise a real plan safely | Fresh import and dry-run work; an existing prefix is amended without duplicate IDs or lost attempts. Work hierarchy is separate from cycles; carry-over/reparenting does not rewrite proof or silently weaken pinned acceptance. | BW-S12-T02, BW-S12-T03 |
| J14 | Hand off without duplicate obligations | Explicit eligible Send freezes intent, creates/reuses a receipt-bound Intake, resolves lost replies and archives the Global source. Edits/promotions/archive at the destination do not destroy receipt identity. Unknown is not safe cancellation. | BW-S08-T02, BW-S08-T03, BW-S08-T04, BW-S08-T05, BW-S09-T01, BW-S09-T02, BW-S09-T03, BW-S09-T04, BW-S09-T05 |
| J15 | Recover durable state | Backup scope is explicit; validated staged restore assigns fresh physical identity while retaining logical origin. Interrupted update restores a compatible package/Global pair. Missing source/artifact/memory material prevents a full-project recovery claim. | BW-S01-T01, BW-S01-T02, BW-S01-T03, BW-S01-T04, BW-S03-T03, BW-S03-T04, BW-S03-T06, BW-S08-T01, BW-S12-T04 |
| J16 | Use one typed agent contract | Required capabilities map to registered callable handlers. CLI, service, skills and a non-CLI client preserve the same outcomes and identity checks. Unavailable inputs/roles/capabilities yield a concrete next step. | BW-S12-T01, BW-S12-T05, BW-S05-T05, BW-S07-T05 |
| J17 | Run headlessly in an isolated environment | An installed compatible binary works without TUI/Node/Cargo at runtime. Explicit persistent roots survive restart; ephemeral destruction is not presented as recovery. Two workers share one authority; OS restrictions remain explicit failures/unsupported cases. | BW-S12-T06 |
| J18 | Ship the product, not a report | Supported artifacts, native installation and an authorized isolated real-work journey pass on exact identities. Representative budgets are declared before measurement. Final evidence covers all required journeys; optional experiments and unverified hosts are not advertised as shipped. | BW-S10-T01, BW-S10-T02, BW-S10-T03, BW-S11-T01, BW-S11-T02, BW-S11-T03, BW-S11-T04, BW-S11-T05, BW-S11-T06, BW-S11-T90 |

| J19 | Define general work and optional outputs | Description, prerequisite/context links and optional typed output requirements survive creation, templates, amendments and recovery; no-deliverable legacy work remains valid. | BW-S12-T01, BW-S12-T02 |
| J20 | Produce, inspect, review and accept artifacts | Required output coverage and exact artifact/input revisions govern close; command proof, automatic inspection and attributable human/independent decisions remain distinct. | BW-S12-T03, BW-S12-T04, BW-S12-T90 |
| J21 | Reuse accepted results across workers | Logo variants consume an exact accepted master; stale/missing/denied bytes and changed inputs are explicit, and relocation/restart preserves identity. | BW-S12-T04, BW-S12-T06, BW-S13-T03 |
| J22 | Manage dates and external waits | Optional due/planned/not-before/follow-up dates have civil-time semantics; a named wait blocks only dependents and resolves through an authorized attributable decision. | BW-S13-T01, BW-S05-T01 |
| J23 | See and operate the same general work everywhere | CLI, typed service, guide and TUI expose context, deliverables, dates, waits, profile and precise close blockers without a second lifecycle. | BW-S12-T05, BW-S13-T02 |
| J24 | Execute reusable mixed-work production | An enrolled worker and reviewer complete lightweight research and a versioned creative chain, with failed/revised outputs, parallel branches and a new repeated-case identity. | BW-S13-T03, BW-S13-T90, BW-S11-T02 |

## Cross-cutting rules

**One semantic authority.** Adapters never reimplement eligibility, completion, authorization, evidence applicability, Send resolution or database mutation. Global does not own Project attempts; a Project Intake receipt is not a completion receipt. Machine recovery is a separate local authority, not a broadly exposed agent tool.

**An action must be usable.** A required guide/next step identifies a registered operation, exact typed inputs and prerequisites. Missing user input or authorization gets an explicit intervention. A loop that repeatedly suggests inspecting the same record is not a complete workflow. No generic SQL/shell escape hatch is an acceptable parity fix.

**Identity survives retries, not arbitrary rebinding.** Preserve logical work/delivery identity separately from physical store activation and strict actor/session/revision-bound operation identity. Recheck authority and current revisions/fences inside mutations. Capability discovery, deterministic IDs and confirmation flags do not grant access. Unknown commit outcomes require authorized readback; no new operation/delivery ID solely to escape uncertainty.

**Context is bounded and attributable.** Source documents and authored commands are data. Trusted guidance comes from the registered workflow package. References declare scope, digest/version, freshness and retrieval limits. A temporary host path is not a portable artifact identity. No credentials in source plans, fixtures, diagnostics or handoffs.

**Stop safely.** Distinguish workflow cancellation, process stop, lease expiry, release, recovery and accepted completion. Preserve worktree/result evidence before reassignment. Do not force-break live locks. An active requirement/result change invokes the existing explicit policy and cannot silently reuse old proof.

## Evidence record

Read [GENERAL_WORK_CONTRACT.md](GENERAL_WORK_CONTRACT.md) for the required additive behavior and scope.

For each required journey, S11 records the current handler/command, test/fixture, exact source/binary/protocol identity, environment, actor roles, operation/result/receipt references, observed outcome and limitations. Use `pass`, `fail`, `unsupported` or `not_run` accurately. Core gaps stay blocking; unsupported future deployment modes stay outside the shipped support matrix. No invented measured latency or runtime completion status belongs in this plan.

The minimum final pilot uses a clean isolated project and non-sensitive fixture. Using a real Dabble repository/database/account requires separate explicit operator authorization and isolation; naming Dabble in the conversation does not grant access or permission to change it.

# Architecture decisions and approved owner choices

This file distinguishes hard constraints from current recommendations. Update
it when a decision changes and name the migration impact.

## Accepted constraints from product intent and audit

| ID | Decision | Reason |
| --- | --- | --- |
| D01 | Rust owns domain, storage, application workflow, runtime, and CLI. | Machine clients need one fast, durable implementation. |
| D02 | TypeScript is the preferred TUI client. | Preserve the useful current UI work while the core is replaced. |
| D03 | Agent harnesses share one claim/attempt protocol. | Separate paths caused divergent work, reservation, assignment, and session state. |
| D04 | Work, attempts, and audit events commit transactionally. | Partial closeout and orphan attempts are unacceptable. |
| D05 | Readers receive one revisioned snapshot without an exclusive app writer lock. | The old TUI/status path contended with workers. |
| D06 | Git does not coordinate operational work mutations. | Concurrent claims need database transactions. |
| D07 | Failed evidence and historical attempts remain inspectable. | Repair must not falsify provenance. |
| D08 | v2 is standalone from the legacy repository. | It will move to its own project. |
| D09 | The self-guiding CLI workflow, conditional statuses, trusted directives, and evidence-driven claim/finish path are Boreal core, not optional parity. | An unfamiliar agent must be able to make progress without a bespoke parent goal prompt; a CRUD-only rewrite would lose the product's central behavior. |
| D10 | Any working v1 behavior omitted from v2 launch requires an explicit keep/rework/defer disposition and user-visible limitation. | "Cleaner" must not silently mean fewer agent capabilities or weaker closeout. The parity inventory and no-goal acceptance test are cutover inputs. |
| D11 | Status and next action are deterministically derived; an agent cannot assert successful completion by setting a field or writing persuasive prose. | Preserve Boreal's proof-gated finish, conditional readiness, and automatic downstream progression from accepted outcomes. Normal upstream waiting is `queued`, not hard `blocked`. See [STATUS_MODEL.md](STATUS_MODEL.md). |
| D12 | A claim time limit that elapses before close flags the attempt/task for safe expiry review; it does not silently make work closed or blindly redispatch it. | Expiry must fence old writes, preserve evidence, and account for a still-running harness or shared worktree. |

## Approved v2 policy defaults

The product owner approved the initial policy direction in
[`spec/POLICY_DRAFT.md`](spec/POLICY_DRAFT.md) on 2026-09-14. These are
requirements for P0-03 fixtures, not claims that implementation exists.
The three final scope/default choices were approved by the owner on the same
date; P0-03 may now freeze fixtures against D13–D29.

| ID | Approved choice | Required negative/acceptance proof |
| --- | --- | --- |
| D13 | Initial agents share one host and one project service; remote multi-host claims require a later authenticated network boundary. | Two local harnesses race one claim; a network filesystem is not used as a shared SQLite work store. |
| D14 | Initial supported platforms are macOS and Linux; Windows support waits for transport/package verification. | Platform-specific service/CLI startup and unsupported-platform diagnostics are fixture-tested. |
| D15 | Active CLI/TUI use auto-elects one local Rust service; offline maintenance uses the same application rules behind an exclusive maintenance boundary. | Concurrent startup elects one owner; restart and unavailable outcomes do not create a second state machine. |
| D16 | Local project/OS boundary plus explicit agent, reviewer, operator, and publisher authority. Cancellation, override, and publication are reason-coded and audited. | An agent credential cannot perform an operator/publisher action; forged actor text or a lower-level CLI spelling cannot bypass authority. |
| D17 | One current fenced attempt per work item and one current execution per session. | Duplicate/parallel claims have one winner; replacement fences stale writes. |
| D18 | Persist a small work lifecycle and derive `queued`, `ready`, hard `blocked`, `complete`, `closed`, eligibility, and one next action from canonical graph/policy/attempt/gate/time inputs. | The same revision and clock produce identical CLI/API/TUI status and claim decisions; no direct agent-set success field. |
| D19 | A default prerequisite advances only on an accepted `closed` result; `verified`, `complete`, and `cancelled` do not count as success. Legacy exceptions are explicit versioned edge-policy/migration findings. | Close unqueues only valid successors; cancellation and verified-but-unclosed leave dependents ineligible unless an audited exception exists. |
| D20 | Renewable ownership lease and hard attempt time budget are distinct. Preserve v1 `--ttl` as a lease alias; v2 grammar uses `--lease-ttl` and `--time-limit` as separate typed values. A hard budget cannot be heartbeat-renewed. | Exact deadline, renewal, stale fence, restart, and CLI alias fixtures; D27 fixes the default hard duration. |
| D21 | Elapsed lease/budget while work is open fences the attempt and displays `expired_review`; safe stop/ownership reconciliation precedes replacement. Automatic retry is opt-in, isolated, bounded, and backed off. | Late timer still makes expiry effective on read/claim; shared worktree is not reassigned to a still-running agent. |
| D22 | `agent finish --close` remains the normal proof-gated path. A durable fenced close intent auto-finalizes when the last valid receipt/review satisfies the same attempt, source/config snapshot, and policy version; passing prose or passive tests alone never close work. | One current summary, idempotent finish, close-intent invalidation on source/policy/attempt change, failed evidence retained. |
| D23 | Versioned per-work acceptance profiles use structured verification/checkpoint/review/audit evidence; no universal prose shortcut. | Wrong command/subject/snapshot/attestation/exit/observable remain distinct typed gaps; D28 fixes when independent review is required. |
| D24 | SQLite owns live work, intake, drafts, and operational links. Git at a named revision owns published curated project memory; publication/reimport is a recoverable job outside work transactions. | Crash/reimport and fresh-clone fixtures preserve citations and human edits. |
| D25 | Keep high-value v1 agent/work/sprint/evidence/memory/health CLI meanings and the no-goal `guide`/`next` loop. `status` remains the v1 prime alias; tasks/milestones remain work kinds. | P4-11 command and unfamiliar-agent parity; omitted commands have explicit keep/rework/defer disposition. |
| D26 | Initial curated memory is project-scoped. Cross-project sharing requires an explicit later import/grant with preserved source provenance. | A source or published note from another project cannot silently enter retrieval or authorize a task transition. |
| D27 | A claim without an explicit `--time-limit` has a two-hour hard completion deadline, measured from authoritative `claimed_at`. The renewable ownership lease remains a separate clock. An explicit time limit overrides the default; heartbeats do not extend either hard budget. | Default and explicit-budget virtual-clock fixtures at the exact boundary; late sweeper and expiry-review safety remain D21. |
| D28 | Independent review is required only when the task's versioned acceptance profile contains a review gate. Normal verification and proof-gated finish still apply without a review gate. | Profile-with-review cannot close without authorized review; profile-without-review can close on valid required proof and finish intent, without fabricating review. |
| D29 | M01 launches the local CLI, TUI, source/memory bank, and guided agent workflow. The old web console, global manager, remote multi-host agents, and automatic agent spawning are deferred with explicit parity impact. | Launch acceptance covers the guided no-goal path and local multi-harness claims; P0-04/P4-11 record omissions and P5-08 approves material deferrals. |

## Recommended, to validate with prototypes

| ID | Recommendation | Tradeoff / validation |
| --- | --- | --- |
| R01 | One SQLite WAL database per local project. | Fits same-host readers + one writer; measure transaction length, WAL growth, and checkpointing. Do not share the file over a network filesystem. |
| R02 | One Rust service per active project for subscriptions, liveness, scheduling, and queued writes. | Adds process lifecycle. Correctness remains in Rust application/store transactions so recovery/offline maintenance does not fork policy. |
| R03 | Local HTTP over a Unix socket, with versioned JSON DTOs. | Easy TS/Rust client boundary; needs service election, socket permissions, and Windows equivalent if supported. |
| R04 | Git publication mechanics: dedicated worktree, deterministic manifest, and idempotent reimport. | D24 fixes authority; P3 prototypes validate the mechanism and conflict recovery. |
| R05 | Agents pull ready work first; automatic dispatch is an optional service loop using the same claim transaction. | Reduces initial scheduler complexity; launch/observe/cancel adapters remain useful later. |
| R06 | Content-addressed blobs hold large source and output bytes. | Requires backup/GC policy and manifest integrity checks. |
| R07 | Efficient representation of close-only edge satisfaction and incremental downstream recomputation. | D19 fixes semantics; P1 benchmarks exact graph/revision behavior and migration impact. |
| R08 | Resumable close-intent implementation with one atomic final close transaction. | D22 fixes behavior; P2 validates crash/idempotency without holding the writer during evidence execution. |

## P0-03 engineering choices

The owner choices D27–D29 are settled. The remaining engineering choices—
exact default lease TTL, local socket protocol, role credential format,
source/blob layout, and initial acceptance
profile details—can be fixed by P0-03 under D13–D29, independently reviewed
at P0-05, and changed only with a versioned decision and fixture. They are
not permission to weaken evidence or silently broaden launch scope.

## Production-completion contract adoption record (PF-S01-T11)

This record integrates the independently reviewed PF-S01 contract artifacts;
it does not pretend that implementation or release evidence already exists,
and it does not silently supersede D01–D29. The accepted artifact boundaries
remain subject to PF-S01-T90/T91/T92 and the later implementation gates.

| Contract | Artifact | Integrated meaning | Runtime claim |
| --- | --- | --- | --- |
| scope/authority | `spec/production/scope-and-boundaries.md` | Rust/application/store/service authority, project-local identity, role boundaries, guided workflow, and explicit non-goals | target contract only |
| identity/revisions | `spec/production/identity-revisions-authority.md` | project/database/restore/entity/proof/attempt/operation identities and authenticated actor context | target contract only |
| work model | `spec/production/planning-and-cycle-contract.md` | milestone/task decomposition, cycle assignment history, container closeout, carry-over and readiness | target contract only |
| execution/submission | `spec/production/execution-submission-contract.md` | distinct lease/hard budget, sealed submission, review/closeout, recovery and unknown outcomes | target contract only |
| status/actions | `spec/production/status-and-actions.md` and `reason-registry.json` | status/3, integrity/availability axes, deterministic reasons and server-owned actions | target contract only |
| acceptance/proof | `spec/production/acceptance-and-proof.md` and `profile-registry.json` | immutable profile definitions, pinned requirements, proof selection and review independence | target contract only |
| dependencies/overrides | `spec/production/dependencies-overrides-reopen.md` | accepted-close prerequisite policy, reasoned exceptions, reopen and downstream impact | target contract only |
| service/protocol | `spec/production/service-contract.md` and `compatibility-matrix.md` | one service boundary, typed envelopes, jobs, readback, compatibility and route/use-case mapping | target contract only |
| security/release | `spec/production/release-support-and-budgets.md` | target platforms, measurable budgets, isolation/security, artifact trust, backup/restore and RPO/RTO | target contract only |
| source/memory/parity | `spec/production/source-memory-parity.md` | project-scoped source and curated memory, retained v1 disposition and provenance | target contract only |

The contract revision is `boreal.production-contract/1`. No client may infer
that the target capabilities are available merely because this record exists;
the protocol manifest marks them as target identities until implementation,
conformance, native, and release evidence authorize runtime advertisement.

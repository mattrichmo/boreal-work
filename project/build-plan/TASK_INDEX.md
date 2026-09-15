# Task index and dependency graph

IDs here are stable planning references, not created `bwrk` IDs. All leaves
belong under one Boreal v2 delivery milestone and the indicated P0–P5 phase
container. A dependent may start only after every listed prerequisite has a
passing or explicitly approved disposition. Do not mark phase containers ready
as if they were claimable leaves.

Each acceptance statement below names an observable artifact or behavior.
The [vertical handoffs](verticals/) and [review gates](REVIEW_GATES.md)
specify the evidence and failure cases in more detail.

## P0 — Contracts and baseline

| ID | Leaf task | Depends on | Observable acceptance |
| --- | --- | --- | --- |
| P0-01 | Resolve product and deployment decisions | — | [`../DECISIONS.md`](../DECISIONS.md) records chosen memory authority, host boundary, service startup, supported platforms, and completion policy with tradeoffs and owner. |
| P0-02 | Capture legacy performance and failure baseline | — | Repro matrix records observed vs inferred failures and operation timings/bytes for a fixed workload; live locks are preserved. |
| P0-03 | Freeze v2 domain, guidance, CLI, schema, and protocol fixtures | P0-01 | Versioned fixtures implement [`STATUS_MODEL.md`](../STATUS_MODEL.md): queued vs hard blocked, claimed/in-progress, complete vs closed, exact deadline/expired-review, gate-bound auto-finalization, close-only default dependency satisfaction, and trusted next action; command grammar, receipt, SQLite, conflict/busy/stale/unknown outcomes are fixed too. |
| P0-04 | Inventory legacy migration data and workflow/CLI parity | — | Representative fixture inventory maps work, edges, attempts, evidence, Git refs, memory, directives, command paths, and claim/finish workflows; every behavior is marked keep, rework, or intentionally defer. |
| P0-05 | Independent contract review | P0-02, P0-03, P0-04 | Reviewer records findings by severity against concurrency, lifecycle, self-guiding agent behavior, Git publication, import, and TUI contracts, including a no-change disposition if none. |
| P0-06 | Reconcile contract-review findings | P0-05 | Every finding is resolved or deferred with owner and gate; affected docs/fixtures are updated and rerun checks named. |
| P0-07 | Revalidate contracts | P0-06 | Schema/protocol/guidance fixtures, conditional transitions, and migration/parity mapping pass agreed checks after reconciliation; unresolved blockers prevent P1. |

## P1 — Work domain and transactional store

| ID | Leaf task | Depends on | Observable acceptance |
| --- | --- | --- | --- |
| P1-01 | Implement typed work model and transitions | P0-07 | Typed IDs/kinds/base statuses, parent hierarchy, terminal-state rules, and legal/illegal conditional transition fixtures match the approved v1-to-v2 status map. |
| P1-02 | Implement conditional status, dependencies, readiness, and rollups | P1-01 | Effective queued/ready/blocked/claimable state and all reasons derive from canonical work, dependencies, policy, time, and current attempt; prerequisite close unqueues only valid successors; release cannot erase an operator-only or hard-block condition; cycles fail and rollup totals are exact. |
| P1-03 | Create SQLite schema and migrations | P0-07 | Fresh and upgraded fixtures open with foreign keys, unique active-attempt/session constraints, revision table, audit/event tables, and integrity checks. |
| P1-04 | Implement transaction, idempotency, and minimal atomic claim | P1-01, P1-02, P1-03 | Work mutation/claim plus audit event plus revision commit atomically; competing claimers yield one current attempt; duplicate operation ID returns original result. P2 adds accept-through-finish lifecycle. |
| P1-05 | Implement revisioned read queries | P1-02, P1-04 | Work detail and dashboard use one short read snapshot; true totals and bounded rows agree; no application writer lock is taken for reads. |
| P1-06 | Implement project/work/sprint use cases | P1-02, P1-05 | Rust application calls create/show/list/activate/dep operations and produces deterministic revisions and typed errors. |
| P1-07 | Independent domain/store review | P1-06 | Reviewer inspects transition coverage, schema constraints, lock scope, query plans, crash paths, and migration compatibility; findings are recorded. |
| P1-08 | Reconcile domain/store findings | P1-07 | Accepted fixes land, contracts/migrations/tests change together, and deferrals have owner and gate. |
| P1-09 | Revalidate domain/store | P1-08 | Focused and combined tests pass on a fresh DB and upgrade fixture; concurrent readers remain available during writes. |

## P2 — Attempts, runtime, protocol, and CLI

| ID | Leaf task | Depends on | Observable acceptance |
| --- | --- | --- | --- |
| P2-01 | Implement one fenced attempt lifecycle | P1-09 | Claim/accept/release/expire/cancel/finish share one transaction path; competing claimers yield one current attempt; stale writes fail; lease expiry is effective before reaper persistence and never reassigns a still-running shared worktree. |
| P2-02 | Implement structured receipts and closeout | P2-01 | Command/source/config/exit/output/attestation fields decide verification, checkpoint, review, and audit gates; prose changes do not; finish is idempotent, optionally auto-finalizes only a matching durable close intent, and releases the correct attempt. |
| P2-03 | Build local Rust service and fair writer queue | P1-09 | One project service is elected; concurrent startup connects or gets typed busy; queue wait and DB hold are separate metrics; crash restart recovers. |
| P2-04 | Build versioned protocol and Rust CLI | P2-01, P2-03 | The CLI keep contract has stable command grammar/aliases and JSON fixtures; exit classes match application outcomes; every response has operation ID and revision. |
| P2-05 | Add session liveness and pull/dispatch eligibility | P2-01, P2-03 | Heartbeat differs from progress and cannot extend a hard time budget; at deadline the attempt is fenced, cancellation/review is visible, and automatic retry is bounded/opt-in; operator-only/paused/hard-blocked work never redispatches after release; capacity uses live claims. |
| P2-06 | Add bounded status and revision notifications | P2-04, P2-05 | Routine status stays bounded with 10,000 historical attempts; TUI/CLI clients can resume a revision cursor or resnapshot after a gap. |
| P2-10 | Build versioned agent directive/obligation compiler | P2-02, P2-05 | One Rust-owned snapshot-to-guidance path emits trusted advisory/required/blocking obligations, missing evidence, blockers, recovery, and next-step reasons without treating task prose as instructions. |
| P2-11 | Restore guided agent CLI loop and handoff | P2-04, P2-10 | `agent guide`, `next`, start/claim, checkpoint/verify, finish/release, and resume expose exact safe actions and contextual task/acceptance/memory references through one versioned API; no-goal entry works. |
| P2-12 | Verify no-goal multi-harness workflow parity | P2-06, P2-11 | An unfamiliar agent from each supported harness distinguishes queued from blocked and expired review, discovers ready work, claims, follows conditional directives, attaches evidence, verifies, closes/releases, and resumes without a bespoke parent prompt or blind polling. |
| P2-07 | Independent runtime/protocol/guidance review | P2-02, P2-06, P2-12 | Reviewer tests crash boundaries, conditional status, directive trust, no-goal progression, session adoption, cancellation fencing, service election, and unknown mutation outcomes. |
| P2-08 | Reconcile runtime/protocol findings | P2-07 | Findings update transitions, schema, protocol fixtures, implementation, and follow-up ownership as applicable. |
| P2-09 | Revalidate runtime/protocol/guidance | P2-08 | Three harness processes complete the self-guided claim/evidence/finish loop while a reader observes consistent status through a service restart; required directives cannot be skipped. |

## P3 — Source, memory, repair, and provenance

| ID | Leaf task | Depends on | Observable acceptance |
| --- | --- | --- | --- |
| P3-01 | Add content-addressed blob and source intake | P2-09 | Immutable versions carry digest, origin, size, scope, availability; duplicate intake is idempotent and missing blobs are diagnosed. |
| P3-02 | Add extraction jobs and versioned search | P3-01 | Slow parsing runs outside work transactions; index lag is reported; stale parser output cannot cite a newer source. |
| P3-03 | Add cited draft memory and review | P3-01, P3-02 | A draft cites exact source versions, stays project-scoped, and cannot masquerade as published knowledge. |
| P3-04 | Add Git publication and reimport | P3-03 | Dedicated memory worktree publishes deterministic manifest/files; crash at each boundary retries without duplicate publication or lost human edits. |
| P3-05 | Add bounded retrieval and context views | P3-02, P3-04 | Hits identify raw/draft/published state, source version, Git commit, trust and index revision; results are bounded and cited. |
| P3-06 | Add doctor, retention, and stable repair | P2-09, P3-04 | Doctor separates current corruption from historical warnings; supported repair converges, second repair is no-op, failed evidence remains. |
| P3-07 | Independent memory/provenance review | P3-05, P3-06 | Reviewer inspects path/scope checks, publication recovery, citation integrity, prompt/data boundary, blob backup, and repair semantics. |
| P3-08 | Reconcile memory findings | P3-07 | Findings are resolved or assigned; schema/manifests/index/receipts and checks are updated together. |
| P3-09 | Revalidate memory | P3-08 | Fresh clone restores published memory; source ingest and Git publication do not materially extend claim transaction holds. |

## P4 — TUI, migration, packaging, and docs

| ID | Leaf task | Depends on | Observable acceptance |
| --- | --- | --- | --- |
| P4-01 | Generate/validate TypeScript API client | P2-09 | TS types and runtime validators match Rust protocol fixtures, including version mismatch and failed envelopes. |
| P4-02 | Build core TUI workflow | P4-01 | User can create milestone/sprint/task, activate sprint, see the same contextual next steps/required gates as CLI, claim, attach receipt, release, and finish through the service. |
| P4-03 | Build monitoring and refresh views | P4-01, P4-02 | Now/ready/sprint/milestone/task views show true totals, one revision plus `as_of` per detail, distinct queued/blocked/complete/closed and expired-attempt labels/reasons, live attempts, and immediate revision/timer-driven refresh. |
| P4-04 | Build legacy export/import with dry run | P3-09 | Real fixtures preserve supported work, conditional status/eligibility/gate meaning, attempts, evidence, memory, and Git refs; unsupported data is listed without silent loss. |
| P4-05 | Package and pin runtime/toolchain/workflow assets | P4-10 | Clean install resolves one immutable CLI/service/directive/workflow identity; upgrade pause/rebase/resume and rollback probes succeed. |
| P4-10 | Port core canonical workflow assets | P2-09, P3-09 | Versioned, packaging-ready route/context/plan/claim/evidence/finish/review/audit/handoff/health workflows have typed inputs, allowed actions, finish criteria, and next refs; all use the Rust guidance/transition path, not a second state machine. |
| P4-11 | Verify legacy workflow parity | P4-03, P4-04, P4-05, P4-10 | For each high-value v1 workflow, a scripted and unfamiliar-agent run against packaged v2 records keep/rework/defer disposition, conditional next steps, evidence/gates, and an honest approved gap; no core route is silently lost. |
| P4-06 | Write operator and harness documentation | P4-03, P4-04, P4-05, P4-10 | Fresh agent/user can install, initialize, start without a bespoke goal, follow `guide`/`next` through planning, claim/evidence/finish/recovery/handoff, publish memory, and inspect errors using version-matched examples. |
| P4-07 | Independent UI/migration/release review | P4-03, P4-04, P4-05, P4-06, P4-11 | Reviewer executes mounted TUI actions, core workflow parity, import dry run, install/upgrade, and docs commands; findings are recorded. |
| P4-08 | Reconcile UI/migration/release findings | P4-07 | UI, importer, package, and docs findings are resolved or explicitly deferred with owner and gate. |
| P4-09 | Revalidate UI/migration/release | P4-08 | Fresh install and imported project complete the TUI/CLI/core workflow and memory loops after reconciliation, with no unapproved essential parity gap. |

## P5 — Load, fault, security, integration, and cutover

| ID | Leaf task | Depends on | Observable acceptance |
| --- | --- | --- | --- |
| P5-01 | Run controlled concurrency benchmark | P4-09 | Same workload/validation runs at 1/3/10/30/50 agents, TUI on/off; p50/p95/max wait/hold and throughput are recorded against legacy. |
| P5-02 | Run crash, clock, and reorder matrix | P4-09 | Fault injection covers each attempt, source, and Git publication boundary, duplicate/reordered notifications, service restart, stale fences, exact lease/budget deadline, renewal/finish/expiry races, and an unresponsive worker in a shared worktree. |
| P5-03 | Review permissions and resource limits | P4-09 | Socket, project paths, source URLs, Git worktree, blobs, response refs, and memory scopes have tested boundaries and bounded resource use. |
| P5-04 | Run full integration/compatibility matrix | P5-01, P5-02, P5-03 | CLI/TUI/API/importer/doctor/package and no-goal agent-loop tests pass on supported platforms; validation identifies source snapshot, directive registry, and toolchain. |
| P5-05 | Independent release critique | P5-04 | Reviewer records correctness, performance, migration, self-guiding workflow parity, and usability findings, including no-change disposition if appropriate. |
| P5-06 | Reconcile release findings | P5-05 | Each finding is fixed, accepted as no-change, or deferred with owner, follow-up, and impact on launch gate. |
| P5-07 | Revalidate release candidate | P5-06 | Affected and full checks rerun after reconciliation; unresolved critical integrity, security, or essential guided-workflow parity findings block cutover. |
| P5-08 | Extract v2 and decide cutover | P5-07 | V2 builds outside legacy checkout; data migration and rollback are rehearsed; release notes name every supported/approved-deferred behavior and measured limits; no core agent loop gap remains. |

## Dependency rule

P2-10 through P2-12 and P4-10/P4-11 were inserted after the original leaf
IDs were issued; their IDs are intentionally not presentation-order numbers.
They are required release gates, not optional follow-up tasks. P1 starts only after P0-07;
P2 after P1-09; P3 after P2-09; P4 work may start
from its per-row prerequisites but phase acceptance requires P3-09 and P4-09;
P5 starts only after P4-09. If a revalidation finds a new issue, return to
that phase's reconciliation task and rerun the affected checks. Never advance
from a finding-producing review or validation result directly.

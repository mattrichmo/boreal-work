# Proposed final architecture and product contract

**Status:** proposal for PF-S01 resolution. This document records the target behind task cards; it does not silently amend existing approved decisions. Read the [decision register](reference/DECISION_REGISTER.md), original M02 and exact source excerpts. Where policy changes are rejected, amend affected tasks and conformance rules before implementation.

## Authority and boundaries

CLI, terminal UI and agent harnesses call one versioned local Rust service. The application authenticates the principal/project context and coordinates use cases. The domain owns canonical predicates, statuses, action permissions, acceptance, dependencies, rollups and transition legality. The store rereads canonical facts, applies constraints and commits outcomes/events transactionally. Service/runtime code owns transport, local service election and recoverable external execution, not a competing policy engine.

SQLite is operational authority. Git holds deliberately curated published memory; it does not coordinate active claims. Verifiers and runtime processes create attributable observations through supported boundaries. TUI, workflow Markdown and harness prose are never authoritative transition engines. Projections/indexes are rebuildable and versioned; no client-writable display-status field exists.

## Canonical entities

| Entity | Responsibility and key boundary |
| --- | --- |
| Project | Portable namespace/policy identity; authorized membership; validated workspace and database bindings. |
| Workspace binding | Explicit association of a project/database instance with an allowed root/worktree; relocation/clone requires disposition. |
| Milestone | Desired outcome, task decomposition and revisioned scope acceptance. Not a claimable task. |
| Task | Stable executable identity, requirements, profile, dependencies and historical outcomes. |
| Cycle/sprint | Scheduling commitment with planned/active/completed/cancelled policy; legacy sprint IDs map to one canonical cycle, not duplicate authority. |
| Assignment | Historical task-to-cycle commitment; atomic carry-over; initially at most one live assignment per task. |
| Profile/requirement | Immutable versioned acceptance definition pinned independently of observed gate rows. |
| Attempt/reservation | One fenced ownership episode with principal/session, deadlines and enforceable resource disposition. |
| Submission | Proposed immutable result bound to proof-relevant revision, source/configuration and originating attempt/fence. |
| Observation/receipt | Append-only verifier outcome with complete subject and artifact identity; failed and stale observations remain facts. |
| Review decision | Typed approve/reject/return/revoke result by an authorized independent principal against the exact result context. |
| Accepted outcome | Durable closure decision identifying the submitted proof and any explicit exceptions. |
| Hold/recovery obligation | Durable intervention state independent of whether an attempt remains current. |
| Override/waiver | Narrow, reasoned, revision-bound authorization decision; does not falsify raw proof or delete an edge. |
| Operation/event | Durable idempotency identity, request digest, outcome and auditable before/after references. |
| Source/memory | Versioned source identity and citations; operational drafts separate from curated Git publication. |

Do not make one integer serve as entity revision, project snapshot revision and execution fence. Distinguish proof-relevant revision, database restore epoch and service connection identity as well. An unrelated heartbeat must not invalidate every planning confirmation; a restore must not revive old write authority.

## Decisions with material implementation consequences

The cycle-backed target changes the provisional fixed-tree compatibility strategy. Preserve task identity through carry-over and milestone ownership; expose familiar sprint grouping as a view/adapter. Do not make both sprint rows and cycles writable authorities.

The proposed sealed-submission model ends execution ownership after safe submission while review can continue independently. Existing D27 is a two-hour completion budget, so this change is not assumed approved. PF-S01-T04 must state whether deadlines remain end-to-end or execution-only, how pending close intents survive, and how source changes invalidate results. Task implementations consume that decision, not a personal preference.

Accepted-close-only task dependencies remain the default. Container ordering is not automatically executable proof. Reopen needs an explicit upstream/downstream impact policy: new claims must not consume revoked acceptance, active consumers may need reconciliation, and historically closed consumers are not rewritten silently.

## Deterministic status response

Return separate **availability** (live/stale/unavailable/incompatible), **integrity** (valid/degraded/quarantined) and **product status**. If required identity/acceptance facts cannot be trusted, return scoped diagnostics and denied unsafe actions rather than fabricate a normal state. A missing historical log attachment is not automatically identical to invalid accepted-outcome identity; freeze that distinction.

The following is the proposed task precedence, to be approved/versioned in PF-S01 and implemented once in PF-S03:

| Priority | Primary status | Qualifying meaning |
| --- | --- | --- |
| Integrity precondition | Diagnostic/quarantined | The facts needed for a safe decision are inconsistent or unreadable. Not an ordinary queued task. |
| 1 | closed / cancelled | A valid explicit terminal outcome. Mutually contradictory terminal facts are corruption. |
| 2 | expired_review | Expired authority with unresolved safe disposition, even without a current-attempt pointer. |
| 3 | blocked | Applicable hard hold, unresolved rejected review or explicit intervention obligation. |
| 4 | draft | Not published for execution. |
| 5 | claimed | Valid owned attempt, not accepted by runtime. |
| 6 | in_progress | Current accepted/running execution. |
| 7 | needs_verification | Submitted/current result lacks valid required technical proof; missing/failed/stale reasons remain distinct. |
| 8 | awaiting_review | Technical proof satisfied; required independent review unresolved. Rejection is not this state. |
| 9 | complete | Required proof/review passed for a valid result; accepted closeout remains. |
| 10 | paused | Idle dispatch explicitly paused; does not silently kill an active executor. |
| 11 | retry_wait | Authorized retry before its not-before time, with no higher condition. |
| 12 | scheduled | Required start/cycle constraint; only with explicitly accepted status-version compatibility. |
| 13 | queued | Ordinary required prerequisite lacks accepted closed outcome. |
| 14 | ready | Published executable work has no remaining execution policy/prerequisite barrier. Actor-specific permission is separately returned. |

Collect applicable reasons before selecting a primary. Return versioned, stable reason priority plus subject identity, preserve primary reason first, deduplicate identical facts without merging different prerequisite subjects, and report `as_of`/next reevaluation time. A due date creates an overdue badge, not a stolen or extended lease. Deadline equality is expired, not a grace period invented by a client.

Queued means normal dependency waiting: display "Queued — waiting for TASK-A." Upstream intervention can be a secondary reason without propagating an invented hard hold through every descendant. An operator-only ready task remains ready with claim denied to an agent. Actions are evaluated against canonical predicates, not inferred from a display label. Stop/recovery/history actions may remain available while progress is blocked.

## Transition contract to freeze and test

| Operation | Preconditions | Canonical outcome / must-not behavior |
| --- | --- | --- |
| Initialize/rebind | Explicit authorized bootstrap; confined path and identity agreement. | Create/bind project intentionally; never select a foreign global fallback. |
| Publish/edit work | Authorized planner, valid requirements/hierarchy, expected entity revision. | Change canonical work facts; invalidate proof only according to declared relevance. |
| Activate cycle | Revisioned valid scope/readiness. | Commit activation/assignments; queued children can be legitimate; no implicit claims. |
| Claim/accept/start | Authenticated principal/session, current policy, valid revision/fence/clock/resource state. | One current owner; stale or foreign claimant cannot write. |
| Checkpoint/verify | Correct subject, authorized process/adapter and declared verifier policy. | Append observation, command/environment/artifact identity; arbitrary "pass" JSON is not valid proof. |
| Submit/finish | Current execution authority and safe handoff. | Seal result/register close intent; release ownership only under chosen budget/submission contract. |
| Review | Authorized independent principal, exact submitted context. | Append typed decision; retain rejected/superseded history. |
| Close | Current accepted intent, required proof/review/disposition or explicit exceptions. | Atomic accepted outcome, lifecycle close and audit; only then default dependents unblock. |
| Pause/resume | Authorized policy change at target revision. | Change dispatch policy; not an implicit stop or unlimited lease extension. |
| Fail/retry | Legal attempt transition, resource disposition and retry policy. | End attempt; explicit retry time or intervention obligation; preserve failed proof. |
| Expire | Canonical deadline reached, even before sweep. | Fence executor, retain recovery obligation and reconcile external process/resource ownership. |
| Stop/release assignment | Owner/operator with safe process/resource disposition. | End execution ownership without task success or deletion of holds. |
| Cancel | Authorized withdrawal plus active-runtime/dependent disposition. | Cancel only with defined safe reconciliation; cancellation is not prerequisite success. |
| Reopen | Authorized reason, expected accepted outcome/revision and impact review. | New proof generation; preserve old outcome and invalidate downstream use explicitly. |
| Force/waive/revoke | Authorized, narrow, reasoned, revision-bound and idempotent. | Append decision; preserve raw failed gate/edge; revocation does not erase accepted history. |
| Carry over/close container | Valid assignment/scope revisions and explicit remaining-work dispositions. | Historical linkage and exact rollup acceptance, not fabricated container execution. |
| Backup/restore/upgrade | Exclusive maintenance and compatibility gates as required. | Coherent identity/artifacts; restore epoch revokes old authority; no silent unsafe downgrade. |

## Failure, trust and operational boundaries

A database fence does not stop a process editing a shared worktree. Runtime ownership and safe replacement need isolated worktrees or enforceable resources plus stop/reconciliation checks. Identity authentication does not defend against an agent with unrestricted ability to overwrite the local database; define the actual local OS trust boundary instead of promising tamper-proof isolation.

External side effects are recoverable jobs, not long SQLite transactions. Persist enough operation context to distinguish rejected, committed, pending and unresolved outcomes. A timeout is not a failed mutation. "Operation not found" alone cannot prove rejection while an original request may still arrive. Bind retries to an operation ID and immutable payload digest; close late-arrival ambiguity explicitly.

Sources require stable versions, bounded citations and invalidation semantics. Curated memory publication spans SQLite and Git, so record/recover each stage; a Git commit that already happened must be read back, not fabricated or blindly duplicated. Retention honors acceptance, review, backup and publication references. Project-local diagnostic exports redact credentials and exclude foreign paths.

Release qualification identifies actual source and binary/assets/SQLite identities. Consistent backup includes the referenced blobs and Git state, not a database-file copy with an aspirational success label. Package/update activation must be atomic across all required assets and distinguish binary rollback from schema recovery.

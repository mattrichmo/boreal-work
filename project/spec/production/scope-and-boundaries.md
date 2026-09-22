# Boreal local production scope and authority boundaries

**Contract status:** proposed launch contract for PF-S01-T01; it becomes
authoritative only after PF-S01 review, reconciliation, and revalidation.

**Target product:** a project-scoped, local Boreal operating system for
agentic work on supported macOS and Linux hosts. The first production form is
same-host and service-backed: multiple agents, a CLI, and the TypeScript TUI
share one project-local Rust service and one canonical project database.

## What production-ready means

Boreal is production-ready for the initial launch when a fresh project can
reliably support the following through the public CLI/service/TUI boundary:

- create and inspect a project-local work plan containing milestones, sprints,
  tasks, dependencies, acceptance requirements, and active scheduling scope;
- guide an unfamiliar agent from a bounded context to one safe next action,
  including no-goal idle, claim, evidence, finish/release, handoff, and
  recovery outcomes;
- allow concurrent local agents to claim distinct work while the application
  and store enforce one current fenced attempt per work item and session;
- derive status, reasons, eligibility, actions, timers, rollups, and counts
  deterministically from canonical revisioned facts;
- preserve failed evidence, attempts, rejected operations, review decisions,
  and recovery obligations rather than turning them into successful history;
- keep project identity, workspace binding, database, cache, service state,
  source references, memory, and operation readback isolated to the selected
  project;
- validate structured evidence and acceptance profiles before closeout, with
  explicit authorized exceptions that retain the failed or unmet fact; and
- recover safely from restart, unavailable service, interrupted operations,
  expiry, stale fences, and readback-unknown outcomes without a second policy
  engine or live-lock force break.

Production-ready does not mean every planned vertical exists. It means the
declared local product is complete at its supported boundaries, its omissions
are visible, and every claimed behavior has evidence from the actual built
source and supported service path.

## Authority model

The dependency direction is fixed:

```text
CLI / TUI / agent harnesses
        ↓
versioned local service API
        ↓
Rust application use cases
        ↓
domain decisions + transactional store
        ↓
project-local operational database
```

| Concern | Authoritative owner | Boundary rule |
| --- | --- | --- |
| Work, attempt, dependency, gate, status, and transition invariants | Rust domain + application | Adapters cannot choose lifecycle outcomes by label or prose. |
| Canonical rows, revisions, uniqueness, audit events, and transaction boundaries | Rust store | External commands and Git work happen outside the committing transaction. |
| Request/response/event vocabulary | Versioned protocol | Additive evolution must remain readable by supported clients and preserve typed errors. |
| Writer election, subscriptions, liveness, queues, timers, and recoverable external jobs | Rust service | The service coordinates execution; it does not create a competing policy engine. |
| CLI syntax, exit codes, setup, and service connection | Rust CLI | Direct/offline maintenance reuses the same application/store policy behind an exclusive boundary. |
| Rendering, navigation, input, confirmation, and responsive presentation | TypeScript TUI | The TUI consumes service DTOs; it never reads canonical SQLite or reimplements action policy. |
| Agent guidance and workflow assets | Rust application, versioned with the release | Guidance is trusted routing metadata, not authorization. |
| Curated published project memory | Git-backed publisher at an explicit revision | Publication is a recoverable job; Git does not coordinate live work mutations. |

Every consequential mutation must authenticate its context, reread the
canonical facts inside its committing transaction, evaluate the requested
action, enforce the applicable revision/fence/deadline/authority rules, and
commit the result and audit event together. A timeout is not a failed mutation
until operation readback establishes the outcome.

### Role boundaries

The local product recognizes four distinct authority classes. A caller-supplied
actor label is not authentication, and a lower-level command spelling cannot
upgrade a role.

| Role | May do | May not do without a separate authorized operation |
| --- | --- | --- |
| Agent | discover context, claim/start its own eligible attempt, checkpoint, attach attributable evidence, submit/finish/release its own attempt, and request recovery | operator holds/cancellation/overrides, independent review, curated publication, signing, or another actor's attempt |
| Reviewer | inspect the exact submitted subject/revision and record an independent declared review decision | review its own attempt, rewrite proof, grant a hidden exception, or publish memory/software |
| Operator | pause/resume, reconcile expiry/failure, cancel, release resources, authorize narrowly scoped reasoned exceptions, and manage project work policy | erase failed history, fabricate proof, self-review a required independent gate, or sign/publish without publisher authority |
| Publisher | publish curated memory or an authorized software artifact with explicit revision, digest, and audit/readback | mutate live work status, bypass acceptance requirements, or turn publication into a claim/close transaction |

The application/store enforce these boundaries transactionally and emit typed
denials. The TUI and CLI only present the server-provided actions.

## Three distinct product concepts

Planning scope, execution ownership, and acceptance proof are intentionally
separate:

1. **Planning identity** is the stable milestone/task identity, its parent,
   dependencies, profile/version, and cycle assignment history. Carry-over
   changes scheduling history; it does not create a new task or move its
   milestone parent.
2. **Execution ownership** is one authenticated, fenced attempt with a lease,
   hard budget, session, runtime/resource context, and durable failure/recovery
   history. Releasing or expiring an assignment never asserts success.
3. **Accepted outcome** is a durable decision that a proof-relevant submission
   satisfies the pinned requirements, required review, and any explicit,
   authorized exception. A receipt, review, summary, or completion label alone
   is not acceptance.

Releasing an assignment is operational recovery. Publishing a software release
is a separate authorized distribution operation with separate artifact,
platform, signing, and publication evidence.

## Accepted execution and closeout rules retained from v2 policy

The initial scope preserves the already accepted lease, expiry, and closeout
decisions; later PF-S01 tasks may refine implementation details but may not
silently weaken them:

- `--ttl` remains the compatibility alias for the renewable lease. The v2
  grammar exposes `--lease-ttl` and `--time-limit` as separate typed values.
  A heartbeat may renew the lease but never the hard completion budget.
- Without an explicit `--time-limit`, the hard budget is two hours from the
  authoritative `claimed_at`. An explicit limit overrides the default. At the
  exact deadline, reads and mutations treat the attempt as expired.
- Lease or budget expiry produces `expired_review`, fences the old attempt,
  retains its evidence, and requires safe stop/resource reconciliation before
  replacement. Automatic retry is opt-in, isolated, bounded, and backed off;
  expiry never silently redispatches a still-running harness.
- `agent finish --close` remains the normal proof-gated path. A durable,
  fenced close intent may finalize when the last valid receipt/review satisfies
  the same attempt, source/configuration snapshot, and policy version. A
  source, policy, attempt, or proof-context change invalidates that intent.
  Passing prose, a passive test, or a display label never closes work.

## Supported local boundary

- Supported initial operating systems are macOS and Linux on the declared
  native executors. Windows, remote multi-host operation, and shared SQLite
  over a network filesystem are outside this launch contract.
- Each active project has one elected local Rust service. A client connects to
  the owner or receives a typed busy/unavailable result; it never breaks a
  live owner lock.
- Offline maintenance is supported only after the application confirms that
  no active service owns the project database. It uses the same Rust
  application/store transactions and policy, not a second lifecycle engine.
- Project location, private runtime directory, database, caches, operation
  journal, source references, and memory bindings are validated as one local
  project scope. A moved, copied, restored, or cloned project requires an
  explicit rebind/restore/new-identity outcome.
- Source and curated memory are project-scoped. Cross-project sharing requires
  an explicit future import/grant preserving provenance and cannot authorize a
  task transition by itself.

## Included in the first product

- Rust-owned project, work, attempt, evidence, review, dependency, status,
  recovery, operation readback, health, and guided-agent workflows.
- CLI and versioned local service API, with the TypeScript TUI as a client of
  that API.
- Local source capture, cited project memory, curated Git publication and
  recoverable publication/readback states.
- Deterministic statuses and structured reasons, including the distinction
  between ordinary queued prerequisites, explicit hard holds, proof gaps,
  rejected review, expiry recovery, and terminal decisions.
- Versioned acceptance profiles, structured verification receipts, independent
  review only when declared by the profile, and audited exceptions that do not
  fabricate passing proof.
- Existing v1 meanings that are core to the product: agent/work/sprint/evidence
  semantics, the `status`/prime behavior, claim/finish/release, memory/health
  guidance, and no-goal `guide`/`next` discovery. Any retained gap needs a
  visible parity disposition and must not silently weaken safety.

## Explicit non-goals and retained limitations

The launch does not include a second canonical state machine in workflow
Markdown or TypeScript, direct TUI database access, a browser UI, a global
manager, remote multi-host claims, automatic harness spawning, generic custom
policy programming, event-sourcing everything, hosted release-channel
management, or a microservice rewrite.

Semantic search, MCP, cross-project/global views, complex memory adjudication,
Git-based cross-team synchronization, and broad custom workflow packs remain
later extensions behind their own discovery/design, implementation, review,
reconciliation, and revalidation gates. Their absence may not defer the core
guided workflow, project isolation, source/memory provenance, evidence, or
recovery guarantees.

Legacy v1 records remain historical input. A legacy word such as `done`,
`complete`, or `archived` cannot silently become a v2 accepted `closed`
outcome without subject, evidence, review, and migration disposition. Missing
v1 proof remains a migration finding, not a reason to manufacture a receipt.

## Initial v1 parity disposition

This launch contract records the required keep/rework/defer decisions. The
dedicated parity and migration tasks must still prove each row against actual
v1 source/data and the built v2 product; this table is not a parity pass.

| v1 capability/meaning | Launch disposition | Required treatment |
| --- | --- | --- |
| `status`/prime, `guide`/`next`, no-goal discovery | **keep** | Preserve the self-guiding loop through the Rust application and versioned protocol. |
| agent/work/sprint/evidence/claim/finish/release meanings | **keep** | Preserve the safe meanings behind one project-scoped Rust lifecycle and typed receipts. |
| project memory, cited sources, and Git publication | **keep/rework** | Keep the user outcome; rework it behind project scope, provenance, recoverable jobs, and explicit publication reconciliation. |
| global manager and cross-project fallback | **rework/defer** | Replace implicit global selection with explicit project binding; defer global views until they are derived, never canonical. |
| legacy status words and historical “complete” rows | **rework** | Import as historical dispositions; do not treat them as accepted `closed` without v2 proof and review rules. |
| web console, remote multi-host operation, MCP, automatic harness launch | **defer** | Each requires its own authenticated adapter and review/revalidation chain; none may add a second lifecycle engine. |

The current baseline discrepancy is explicit: the fresh v2 source has partial
implementation and fixture coverage, while full v1 parity, real-service
lifecycle proof, native release coverage, and external publication authority
remain later acceptance inputs. No row above claims those inputs already exist.

## Offline and unavailable-service behavior

Normal active use is service-backed. When the service is unavailable, the
client shows a clearly timestamped last-known view for the selected project,
disables mutations that cannot be safely authorized, and offers connection
diagnostics and operation readback. It does not switch projects, invent fresh
counts, or use a cached view as a second database.

Offline maintenance is a deliberate operator mode with an exclusive project
boundary. It must report why the service is absent, use the same Rust
application policy, record operations/audit outcomes, and return to normal
service ownership cleanly. A live lock is never broken as a normal recovery
step.

## User-facing vocabulary

| Internal condition | User-facing language | Important distinction |
| --- | --- | --- |
| `queued` | “Queued — waiting for TASK-A” | An ordinary unmet prerequisite; not an intervention hold. |
| `blocked` | “Blocked — operator action required” | A hard hold, failed proof disposition, rejected review, or other explicit intervention. |
| `expired_review` | “Lease expired — recovery required” | Execution authority ended; recovery obligation remains. |
| `needs_verification` | “Proof needed — verification is missing, failed, or stale” | The work may have a submission, but current technical proof is insufficient. |
| `awaiting_review` | “Proof complete — review pending” | Required technical proof is present and declared independent review is unresolved. |
| `complete` | “Proof complete — closeout pending” | Requirements are satisfied, but accepted closeout is not committed. |
| `closed` | “Closed — accepted outcome recorded” | The durable accepted result that can satisfy ordinary dependencies. |
| `cancelled` | “Cancelled — withdrawn by an authorized operator” | It does not satisfy a normal prerequisite unless a separate audited policy says so. |
| integrity degraded | “Record needs attention” | The row remains visible with diagnostics; corruption is not normal queued work. |
| quarantined | “Unavailable — record quarantined” | Mutation actions are disabled until a scoped repair or recovery path exists. |
| service unavailable | “Service unavailable — showing last known project view” | Availability is separate from lifecycle status and never causes project fallback. |
| explicit exception | “Accepted by operator exception EX-17” | The failed/unmet fact remains visible beside the authorized exception. |

Raw enum names, fences, SQL errors, protocol paths, and receipt JSON belong in
advanced diagnostics. Normal workflow screens should answer what needs
attention, why, what is safe next, and which project/revision is selected.

## Open decisions carried forward

This contract does not silently settle recommendations that have their own
PF-S01 tasks. Cycle-backed sprint authority, sealed-submission/lease coupling,
scheduled status, profile immutability details, override scope, protocol job
evolution, security budgets, and v1 parity dispositions are consumed by their
named contract tasks and later independent gates. Until accepted, no worker
may treat a recommendation as implementation authority.

## Decision traceability

This contract consumes the following accepted decisions rather than replacing
them: D01–D09 establish Rust authority, one protocol, transactional history,
and self-guiding workflows; D10–D12 require visible parity dispositions,
deterministic status, and safe expiry; D13–D19 define the local boundary,
roles, attempts, derived status, and close-only dependency satisfaction;
D20–D24 define leases/budgets, expiry, close intent, profiles, and Git-backed
memory; D25–D26 retain core v1 meanings and project-scoped memory; D27–D29
freeze the two-hour hard budget, declared independent review, and local launch
scope. The execution details above make D16, D20, D21, D22, and D27 explicit;
the remaining PF-S01 tasks own their deeper contract fixtures and migration
impact.

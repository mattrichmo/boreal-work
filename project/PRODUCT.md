# Product and scope

Boreal is a harness-agnostic project manager for agents. It gives agents a
shared, durable account of work, ownership, progress, evidence, and project
knowledge. Humans can inspect and direct the same state through a TUI and CLI.
The machine interface is primary: any harness that can launch a process or
call the local API can participate.

Boreal is also a **self-guiding work protocol**. An agent should not need a
bespoke goal prompt to discover the current task, its context, conditional
status, required evidence, and next safe action. Boreal guides the lifecycle;
the agent still chooses how to implement the work. A v2 that stores tasks and
receipts but loses this loop is not product parity.

The product has three related forms of memory:

1. **Work memory**: milestones, sprints, tasks, dependencies, current status,
   ownership, and audit events. This answers what should happen and what did.
2. **Execution memory**: attempts, sessions, runtime acceptance, heartbeat,
   checkpoints, test receipts, failures, and closeout. This answers who is
   doing the work and whether a result is still valid.
3. **Project memory bank**: versioned sources, durable notes/claims/decisions,
   citations, and retrieval. This answers why work exists and what project
   knowledge an agent should use. It must be exportable to Git for review and
   portable restoration.

These are not interchangeable. A source document is not an execution
heartbeat. A task comment is not a verified memory claim. A Git commit does not
atomically claim a task.

## First useful product

- One local project, many concurrent agents on the same host.
- Milestone -> sprint -> task containment. Blocking dependencies are separate.
- Active sprint selection, accurate rollups, and bounded ready/active queues.
- Claim, accept, heartbeat, checkpoint, release/fail, and complete one attempt.
- Explicit automatic/operator-only/paused dispatch policy, with hard block
  reasons and normal queued prerequisites evaluated separately.
- Structured validation receipts and closeout diagnostics.
- Versioned contextual directives and `guide`/`next` actions that lead a new
  agent through start/claim, implementation checkpoint, verification,
  finish/release, and recovery without a parent coordinator narrating each
  command. Required and blocking obligations are enforced, not display-only.
- Local memory ingestion, cited entry creation, scoped retrieval, and
  Git-friendly export/import.
- Rust service and CLI; TypeScript TUI is a client of the same application API.

## Later, based on demand

Cross-project/global management, remote multi-host operation, full semantic
search, MCP, web UI, automatic agent spawning, elaborate/custom evidence
policy, knowledge-claim adjudication, broad user-authored workflow templates,
and hosted release-channel management. Their absence must not obstruct the
first product's data model, but they do not get independent state machines
now. The core trusted directive
registry, contextual next action, and evidence/finish workflow are **not**
part of this deferred list.

## Required behaviors

- Ten or more agents can read status while multiple workers update unrelated
  tasks. Reads do not acquire a canonical exclusive writer lock.
- An agent cannot automatically claim queued, hard-blocked, operator-only,
  paused, expired-review, or terminal work through a different harness or
  command path. An authorized operator-only claim is explicit and audited.
- Effective status and claimability derive only from canonical work lifecycle,
  dependencies, explicit dispatch policy/hard reasons, attempt ownership,
  clock, and gates. Every
  unclaimable or unclosable result explains the current condition and the
  permitted next action; release never silently promotes blocked work.
- An agent starting without a task ID or user-authored goal can receive a
  bounded current context and either a safe next action, an explicit idle
  result, or a precise blocker/recovery path. A required directive cannot be
  skipped by changing harness or using a lower-level CLI spelling.
- One current attempt per task; one current execution per session. Replaced
  attempts are fenced from future writes.
- A claim is not evidence of progress. An accepted session is not a completed
  task. Completion is a durable, validated transition.
- Every dashboard total is a true total at one revision; pagination affects
  rows, not counts.
- A memory retrieval names source versions and provenance. Search index lag is
  visible; stale results never silently claim to be current.
- Task lifecycle and its status inputs are canonical; the visible task status,
  milestone progress, and sprint progress are derived. The active sprint is
  an explicit project setting, never a
  fallback to the first sprint in a list.

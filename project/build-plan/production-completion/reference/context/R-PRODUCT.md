# R-PRODUCT — project/PRODUCT.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/PRODUCT.md:L1–L86`  
**File SHA-256:** `38bf2db5da436975374f2dcde033f920e0e89ec68b09645bc13d5d06334fe0b2`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

User outcomes and work/execution memory distinctions.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,86p' 'project/PRODUCT.md'
```

## Exact baseline excerpt

````text
    1 | # Product and scope
    2 | 
    3 | Boreal is a harness-agnostic project manager for agents. It gives agents a
    4 | shared, durable account of work, ownership, progress, evidence, and project
    5 | knowledge. Humans can inspect and direct the same state through a TUI and CLI.
    6 | The machine interface is primary: any harness that can launch a process or
    7 | call the local API can participate.
    8 | 
    9 | Boreal is also a **self-guiding work protocol**. An agent should not need a
   10 | bespoke goal prompt to discover the current task, its context, conditional
   11 | status, required evidence, and next safe action. Boreal guides the lifecycle;
   12 | the agent still chooses how to implement the work. A v2 that stores tasks and
   13 | receipts but loses this loop is not product parity.
   14 | 
   15 | The product has three related forms of memory:
   16 | 
   17 | 1. **Work memory**: milestones, sprints, tasks, dependencies, current status,
   18 |    ownership, and audit events. This answers what should happen and what did.
   19 | 2. **Execution memory**: attempts, sessions, runtime acceptance, heartbeat,
   20 |    checkpoints, test receipts, failures, and closeout. This answers who is
   21 |    doing the work and whether a result is still valid.
   22 | 3. **Project memory bank**: versioned sources, durable notes/claims/decisions,
   23 |    citations, and retrieval. This answers why work exists and what project
   24 |    knowledge an agent should use. It must be exportable to Git for review and
   25 |    portable restoration.
   26 | 
   27 | These are not interchangeable. A source document is not an execution
   28 | heartbeat. A task comment is not a verified memory claim. A Git commit does not
   29 | atomically claim a task.
   30 | 
   31 | ## First useful product
   32 | 
   33 | - One local project, many concurrent agents on the same host.
   34 | - Milestone -> sprint -> task containment. Blocking dependencies are separate.
   35 | - Active sprint selection, accurate rollups, and bounded ready/active queues.
   36 | - Claim, accept, heartbeat, checkpoint, release/fail, and complete one attempt.
   37 | - Explicit automatic/operator-only/paused dispatch policy, with hard block
   38 |   reasons and normal queued prerequisites evaluated separately.
   39 | - Structured validation receipts and closeout diagnostics.
   40 | - Versioned contextual directives and `guide`/`next` actions that lead a new
   41 |   agent through start/claim, implementation checkpoint, verification,
   42 |   finish/release, and recovery without a parent coordinator narrating each
   43 |   command. Required and blocking obligations are enforced, not display-only.
   44 | - Local memory ingestion, cited entry creation, scoped retrieval, and
   45 |   Git-friendly export/import.
   46 | - Rust service and CLI; TypeScript TUI is a client of the same application API.
   47 | 
   48 | ## Later, based on demand
   49 | 
   50 | Cross-project/global management, remote multi-host operation, full semantic
   51 | search, MCP, web UI, automatic agent spawning, elaborate/custom evidence
   52 | policy, knowledge-claim adjudication, broad user-authored workflow templates,
   53 | and hosted release-channel management. Their absence must not obstruct the
   54 | first product's data model, but they do not get independent state machines
   55 | now. The core trusted directive
   56 | registry, contextual next action, and evidence/finish workflow are **not**
   57 | part of this deferred list.
   58 | 
   59 | ## Required behaviors
   60 | 
   61 | - Ten or more agents can read status while multiple workers update unrelated
   62 |   tasks. Reads do not acquire a canonical exclusive writer lock.
   63 | - An agent cannot automatically claim queued, hard-blocked, operator-only,
   64 |   paused, expired-review, or terminal work through a different harness or
   65 |   command path. An authorized operator-only claim is explicit and audited.
   66 | - Effective status and claimability derive only from canonical work lifecycle,
   67 |   dependencies, explicit dispatch policy/hard reasons, attempt ownership,
   68 |   clock, and gates. Every
   69 |   unclaimable or unclosable result explains the current condition and the
   70 |   permitted next action; release never silently promotes blocked work.
   71 | - An agent starting without a task ID or user-authored goal can receive a
   72 |   bounded current context and either a safe next action, an explicit idle
   73 |   result, or a precise blocker/recovery path. A required directive cannot be
   74 |   skipped by changing harness or using a lower-level CLI spelling.
   75 | - One current attempt per task; one current execution per session. Replaced
   76 |   attempts are fenced from future writes.
   77 | - A claim is not evidence of progress. An accepted session is not a completed
   78 |   task. Completion is a durable, validated transition.
   79 | - Every dashboard total is a true total at one revision; pagination affects
   80 |   rows, not counts.
   81 | - A memory retrieval names source versions and provenance. Search index lag is
   82 |   visible; stale results never silently claim to be current.
   83 | - Task lifecycle and its status inputs are canonical; the visible task status,
   84 |   milestone progress, and sprint progress are derived. The active sprint is
   85 |   an explicit project setting, never a
   86 |   fallback to the first sprint in a list.
````

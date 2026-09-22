# R-DECISIONS — project/DECISIONS.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/DECISIONS.md:L1–L71`  
**File SHA-256:** `6587014e5acbafa3dc1caefb2a455a9868111a810f361805f6931c2cd38b36cb`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

D01-D29 approved constraints; D22/D27 must not be silently changed by the sealed-submission recommendation.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,71p' 'project/DECISIONS.md'
```

## Exact baseline excerpt

````text
    1 | # Architecture decisions and approved owner choices
    2 | 
    3 | This file distinguishes hard constraints from current recommendations. Update
    4 | it when a decision changes and name the migration impact.
    5 | 
    6 | ## Accepted constraints from product intent and audit
    7 | 
    8 | | ID | Decision | Reason |
    9 | | --- | --- | --- |
   10 | | D01 | Rust owns domain, storage, application workflow, runtime, and CLI. | Machine clients need one fast, durable implementation. |
   11 | | D02 | TypeScript is the preferred TUI client. | Preserve the useful current UI work while the core is replaced. |
   12 | | D03 | Agent harnesses share one claim/attempt protocol. | Separate paths caused divergent work, reservation, assignment, and session state. |
   13 | | D04 | Work, attempts, and audit events commit transactionally. | Partial closeout and orphan attempts are unacceptable. |
   14 | | D05 | Readers receive one revisioned snapshot without an exclusive app writer lock. | The old TUI/status path contended with workers. |
   15 | | D06 | Git does not coordinate operational work mutations. | Concurrent claims need database transactions. |
   16 | | D07 | Failed evidence and historical attempts remain inspectable. | Repair must not falsify provenance. |
   17 | | D08 | v2 is standalone from the legacy repository. | It will move to its own project. |
   18 | | D09 | The self-guiding CLI workflow, conditional statuses, trusted directives, and evidence-driven claim/finish path are Boreal core, not optional parity. | An unfamiliar agent must be able to make progress without a bespoke parent goal prompt; a CRUD-only rewrite would lose the product's central behavior. |
   19 | | D10 | Any working v1 behavior omitted from v2 launch requires an explicit keep/rework/defer disposition and user-visible limitation. | "Cleaner" must not silently mean fewer agent capabilities or weaker closeout. The parity inventory and no-goal acceptance test are cutover inputs. |
   20 | | D11 | Status and next action are deterministically derived; an agent cannot assert successful completion by setting a field or writing persuasive prose. | Preserve Boreal's proof-gated finish, conditional readiness, and automatic downstream progression from accepted outcomes. Normal upstream waiting is `queued`, not hard `blocked`. See [STATUS_MODEL.md](STATUS_MODEL.md). |
   21 | | D12 | A claim time limit that elapses before close flags the attempt/task for safe expiry review; it does not silently make work closed or blindly redispatch it. | Expiry must fence old writes, preserve evidence, and account for a still-running harness or shared worktree. |
   22 | 
   23 | ## Approved v2 policy defaults
   24 | 
   25 | The product owner approved the initial policy direction in
   26 | [`spec/POLICY_DRAFT.md`](spec/POLICY_DRAFT.md) on 2026-09-14. These are
   27 | requirements for P0-03 fixtures, not claims that implementation exists.
   28 | The three final scope/default choices were approved by the owner on the same
   29 | date; P0-03 may now freeze fixtures against D13–D29.
   30 | 
   31 | | ID | Approved choice | Required negative/acceptance proof |
   32 | | --- | --- | --- |
   33 | | D13 | Initial agents share one host and one project service; remote multi-host claims require a later authenticated network boundary. | Two local harnesses race one claim; a network filesystem is not used as a shared SQLite work store. |
   34 | | D14 | Initial supported platforms are macOS and Linux; Windows support waits for transport/package verification. | Platform-specific service/CLI startup and unsupported-platform diagnostics are fixture-tested. |
   35 | | D15 | Active CLI/TUI use auto-elects one local Rust service; offline maintenance uses the same application rules behind an exclusive maintenance boundary. | Concurrent startup elects one owner; restart and unavailable outcomes do not create a second state machine. |
   36 | | D16 | Local project/OS boundary plus explicit agent, reviewer, operator, and publisher authority. Cancellation, override, and publication are reason-coded and audited. | An agent credential cannot perform an operator/publisher action; forged actor text or a lower-level CLI spelling cannot bypass authority. |
   37 | | D17 | One current fenced attempt per work item and one current execution per session. | Duplicate/parallel claims have one winner; replacement fences stale writes. |
   38 | | D18 | Persist a small work lifecycle and derive `queued`, `ready`, hard `blocked`, `complete`, `closed`, eligibility, and one next action from canonical graph/policy/attempt/gate/time inputs. | The same revision and clock produce identical CLI/API/TUI status and claim decisions; no direct agent-set success field. |
   39 | | D19 | A default prerequisite advances only on an accepted `closed` result; `verified`, `complete`, and `cancelled` do not count as success. Legacy exceptions are explicit versioned edge-policy/migration findings. | Close unqueues only valid successors; cancellation and verified-but-unclosed leave dependents ineligible unless an audited exception exists. |
   40 | | D20 | Renewable ownership lease and hard attempt time budget are distinct. Preserve v1 `--ttl` as a lease alias; v2 grammar uses `--lease-ttl` and `--time-limit` as separate typed values. A hard budget cannot be heartbeat-renewed. | Exact deadline, renewal, stale fence, restart, and CLI alias fixtures; D27 fixes the default hard duration. |
   41 | | D21 | Elapsed lease/budget while work is open fences the attempt and displays `expired_review`; safe stop/ownership reconciliation precedes replacement. Automatic retry is opt-in, isolated, bounded, and backed off. | Late timer still makes expiry effective on read/claim; shared worktree is not reassigned to a still-running agent. |
   42 | | D22 | `agent finish --close` remains the normal proof-gated path. A durable fenced close intent auto-finalizes when the last valid receipt/review satisfies the same attempt, source/config snapshot, and policy version; passing prose or passive tests alone never close work. | One current summary, idempotent finish, close-intent invalidation on source/policy/attempt change, failed evidence retained. |
   43 | | D23 | Versioned per-work acceptance profiles use structured verification/checkpoint/review/audit evidence; no universal prose shortcut. | Wrong command/subject/snapshot/attestation/exit/observable remain distinct typed gaps; D28 fixes when independent review is required. |
   44 | | D24 | SQLite owns live work, intake, drafts, and operational links. Git at a named revision owns published curated project memory; publication/reimport is a recoverable job outside work transactions. | Crash/reimport and fresh-clone fixtures preserve citations and human edits. |
   45 | | D25 | Keep high-value v1 agent/work/sprint/evidence/memory/health CLI meanings and the no-goal `guide`/`next` loop. `status` remains the v1 prime alias; tasks/milestones remain work kinds. | P4-11 command and unfamiliar-agent parity; omitted commands have explicit keep/rework/defer disposition. |
   46 | | D26 | Initial curated memory is project-scoped. Cross-project sharing requires an explicit later import/grant with preserved source provenance. | A source or published note from another project cannot silently enter retrieval or authorize a task transition. |
   47 | | D27 | A claim without an explicit `--time-limit` has a two-hour hard completion deadline, measured from authoritative `claimed_at`. The renewable ownership lease remains a separate clock. An explicit time limit overrides the default; heartbeats do not extend either hard budget. | Default and explicit-budget virtual-clock fixtures at the exact boundary; late sweeper and expiry-review safety remain D21. |
   48 | | D28 | Independent review is required only when the task's versioned acceptance profile contains a review gate. Normal verification and proof-gated finish still apply without a review gate. | Profile-with-review cannot close without authorized review; profile-without-review can close on valid required proof and finish intent, without fabricating review. |
   49 | | D29 | M01 launches the local CLI, TUI, source/memory bank, and guided agent workflow. The old web console, global manager, remote multi-host agents, and automatic agent spawning are deferred with explicit parity impact. | Launch acceptance covers the guided no-goal path and local multi-harness claims; P0-04/P4-11 record omissions and P5-08 approves material deferrals. |
   50 | 
   51 | ## Recommended, to validate with prototypes
   52 | 
   53 | | ID | Recommendation | Tradeoff / validation |
   54 | | --- | --- | --- |
   55 | | R01 | One SQLite WAL database per local project. | Fits same-host readers + one writer; measure transaction length, WAL growth, and checkpointing. Do not share the file over a network filesystem. |
   56 | | R02 | One Rust service per active project for subscriptions, liveness, scheduling, and queued writes. | Adds process lifecycle. Correctness remains in Rust application/store transactions so recovery/offline maintenance does not fork policy. |
   57 | | R03 | Local HTTP over a Unix socket, with versioned JSON DTOs. | Easy TS/Rust client boundary; needs service election, socket permissions, and Windows equivalent if supported. |
   58 | | R04 | Git publication mechanics: dedicated worktree, deterministic manifest, and idempotent reimport. | D24 fixes authority; P3 prototypes validate the mechanism and conflict recovery. |
   59 | | R05 | Agents pull ready work first; automatic dispatch is an optional service loop using the same claim transaction. | Reduces initial scheduler complexity; launch/observe/cancel adapters remain useful later. |
   60 | | R06 | Content-addressed blobs hold large source and output bytes. | Requires backup/GC policy and manifest integrity checks. |
   61 | | R07 | Efficient representation of close-only edge satisfaction and incremental downstream recomputation. | D19 fixes semantics; P1 benchmarks exact graph/revision behavior and migration impact. |
   62 | | R08 | Resumable close-intent implementation with one atomic final close transaction. | D22 fixes behavior; P2 validates crash/idempotency without holding the writer during evidence execution. |
   63 | 
   64 | ## P0-03 engineering choices
   65 | 
   66 | The owner choices D27–D29 are settled. The remaining engineering choices—
   67 | exact default lease TTL, local socket protocol, role credential format,
   68 | source/blob layout, and initial acceptance
   69 | profile details—can be fixed by P0-03 under D13–D29, independently reviewed
   70 | at P0-05, and changed only with a versioned decision and fixture. They are
   71 | not permission to weaken evidence or silently broaden launch scope.
````

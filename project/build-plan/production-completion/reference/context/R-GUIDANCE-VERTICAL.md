# R-GUIDANCE-VERTICAL — project/build-plan/verticals/11-agent-guidance.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/build-plan/verticals/11-agent-guidance.md:L1–L106`  
**File SHA-256:** `95ded6409898da15fcfdda0a77086152ce012cdd45f922ceecde27a20762fd32`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Core no-goal, two-harness, bounded-context and trusted-argv acceptance; this capability is not an optional workflow pack.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,106p' 'project/build-plan/verticals/11-agent-guidance.md'
```

## Exact baseline excerpt

````text
    1 | # Vertical 11 — self-guiding agent workflow
    2 | 
    3 | Task IDs: P2-10, P2-11, P2-12. This is required v2 core, not a deferred
    4 | workflow pack. Read the [product contract](../../PRODUCT.md),
    5 | [agent lifecycle](../../AGENT_LIFECYCLE.md),
    6 | [interface contract](../../INTERFACES.md),
    7 | [task graph](../TASK_INDEX.md), and
    8 | [agent guidance design](../../AGENT_GUIDANCE.md). The legacy directive
    9 | registry, `bwrk next`, `agent guide`, and claim/finish workflows are behavioral
   10 | references, not modules to import into Rust.
   11 | 
   12 | ## Outcome
   13 | 
   14 | An unfamiliar agent on any supported harness can enter a project without a
   15 | hand-crafted goal prompt. Boreal tells it the current task or ready queue,
   16 | why the work is or is not claimable, what context and acceptance apply, which
   17 | obligations remain, and one safe next action. After each transition or resume,
   18 | the guidance changes with canonical state. Boreal directs *workflow* while
   19 | the agent decides *implementation*.
   20 | 
   21 | ## Ownership and prerequisites
   22 | 
   23 | - Own `crates/application/src/guidance/**`, the trusted directive registry,
   24 |   compilation rules, reason/action selection, and tests/fixtures for this
   25 |   module. Do not create a separate persisted workflow state machine.
   26 | - Own `crates/protocol/src/guidance.rs` and
   27 |   `crates/cli/src/commands/guidance.rs` only after the Vertical 05 owner
   28 |   agrees on DTO, command registry, and crate wiring. Shared top-level module
   29 |   files belong to Vertical 05/integration owner.
   30 | - Coordinate with Vertical 02 for receipt/finish and runtime liveness; do not
   31 |   edit lifecycle or gate transitions independently. P2-10 needs P2-02 and
   32 |   P2-05, P2-11 needs P2-04 and P2-10, and P2-12 needs P2-06 and P2-11.
   33 | - P0-03 must freeze guidance fixtures and P0-04 must record legacy parity;
   34 |   `project/spec/guidance/**` is owned by the architecture steward until P0-07.
   35 | 
   36 | ## Required contract
   37 | 
   38 | 1. Compile from a single revisioned snapshot of work, dependencies,
   39 |    effective eligibility, current attempt/session/fence, gates/receipts,
   40 |    health, and optional source/memory references. A guide is read-only; the
   41 |    selected action rechecks its preconditions in the writer transaction.
   42 | 2. Return a bounded, versioned guide with subject and context references,
   43 |    stored work state, effective status/reason codes, attempt identity, trusted
   44 |    registry version, ordered directives (`advisory`, `required`, `blocking`),
   45 |    one selected next action or a typed idle/blocker/operator outcome, project
   46 |    revision, and next refresh event/deadline. Do not attach all history.
   47 | 3. An executable action contains trusted source, runner, exact argv, cwd,
   48 |    `shell: false`, expected revision/fence, and an operation identity for
   49 |    mutation. The registry may construct Boreal commands from typed IDs;
   50 |    work-authored prose and declared commands are display data. A declared
   51 |    verification command runs only through an explicit bounded/attested
   52 |    executor policy. Never transform source text into shell authority.
   53 | 4. Required/blocking directives reflect application-enforced invariants.
   54 |    Guidance cannot offer close while evidence/gates are unsatisfied, claim
   55 |    while dependencies/eligibility block it, or resume a fenced old attempt.
   56 |    Conflicts, missing required directives, unsupported registry versions,
   57 |    stale snapshots, and unknown operation outcomes are explicit results.
   58 | 5. Keep the familiar high-level entry points: `agent guide`, `next`,
   59 |    `agent start`, `agent resume`, `agent finish`, plus lower-level
   60 |    work/evidence operations.
   61 |    High-level start/finish call the same P2 transactions, not a second
   62 |    lifecycle. The CLI publishes command migration/aliases for retained v1
   63 |    workflows and returns next guidance as part of normal operation results
   64 |    where useful, avoiding extra status round trips.
   65 | 6. The first canonical routes are discover/claim, resume, implement and
   66 |    checkpoint, run/attach evidence, verify, finish/release, and recover.
   67 |    Broader user-defined templates may be added later as data that compiles
   68 |    into these same operations. A no-goal agent needs no giant prompt file.
   69 | 
   70 | ## Conditional scenarios to test
   71 | 
   72 | - Ready work with no active attempt offers a claim/start action; two agents
   73 |   racing get one winner, and the loser receives a fresh appropriate action.
   74 | - An open dependency, operator-only flag, pause, retry-not-before, or
   75 |   exhausted capacity explains why claim is unavailable. Release or scheduler
   76 |   tick never silently changes these conditions.
   77 | - A claimed but unaccepted attempt prompts acceptance/recovery, not an
   78 |   implementation-complete claim. Accepted/running work prompts resume or
   79 |   checkpoint while heartbeat remains separate from semantic progress.
   80 | - Missing/stale/wrong-subject/wrong-command/unattested evidence gives a
   81 |   precise required directive and safe bounded evidence/verification path.
   82 |   Equivalent human prose produces the same gate result.
   83 | - All required gates satisfied offers fenced idempotent finish. A stale
   84 |   session after replacement receives readback/recovery, not finish.
   85 | - After service restart, cursor gap, or uncertain mutation, an agent gets
   86 |   one current snapshot or operation-ID readback and resumes at the durable
   87 |   stage, without duplicate summary/claim or repeated blind polling.
   88 | - Completed work, empty queue, and infrastructure blocker each return a
   89 |   distinct idle/next/operator outcome. A guidance call must not create work.
   90 | 
   91 | ## Acceptance and gate
   92 | 
   93 | P2-12 runs the same scripted *and* model-operated fixture from at least two
   94 | different harness entry points through the versioned CLI/API. Neither gets a
   95 | bespoke task prompt: both use the returned context/directives and finish or
   96 | release with correct evidence. Measure CLI calls per useful transition,
   97 | unchanged reads, guide payload bytes, and time from verification to closure
   98 | against the v1 baseline. Include 10,000 historical attempts to prove routine
   99 | guidance remains bounded. A reviewer outside this implementation lane inspects
  100 | trust boundaries, missing obligations, route reachability, and conditional
  101 | status in P2-07; findings flow through P2-08 and P2-09 before P3/P4 advance.
  102 | 
  103 | Handoff: registry/schema version, fixture matrix, command migration map,
  104 | actual no-goal transcripts, exact argv/action provenance, focused and
  105 | cross-harness tests, negative cases, measured payload/call counts, and
  106 | remaining parity gaps. A safe but unguided CRUD CLI does not pass this gate.
````

# Vertical 11 — self-guiding agent workflow

Task IDs: P2-10, P2-11, P2-12. This is required v2 core, not a deferred
workflow pack. Read the [product contract](../../PRODUCT.md),
[agent lifecycle](../../AGENT_LIFECYCLE.md),
[interface contract](../../INTERFACES.md),
[task graph](../TASK_INDEX.md), and
[agent guidance design](../../AGENT_GUIDANCE.md). The legacy directive
registry, `bwrk next`, `agent guide`, and claim/finish workflows are behavioral
references, not modules to import into Rust.

## Outcome

An unfamiliar agent on any supported harness can enter a project without a
hand-crafted goal prompt. Boreal tells it the current task or ready queue,
why the work is or is not claimable, what context and acceptance apply, which
obligations remain, and one safe next action. After each transition or resume,
the guidance changes with canonical state. Boreal directs *workflow* while
the agent decides *implementation*.

## Ownership and prerequisites

- Own `crates/application/src/guidance/**`, the trusted directive registry,
  compilation rules, reason/action selection, and tests/fixtures for this
  module. Do not create a separate persisted workflow state machine.
- Own `crates/protocol/src/guidance.rs` and
  `crates/cli/src/commands/guidance.rs` only after the Vertical 05 owner
  agrees on DTO, command registry, and crate wiring. Shared top-level module
  files belong to Vertical 05/integration owner.
- Coordinate with Vertical 02 for receipt/finish and runtime liveness; do not
  edit lifecycle or gate transitions independently. P2-10 needs P2-02 and
  P2-05, P2-11 needs P2-04 and P2-10, and P2-12 needs P2-06 and P2-11.
- P0-03 must freeze guidance fixtures and P0-04 must record legacy parity;
  `project/spec/guidance/**` is owned by the architecture steward until P0-07.

## Required contract

1. Compile from a single revisioned snapshot of work, dependencies,
   effective eligibility, current attempt/session/fence, gates/receipts,
   health, and optional source/memory references. A guide is read-only; the
   selected action rechecks its preconditions in the writer transaction.
2. Return a bounded, versioned guide with subject and context references,
   stored work state, effective status/reason codes, attempt identity, trusted
   registry version, ordered directives (`advisory`, `required`, `blocking`),
   one selected next action or a typed idle/blocker/operator outcome, project
   revision, and next refresh event/deadline. Do not attach all history.
3. An executable action contains trusted source, runner, exact argv, cwd,
   `shell: false`, expected revision/fence, and an operation identity for
   mutation. The registry may construct Boreal commands from typed IDs;
   work-authored prose and declared commands are display data. A declared
   verification command runs only through an explicit bounded/attested
   executor policy. Never transform source text into shell authority.
4. Required/blocking directives reflect application-enforced invariants.
   Guidance cannot offer close while evidence/gates are unsatisfied, claim
   while dependencies/eligibility block it, or resume a fenced old attempt.
   Conflicts, missing required directives, unsupported registry versions,
   stale snapshots, and unknown operation outcomes are explicit results.
5. Keep the familiar high-level entry points: `agent guide`, `next`,
   `agent start`, `agent resume`, `agent finish`, plus lower-level
   work/evidence operations.
   High-level start/finish call the same P2 transactions, not a second
   lifecycle. The CLI publishes command migration/aliases for retained v1
   workflows and returns next guidance as part of normal operation results
   where useful, avoiding extra status round trips.
6. The first canonical routes are discover/claim, resume, implement and
   checkpoint, run/attach evidence, verify, finish/release, and recover.
   Broader user-defined templates may be added later as data that compiles
   into these same operations. A no-goal agent needs no giant prompt file.

## Conditional scenarios to test

- Ready work with no active attempt offers a claim/start action; two agents
  racing get one winner, and the loser receives a fresh appropriate action.
- An open dependency, operator-only flag, pause, retry-not-before, or
  exhausted capacity explains why claim is unavailable. Release or scheduler
  tick never silently changes these conditions.
- A claimed but unaccepted attempt prompts acceptance/recovery, not an
  implementation-complete claim. Accepted/running work prompts resume or
  checkpoint while heartbeat remains separate from semantic progress.
- Missing/stale/wrong-subject/wrong-command/unattested evidence gives a
  precise required directive and safe bounded evidence/verification path.
  Equivalent human prose produces the same gate result.
- All required gates satisfied offers fenced idempotent finish. A stale
  session after replacement receives readback/recovery, not finish.
- After service restart, cursor gap, or uncertain mutation, an agent gets
  one current snapshot or operation-ID readback and resumes at the durable
  stage, without duplicate summary/claim or repeated blind polling.
- Completed work, empty queue, and infrastructure blocker each return a
  distinct idle/next/operator outcome. A guidance call must not create work.

## Acceptance and gate

P2-12 runs the same scripted *and* model-operated fixture from at least two
different harness entry points through the versioned CLI/API. Neither gets a
bespoke task prompt: both use the returned context/directives and finish or
release with correct evidence. Measure CLI calls per useful transition,
unchanged reads, guide payload bytes, and time from verification to closure
against the v1 baseline. Include 10,000 historical attempts to prove routine
guidance remains bounded. A reviewer outside this implementation lane inspects
trust boundaries, missing obligations, route reachability, and conditional
status in P2-07; findings flow through P2-08 and P2-09 before P3/P4 advance.

Handoff: registry/schema version, fixture matrix, command migration map,
actual no-goal transcripts, exact argv/action provenance, focused and
cross-harness tests, negative cases, measured payload/call counts, and
remaining parity gaps. A safe but unguided CRUD CLI does not pass this gate.

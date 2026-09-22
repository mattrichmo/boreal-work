> M02 inventory, ownership and evidence limitations: see
> `validation/m02/PARITY.md` and `validation/m02/COMMAND_INVENTORY.json`.
> Historical source references below were supplied with the snapshot; the
> legacy runtime is not included and has not been silently reconstructed.

# Workflow parity: legacy Boreal to v2

Status: bounded v2 planning note, 2026-09-14. This is a behavioral parity
assessment, not a claim that the v2 implementation is complete. “Observed”
below means behavior visible in the legacy checkout or already stated as a v2
contract. “Recommendation” is a v2 design choice and must not be treated as
implemented until it has a transition fixture and acceptance evidence.

## The short version

Boreal still feels like Boreal when a task is dependency-aware, an agent can
claim it without racing another harness, ownership is explicit and recoverable,
completion is proved rather than asserted, and the next safe action is visible.
The v2 direction is right to make eligibility explicit and to separate a
current fenced attempt from durable task state. The main parity risk is
collapsing all of that back into one status enum, or making a scheduler/model
call authoritative for a transition.

The minimum v2 invariant is:

```text
task state + dependency state + explicit eligibility
  -> claimable or not
current attempt + fence + session/harness
  -> who may act now
structured evidence + verification + closeout policy
  -> whether completion is allowed
```

The more precise v2 taxonomy, `queued` versus intervention `blocked`, hard
attempt deadlines versus renewable leases, expiry review, and close-only
default dependency satisfaction are specified in
[STATUS_MODEL.md](STATUS_MODEL.md). Where this older parity note uses
`blocked` for an open prerequisite, read it as legacy behavior; the new
authoritative display status is `queued` unless another hard reason applies.

## Source map

| Surface | Legacy source of truth / evidence | V2 source or planned contract |
| --- | --- | --- |
| Work statuses and readiness | `packages/core/src/records.ts`; `packages/work-engine/src/work.ts`; `AGENT_README.md` §7 | `project/AGENT_LIFECYCLE.md`; `project/build-plan/verticals/00-contracts-baseline.md`; `crates/domain/src/lib.rs` |
| Reservation and claim race | `packages/agent-runtime/src/reservations.ts`; `packages/engine/src/runtime.ts`; `apps/cli/src/commands/agent.ts` | `project/AGENT_LIFECYCLE.md`; `project/STATE_AND_CONCURRENCY.md` |
| Start/no-work guidance | `apps/cli/src/commands/agent.ts` (`agentStartCommand`); `AGENT_README.md` §§6–7 | `project/INTERFACES.md`; `project/build-plan/verticals/02-attempt-runtime.md` |
| Finish, release, close | `apps/cli/src/commands/agent.ts`; `packages/engine/src/runtime.ts`; `workflows/40-work/claim-and-finish-work.md` | `project/AGENT_LIFECYCLE.md`; `project/build-plan/verticals/02-attempt-runtime.md` |
| Evidence trust and verification | `docs/architecture/EVIDENCE_TRUST.md`; `packages/evidence-engine/src/evidence.ts`; `AGENT_README.md` §9 | `project/AGENT_LIFECYCLE.md`; `project/DECISIONS.md` (open completion-evidence decision) |
| Closeout gates | `docs/architecture/CLOSEOUT_GATE_CONTRACT.md`; `packages/core/src/records.ts`; `packages/engine/src/runtime.ts` | `project/AGENT_LIFECYCLE.md`; `project/build-plan/verticals/02-attempt-runtime.md` |
| Workflow routing and next step | `workflows/00-agent/route-request.md`; `apps/cli/src/commands/protocol.ts`; `packages/core/src/agent-directive-compiler.ts`; `apps/daemon/src/runtime.ts` | `project/INTERFACES.md`; `project/README.md`; `project/build-plan/verticals/00-contracts-baseline.md` |
| Legacy/performance failure evidence | `project/AUDIT_BASELINE.md`; `V2_REBUILD_PLAN.md` | Same files plus the v2 build-plan traceability matrix |

## Keep / rework / defer matrix

| Current capability | Disposition | Why this is essential or not | V2 acceptance bar / next step |
| --- | --- | --- | --- |
| Dependency-derived readiness; open blockers keep work out of the queue | **Keep, rework representation** | This is the clearest “Boreal” behavior. Legacy `deriveReadinessStatus` treats `draft`/`blocked` as `ready` only after gaps clear, and reconciliation obligations can still block. | Show normal upstream wait as `queued`, hard intervention as `blocked`; keep dependency edges canonical, derive eligibility at claim time, and return reason IDs plus a next action. Add legal/illegal transition fixtures in P0-03. |
| `ready` queue versus raw `--status ready` filter | **Keep, clarify** | Legacy docs explicitly distinguish dependency-valid `--ready` from a raw status filter. Losing this distinction recreates stale-queue bugs. | V2 status must label “eligible now” separately from task status; a stale snapshot cannot authorize a claim. |
| Atomic find-and-reserve / one active reservation | **Keep, rework attempt model** | Legacy claim selection and reservation are locked together; v2 correctly promotes one current attempt and a fence. | Two or more harnesses racing 100 times produce one winner per task; loser gets typed conflict, not a second attempt. |
| Agent `start` resumes an owned active reservation before claiming another | **Keep** | This prevents accidental double work and makes restart/resume practical. | `start` with an agent and no goal first resumes that agent’s current attempt; if none exists, it performs the bounded pull path. |
| No-goal start returns a structured `no_ready_work` result | **Keep, expand guidance** | Legacy returns exit success for no ready work, but the response is still actionable machine data. | Include counts, blockers, eligibility reasons, retry deadline, and exact next command/workflow. Never turn “no work” into a failure or an implicit model call. |
| Forced reservation of non-ready work with a reason | **Rework sharply** | Legacy `work reserve` permits force+reason for non-ready work, while ordinary claim/start does not. This is useful for operators but too easy to confuse with normal eligibility. | Separate `operator_only`/override capability from automatic eligibility. Require explicit actor permission, reason code, audit event, and never let a forced claim make the task scheduler-eligible. |
| `in_progress` as the post-claim work status | **Rework representation** | It is useful in the UI, but it currently carries reservation/attempt meaning that v2 needs to model explicitly. | Derive display status from task state + current attempt; persist one current attempt and fence. Keep `claimed`, `accepted`, and `running` visible without making them competing authorities. |
| `blocked` as a dependency/reconciliation state | **Keep, split causes** | V1 conflates normal upstream wait with intervention. | Display `queued` for prerequisite wait and `blocked` for reconciliation/decision/integrity intervention; return all typed reasons. Release must recompute rather than blindly make work ready. |
| `paused`, `operator_only`, and `automatic` dispatch policy | **Keep as v2-first behavior** | Legacy work statuses do not encode all of these; v2 explicitly promises them because the audit found redispatch loops. | Policy is explicit; effective eligibility additionally checks prerequisites, hard reasons, attempt, capacity, and time. Labels/descriptions cannot grant eligibility. |
| Released and expired reservations remain inspectable; work can become ready again | **Keep** | Release is ownership history, not completion. This is a key recovery property. | Release/expiry increments the fence, closes the current attempt, preserves history, derives the next eligibility, and supplies the reclaim command. Test release of ready, blocked, paused, and operator-only tasks. |
| Manual claim/adoption of an already-started session | **Keep, define identity rules** | V2 explicitly supports a harness adopting a manually started session; without a common path, lifecycle drift returns. | Manual and automatic claim use the same transaction and attempt schema. Adoption must bind actor+harness+session, reject a conflicting current session, and be idempotent by operation ID. |
| `work verify` requires subject-matched passed evidence | **Keep, make structured** | This prevents a passing sentence or unrelated evidence from closing work. | Verification checks evidence subject, outcome, receipt/source identity, and freshness; prose is explanatory only. Failed evidence remains queryable. |
| Evidence trust levels: legacy, self-reported, Boreal-witnessed, external | **Keep** | Trust provenance is separate from result and is needed for honest migration. | Port the distinction into structured receipts. Never upgrade trust from `outcome=passed`, command text, actor kind, or Git history. |
| Declared verification/review/audit/checkpoint gates | **Keep, simplify where possible** | Gates make closeout policy explicit and roll-up-safe. | V2 launch must support all four gate kinds with typed outcomes; the first executable slice can begin with verification/checkpoint. Every close response returns open/satisfied/forced gates and gaps. |
| `agent finish --close` versus `--release` | **Keep** | It is the useful composite path: evidence, verification, close/release, ownership cleanup, and readiness repair. | Implement one atomic application operation. `close` requires passed verification and required gates; `release` never implies done. Repeated finish returns the prior operation result. |
| Direct `work close` and forced gate paths | **Defer or operator-only** | Legacy needs historical repair, but multiple close paths are a source of ambiguity. | First v2 release has one normal finish path; retain an audited operator repair command later with explicit force reason and evidence. |
| Workflow files, allowed commands, finish criteria, and next workflow | **Keep concept, rework transport** | The route/skill/workflow split is central to predictable agent behavior. | Use versioned workflow references in responses, but make the Rust application own state transitions. A missing workflow reference is a routing error, not a best-effort guess. |
| Directive bundles and `nextCommandPath` guidance | **Keep selectively** | The legacy system can tell an agent what to do after a block or gate gap. | V2 responses should expose a bounded `next_step` object: reason, command, required inputs, workflow ref, and whether operator action is required. Do not embed untrusted work text as instructions. |
| Legacy web console, global manager, broad MCP, and full workflow port | **Defer** | V2 needs parity of the work loop, not every client surface. | Prove CLI/API parity first; add TUI actions only against the same API. No duplicated client-side transition logic. |
| Old file store/object-store compatibility and broad legacy migration | **Defer after migration mapping** | Compatibility matters, but it must not distort the new lifecycle contract. | Map statuses, reservations, evidence, and history explicitly; preserve unsupported/ambiguous records as historical or operator-review items. |

## Conditional status and eligibility model

### Observed legacy behavior

Legacy has a single `WorkStatus` enum (`draft`, `ready`, `reserved`,
`in_progress`, `blocked`, `needs_verification`, `verified`, `closed`,
`cancelled`) in `packages/core/src/records.ts`. Readiness is then recomputed
from dependencies and reconciliation obligations in
`packages/work-engine/src/work.ts`. A blocking dependency is any dependency
not terminal (`closed`, `cancelled`, or `verified`) or carrying open
reconciliation obligations. `claimNextWork` in `packages/engine/src/runtime.ts`
selects only status `ready`, no reservation, matching labels, and a second
derived-readiness check inside the write transaction.

`reserveWork` in `packages/agent-runtime/src/reservations.ts` turns a
successful reservation into `in_progress`. It rejects closed/cancelled work,
active conflicts, capacity overflow, and non-ready work unless `force` and a
reason are supplied. Releasing clears ownership and marks the reservation
`released`; expiry is a separate inspectable reservation state. The legacy
`agent start` path resumes an active reservation, blocks on expired active
reservations or capacity, claims exact work or the next ready item, and returns
`no_ready_work` when no candidate exists.

The important limitation is semantic: “blocked”, reservation ownership,
verification state, and dispatch policy are adjacent but not the same thing.
The enum does not natively represent `operator_only` or `paused`; project
registry lifecycle and orchestration have separate paused/released concepts.

### V2 recommendation

Do not port the enum as the sole state machine. The detailed and authoritative
v2 model is [STATUS_MODEL.md](STATUS_MODEL.md); this is a compact summary:

| Dimension | Recommended values | Meaning |
| --- | --- | --- |
| Task lifecycle | `draft`, `open`, `closed`, `cancelled` | Durable work state; `queued`, `ready`, `blocked`, `complete`, and verification/review labels are derived. |
| Current attempt | absent, `claimed`, `accepted`, `running`, `verifying`, terminal attempt outcome | One fenced execution generation; `claimed` is reservation, not productive work. |
| Dispatch policy | `automatic`, `operator_only`, `paused`, optional `retry_not_before` | Who may claim next; hard blocks and prerequisites are separate effective-eligibility inputs. |
| Ownership | current reservation/attempt with lease and fence | Actor, harness, session, expiry, and replacement boundary. |

The display layer may show a compact combined label, but API data must retain
all dimensions and their reasons. A release of an automatic task may yield
automatic eligibility again; an operator-only task stays operator-only; an
open prerequisite produces `queued` unless a hard reason makes it `blocked`.

## Acceptance scenarios

These are v2 planning scenarios, not completed test results.

1. **Multi-harness single winner.** Create one eligible task and start two
   different harnesses concurrently. Exactly one current attempt is committed;
   the other receives a conflict with the winning task/attempt revision. A
   read shows one owner, one fence, and one audit event for the claim.

2. **No-goal start.** A harness calls `agent start` or `next` with actor+harness
   but no task. If it has a current attempt, it resumes it. Otherwise `next`
   offers a trusted claim action for a ready task and `agent start` may claim
   through the same atomic path. If none is ready, it receives bounded idle
   status with ready/blocked/paused/operator-only counts, retry deadline, and
   routing/recovery guidance. It does not fail, invent a goal, or launch a model.

3. **Exact start and manual adoption.** A human/operator creates or manually
   starts a session for an eligible task. A harness adopts it using the same
   claim/accept protocol. A second adoption with the same operation ID is
   idempotent; a different session is rejected while the attempt is current.

4. **Queued transition.** Add an open dependency to a ready task. The next
   read and any claim transaction report `queued` with the exact prerequisite ID.
   Releasing an unrelated attempt cannot make it claimable. Closing the blocker
   recomputes the dependent task to eligible/automatic (unless another reason
   still blocks it).

5. **Operator-only transition.** Mark a task `operator_only`. Automatic pull
   and dispatch skip it; an authorized explicit operator claim succeeds with a
   reason and audit record. Releasing it leaves it operator-only. A label or
   parent change cannot silently promote it.

6. **Paused transition.** Pause an eligible task, then release or expire its
   attempt. Neither pull nor automatic dispatch claims it. Resume creates a new
   eligibility revision; a claim then succeeds only after dependency and
   capacity checks. Stale heartbeat/finish from the paused generation is
   rejected by fence.

7. **Released and replaced attempt.** Claim, checkpoint, release, then claim
   again. The old attempt remains inspectable and cannot finish the new one;
   the replacement has a greater fence and a distinct attempt ID. The next-step
   response names reclaim/resume behavior rather than hiding history.

8. **Evidence and verification.** Record a failed receipt, then a passed
   receipt for the same task. Both remain visible. Only the subject-matched
   passed receipt can support verification. A prose-only “tests passed” note,
   wrong source snapshot, stale fence, or mismatched command is rejected or
   remains unsatisfied with a machine-readable gap.

9. **Finish/release/closeout.** `finish --release` records evidence and any
   verification but leaves work open and ownership cleared. `finish --close`
   atomically validates the current fence, required evidence, verification,
   checkpoint/other gates, writes the completion event, and releases ownership.
   A repeated operation ID returns the original result; it never duplicates a
   completion event.

10. **Workflow routing after a gap.** A blocked claim, missing evidence, stale
    attempt, or closeout gate gap returns a typed reason plus exactly one safe
    next-step workflow/command and required inputs. The client can render that
    guidance for a human or harness without parsing prose. Unknown or missing
    workflow assets fail closed and identify the routing defect.

## Next-step guidance contract

Every mutating response that cannot advance work should expose a bounded
machine-readable shape equivalent to:

```json
{
  "reason": "queued_prerequisite_open",
  "message": "One normal prerequisite is still open.",
  "workflow_ref": "boreal.workflow.claim-and-finish-work.v1",
  "executable_action": {
    "source": "trusted_directive_registry",
    "runner": "boreal_cli",
    "argv": ["bwrk", "work", "show", "task_123", "--json"],
    "cwd": "/project",
    "shell": false
  },
  "required_inputs": ["blocker_id"],
  "operator_required": false,
  "retry_not_before": null
}
```

The command is guidance, not an instruction sourced from task description,
evidence, or raw memory. For `operator_only`, `paused`, stale-fence, and
unknown-outcome cases, `operator_required` and recovery guidance must be
explicit. For no-goal start, guidance must be pull/route-oriented and must not
pretend a task was selected.

## Verification and closeout recommendation

The legacy gate contract is strong enough to preserve: subject identity,
evidence kind/outcome, trust level, verification record, checkpoint proof, and
explicit forced bypass. The v2 first slice should implement the smallest
complete path rather than a prose-compatible subset:

1. Declare acceptance criteria and required verification/checkpoint policy at
   task creation.
2. Capture a structured receipt outside the write transaction, including
   executable/argv, source or Git snapshot, exit state, output digest/reference,
   and executor/harness identity.
3. In one short finish transaction, recheck attempt fence, attach the receipt,
   create verification, evaluate gates, close or release, append the audit
   event, and advance the revision.
4. Return gate status and gaps in the same bounded envelope. Failed evidence,
   prior attempts, and forced gates remain inspectable.

Do not make `evidence add --command` execute a command; the legacy docs already
separate reported evidence from Boreal-witnessed execution. Do not require
Git commits for operational claims unless the declared checkpoint policy says
so; the v2 memory plan correctly keeps published memory and live work as
different authorities.

## What remains explicitly deferred

- Full legacy web console/global manager/MCP parity.
- Broad custom workflow templates and specialized directive families beyond
  the core trusted registry, conditional claim/evidence/finish/recovery loop,
  and launch-required review/audit/checkpoint obligations.
- Automatic harness/model launching inside a claim transaction.
- Direct close and arbitrary forced bypasses in the normal agent path.
- A complete migration mapping for every legacy record shape; P0-04 owns that
  inventory.

These deferrals are safe only if the first v2 vertical proves the scenarios
above and preserves historical failed evidence and attempts. Otherwise the
result may be faster or cleaner internally but will no longer behave like
Boreal at the point agents actually coordinate work.

## Verification note for this planning pass

This document was produced from repository code and documentation inspection.
No Boreal work/memory mutation was performed. A subagent's read-only
`bwrk prime --json` attempt encountered a live runtime lock, which was not
cleared or broken. The main planning check later succeeded read-only and
reported `canonicalWritesAllowed: false` from a build/digest mismatch.

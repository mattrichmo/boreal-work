# R-PARITY — project/WORKFLOW_PARITY.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/WORKFLOW_PARITY.md:L1–L262`  
**File SHA-256:** `26b83506fc2a98cdc58e642f237f5f6270deeb67608cf2995e01e1d23f7a35d2`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Known retained/reworked/deferred v1 command and workflow meanings.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,262p' 'project/WORKFLOW_PARITY.md'
```

## Exact baseline excerpt

````text
    1 | > M02 inventory, ownership and evidence limitations: see
    2 | > `validation/m02/PARITY.md` and `validation/m02/COMMAND_INVENTORY.json`.
    3 | > Historical source references below were supplied with the snapshot; the
    4 | > legacy runtime is not included and has not been silently reconstructed.
    5 | 
    6 | # Workflow parity: legacy Boreal to v2
    7 | 
    8 | Status: bounded v2 planning note, 2026-09-14. This is a behavioral parity
    9 | assessment, not a claim that the v2 implementation is complete. “Observed”
   10 | below means behavior visible in the legacy checkout or already stated as a v2
   11 | contract. “Recommendation” is a v2 design choice and must not be treated as
   12 | implemented until it has a transition fixture and acceptance evidence.
   13 | 
   14 | ## The short version
   15 | 
   16 | Boreal still feels like Boreal when a task is dependency-aware, an agent can
   17 | claim it without racing another harness, ownership is explicit and recoverable,
   18 | completion is proved rather than asserted, and the next safe action is visible.
   19 | The v2 direction is right to make eligibility explicit and to separate a
   20 | current fenced attempt from durable task state. The main parity risk is
   21 | collapsing all of that back into one status enum, or making a scheduler/model
   22 | call authoritative for a transition.
   23 | 
   24 | The minimum v2 invariant is:
   25 | 
   26 | ```text
   27 | task state + dependency state + explicit eligibility
   28 |   -> claimable or not
   29 | current attempt + fence + session/harness
   30 |   -> who may act now
   31 | structured evidence + verification + closeout policy
   32 |   -> whether completion is allowed
   33 | ```
   34 | 
   35 | The more precise v2 taxonomy, `queued` versus intervention `blocked`, hard
   36 | attempt deadlines versus renewable leases, expiry review, and close-only
   37 | default dependency satisfaction are specified in
   38 | [STATUS_MODEL.md](STATUS_MODEL.md). Where this older parity note uses
   39 | `blocked` for an open prerequisite, read it as legacy behavior; the new
   40 | authoritative display status is `queued` unless another hard reason applies.
   41 | 
   42 | ## Source map
   43 | 
   44 | | Surface | Legacy source of truth / evidence | V2 source or planned contract |
   45 | | --- | --- | --- |
   46 | | Work statuses and readiness | `packages/core/src/records.ts`; `packages/work-engine/src/work.ts`; `AGENT_README.md` §7 | `project/AGENT_LIFECYCLE.md`; `project/build-plan/verticals/00-contracts-baseline.md`; `crates/domain/src/lib.rs` |
   47 | | Reservation and claim race | `packages/agent-runtime/src/reservations.ts`; `packages/engine/src/runtime.ts`; `apps/cli/src/commands/agent.ts` | `project/AGENT_LIFECYCLE.md`; `project/STATE_AND_CONCURRENCY.md` |
   48 | | Start/no-work guidance | `apps/cli/src/commands/agent.ts` (`agentStartCommand`); `AGENT_README.md` §§6–7 | `project/INTERFACES.md`; `project/build-plan/verticals/02-attempt-runtime.md` |
   49 | | Finish, release, close | `apps/cli/src/commands/agent.ts`; `packages/engine/src/runtime.ts`; `workflows/40-work/claim-and-finish-work.md` | `project/AGENT_LIFECYCLE.md`; `project/build-plan/verticals/02-attempt-runtime.md` |
   50 | | Evidence trust and verification | `docs/architecture/EVIDENCE_TRUST.md`; `packages/evidence-engine/src/evidence.ts`; `AGENT_README.md` §9 | `project/AGENT_LIFECYCLE.md`; `project/DECISIONS.md` (open completion-evidence decision) |
   51 | | Closeout gates | `docs/architecture/CLOSEOUT_GATE_CONTRACT.md`; `packages/core/src/records.ts`; `packages/engine/src/runtime.ts` | `project/AGENT_LIFECYCLE.md`; `project/build-plan/verticals/02-attempt-runtime.md` |
   52 | | Workflow routing and next step | `workflows/00-agent/route-request.md`; `apps/cli/src/commands/protocol.ts`; `packages/core/src/agent-directive-compiler.ts`; `apps/daemon/src/runtime.ts` | `project/INTERFACES.md`; `project/README.md`; `project/build-plan/verticals/00-contracts-baseline.md` |
   53 | | Legacy/performance failure evidence | `project/AUDIT_BASELINE.md`; `V2_REBUILD_PLAN.md` | Same files plus the v2 build-plan traceability matrix |
   54 | 
   55 | ## Keep / rework / defer matrix
   56 | 
   57 | | Current capability | Disposition | Why this is essential or not | V2 acceptance bar / next step |
   58 | | --- | --- | --- | --- |
   59 | | Dependency-derived readiness; open blockers keep work out of the queue | **Keep, rework representation** | This is the clearest “Boreal” behavior. Legacy `deriveReadinessStatus` treats `draft`/`blocked` as `ready` only after gaps clear, and reconciliation obligations can still block. | Show normal upstream wait as `queued`, hard intervention as `blocked`; keep dependency edges canonical, derive eligibility at claim time, and return reason IDs plus a next action. Add legal/illegal transition fixtures in P0-03. |
   60 | | `ready` queue versus raw `--status ready` filter | **Keep, clarify** | Legacy docs explicitly distinguish dependency-valid `--ready` from a raw status filter. Losing this distinction recreates stale-queue bugs. | V2 status must label “eligible now” separately from task status; a stale snapshot cannot authorize a claim. |
   61 | | Atomic find-and-reserve / one active reservation | **Keep, rework attempt model** | Legacy claim selection and reservation are locked together; v2 correctly promotes one current attempt and a fence. | Two or more harnesses racing 100 times produce one winner per task; loser gets typed conflict, not a second attempt. |
   62 | | Agent `start` resumes an owned active reservation before claiming another | **Keep** | This prevents accidental double work and makes restart/resume practical. | `start` with an agent and no goal first resumes that agent’s current attempt; if none exists, it performs the bounded pull path. |
   63 | | No-goal start returns a structured `no_ready_work` result | **Keep, expand guidance** | Legacy returns exit success for no ready work, but the response is still actionable machine data. | Include counts, blockers, eligibility reasons, retry deadline, and exact next command/workflow. Never turn “no work” into a failure or an implicit model call. |
   64 | | Forced reservation of non-ready work with a reason | **Rework sharply** | Legacy `work reserve` permits force+reason for non-ready work, while ordinary claim/start does not. This is useful for operators but too easy to confuse with normal eligibility. | Separate `operator_only`/override capability from automatic eligibility. Require explicit actor permission, reason code, audit event, and never let a forced claim make the task scheduler-eligible. |
   65 | | `in_progress` as the post-claim work status | **Rework representation** | It is useful in the UI, but it currently carries reservation/attempt meaning that v2 needs to model explicitly. | Derive display status from task state + current attempt; persist one current attempt and fence. Keep `claimed`, `accepted`, and `running` visible without making them competing authorities. |
   66 | | `blocked` as a dependency/reconciliation state | **Keep, split causes** | V1 conflates normal upstream wait with intervention. | Display `queued` for prerequisite wait and `blocked` for reconciliation/decision/integrity intervention; return all typed reasons. Release must recompute rather than blindly make work ready. |
   67 | | `paused`, `operator_only`, and `automatic` dispatch policy | **Keep as v2-first behavior** | Legacy work statuses do not encode all of these; v2 explicitly promises them because the audit found redispatch loops. | Policy is explicit; effective eligibility additionally checks prerequisites, hard reasons, attempt, capacity, and time. Labels/descriptions cannot grant eligibility. |
   68 | | Released and expired reservations remain inspectable; work can become ready again | **Keep** | Release is ownership history, not completion. This is a key recovery property. | Release/expiry increments the fence, closes the current attempt, preserves history, derives the next eligibility, and supplies the reclaim command. Test release of ready, blocked, paused, and operator-only tasks. |
   69 | | Manual claim/adoption of an already-started session | **Keep, define identity rules** | V2 explicitly supports a harness adopting a manually started session; without a common path, lifecycle drift returns. | Manual and automatic claim use the same transaction and attempt schema. Adoption must bind actor+harness+session, reject a conflicting current session, and be idempotent by operation ID. |
   70 | | `work verify` requires subject-matched passed evidence | **Keep, make structured** | This prevents a passing sentence or unrelated evidence from closing work. | Verification checks evidence subject, outcome, receipt/source identity, and freshness; prose is explanatory only. Failed evidence remains queryable. |
   71 | | Evidence trust levels: legacy, self-reported, Boreal-witnessed, external | **Keep** | Trust provenance is separate from result and is needed for honest migration. | Port the distinction into structured receipts. Never upgrade trust from `outcome=passed`, command text, actor kind, or Git history. |
   72 | | Declared verification/review/audit/checkpoint gates | **Keep, simplify where possible** | Gates make closeout policy explicit and roll-up-safe. | V2 launch must support all four gate kinds with typed outcomes; the first executable slice can begin with verification/checkpoint. Every close response returns open/satisfied/forced gates and gaps. |
   73 | | `agent finish --close` versus `--release` | **Keep** | It is the useful composite path: evidence, verification, close/release, ownership cleanup, and readiness repair. | Implement one atomic application operation. `close` requires passed verification and required gates; `release` never implies done. Repeated finish returns the prior operation result. |
   74 | | Direct `work close` and forced gate paths | **Defer or operator-only** | Legacy needs historical repair, but multiple close paths are a source of ambiguity. | First v2 release has one normal finish path; retain an audited operator repair command later with explicit force reason and evidence. |
   75 | | Workflow files, allowed commands, finish criteria, and next workflow | **Keep concept, rework transport** | The route/skill/workflow split is central to predictable agent behavior. | Use versioned workflow references in responses, but make the Rust application own state transitions. A missing workflow reference is a routing error, not a best-effort guess. |
   76 | | Directive bundles and `nextCommandPath` guidance | **Keep selectively** | The legacy system can tell an agent what to do after a block or gate gap. | V2 responses should expose a bounded `next_step` object: reason, command, required inputs, workflow ref, and whether operator action is required. Do not embed untrusted work text as instructions. |
   77 | | Legacy web console, global manager, broad MCP, and full workflow port | **Defer** | V2 needs parity of the work loop, not every client surface. | Prove CLI/API parity first; add TUI actions only against the same API. No duplicated client-side transition logic. |
   78 | | Old file store/object-store compatibility and broad legacy migration | **Defer after migration mapping** | Compatibility matters, but it must not distort the new lifecycle contract. | Map statuses, reservations, evidence, and history explicitly; preserve unsupported/ambiguous records as historical or operator-review items. |
   79 | 
   80 | ## Conditional status and eligibility model
   81 | 
   82 | ### Observed legacy behavior
   83 | 
   84 | Legacy has a single `WorkStatus` enum (`draft`, `ready`, `reserved`,
   85 | `in_progress`, `blocked`, `needs_verification`, `verified`, `closed`,
   86 | `cancelled`) in `packages/core/src/records.ts`. Readiness is then recomputed
   87 | from dependencies and reconciliation obligations in
   88 | `packages/work-engine/src/work.ts`. A blocking dependency is any dependency
   89 | not terminal (`closed`, `cancelled`, or `verified`) or carrying open
   90 | reconciliation obligations. `claimNextWork` in `packages/engine/src/runtime.ts`
   91 | selects only status `ready`, no reservation, matching labels, and a second
   92 | derived-readiness check inside the write transaction.
   93 | 
   94 | `reserveWork` in `packages/agent-runtime/src/reservations.ts` turns a
   95 | successful reservation into `in_progress`. It rejects closed/cancelled work,
   96 | active conflicts, capacity overflow, and non-ready work unless `force` and a
   97 | reason are supplied. Releasing clears ownership and marks the reservation
   98 | `released`; expiry is a separate inspectable reservation state. The legacy
   99 | `agent start` path resumes an active reservation, blocks on expired active
  100 | reservations or capacity, claims exact work or the next ready item, and returns
  101 | `no_ready_work` when no candidate exists.
  102 | 
  103 | The important limitation is semantic: “blocked”, reservation ownership,
  104 | verification state, and dispatch policy are adjacent but not the same thing.
  105 | The enum does not natively represent `operator_only` or `paused`; project
  106 | registry lifecycle and orchestration have separate paused/released concepts.
  107 | 
  108 | ### V2 recommendation
  109 | 
  110 | Do not port the enum as the sole state machine. The detailed and authoritative
  111 | v2 model is [STATUS_MODEL.md](STATUS_MODEL.md); this is a compact summary:
  112 | 
  113 | | Dimension | Recommended values | Meaning |
  114 | | --- | --- | --- |
  115 | | Task lifecycle | `draft`, `open`, `closed`, `cancelled` | Durable work state; `queued`, `ready`, `blocked`, `complete`, and verification/review labels are derived. |
  116 | | Current attempt | absent, `claimed`, `accepted`, `running`, `verifying`, terminal attempt outcome | One fenced execution generation; `claimed` is reservation, not productive work. |
  117 | | Dispatch policy | `automatic`, `operator_only`, `paused`, optional `retry_not_before` | Who may claim next; hard blocks and prerequisites are separate effective-eligibility inputs. |
  118 | | Ownership | current reservation/attempt with lease and fence | Actor, harness, session, expiry, and replacement boundary. |
  119 | 
  120 | The display layer may show a compact combined label, but API data must retain
  121 | all dimensions and their reasons. A release of an automatic task may yield
  122 | automatic eligibility again; an operator-only task stays operator-only; an
  123 | open prerequisite produces `queued` unless a hard reason makes it `blocked`.
  124 | 
  125 | ## Acceptance scenarios
  126 | 
  127 | These are v2 planning scenarios, not completed test results.
  128 | 
  129 | 1. **Multi-harness single winner.** Create one eligible task and start two
  130 |    different harnesses concurrently. Exactly one current attempt is committed;
  131 |    the other receives a conflict with the winning task/attempt revision. A
  132 |    read shows one owner, one fence, and one audit event for the claim.
  133 | 
  134 | 2. **No-goal start.** A harness calls `agent start` or `next` with actor+harness
  135 |    but no task. If it has a current attempt, it resumes it. Otherwise `next`
  136 |    offers a trusted claim action for a ready task and `agent start` may claim
  137 |    through the same atomic path. If none is ready, it receives bounded idle
  138 |    status with ready/blocked/paused/operator-only counts, retry deadline, and
  139 |    routing/recovery guidance. It does not fail, invent a goal, or launch a model.
  140 | 
  141 | 3. **Exact start and manual adoption.** A human/operator creates or manually
  142 |    starts a session for an eligible task. A harness adopts it using the same
  143 |    claim/accept protocol. A second adoption with the same operation ID is
  144 |    idempotent; a different session is rejected while the attempt is current.
  145 | 
  146 | 4. **Queued transition.** Add an open dependency to a ready task. The next
  147 |    read and any claim transaction report `queued` with the exact prerequisite ID.
  148 |    Releasing an unrelated attempt cannot make it claimable. Closing the blocker
  149 |    recomputes the dependent task to eligible/automatic (unless another reason
  150 |    still blocks it).
  151 | 
  152 | 5. **Operator-only transition.** Mark a task `operator_only`. Automatic pull
  153 |    and dispatch skip it; an authorized explicit operator claim succeeds with a
  154 |    reason and audit record. Releasing it leaves it operator-only. A label or
  155 |    parent change cannot silently promote it.
  156 | 
  157 | 6. **Paused transition.** Pause an eligible task, then release or expire its
  158 |    attempt. Neither pull nor automatic dispatch claims it. Resume creates a new
  159 |    eligibility revision; a claim then succeeds only after dependency and
  160 |    capacity checks. Stale heartbeat/finish from the paused generation is
  161 |    rejected by fence.
  162 | 
  163 | 7. **Released and replaced attempt.** Claim, checkpoint, release, then claim
  164 |    again. The old attempt remains inspectable and cannot finish the new one;
  165 |    the replacement has a greater fence and a distinct attempt ID. The next-step
  166 |    response names reclaim/resume behavior rather than hiding history.
  167 | 
  168 | 8. **Evidence and verification.** Record a failed receipt, then a passed
  169 |    receipt for the same task. Both remain visible. Only the subject-matched
  170 |    passed receipt can support verification. A prose-only “tests passed” note,
  171 |    wrong source snapshot, stale fence, or mismatched command is rejected or
  172 |    remains unsatisfied with a machine-readable gap.
  173 | 
  174 | 9. **Finish/release/closeout.** `finish --release` records evidence and any
  175 |    verification but leaves work open and ownership cleared. `finish --close`
  176 |    atomically validates the current fence, required evidence, verification,
  177 |    checkpoint/other gates, writes the completion event, and releases ownership.
  178 |    A repeated operation ID returns the original result; it never duplicates a
  179 |    completion event.
  180 | 
  181 | 10. **Workflow routing after a gap.** A blocked claim, missing evidence, stale
  182 |     attempt, or closeout gate gap returns a typed reason plus exactly one safe
  183 |     next-step workflow/command and required inputs. The client can render that
  184 |     guidance for a human or harness without parsing prose. Unknown or missing
  185 |     workflow assets fail closed and identify the routing defect.
  186 | 
  187 | ## Next-step guidance contract
  188 | 
  189 | Every mutating response that cannot advance work should expose a bounded
  190 | machine-readable shape equivalent to:
  191 | 
  192 | ```json
  193 | {
  194 |   "reason": "queued_prerequisite_open",
  195 |   "message": "One normal prerequisite is still open.",
  196 |   "workflow_ref": "boreal.workflow.claim-and-finish-work.v1",
  197 |   "executable_action": {
  198 |     "source": "trusted_directive_registry",
  199 |     "runner": "boreal_cli",
  200 |     "argv": ["bwrk", "work", "show", "task_123", "--json"],
  201 |     "cwd": "/project",
  202 |     "shell": false
  203 |   },
  204 |   "required_inputs": ["blocker_id"],
  205 |   "operator_required": false,
  206 |   "retry_not_before": null
  207 | }
  208 | ```
  209 | 
  210 | The command is guidance, not an instruction sourced from task description,
  211 | evidence, or raw memory. For `operator_only`, `paused`, stale-fence, and
  212 | unknown-outcome cases, `operator_required` and recovery guidance must be
  213 | explicit. For no-goal start, guidance must be pull/route-oriented and must not
  214 | pretend a task was selected.
  215 | 
  216 | ## Verification and closeout recommendation
  217 | 
  218 | The legacy gate contract is strong enough to preserve: subject identity,
  219 | evidence kind/outcome, trust level, verification record, checkpoint proof, and
  220 | explicit forced bypass. The v2 first slice should implement the smallest
  221 | complete path rather than a prose-compatible subset:
  222 | 
  223 | 1. Declare acceptance criteria and required verification/checkpoint policy at
  224 |    task creation.
  225 | 2. Capture a structured receipt outside the write transaction, including
  226 |    executable/argv, source or Git snapshot, exit state, output digest/reference,
  227 |    and executor/harness identity.
  228 | 3. In one short finish transaction, recheck attempt fence, attach the receipt,
  229 |    create verification, evaluate gates, close or release, append the audit
  230 |    event, and advance the revision.
  231 | 4. Return gate status and gaps in the same bounded envelope. Failed evidence,
  232 |    prior attempts, and forced gates remain inspectable.
  233 | 
  234 | Do not make `evidence add --command` execute a command; the legacy docs already
  235 | separate reported evidence from Boreal-witnessed execution. Do not require
  236 | Git commits for operational claims unless the declared checkpoint policy says
  237 | so; the v2 memory plan correctly keeps published memory and live work as
  238 | different authorities.
  239 | 
  240 | ## What remains explicitly deferred
  241 | 
  242 | - Full legacy web console/global manager/MCP parity.
  243 | - Broad custom workflow templates and specialized directive families beyond
  244 |   the core trusted registry, conditional claim/evidence/finish/recovery loop,
  245 |   and launch-required review/audit/checkpoint obligations.
  246 | - Automatic harness/model launching inside a claim transaction.
  247 | - Direct close and arbitrary forced bypasses in the normal agent path.
  248 | - A complete migration mapping for every legacy record shape; P0-04 owns that
  249 |   inventory.
  250 | 
  251 | These deferrals are safe only if the first v2 vertical proves the scenarios
  252 | above and preserves historical failed evidence and attempts. Otherwise the
  253 | result may be faster or cleaner internally but will no longer behave like
  254 | Boreal at the point agents actually coordinate work.
  255 | 
  256 | ## Verification note for this planning pass
  257 | 
  258 | This document was produced from repository code and documentation inspection.
  259 | No Boreal work/memory mutation was performed. A subagent's read-only
  260 | `bwrk prime --json` attempt encountered a live runtime lock, which was not
  261 | cleared or broken. The main planning check later succeeded read-only and
  262 | reported `canonicalWritesAllowed: false` from a build/digest mismatch.
````

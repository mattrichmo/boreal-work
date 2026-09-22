# R-GUIDANCE — project/AGENT_GUIDANCE.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/AGENT_GUIDANCE.md:L1–L305`  
**File SHA-256:** `8b8e90a3ba8fb4482b40957ac9ec8aa6e7b8642ec62b2fbf3586c266b3b80456`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Trusted guide/next, conditional directives, no-goal behavior, safe argv and bounded context.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,305p' 'project/AGENT_GUIDANCE.md'
```

## Exact baseline excerpt

````text
    1 | # V2 Agent Guidance Protocol
    2 | 
    3 | Status: bounded planning contract. Owner: Rust application/domain layer and
    4 | the versioned local protocol. This document defines the first-class v2
    5 | self-guiding agent surface; it does not create a second workflow engine.
    6 | 
    7 | ## Goal
    8 | 
    9 | An agent must be able to ask one question—“what is the next safe action in
   10 | this project context?”—without supplying a goal, rediscovering flag grammar,
   11 | or interpreting free-form work text as policy. Rust owns the answer. The CLI,
   12 | TUI, service, and future harness adapters are clients of the same DTO and
   13 | selection rules.
   14 | 
   15 | The protocol preserves the useful legacy contract:
   16 | 
   17 | - a trusted, versioned directive registry;
   18 | - contextual status, requirements, and one next action;
   19 | - exact safe `argv`, working directory, runner, and `shell: false`;
   20 | - context and provenance sufficient to explain selection;
   21 | - `blocking`, `required`, and `advisory` severity;
   22 | - one-action-at-a-time progression with deterministic resume and failure
   23 |   handling.
   24 | 
   25 | It projects live enforcement state. It does not replace dependency checks,
   26 | attempt fences, closeout gates, receipt validation, health checks, or workflow
   27 | finish criteria.
   28 | The status taxonomy and deadline rules are defined in
   29 | [STATUS_MODEL.md](STATUS_MODEL.md): a normal downstream wait is `queued`, a
   30 | hard intervention is `blocked`, and an elapsed claim is `expired_review` until
   31 | safe fenced recovery. Guidance explains each differently; it never offers a
   32 | claim merely because a persisted legacy status said `ready`.
   33 | 
   34 | ## Parity essentials for the first v2 slice
   35 | 
   36 | ### Rust-owned inputs
   37 | 
   38 | The Rust application creates a bounded `GuidanceContext` at one project
   39 | revision. It includes only typed, current data needed for selection:
   40 | 
   41 | ```text
   42 | project_id, project_revision
   43 | actor_id, harness_id, session_id
   44 | current_attempt { work_id, attempt_id, fence, state, lease_deadline }
   45 | eligible_work { bounded summaries, dependency/readiness state }
   46 | open_requirements { gate ids, verification/review/audit/checkpoint state }
   47 | health { diagnostics, sync/index status }
   48 | workflow { canonical refs, required input names, asset/config identity }
   49 | source_snapshot { schema/version, content hash, captured_at }
   50 | ```
   51 | 
   52 | The read is internally consistent at `project_revision`, bounded independently
   53 | of historical attempts, and never holds a database transaction while rendering,
   54 | running a subprocess, invoking a model, or waiting for a client.
   55 | 
   56 | ### Trusted registry
   57 | 
   58 | The registry is checked-in Rust data (or a Rust-owned generated equivalent)
   59 | with an immutable version and entries containing:
   60 | 
   61 | ```text
   62 | registry_id, entry_version, family, severity, kind, title, instruction
   63 | trigger_codes, command_template_id, acknowledgement/closeout effect
   64 | ```
   65 | 
   66 | Only registry entries supply imperative `title` and `instruction` text. A
   67 | directive is emitted only when a stable enforcement gap or documented
   68 | navigation boundary selects it. Missing registry entries, invalid versions,
   69 | missing required payloads, or conflicting safety requirements fail closed.
   70 | The Rust application exposes severity, runner, shell mode, and safe argv as
   71 | one validated action boundary. Required and blocking directives must be
   72 | acknowledged as actions; advisory discovery remains navigation and must not be
   73 | relabeled as the required `agent.start` action. Clients should use the checked
   74 | application selection seam before executing or presenting a directive as
   75 | executable.
   76 | 
   77 | Selection is deterministic: active attempt and recovery requirements precede
   78 | new work; `blocking` precedes `required`, which precedes `advisory`; ties use
   79 | stable gap code, subject id, registry id, and directive id ordering. The
   80 | response contains conflicts or deferrals when they matter to diagnosis, but
   81 | returns exactly one executable action.
   82 | 
   83 | ### Compact response shape
   84 | 
   85 | The first protocol version should expose one bounded JSON response. Names may
   86 | be snake_case on the wire, but the fields and meaning are stable:
   87 | 
   88 | ```json
   89 | {
   90 |   "schema_version": "boreal.agent_guidance.v1",
   91 |   "protocol_version": "2",
   92 |   "operation_id": "op_...",
   93 |   "project_revision": 42,
   94 |   "context": { "mode": "resume", "project_id": "...", "actor_id": "...", "session_id": "..." },
   95 |   "status": { "state": "active_attempt", "work_id": "...", "attempt_id": "...", "summary": "..." },
   96 |   "requirements": [
   97 |     { "id": "gate_...", "kind": "verification", "severity": "required", "state": "open", "reason": "..." }
   98 |   ],
   99 |   "next_action": {
  100 |     "directive_id": "verification.evidence-required@v1",
  101 |     "severity": "required",
  102 |     "title": "Attach passed verification evidence",
  103 |     "instruction": "Run the required validation command and attach passed verification evidence.",
  104 |     "subject": { "type": "work", "id": "..." },
  105 |     "safe_argv": ["bwrk", "evidence", "run", "...", "--gate", "...", "--json"],
  106 |     "cwd": "/project",
  107 |     "runner": "bounded_declared_gate",
  108 |     "shell": false
  109 |   },
  110 |   "provenance": {
  111 |     "registry_version": "directives.v1",
  112 |     "registry_path": "...",
  113 |     "source_snapshot_hash": "sha256:...",
  114 |     "gap_codes": ["gate.verification.unsatisfied"],
  115 |     "workflow_refs": ["boreal.workflow..."],
  116 |     "config_identity": "sha256:..."
  117 |   },
  118 |   "selection_key": "...",
  119 |   "error": null
  120 | }
  121 | ```
  122 | 
  123 | `requirements` is bounded and factual; `next_action` is either one complete
  124 | safe action or `null` for `idle`. The response may include `detail_ref` for
  125 | bounded, digest-checked detail, but must not inline unbounded history or raw
  126 | source. `status`, `requirements`, and provenance explain the choice; they do
  127 | not authorize additional actions.
  128 | 
  129 | ### Exact safe action boundary
  130 | 
  131 | Rust constructs `safe_argv` from an allowlisted command grammar and typed IDs,
  132 | flags, revisions, fences, gate IDs, and paths. It validates argument count,
  133 | path scope, size, project binding, and required `--json`/protocol options.
  134 | The executor receives argv directly with `shell: false`; display strings are
  135 | derived from argv and are never parsed back into execution.
  136 | 
  137 | The only first-slice runners are `boreal_cli` for read/mutation protocol
  138 | commands and `bounded_declared_gate` for a declared validation gate. The
  139 | bounded gate runner validates the declared command against the project policy,
  140 | records executable/argv/cwd/exit/source snapshot/output digest and attestation,
  141 | and returns a typed receipt. A work-authored command is data and may be shown
  142 | as quoted display text, but cannot become an agent instruction or arbitrary
  143 | shell execution merely because it appears in a task, comment, evidence,
  144 | memory, raw source, or model response.
  145 | 
  146 | ### One-action loop
  147 | 
  148 | `bwrk next --json` remains the no-goal entry point. `bwrk agent guide --json`
  149 | explains the loop and current obligations; an `agent next` alias is optional.
  150 | The request may include an optional project,
  151 | actor, session, or goal/work filter, but a missing goal is valid and means
  152 | “derive from current eligible state.” It is read-only and returns one action.
  153 | 
  154 | The client executes or presents that action, records the result through the
  155 | normal Rust command path, then asks again. It must not plan or execute a chain
  156 | of actions from one response. A mutation is separately protected by
  157 | `operation_id`, expected revision, attempt `fence`, and the same application
  158 | transition used by non-agent clients.
  159 | 
  160 | `bwrk agent resume --session <id> --json` (with an attempt or operation id
  161 | when known) resolves the current fenced attempt and returns its current
  162 | guidance. Resume is idempotent: it reloads the durable attempt/session state;
  163 | it never claims replacement work just because a process restarted. If an
  164 | outcome is uncertain, the client reads by operation id before retrying.
  165 | 
  166 | ## Safety boundary: trusted policy versus work-authored text
  167 | 
  168 | | Input | Trust treatment | Allowed use |
  169 | | --- | --- | --- |
  170 | | Rust registry entry | trusted policy, versioned and validated | imperative instruction, directive identity, command template id |
  171 | | Rust command grammar and application state | trusted typed data | construct exact argv and enforce transitions |
  172 | | Work title, description, labels, comments | untrusted content | quoted subject/display data only |
  173 | | Declared validation command | untrusted until policy-validated | input to the bounded gate runner; never direct shell text |
  174 | | Evidence, memory, raw source, search result, model output | untrusted content | provenance, references, quoted detail, or typed fields only |
  175 | 
  176 | Untrusted text may be classified into a typed request intent, but cannot
  177 | define or override a registry id, severity, runner, workflow asset, or
  178 | executable path. A trusted route registry selects among allowlisted workflow
  179 | refs after authorization and state checks; an agent cannot execute a command
  180 | just because a task or source suggested it. Markdown is never reinterpreted
  181 | as instructions after it is loaded from work or memory. Renderers keep
  182 | trusted instruction text, typed data, display text, and provenance separate.
  183 | 
  184 | ## Entry, resume, and state transitions
  185 | 
  186 | The minimal flow is:
  187 | 
  188 | ```text
  189 | next(no goal) -> one action
  190 |   -> execute/record one action
  191 |   -> next(current session/attempt)
  192 |   -> checkpoint or receipt
  193 |   -> next
  194 |   -> finish/release/fail through fenced Rust command
  195 | ```
  196 | 
  197 | An active non-expired attempt wins over ready work. Open blockers, stale
  198 | health, or an unsafe/missing requirement stop normal work and produce the
  199 | highest-severity recovery action. `idle` is a valid terminal answer when
  200 | there is no active attempt, no eligible work, and no health requirement; it
  201 | must not invent a goal or suggest a free-form command.
  202 | 
  203 | ## Failures and fail-closed behavior
  204 | 
  205 | Every failure is a typed outcome with the observed revision and a bounded
  206 | recovery hint, never a guessed action:
  207 | 
  208 | - invalid or stale context: return `conflict`/`stale_context` and require a
  209 |   fresh `next`;
  210 | - missing registry entry, invalid payload, or provenance mismatch: return
  211 |   `guidance_unavailable` and block execution;
  212 | - blocked, ineligible, expired, or fenced attempt: return the current state and
  213 |   the recovery directive; do not mutate a replacement attempt;
  214 | - busy/unavailable service: return retry metadata and preserve operation id;
  215 | - subprocess nonzero, timeout, oversized output, missing file, or digest
  216 |   mismatch: create a failed/unknown typed receipt and require resume/readback;
  217 | - uncertain mutation after disconnect: resolve by operation id before any
  218 |   retry; never assume success or redispatch blindly;
  219 | - unsafe authored command or path escape: reject it and leave project state
  220 |   unchanged.
  221 | 
  222 | ## Parity essentials versus later workflow packs
  223 | 
  224 | ### Required for v2 parity
  225 | 
  226 | - Rust-owned context snapshot and deterministic selection.
  227 | - Versioned registry, trusted instruction text, severity, gap codes, and
  228 |   provenance hash.
  229 | - Compact status/requirements/one-action response with exact safe argv and
  230 |   `shell: false`.
  231 | - No-goal `next`, fenced session/attempt resume, operation-id readback, and
  232 |   typed failure outcomes.
  233 | - Bounded gate execution and structured validation receipts.
  234 | - Core verification, checkpoint, review, and audit obligations, plus a compact
  235 |   context/handoff capsule for a replacement or resumed agent.
  236 | - CLI and service fixtures shared by the Rust CLI and all other clients.
  237 | 
  238 | ### Later than the P2 agent loop, but required before v2 cutover
  239 | 
  240 | P4-10 prepares and P4-11 validates the packaged core route, project/work/decision
  241 | context, work planning and sprint launch, review/audit, handoff/closeout,
  242 | health recovery, and source/memory workflows. These use the same registry,
  243 | typed inputs, application transitions, and one-action guide; they are not a
  244 | second engine. See the [canonical-workflow handoff](build-plan/verticals/12-canonical-workflows.md).
  245 | 
  246 | ### Explicitly outside the v2 launch scope
  247 | 
  248 | - Broad custom/user-authored packs beyond the packaged core routes,
  249 |   elaborate handoff authoring beyond the core resume capsule, and
  250 |   specialized review/audit choreography beyond gate satisfaction.
  251 | - Model-generated plans, autonomous multi-step execution, scheduler-driven
  252 |   dispatch, or arbitrary external tool/plugin execution.
  253 | - A second workflow DSL embedded in directives, free-form prompt policies,
  254 |   full historical timelines in routine guidance, or a TUI-specific protocol.
  255 | 
  256 | Later packs may add registry families and workflow refs only through the same
  257 | typed gap, provenance, command-grammar, and acceptance-test boundaries.
  258 | 
  259 | ## Acceptance tests
  260 | 
  261 | The first implementation is accepted only when these fixtures pass:
  262 | 
  263 | 1. **Contract:** serialize/deserialize the compact response; validate version,
  264 |    required fields, bounded sizes, null/empty arrays, unknown-field policy,
  265 |    and stable exit classes.
  266 | 2. **Registry trust:** every emitted directive references an existing
  267 |    `registry_id` and version; changing work descriptions, comments, raw source,
  268 |    or model text cannot change trusted instruction or runner selection.
  269 | 3. **Selection:** fixtures prove active attempt, blocker, health, ready-work,
  270 |    and idle precedence; ties produce the same selection key across processes.
  271 | 4. **Safe argv:** generated argv contains no shell metacharacter execution,
  272 |    stays project-bound, includes required JSON/protocol flags, and is executed
  273 |    only with `shell: false`; display text cannot be parsed as a substitute.
  274 | 5. **No-goal/resume:** an empty-goal request returns a bounded action or idle;
  275 |    restart plus `resume` returns the same current fenced attempt; no duplicate
  276 |    claim or dispatch occurs.
  277 | 6. **Failures:** stale revision/fence, missing registry data, blocked work,
  278 |    busy service, nonzero/timeout/oversized command, digest mismatch, and
  279 |    unknown operation outcome all fail closed and preserve state.
  280 | 7. **Receipts/provenance:** a successful gate records argv, cwd, exit status,
  281 |    timestamps, source/config identity, output digest/reference, subject,
  282 |    revision, and executor attestation; prose-only evidence is insufficient.
  283 | 8. **Boundedness:** status and guidance remain within the documented response
  284 |    budget as historical attempts grow; detail is referenced and digest-checked.
  285 | 9. **Client parity:** Rust CLI, local service, and a fixture client consume the
  286 |    same protocol fixtures and cannot open storage or implement transitions
  287 |    independently.
  288 | 
  289 | ## Source basis
  290 | 
  291 | This plan was derived from the legacy registry/compiler and runtime projection
  292 | in `packages/core/src/agent-directive-registry.ts`,
  293 | `packages/core/src/agent-directive-*.ts`, and
  294 | `packages/agent-runtime/src/directives.ts`; the `next` and legacy guide shapes
  295 | in `apps/cli/src/commands.ts`; directive safety and workflow boundaries in
  296 | `docs/architecture/AGENT_DIRECTIVES.md`,
  297 | `docs/architecture/AGENT_DIRECTIVE_LEGACY_BACKFILL.md`,
  298 | `docs/architecture/SKILLS_AND_WORKFLOWS.md`, and
  299 | `docs/product/V1_WORKFLOWS.md`; and the v2 Rust ownership, lifecycle,
  300 | protocol, bounded-status, and security constraints in
  301 | `project/AGENT_LIFECYCLE.md`,
  302 | `project/INTERFACES.md`,
  303 | `project/STATE_AND_CONCURRENCY.md`, and
  304 | `project/build-plan/verticals/02-attempt-runtime.md`,
  305 | `05-protocol-cli-service.md`, and `10-security-boundaries.md`.
````

# V2 Agent Guidance Protocol

Status: bounded planning contract. Owner: Rust application/domain layer and
the versioned local protocol. This document defines the first-class v2
self-guiding agent surface; it does not create a second workflow engine.

## Goal

An agent must be able to ask one question—“what is the next safe action in
this project context?”—without supplying a goal, rediscovering flag grammar,
or interpreting free-form work text as policy. Rust owns the answer. The CLI,
TUI, service, and future harness adapters are clients of the same DTO and
selection rules.

The protocol preserves the useful legacy contract:

- a trusted, versioned directive registry;
- contextual status, requirements, and one next action;
- exact safe `argv`, working directory, runner, and `shell: false`;
- context and provenance sufficient to explain selection;
- `blocking`, `required`, and `advisory` severity;
- one-action-at-a-time progression with deterministic resume and failure
  handling.

It projects live enforcement state. It does not replace dependency checks,
attempt fences, closeout gates, receipt validation, health checks, or workflow
finish criteria.
The status taxonomy and deadline rules are defined in
[STATUS_MODEL.md](STATUS_MODEL.md): a normal downstream wait is `queued`, a
hard intervention is `blocked`, and an elapsed claim is `expired_review` until
safe fenced recovery. Guidance explains each differently; it never offers a
claim merely because a persisted legacy status said `ready`.

## Parity essentials for the first v2 slice

### Rust-owned inputs

The Rust application creates a bounded `GuidanceContext` at one project
revision. It includes only typed, current data needed for selection:

```text
project_id, project_revision
actor_id, harness_id, session_id
current_attempt { work_id, attempt_id, fence, state, lease_deadline }
eligible_work { bounded summaries, dependency/readiness state }
open_requirements { gate ids, verification/review/audit/checkpoint state }
health { diagnostics, sync/index status }
workflow { canonical refs, required input names, asset/config identity }
source_snapshot { schema/version, content hash, captured_at }
```

The read is internally consistent at `project_revision`, bounded independently
of historical attempts, and never holds a database transaction while rendering,
running a subprocess, invoking a model, or waiting for a client.

### Trusted registry

The registry is checked-in Rust data (or a Rust-owned generated equivalent)
with an immutable version and entries containing:

```text
registry_id, entry_version, family, severity, kind, title, instruction
trigger_codes, command_template_id, acknowledgement/closeout effect
```

Only registry entries supply imperative `title` and `instruction` text. A
directive is emitted only when a stable enforcement gap or documented
navigation boundary selects it. Missing registry entries, invalid versions,
missing required payloads, or conflicting safety requirements fail closed.
The Rust application exposes severity, runner, shell mode, and safe argv as
one validated action boundary. Required and blocking directives must be
acknowledged as actions; advisory discovery remains navigation and must not be
relabeled as the required `agent.start` action. Clients should use the checked
application selection seam before executing or presenting a directive as
executable.

Selection is deterministic: active attempt and recovery requirements precede
new work; `blocking` precedes `required`, which precedes `advisory`; ties use
stable gap code, subject id, registry id, and directive id ordering. The
response contains conflicts or deferrals when they matter to diagnosis, but
returns exactly one executable action.

### Compact response shape

The first protocol version should expose one bounded JSON response. Names may
be snake_case on the wire, but the fields and meaning are stable:

```json
{
  "schema_version": "boreal.agent_guidance.v1",
  "protocol_version": "2",
  "operation_id": "op_...",
  "project_revision": 42,
  "context": { "mode": "resume", "project_id": "...", "actor_id": "...", "session_id": "..." },
  "status": { "state": "active_attempt", "work_id": "...", "attempt_id": "...", "summary": "..." },
  "requirements": [
    { "id": "gate_...", "kind": "verification", "severity": "required", "state": "open", "reason": "..." }
  ],
  "next_action": {
    "directive_id": "verification.evidence-required@v1",
    "severity": "required",
    "title": "Attach passed verification evidence",
    "instruction": "Run the required validation command and attach passed verification evidence.",
    "subject": { "type": "work", "id": "..." },
    "safe_argv": ["bwrk", "evidence", "run", "...", "--gate", "...", "--json"],
    "cwd": "/project",
    "runner": "bounded_declared_gate",
    "shell": false
  },
  "provenance": {
    "registry_version": "directives.v1",
    "registry_path": "...",
    "source_snapshot_hash": "sha256:...",
    "gap_codes": ["gate.verification.unsatisfied"],
    "workflow_refs": ["boreal.workflow..."],
    "config_identity": "sha256:..."
  },
  "selection_key": "...",
  "error": null
}
```

`requirements` is bounded and factual; `next_action` is either one complete
safe action or `null` for `idle`. The response may include `detail_ref` for
bounded, digest-checked detail, but must not inline unbounded history or raw
source. `status`, `requirements`, and provenance explain the choice; they do
not authorize additional actions.

### Exact safe action boundary

Rust constructs `safe_argv` from an allowlisted command grammar and typed IDs,
flags, revisions, fences, gate IDs, and paths. It validates argument count,
path scope, size, project binding, and required `--json`/protocol options.
The executor receives argv directly with `shell: false`; display strings are
derived from argv and are never parsed back into execution.

The only first-slice runners are `boreal_cli` for read/mutation protocol
commands and `bounded_declared_gate` for a declared validation gate. The
bounded gate runner validates the declared command against the project policy,
records executable/argv/cwd/exit/source snapshot/output digest and attestation,
and returns a typed receipt. A work-authored command is data and may be shown
as quoted display text, but cannot become an agent instruction or arbitrary
shell execution merely because it appears in a task, comment, evidence,
memory, raw source, or model response.

### One-action loop

`bwrk next --json` remains the no-goal entry point. `bwrk agent guide --json`
explains the loop and current obligations; an `agent next` alias is optional.
The request may include an optional project,
actor, session, or goal/work filter, but a missing goal is valid and means
“derive from current eligible state.” It is read-only and returns one action.

The client executes or presents that action, records the result through the
normal Rust command path, then asks again. It must not plan or execute a chain
of actions from one response. A mutation is separately protected by
`operation_id`, expected revision, attempt `fence`, and the same application
transition used by non-agent clients.

`bwrk agent resume --session <id> --json` (with an attempt or operation id
when known) resolves the current fenced attempt and returns its current
guidance. Resume is idempotent: it reloads the durable attempt/session state;
it never claims replacement work just because a process restarted. If an
outcome is uncertain, the client reads by operation id before retrying.

## Safety boundary: trusted policy versus work-authored text

| Input | Trust treatment | Allowed use |
| --- | --- | --- |
| Rust registry entry | trusted policy, versioned and validated | imperative instruction, directive identity, command template id |
| Rust command grammar and application state | trusted typed data | construct exact argv and enforce transitions |
| Work title, description, labels, comments | untrusted content | quoted subject/display data only |
| Declared validation command | untrusted until policy-validated | input to the bounded gate runner; never direct shell text |
| Evidence, memory, raw source, search result, model output | untrusted content | provenance, references, quoted detail, or typed fields only |

Untrusted text may be classified into a typed request intent, but cannot
define or override a registry id, severity, runner, workflow asset, or
executable path. A trusted route registry selects among allowlisted workflow
refs after authorization and state checks; an agent cannot execute a command
just because a task or source suggested it. Markdown is never reinterpreted
as instructions after it is loaded from work or memory. Renderers keep
trusted instruction text, typed data, display text, and provenance separate.

## Entry, resume, and state transitions

The minimal flow is:

```text
next(no goal) -> one action
  -> execute/record one action
  -> next(current session/attempt)
  -> checkpoint or receipt
  -> next
  -> finish/release/fail through fenced Rust command
```

An active non-expired attempt wins over ready work. Open blockers, stale
health, or an unsafe/missing requirement stop normal work and produce the
highest-severity recovery action. `idle` is a valid terminal answer when
there is no active attempt, no eligible work, and no health requirement; it
must not invent a goal or suggest a free-form command.

## Failures and fail-closed behavior

Every failure is a typed outcome with the observed revision and a bounded
recovery hint, never a guessed action:

- invalid or stale context: return `conflict`/`stale_context` and require a
  fresh `next`;
- missing registry entry, invalid payload, or provenance mismatch: return
  `guidance_unavailable` and block execution;
- blocked, ineligible, expired, or fenced attempt: return the current state and
  the recovery directive; do not mutate a replacement attempt;
- busy/unavailable service: return retry metadata and preserve operation id;
- subprocess nonzero, timeout, oversized output, missing file, or digest
  mismatch: create a failed/unknown typed receipt and require resume/readback;
- uncertain mutation after disconnect: resolve by operation id before any
  retry; never assume success or redispatch blindly;
- unsafe authored command or path escape: reject it and leave project state
  unchanged.

## Parity essentials versus later workflow packs

### Required for v2 parity

- Rust-owned context snapshot and deterministic selection.
- Versioned registry, trusted instruction text, severity, gap codes, and
  provenance hash.
- Compact status/requirements/one-action response with exact safe argv and
  `shell: false`.
- No-goal `next`, fenced session/attempt resume, operation-id readback, and
  typed failure outcomes.
- Bounded gate execution and structured validation receipts.
- Core verification, checkpoint, review, and audit obligations, plus a compact
  context/handoff capsule for a replacement or resumed agent.
- CLI and service fixtures shared by the Rust CLI and all other clients.

### Later than the P2 agent loop, but required before v2 cutover

P4-10 prepares and P4-11 validates the packaged core route, project/work/decision
context, work planning and sprint launch, review/audit, handoff/closeout,
health recovery, and source/memory workflows. These use the same registry,
typed inputs, application transitions, and one-action guide; they are not a
second engine. See the [canonical-workflow handoff](build-plan/verticals/12-canonical-workflows.md).

### Explicitly outside the v2 launch scope

- Broad custom/user-authored packs beyond the packaged core routes,
  elaborate handoff authoring beyond the core resume capsule, and
  specialized review/audit choreography beyond gate satisfaction.
- Model-generated plans, autonomous multi-step execution, scheduler-driven
  dispatch, or arbitrary external tool/plugin execution.
- A second workflow DSL embedded in directives, free-form prompt policies,
  full historical timelines in routine guidance, or a TUI-specific protocol.

Later packs may add registry families and workflow refs only through the same
typed gap, provenance, command-grammar, and acceptance-test boundaries.

## Acceptance tests

The first implementation is accepted only when these fixtures pass:

1. **Contract:** serialize/deserialize the compact response; validate version,
   required fields, bounded sizes, null/empty arrays, unknown-field policy,
   and stable exit classes.
2. **Registry trust:** every emitted directive references an existing
   `registry_id` and version; changing work descriptions, comments, raw source,
   or model text cannot change trusted instruction or runner selection.
3. **Selection:** fixtures prove active attempt, blocker, health, ready-work,
   and idle precedence; ties produce the same selection key across processes.
4. **Safe argv:** generated argv contains no shell metacharacter execution,
   stays project-bound, includes required JSON/protocol flags, and is executed
   only with `shell: false`; display text cannot be parsed as a substitute.
5. **No-goal/resume:** an empty-goal request returns a bounded action or idle;
   restart plus `resume` returns the same current fenced attempt; no duplicate
   claim or dispatch occurs.
6. **Failures:** stale revision/fence, missing registry data, blocked work,
   busy service, nonzero/timeout/oversized command, digest mismatch, and
   unknown operation outcome all fail closed and preserve state.
7. **Receipts/provenance:** a successful gate records argv, cwd, exit status,
   timestamps, source/config identity, output digest/reference, subject,
   revision, and executor attestation; prose-only evidence is insufficient.
8. **Boundedness:** status and guidance remain within the documented response
   budget as historical attempts grow; detail is referenced and digest-checked.
9. **Client parity:** Rust CLI, local service, and a fixture client consume the
   same protocol fixtures and cannot open storage or implement transitions
   independently.

## Source basis

This plan was derived from the legacy registry/compiler and runtime projection
in `packages/core/src/agent-directive-registry.ts`,
`packages/core/src/agent-directive-*.ts`, and
`packages/agent-runtime/src/directives.ts`; the `next` and legacy guide shapes
in `apps/cli/src/commands.ts`; directive safety and workflow boundaries in
`docs/architecture/AGENT_DIRECTIVES.md`,
`docs/architecture/AGENT_DIRECTIVE_LEGACY_BACKFILL.md`,
`docs/architecture/SKILLS_AND_WORKFLOWS.md`, and
`docs/product/V1_WORKFLOWS.md`; and the v2 Rust ownership, lifecycle,
protocol, bounded-status, and security constraints in
`project/AGENT_LIFECYCLE.md`,
`project/INTERFACES.md`,
`project/STATE_AND_CONCURRENCY.md`, and
`project/build-plan/verticals/02-attempt-runtime.md`,
`05-protocol-cli-service.md`, and `10-security-boundaries.md`.

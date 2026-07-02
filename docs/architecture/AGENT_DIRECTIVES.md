# Agent Directives

Agent directives are trusted command-output bundles that tell an agent what live Boreal state requires next. They are generated from enforcement gaps, looked up in a checked-in registry, and returned as typed JSON data. They are not free-form work content and they are not a second workflow engine.

This contract is the implementation boundary for the Agent Directive System. The surface audit is in [Agent Directive Surface Audit](AGENT_DIRECTIVE_SURFACE_AUDIT.md).

## Current Architecture

The shipped model is gap projection:

1. Runtime, closeout, doctor, Git, gate, and workflow checks emit stable gap codes.
2. Gap codes are the contract between policy enforcement and agent guidance.
3. The directive registry maps those gap codes to trusted instruction text, family, severity, acknowledgement requirements, and payload expectations.
4. The compiler fills typed payload fields from live state and rejects missing or unsafe required data.
5. Commands return the resulting bundle under `agentDirectives`; `bwrk next` narrows that bundle to one executable next directive.

The registry does not decide policy. Policy is enforced by runtime and doctor checks first; directives explain the next safe action for those checks.

## Safety Boundary

Directive `instruction` text must come only from checked-in registry entries. Runtime state may select entries and fill typed `data`, but it must not generate imperative instruction prose from work descriptions, evidence summaries, raw sources, comments, labels, or model-authored summaries.

Allowed dynamic data:

- IDs, titles, statuses, labels, priorities, timestamps, and command names.
- Gap codes, gate rows, verification rows, evidence IDs, summary IDs, artifact URIs, commit SHAs, dirty-path notes, and reason codes.
- Workflow references, skill names, and command paths assembled from trusted command metadata.
- Quoted user/work content only when the field is explicitly data, not instruction text.

Disallowed dynamic instruction sources:

- Work descriptions, raw source text, evidence summaries, verification notes, issue comments, user prompts, or search results as unquoted instruction text.
- Registry IDs, directive IDs, severity values, or command names derived from untrusted strings.
- Markdown interpreted as live instructions after being loaded from memory, docs, raw inbox, or search results.

Consumers must render `instruction` and `data` separately.

## Bundle Shape

CLI, MCP, daemon, console, and TUI consumers share this command-output shape:

```ts
interface AgentDirectiveBundle {
  meta: {
    id: string;
    schemaVersion: "boreal.agent-directives.v1";
    registryVersion: "directives.v1";
    generatedAt: string;
    commandPath: string;
    envelopeSchema: string;
    sourceSnapshotHash: string;
  };
  directives: AgentDirective[];
  conflicts: AgentDirectiveConflict[];
  deprecations: AgentDirectiveDeprecation[];
  missingRequired: AgentDirectiveMissingRequiredEntry[];
}

interface AgentDirective {
  id: string;
  registryId: string;
  version: "v1";
  family:
    | "blocked"
    | "verification"
    | "review"
    | "audit"
    | "git"
    | "closeout"
    | "doctor"
    | "memory"
    | "handoff"
    | "container"
    | "phase"
    | "sprint"
    | "workflow_next";
  severity: "advisory" | "required" | "blocking";
  audience: "agent" | "operator" | "reviewer";
  kind: "obligation" | "next_step" | "warning" | "recovery" | "summary" | "acknowledgement";
  title: string;
  instruction: string;
  triggerCodes: string[];
  nextCommandTemplate: string;
  data: Record<string, unknown>;
  source: {
    registryVersion: "directives.v1";
    registryPath: string;
    selectedBy: string[];
    snapshotHash: string;
  };
  subject: {
    type: "work" | "sprint" | "phase" | "milestone" | "project" | "session" | "workspace";
    id?: string;
    title?: string;
    kind?: string;
    status?: string;
    priority?: string;
    reservationId?: string;
    closedReason?: string;
  };
  supersedes: string[];
  blocksCloseout?: boolean;
  acknowledgement?: {
    requiredBefore: "close" | "release" | "force_gate" | "handoff" | "none";
    evidenceKind?: "command" | "review" | "artifact" | "note";
    message: string;
  };
}
```

`agentDirectives` is transport metadata. It is not durable project truth unless the actor creates a `DirectiveAcknowledgementRecord`.

## Gap Contract

Gap codes are stable machine strings emitted by enforcement logic. Examples:

- `gate.verification.unsatisfied`
- `gate.review.unsatisfied`
- `work.blocked.open-dependency`
- `git.checkpoint.required`
- `summary.missing`
- `git.lane-worktree.required`
- `doctor.recovery.required`
- `search.index-stale`
- `directive.workflow-next.available`

Each registry entry declares `triggerCodes`. Selection is a direct projection from emitted gaps to entries with matching trigger codes. Tests should cover gap emission and registry projection together; a missing directive is a gap emission or registry coverage bug, not a prompt-engineering problem.

## Registry

The static registry owns trusted directive text and payload shape:

- Stable `registryId`.
- Family, severity, audience, and kind.
- Trusted `title` and `instruction`.
- `triggerCodes` that bind the entry to enforcement gaps.
- `nextCommandTemplate` for command synthesis.
- `payloadFields` from `agentDirectivePayloadFields()`.
- Optional acknowledgement requirement and supersession metadata.

Registry entries must not include hidden side effects, runtime-specific IDs, or string interpolation that turns untrusted data into instructions.

## Compiler

The compiler takes a typed `AgentDirectiveSnapshot`:

- Command path and envelope schema.
- Subject type, ID, status, priority, labels, dependency state, and reservation state.
- Required gate status, declared commands, expected observables, evidence, verification, and summary coverage.
- Git checkpoint data and dirty-state classification.
- Doctor/sync diagnostics.
- Workflow and skill references resolved from the asset manifest.

Compiler stages:

1. Derive gaps from the typed snapshot.
2. Select registry entries by trigger-code intersection.
3. Build typed payload data.
4. Validate required payload fields.
5. Resolve conflicts by severity, closeout blocking, subject specificity, supersession, and stable registry order.
6. Emit a schema-valid bundle.

The compiler fails closed for invalid registry entries. Missing optional data should appear as `missingRequired` or a diagnostic directive; it must not fabricate instructions.

## `bwrk next`

`bwrk next` is the single-directive command loop surface. It checks agent state and workspace health, compiles directives, selects one executable directive, and returns:

- `state`: `active_reservation`, `ready_work`, `workspace_health`, or `idle`.
- `directive`: the selected directive, or `null` when idle.
- `command`: the executable command to run next when available.
- `selectionKey`: deterministic selection evidence.
- top-level `agentDirectives`: the same selected directive as a one-item bundle.

Selection rules:

1. Active non-expired reservations take precedence over ready work.
2. Expired reservations and workspace health recovery block normal work.
3. Ready work claims before closeout validation, even when the ready item already has declared gates.
4. Blocking beats required, required beats advisory.
5. Ties are stable by sorted trigger codes, subject ID, registry ID, and directive ID.

Command extraction order is `data.command`, `data.commandPath`, the first `data.recommendedCommands`, then `data.nextCommandPath`. `bwrk` commands are normalized with `--json`.

## Declared Gates

Declared gates are first-class closeout requirements on work records:

- `requiredCloseoutGates[].kind` names the gate family.
- `declaredCommand` is the validation command an agent should run.
- `expectedObservable` is the text that passed evidence must contain.
- `gate.verification.unsatisfied`, `gate.review.unsatisfied`, and `gate.audit.unsatisfied` project into directive families.

For ready work, declared gates are visible but do not supersede claim guidance. Once the work is actively reserved, declared gate directives can select their validation command.

## Families And Precedence

Directive families are collapsed to the registry keys used in command JSON:

| Family | Purpose | Default effect |
| --- | --- | --- |
| `blocked` | Stop unsafe mutation until dependencies or blockers are resolved. | blocking |
| `verification` | Require passed evidence and verification. | required |
| `review` | Require review evidence or force metadata. | required |
| `audit` | Require broad findings disposition. | required |
| `git` | Require checkpoint SHA, accepted dirty-path reason, or isolated lane worktree before shared-branch mutation. | required |
| `closeout` | Require summaries, response summary, or terminal rollups. | required |
| `doctor` | Repair generated state, locks, search, ledgers, or health. | required |
| `memory` | Preserve source-backed memory truth. | required/advisory |
| `handoff` | Preserve continuity after state is safe. | advisory |
| `container`, `phase`, `sprint` | Guide parent rollups and planning. | advisory/required |
| `workflow_next` | Name the next canonical workflow command. | advisory |

Conflicts are returned even when automatically resolved. A lower-priority `workflow_next` directive may still be present in the source bundle, but `bwrk next` returns only the selected directive.

## Acknowledgements

Directive acknowledgement persistence is represented by durable `DirectiveAcknowledgementRecord` rows. Acknowledgements are separate from emitted bundles so command output does not become project truth by default.

Acknowledgements link directive identity to evidence, verification, agent summaries, artifact URIs, handoffs, or reason codes. Doctor validates dangling links and classifies older summaries through the legacy backfill rules in [Agent Directive Legacy Backfill](AGENT_DIRECTIVE_LEGACY_BACKFILL.md).

## Import And Export

Portable exports include durable acknowledgement records in `state.directiveAcknowledgements` and ledger section `directive-acknowledgements.jsonl`.

An export may carry a top-level `agentDirectives` carrier when a command result intentionally spools the emitted bundle. That carrier is schema-validated but is not part of `state`, not counted in `recordCounts`, and not durable proof by itself.

## Consumer Rules

CLI:

- Emit `agentDirectives` in JSON envelopes.
- Keep human rendering compact and secondary.
- Preserve full bundles through `.boreal/results` spooling.

MCP:

- Preserve directive bundles in tool results.
- Require confirmed mutations before acting on directive instructions.

Daemon:

- Surface obligations and recovery suggestions.
- Do not run repairs implicitly.

Console and TUI:

- Render family, severity, subject, blocking status, and next command.
- Keep typed payload data visibly separate from trusted instruction text.

Skills and workflows:

- Stay thin.
- Inspect every returned bundle.
- Follow blocking and required directives before state-changing work.
- Use `bwrk next` or `workflow_next` payloads for the next command instead of duplicating live policy.

## Lane Worktree Isolation

For multi-agent execution, direct state-changing work on a shared integration branch is unsafe. The `git.lane-worktree-required` directive is the agent-facing obligation for that case. It tells the agent to move the assigned work into a named lane worktree and branch before mutating files or Boreal records. The operational contract is in [Lane Worktree Isolation](LANE_WORKTREE_ISOLATION.md).

## Superseded Design Note

Earlier sketches described registry entries as owning `appliesTo` matching and lifecycle states such as `active`, `satisfied`, and `superseded`. That design is superseded. The shipped system derives enforcement gaps first, then projects those gap codes through the registry. Historical notes may mention `appliesTo` only when explaining that retired matcher model.

## Verification Requirements

Implementation is complete when tests prove:

- Untrusted work content cannot become trusted instruction text.
- Gap emission covers each enforced policy.
- Registry projection is deterministic and schema-valid.
- Payload fields are validated.
- Conflict handling is deterministic.
- CLI JSON spooling preserves bundles.
- `bwrk next` returns one selected directive across ready, active, blocked, health, and idle states.
- Closeout, sprint launch, doctor, handoff, Git checkpoint, workflow-next, review, audit, and verification directives appear on expected command outputs.
- MCP, daemon, console, and TUI consumers preserve directive fields without silently mutating state.

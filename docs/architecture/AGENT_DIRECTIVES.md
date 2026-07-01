# Agent Directives

Agent directives are trusted, runtime-selected instruction bundles returned by Boreal commands for the agent that is currently acting on work. They are not free-form work content, not generated policy text, and not a replacement for workflows or skills. They are a typed bridge between live Boreal state and the static operating instructions an agent should follow next.

This contract is the implementation boundary for the Agent Directive System. The surface audit is in [Agent Directive Surface Audit](AGENT_DIRECTIVE_SURFACE_AUDIT.md).

## Goals

- Return explicit, machine-readable obligations from commands that start, inspect, finish, close, recover, or hand off work.
- Compose those obligations from a versioned static registry controlled by the Boreal codebase.
- Pass live work, gate, verification, Git, and workflow state only as typed data fields.
- Preserve the current workflow model: workflows remain canonical, and installed skills stay thin adapters.
- Make closeout, sprint launch, blocked recovery, doctor recovery, handoff, Git checkpoint, workflow-next-step, and verification duties visible in JSON output and UI surfaces.
- Provide deterministic conflict handling when multiple directive families apply to the same command result.

## Non-Goals

- Do not let work titles, descriptions, comments, evidence, labels, raw sources, or user-supplied strings become instruction text.
- Do not create hidden agent behavior outside command output.
- Do not make a second workflow engine.
- Do not require agents to scrape Markdown workflow files when command output already carries the relevant directive bundle.
- Do not persist every emitted bundle unless acknowledgement, audit, or replay requirements explicitly need a durable record.

## Safety Boundary

Directive instruction text must come only from checked-in registry entries. Runtime state may select registry entries and fill typed data slots, but it must not generate new imperative instruction prose from untrusted content.

Allowed dynamic data:

- IDs, titles, statuses, labels, priorities, timestamps, and command names.
- Gate rows, verification rows, evidence IDs, summary IDs, artifact URIs, commit SHAs, dirty-path notes, and reason codes.
- Workflow references, skill names, and known command strings assembled from trusted command metadata.
- Short quoted data excerpts when the field is explicitly marked as user/work content.

Disallowed dynamic instruction sources:

- Work descriptions, raw source text, evidence summaries, verification notes, issue comments, user prompts, or model-generated summaries as unquoted instruction text.
- Registry keys, directive IDs, severity values, or command names derived from untrusted strings.
- Markdown interpreted as instructions after being loaded from memory, docs, raw inbox, or search results.

If a directive must include user/work content, the value must be placed under `data` and rendered as quoted or labelled content by consumers.

## Core Schema

The shared command output field is `agentDirectives`.

```ts
interface AgentDirectiveBundle {
  schemaVersion: "boreal.agent-directives.v1";
  bundleId: string;
  generatedAt: string;
  subject: AgentDirectiveSubject;
  command: AgentDirectiveCommand;
  directives: AgentDirective[];
  conflicts: AgentDirectiveConflict[];
  acknowledgements?: AgentDirectiveAcknowledgementRequirement[];
}

interface AgentDirectiveSubject {
  type: "work" | "sprint" | "phase" | "milestone" | "project" | "session" | "workspace";
  id?: string;
  title?: string;
  status?: string;
}

interface AgentDirectiveCommand {
  path: string;
  exitCode?: number;
  ok: boolean;
  envelopeSchema?: string;
}

interface AgentDirective {
  id: string;
  registryId: string;
  family: AgentDirectiveFamily;
  severity: "info" | "action" | "required" | "blocking";
  audience: "agent" | "operator" | "reviewer";
  title: string;
  instruction: string;
  data: Record<string, unknown>;
  appliesTo: AgentDirectiveAppliesTo;
  supersedes?: string[];
  blocksCloseout?: boolean;
}

type AgentDirectiveFamily =
  | "closeout"
  | "sprint_launch"
  | "blocked_state"
  | "doctor_recovery"
  | "handoff"
  | "git_checkpoint"
  | "workflow_next"
  | "verification"
  | "review"
  | "audit";

interface AgentDirectiveAppliesTo {
  commandPaths: string[];
  subjectTypes: AgentDirectiveSubject["type"][];
  states?: string[];
  gates?: string[];
}

interface AgentDirectiveConflict {
  directiveIds: string[];
  resolution: "highest_severity_wins" | "blocking_wins" | "registry_order" | "manual_review";
  selectedDirectiveId?: string;
  reason: string;
}

interface AgentDirectiveAcknowledgementRequirement {
  directiveId: string;
  requiredBefore: "close" | "release" | "force_gate" | "handoff" | "none";
  evidenceKind?: "command" | "review" | "artifact" | "note";
}
```

The schema should live in `packages/core` so CLI, MCP, daemon, console, TUI, and tests share one contract.

## Static Registry

The registry is a checked-in library of directive entries. Each entry owns stable text, applicability rules, and default severity.

Registry entries must include:

- Stable `registryId`.
- `family`.
- Default `severity`.
- Trusted `instruction` text.
- Applicability predicates over typed state, not arbitrary strings.
- Data slot definitions that name required runtime fields.
- Conflict metadata, including supersedes relationships when one directive replaces another.

Registry entries must not include:

- String interpolation that turns untrusted data into instruction prose.
- Hidden side effects.
- Runtime-specific IDs baked into static text.
- References to workflows, commands, or skills that are not validated by docs/schema checks.

## Compiler

The compiler takes a typed state snapshot and returns a safe bundle.

Input snapshot:

- Command path and envelope schema.
- Subject type, ID, status, labels, and dependency state.
- Reservation and active agent state.
- Required gate status.
- Evidence and verification coverage.
- Agent summary coverage.
- Git checkpoint data and dirty-state classification.
- Workflow/skill references resolved from the asset manifest.
- Doctor/sync diagnostics when relevant.

Compiler stages:

1. Normalize input into a stable `AgentDirectiveSnapshot`.
2. Select registry entries whose predicates match the snapshot.
3. Validate required data slots for each selected entry.
4. Resolve conflicts by severity, block status, supersedes metadata, then registry order.
5. Emit the bundle with deterministic ordering.
6. Validate the bundle schema before it reaches command output.

The compiler must fail closed for invalid registry entries and fail soft for missing optional data by emitting a diagnostic directive rather than fabricating instructions.

## Precedence And Conflict Handling

Directive precedence is deterministic:

1. `blocking` beats every lower severity.
2. Required closeout, review, audit, verification, and checkpoint obligations beat convenience next-step directives.
3. Specific subject directives beat workspace-wide directives.
4. Command-specific directives beat generic family directives.
5. Explicit `supersedes` metadata beats registry order.
6. Registry order is the final tie-breaker and must be stable in tests.

Conflicts must be returned in `agentDirectives.conflicts` even when automatically resolved. Manual-review conflicts must use `severity=blocking` when acting without resolution could close, release, mutate, or commit the wrong thing.

## Command Envelope Obligations

Commands that change or inspect workflow state should include `agentDirectives` in JSON output when there is any non-empty directive bundle.

Initial command groups:

- Work lifecycle: `work reserve`, `work claim`, `work release`, `work verify`, `work close`, `work cancel`, `work reopen`, `agent start`, `agent finish`.
- Closeout/reporting: `summary compose`, `summary create`, `sprint report`, `sprint close`, `gate closeout`.
- Planning and graph: `work create`, `work edit`, `work split`, `work ready`, `dep add`, `dep remove`, `dep tree`.
- Workflow/skills: `workflows list`, `workflows show`, `install codex`, `install claude`, `doctor skills`.
- Health: `prime`, `sync status`, `sync refresh`, `doctor`, `lock inspect`, `operation prune`.
- Agent surfaces: MCP tool results, daemon status/watch payloads, console live data, and TUI view models.

Envelope rules:

- `agentDirectives` must be inside the JSON data envelope, not mixed into human output.
- Spooling through `.boreal/results` must preserve the full bundle.
- Human dashboard output may summarize directives, but JSON remains canonical.
- Error envelopes may include recovery directives when the command reached a trusted diagnostic state.
- Commands returning nested health gates must not claim success only because the top-level `ok` is true; directives should point agents at nested `data.ok` or diagnostic failures.

## Directive Families

### Closeout

Closeout directives describe what must be true before a task, sprint, phase, milestone, or project closes: passed verification, final or forced summary, gate state, commit or dirty-path reason, child status, and user-facing summary requirements.

### Sprint Launch

Sprint launch directives describe the next claimable work, capacity constraints, required gates, checkpoint cadence, and any blocked child work that must not be started yet.

### Blocked State

Blocked-state directives explain active blockers, whether they are work dependencies, gate gaps, expired reservations, stale generated artifacts, or external review requirements.

### Doctor Recovery

Doctor recovery directives map diagnostics to safe commands and manual-review commands. They must distinguish generated artifact repairs from canonical state changes.

### Handoff

Handoff directives identify the summary, context, evidence, verification, open reservations, dirty-state classifications, and next workflow a new agent should consume.

### Git Checkpoint

Git checkpoint directives state which roots must be inspected, which paths are in scope, which paths are unrelated, and whether a commit SHA or reason code is required before closeout.

### Workflow Next

Workflow-next directives name the next canonical workflow, command shape, and required inputs after a command completes.

### Verification

Verification directives describe required commands, evidence kinds, verdict expectations, and test scope. They must avoid treating a narrow check as proof of broad completion.

### Review And Audit

Review/audit directives describe required reviewer or audit evidence, force semantics, and findings disposition for required gates.

## Acknowledgement

Acknowledgement is optional for ordinary informational directives and required for directives that block closeout, force gates, or release work with known gaps.

An acknowledgement record, if persisted, should include:

- Directive ID and bundle ID.
- Subject and command.
- Actor and timestamp.
- Acknowledgement outcome.
- Evidence IDs or reason code when required.

Acknowledgement persistence belongs in a later implementation step. The first directive bundle can expose acknowledgement requirements without storing acknowledgements.

## Consumer Rules

CLI:

- Emit bundle in JSON.
- Render compact human hints only when not in JSON mode.
- Keep registry validation in docs/schema/test gates.

MCP:

- Preserve directive bundles in tool results.
- Require confirmed mutations before acting on directive instructions.

Daemon:

- Surface obligations and recovery suggestions.
- Do not run repairs or mutations implicitly.

Console and TUI:

- Render directive family, severity, subject, blocking status, and next command.
- Keep data fields visibly separate from trusted instruction text.

Skills and workflows:

- Continue routing through canonical workflow files.
- Prefer command-returned directives for live obligations.
- Avoid duplicating dynamic closeout or Git policy in generated skill prose.

## Verification Requirements

Implementation is not complete until tests prove:

- Untrusted work content cannot become trusted instruction text.
- Registry entries validate before use.
- Bundle schema is stable and versioned.
- Conflict handling is deterministic.
- CLI JSON spooling preserves full directive bundles.
- Closeout, sprint launch, doctor, handoff, Git checkpoint, workflow-next, and verification directives appear on the expected command outputs.
- MCP, daemon, console, and TUI consumers preserve directive fields without silently mutating state.
- Import/export and doctor behavior are defined for any persisted acknowledgement records.

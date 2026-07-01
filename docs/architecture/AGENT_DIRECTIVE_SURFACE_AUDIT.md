# Agent Directive Surface Audit

Status: S01T01 audit for `bw_work_d3415afb9c29a1c7`

## Finding

The repository does not currently contain an `agentDirectives` or `AgentDirective` implementation. The directive system should be added as a new typed runtime/CLI contract, not as a rename of an existing surface.

Verified with:

```sh
rg -n "agentDirectives|AgentDirective|agent directive|Agent Directive" apps packages workflows tests .agents/skills --glob '!node_modules'
```

The search returned no matches.

## Affected Runtime Surfaces

- `packages/core/src/records.ts`: source for durable record types such as work items, evidence, verifications, graph edges, context packs, and agent summaries. Agent directive records or bundle types should start here if they become a shared contract.
- `packages/core/src/schema-validation.ts`: schema validation for runtime records and policies. Directive bundles need schema validation here or in a sibling validator before they are emitted by commands.
- `packages/core/src/policies.ts`: runtime policy flags currently include closeout summary policy. Directive enforcement policy should be explicit rather than inferred from command output text.
- `packages/engine/src/runtime.ts`: transactional work state changes, reservations, evidence, verification, close/cancel, and summary policy checks. This is the right integration point for state-derived directive inputs.
- `packages/storage/src/ports.ts` and `packages/storage/src/memory-store.ts`: storage APIs for runtime records. Add storage only if directive acknowledgements or persisted directive bundles become durable records.
- `packages/search/src/search-index.ts`: indexes work, context, knowledge, and agent summaries. Directive content should not be blindly indexed unless the contract says it is searchable project truth.

## Affected CLI Surfaces

- `apps/cli/src/commands.ts`: central command dispatcher and JSON payload builder. Directive bundles should be attached here after runtime reads/writes have resolved current state.
- `apps/cli/src/command-registry.ts`: command metadata, usage, examples, lock and output behavior. Any `directives` command group or `agentDirectives` envelope field needs registry coverage.
- `apps/cli/src/output.ts`: JSON spooling writes oversized command envelopes to `.boreal/results` and returns `truncated`, `preview`, `fullResultPath`, and `fullResultBytes`. Directive bundles must survive this path.
- `apps/cli/src/doctor.ts`: health diagnostics currently cover raw-source reconciliation, operation volume, closeout summary coverage, gate coverage, readiness, generated artifacts, daemon, and MCP config. Directive coverage/conflict diagnostics belong here.
- `apps/cli/src/args.ts` and `apps/cli/src/cli-ui.ts`: argument parsing and human output helpers. Keep directive data JSON-first; human rendering should be secondary.
- `apps/cli/src/import-export.ts`: import/export contracts for durable runtime state. Include directives only if persisted acknowledgements or bundle records become portable state.
- `apps/cli/src/workflow-assets.ts` and `apps/cli/src/environment-manifest.ts`: workflow and installed skill resolution. Directive adoption by workflows/skills should be validated against these asset sources.

Commands directly affected:

- `bwrk work reserve`
- `bwrk work claim`
- `bwrk agent start`
- `bwrk agent finish`
- `bwrk work close`
- `bwrk work cancel`
- `bwrk summary compose`
- `bwrk summary create`
- `bwrk sprint report`
- `bwrk sprint close`
- `bwrk work recent-closed`
- `bwrk work review-candidates`
- `bwrk doctor`
- `bwrk gate closeout`
- `bwrk sync refresh`
- `bwrk workflows list`
- `bwrk workflows show`

## Affected Workflow And Skill Surfaces

- `workflows/40-work/claim-and-finish-work.md`: normal reserved-work closeout path. It should consume directive bundles for closeout obligations, verification, checkpoint, and user-response summary requirements.
- `workflows/40-work/closeout-work.md`: manual and parent closeout path. It should consume directive bundles for review/audit gates, sprint reports, child summaries, and final response obligations.
- `workflows/40-work/checkpoint-git-state.md`: checkpoint policy and reason codes. Directive bundles should carry commit/no-commit obligations and out-of-scope dirty state handling.
- `workflows/40-work/create-work-structure.md`, `workflows/40-work/update-work-structure.md`, and `workflows/40-work/discovery-to-work.md`: planning flows that should emit next-step and readiness directives after creating or changing graph state.
- `workflows/40-work/launch-sprint.md`: sprint-start flow that should emit launch, commit, gate, and handoff directives for newly claimable work.
- `workflows/60-health/sync-and-doctor.md`: health recovery flow. It should emit doctor recovery directives and avoid racing refresh/doctor checks.
- `.agents/skills/boreal-*/SKILL.md` and matching `boreal.yaml` files: installed adapter skills are thin workflow routers. Directive adoption should keep them thin and point agents to command-returned directives rather than duplicating policy text.

## Affected Agent Surfaces

- `apps/mcp/src/tools.ts` and `apps/mcp/src/server.ts`: MCP tools wrap CLI-style reads and confirmed mutations. Directive bundles need a stable MCP field and mutation confirmation behavior.
- `apps/daemon/src/runtime.ts`: daemon status and watcher output should expose directive obligations without silently mutating workspace state.
- `apps/console/src/app/live-data.ts`, `apps/console/src/app/types.ts`, `apps/console/src/app/render.tsx`, and `apps/console/src/server.ts`: console live data and UI should display directive obligations, conflicts, acknowledgement state, and next-step commands.
- `packages/ui-model/src/dashboard-view.ts`: shared dashboard models should carry directive state if console/TUI both need it.
- `apps/tui/src/app.tsx`: TUI work views may need compact directive summaries for repeated operator workflows.

## Existing Contracts To Preserve

- CLI JSON mode must remain parseable, with health commands checked by nested `data.ok` when present.
- Oversized command output must keep full directive data available through `.boreal/results` spooling.
- `current` and `active` aliases must remain agent-scoped and fail closed when more than one active reservation exists.
- Required closeout gates are subject-scoped policy and are separate from workspace-wide `gate closeout`.
- Operation history is local/prunable telemetry, not durable project truth.
- Dynamic live work content must be typed data. Runtime-generated instruction text should come only from a trusted static directive registry.

## Test Surfaces

- `tests/runtime/cli.test.ts`: CLI contracts for claim/reserve/finish, spooling, summary, gates, doctor, review candidates, and closeout.
- `tests/runtime/workflow-docs.test.ts`: workflow documentation contract checks.
- `tests/runtime/mcp.test.ts`: MCP command wrapping and confirmed mutations.
- `tests/runtime/console-server.test.ts`, `tests/runtime/console-components.test.tsx`, and `tests/runtime/console-cli-contracts.test.ts`: console command and rendering contracts.
- `tests/runtime/runtime-flow.test.ts`: runtime gate enforcement and transaction behavior.
- `tests/runtime/search.test.ts`: search/index behavior if directives become searchable.

## Implementation Boundary For Later Tasks

The first implementation task should create a shared directive type and registry boundary before any command starts emitting directive text. Command integrations should pass only typed state snapshots into a compiler. Tests should assert that untrusted work titles, summaries, labels, and evidence text cannot become instruction text except as quoted data fields.

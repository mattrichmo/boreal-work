# Agent Directive Surface Audit

Status: Updated 2026-07-02 for `bw_work_4989ec10d44e5e9a`

## Current Status

The repository now contains a shipped `agentDirectives` implementation. The live system is a gap-projection contract:

- enforcement surfaces emit stable gap codes;
- `packages/core/src/agent-directive-registry.ts` maps gap codes to trusted directive entries;
- `packages/core/src/agent-directive-compiler.ts` assembles schema-valid bundles;
- CLI commands return bundles in JSON envelopes;
- `bwrk next` selects one executable directive for the current agent state.

The original S01T01 audit below is preserved as historical discovery. Sections that said the implementation did not exist are superseded by the current files and tests.

## Current Runtime Surfaces

- `packages/core/src/agent-directives.ts`: shared directive bundle, directive, conflict, deprecation, missing-required, and acknowledgement types.
- `packages/core/src/agent-directive-registry.ts`: static registry entries, trusted instruction text, trigger-code mappings, command templates, family/severity/kind metadata, and acknowledgement requirements.
- `packages/core/src/agent-directive-compiler.ts`: gap projection, payload assembly, payload validation, conflict resolution, and schema-safe bundle assembly.
- `packages/core/src/agent-directive-payloads.ts`: payload field metadata exposed by registry commands.
- `packages/agent-runtime/src/directives.ts`: non-CLI directive obligation helper for daemon and other runtime consumers.
- `schemas/directives/agent-directive-bundle.schema.json`: JSON schema for emitted bundles.

## Current CLI Surfaces

- `apps/cli/src/commands.ts`: attaches directive bundles to command envelopes and implements `bwrk next`.
- `apps/cli/src/command-registry.ts`: command metadata for `next`, directive registry, compile/explain, acknowledgement, and closeout commands.
- `apps/cli/src/output.ts`: JSON output and result spooling path that must preserve full bundles.
- `apps/cli/src/doctor.ts`: static registry lint and acknowledgement/coverage diagnostics.

Commands currently carrying directive obligations include work claim/show/verify/close/cancel, agent start/finish/status, summary compose/create/show, sprint report/close, gate closeout, sync refresh/status, doctor, daemon status, directive registry/compile/explain, and `bwrk next`.

## Current Agent Surfaces

- `apps/mcp/src/tools.ts`: preserves directive bundles in MCP tool results.
- `apps/console/src/app/live-data.ts` and related console components: consume directive state for live dashboards.
- `packages/ui-model/src/work-view.ts`: shared UI projection includes directive-related work/gate state.
- `skills/*/SKILL.md` and `.agents/skills/*/SKILL.md`: installed adapters stay thin and instruct agents to follow command-returned directives.
- `workflows/40-work/*.md`: work workflows consume `agentDirectives` and `bwrk next` for live obligations.

## Current Test Surfaces

- `tests/runtime/agent-directive-compiler.test.ts`
- `tests/runtime/agent-directive-goldens.test.ts`
- `tests/runtime/agent-directive-health.test.ts`
- `tests/runtime/agent-directive-regressions.test.ts`
- `tests/runtime/agent-directive-runtime-integration.test.ts`
- `tests/runtime/cli-agent-directives.test.ts`
- `tests/runtime/import-export-directives.test.ts`
- `tests/runtime/mcp.test.ts`
- `tests/runtime/console-app.test.tsx`
- `tests/runtime/console-components.test.tsx`
- `tests/runtime/core.test.ts`

The next-loop property harness lives in `tests/runtime/cli-agent-directives.test.ts` and covers ready, active, blocked, idle, and seeded dependency-chain states.

## Current Preservation Rules

- CLI JSON mode remains parseable; health commands still require nested `data.ok` checks when present.
- Emitted bundles are transport metadata, not durable state.
- Durable acknowledgement records are exported, imported, rendered, and doctor-validated separately.
- Work titles, summaries, labels, evidence, and raw memory text remain typed data, not instruction text.
- `current` and `active` aliases remain agent-scoped and fail closed when ambiguous.
- Operation history remains local/prunable telemetry.

## Superseded Historical Audit

The following S01T01 audit is retained for traceability. It described the repository before the directive implementation existed.

### Historical Finding

Superseded: the repository did not contain an `agentDirectives` or `AgentDirective` implementation. The directive system was expected to be added as a new typed runtime/CLI contract, not as a rename of an existing surface.

Historical verification command:

```sh
rg -n "agentDirectives|AgentDirective|agent directive|Agent Directive" apps packages workflows tests .agents/skills --glob '!node_modules'
```

The historical search returned no matches.

### Historical Affected Runtime Surfaces

- `packages/core/src/records.ts`: source for durable record types such as work items, evidence, verifications, graph edges, context packs, and agent summaries.
- `packages/core/src/schema-validation.ts`: schema validation for runtime records and policies.
- `packages/core/src/policies.ts`: runtime policy flags.
- `packages/engine/src/runtime.ts`: transactional work state changes, reservations, evidence, verification, close/cancel, and summary policy checks.
- `packages/storage/src/ports.ts` and `packages/storage/src/memory-store.ts`: storage APIs for runtime records.
- `packages/search/src/search-index.ts`: indexes work, context, knowledge, and agent summaries.

### Historical Affected CLI Surfaces

- `apps/cli/src/commands.ts`: central command dispatcher and JSON payload builder.
- `apps/cli/src/command-registry.ts`: command metadata, usage, examples, lock and output behavior.
- `apps/cli/src/output.ts`: JSON spooling writes oversized command envelopes to `.boreal/results`.
- `apps/cli/src/doctor.ts`: health diagnostics.
- `apps/cli/src/args.ts` and `apps/cli/src/cli-ui.ts`: argument parsing and human output helpers.
- `apps/cli/src/import-export.ts`: import/export contracts for durable runtime state.
- `apps/cli/src/workflow-assets.ts` and `apps/cli/src/environment-manifest.ts`: workflow and installed skill resolution.

Historical directly affected commands:

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

### Historical Affected Workflow And Skill Surfaces

- `workflows/40-work/claim-and-finish-work.md`
- `workflows/40-work/closeout-work.md`
- `workflows/40-work/checkpoint-git-state.md`
- `workflows/40-work/create-work-structure.md`
- `workflows/40-work/update-work-structure.md`
- `workflows/40-work/discovery-to-work.md`
- `workflows/40-work/launch-sprint.md`
- `workflows/60-health/sync-and-doctor.md`
- `.agents/skills/boreal-*/SKILL.md` and matching `boreal.yaml` files

### Historical Affected Agent Surfaces

- `apps/mcp/src/tools.ts` and `apps/mcp/src/server.ts`
- `apps/daemon/src/runtime.ts`
- `apps/console/src/app/live-data.ts`, `apps/console/src/app/types.ts`, `apps/console/src/app/render.tsx`, and `apps/console/src/server.ts`
- `packages/ui-model/src/dashboard-view.ts`
- `apps/tui/src/app.tsx`

### Historical Contracts To Preserve

- CLI JSON mode must remain parseable.
- Oversized command output must keep full directive data available through `.boreal/results` spooling.
- `current` and `active` aliases must remain agent-scoped and fail closed when ambiguous.
- Required closeout gates are subject-scoped policy.
- Operation history is local/prunable telemetry.
- Dynamic live work content must remain typed data.

### Historical Test Surfaces

- `tests/runtime/cli.test.ts`
- `tests/runtime/workflow-docs.test.ts`
- `tests/runtime/mcp.test.ts`
- `tests/runtime/console-server.test.ts`
- `tests/runtime/console-components.test.tsx`
- `tests/runtime/console-cli-contracts.test.ts`
- `tests/runtime/runtime-flow.test.ts`
- `tests/runtime/search.test.ts`

### Historical Implementation Boundary

Superseded: the first implementation task should create a shared directive type and registry boundary before any command starts emitting directive text. The current implementation has completed that boundary and moved to gap projection plus durable acknowledgement coverage.

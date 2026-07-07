# Schemas

These JSON schemas describe the durable record envelopes used by the TypeScript runtime. The TypeScript source in `packages/core/src/records.ts` remains the domain type source, and `packages/core/src/schema-validation.ts` enforces the currently published schema subset at runtime, import, and doctor boundaries.

The current runtime types cover work, agent summaries, graph edges, evidence, verification, knowledge sources, claims, decisions, reservations, events, and projections. Enforcement gap schemas describe typed runtime misses that directives can project from later, but are not durable runtime snapshot sections yet. Agent directive bundle schemas describe trusted runtime instruction bundles carried by command envelopes and imports, but are intentionally separate from durable runtime snapshots. The project registry schema is a machine-local coordination contract for known Boreal workspaces and is intentionally separate from runtime snapshots.

Currently enforced schemas:

- `schemas/records/work-item.schema.json`
- `schemas/records/agent-summary-record.schema.json`
- `schemas/records/graph-edge.schema.json`
- `schemas/records/evidence-record.schema.json`
- `schemas/enforcement/enforcement-gap.schema.json`
- `schemas/records/verification-record.schema.json`
- `schemas/records/knowledge-source.schema.json`
- `schemas/records/claim-record.schema.json`
- `schemas/records/decision-record.schema.json`
- `schemas/records/agent-reservation.schema.json`
- `schemas/events/runtime-event.schema.json`
- `schemas/operations/runtime-operation.schema.json`
- `schemas/projections/projection-record.schema.json`
- `schemas/projections/context-pack.schema.json`
- `schemas/projections/project-rollup.schema.json`
- `schemas/policies/runtime-policy.schema.json`
- `schemas/directives/agent-directive-bundle.schema.json`
- `schemas/projects/project-registry.schema.json`

Published schema parity is enforced through `PUBLISHED_SCHEMA_CONTRACTS` in `packages/core/src/schema-validation.ts`. Each entry binds a schema ID, schema file path, and validator function; runtime snapshot schemas also bind the state section they validate. CI fails when a `.schema.json` file is missing from that registry, when a registry entry points at the wrong `$id`, or when a validator no longer reports issues under its published schema ID.

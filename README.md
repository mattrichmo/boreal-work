# Boreal Work v2

Clean, authoritative project/work tracking core for:

```text
milestone -> sprint -> task -> claim/release -> complete -> dashboard
```

This repository is now the canonical v2 workspace. The legacy implementation
is preserved in Git history under the `v1-archive-pre-v2-cutover` tag and the
`archive/v1-pre-v2-cutover` branch; it is not part of the active runtime.

## Structure

```text
crates/
  domain/       Pure records and invariants
  store/        Persistence ports and transaction boundary
  application/  Authoritative use cases and read models
  cli/          CLI adapter and versioned JSON contract
  protocol/     Versioned request/response/error envelopes
  service/      Local queue/election/read-write runtime primitives
  source/       Immutable scoped source/citation groundwork
  memory/       Cited draft and deterministic publication groundwork
  migration/    Explicit reduced legacy import/export boundary
apps/
  tui/          TypeScript protocol/status client groundwork
project/        Architecture packet for implementation agents
docs/           v2 architecture and migration notes
tests/          Cross-crate and fixture tests
```

The workspace contains tested domain/store/application, protocol, service,
source, memory, migration, CLI, TUI, workflow, and packaging slices. P2-09 has
bounded application plus real local-socket multi-harness/restart proof, and the
service route now carries structured evidence/finish-close payloads, but the
release gate still requires guided evidence execution and a successful
end-to-end finish transcript;
see the [revalidation record](project/build-plan/P2-09-REVALIDATION.md) before
calling this a release build. The workspace has no dependency on legacy TypeScript
packages. Legacy data crosses only through the explicit reduced migration
format; it is not silently imported into the v2 store.
To build the product, start with the [master milestone plan](MASTER_PLAN.md),
the [sprint folders](milestones/M01-v2-product/README.md), and the
[agent handoff](AGENT_HANDOFF.md). The [project packet](project/README.md)
holds architecture and behavior contracts. These are file-based assignments;
do not instantiate them in the legacy `bwrk` workspace.

## Design principles

- One lifecycle across work, reservation, assignment, and runtime attempt.
- One canonical dependency representation.
- One consistent snapshot per read.
- Short, measurable write critical sections.
- Structured evidence and deterministic gate results.
- Git-published project memory without using Git as the work transaction
  engine.
- Small product surface before optional integrations.

## Build

```sh
cargo check
```

The crates are deliberately dependency-light at this stage. Runtime and UI
dependencies should be added only when their boundary is settled.

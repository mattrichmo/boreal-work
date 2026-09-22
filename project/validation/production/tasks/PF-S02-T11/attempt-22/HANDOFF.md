# PF-S02-T11 — attempt 22 application memory-publication handoff

## Disposition

Bounded application integration complete and compiling; not a full service
acceptance claim. No plan/state, store, memory, service, CLI, commit, or push
changes were made.

## Changed paths

- `crates/application/src/knowledge.rs`
- `crates/application/tests/knowledge.rs`

## Implemented behavior

`KnowledgeApplication::publish_memory` now requires the canonical `SqliteStore`,
`IdentityContext`, accepted reviewed memory, actor/session/deadline context,
and creation/start/observation timestamps. It builds a
`PublicationJobRequest`, uses `ExternalJobKind::MemoryPublication`, and bridges
the existing identity-bound `ExternalEffectAdapter` to the memory crate's
`PublicationJobPort`.

Git publication is invoked only after durable job acquisition returns `Won`.
Pending, readback-required, rejected, and failed outcomes return a typed
application result without a `PublicationReceipt`. Reconciled publication
alone produces a Git receipt. Replay reads the original durable job and does
not invoke a second Git effect; project/operation/actor/session/request
identity mismatches fail closed.

The knowledge integration test now creates the production identity and audited
operation context, proves publication/search provenance, and proves replay
duplicate behavior.

## Remaining boundary

The versioned service/CLI route and any external callers still need wiring to
provide the new application context and durable operation identity. Those
paths are outside this attempt's write set and were not changed or claimed as
accepted production-service coverage.

## Source identity

- `crates/application/src/knowledge.rs` — `abd2c38d2f79705529248c6345379a3fe599ca2c3a7af87b9b5f4b7486e3c087`
- `crates/application/tests/knowledge.rs` — `03e20b88240b159e39ed746f1deddfa5e563e62b76dadd80de0498213456131a`

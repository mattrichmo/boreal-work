# PF-S02-T11 attempt 20 — protected integration request

## Required owner

Application/store integration owner, with service-route owner review. The
memory-root steward cannot edit these paths under the current assignment.

## Exact blocker

`crates/application/src/knowledge.rs:645-661`, in
`KnowledgeApplication::publish_memory`, directly calls
`Publisher::publish_with_expected_base` and constructs a `PublicationReceipt`
as if Git completion were the canonical durable outcome. It does not receive
or implement `PublicationJobPort`, and therefore does not register a
`MemoryPublication` external job before the Git effect.

## Required change

1. Build `boreal_memory::PublicationJobRequest` from the canonical project,
   operation, request digest, entry, content, final manifest, memory-root,
   actor/session, source/config, deadline, and creation identities.
2. Implement the store-backed `PublicationJobPort` using the existing
   application external-job contract: `ExternalJobKind::MemoryPublication`
   at `crates/application/src/evidence.rs:32-48`, plus the store jobs
   registration/acquire/readback/reconcile transitions. The same operation and
   request digest must be used for every transition.
3. Call
   `Publisher::publish_with_durable_job` and invoke the Git publisher only from
   its `Won` callback. Do not map `Pending`, `ReadbackRequired`, unknown,
   rejected, or failed outcomes to `PublicationReceipt`/success.
4. On restart or callback uncertainty, read the original job and call
   `Publisher::publication_readback`; reconcile only when project, operation,
   entry/content, manifest, memory root, side-effect reference, Git revision,
   result digest, and observed timestamp match.
5. Expose the resulting pending/readback/reconciled states through the
   versioned service route and add exact replay, interrupted-effect,
   wrong-project/identity, and restart readback tests on the combined tree.

## Acceptance boundary

Do not close PF-S02-T11 from this request alone. Acceptance requires the
application/store implementation, the service route, and genuine combined
tests proving no direct canonical publication path remains.


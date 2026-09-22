# PF-S02-T11 — attempt 22 bounded evidence

The canonical application publication method no longer has a direct Git
fallback. Its only Git path is `Publisher::publish_with_durable_job` through
the application-owned, identity-bound store job port. Missing context or
unresolved durable state cannot produce a `PublicationReceipt`; the method
fails closed or returns an explicit non-reconciled state.

The evidence is application-bound only. Durable store APIs and the memory
publisher seam are consumed as they exist in the current tree; service/CLI
route wiring and real service restart/readback acceptance remain outside the
exclusive write set.

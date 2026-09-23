# PF-S02-T04 — Attempt 7 evidence record

## Compatibility boundary

`production_store_seams.rs` remains an explicitly noncanonical `schema-v2`
fixture. It retains direct row insertion to exercise the adapter seams, but it
now registers a fixture-specific profile and persists the immutable pinned
requirement snapshot through `ProfileStore` before running acceptance reads.
This makes the requirement declaration explicit without weakening canonical
production fail-closed behavior.

The fixture also uses the normalized observed gate identity `w1:verification`,
which is the identity produced by the public work-creation path and consumed by
the pinned requirement projection.

## Validation evidence

- Focused seam target: **5 passed, 0 failed**.
- Strict store Clippy: **passed**.
- Workspace formatting check: **passed**.
- Bounded diff check: **passed**.

The full `boreal-store` package remains **not fully green** because
`crates/store/tests/storage_remediation.rs::status_gate_queries_are_batched_for_large_projects`
failed its existing query-count assertion (`2016` prepared statements versus
the expected fixed-size relation). This attempt did not change that test or any
production code, so the failure is reported rather than masked.

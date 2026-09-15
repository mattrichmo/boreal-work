# P3-09 — Source/memory revalidation

Date: 2026-09-15
Status: **BOUNDED CRATE REVALIDATION PASSED; FORMAL P3 GATE OPEN**.

## Revalidated evidence

The following command passed on the current working tree:

```text
cargo fmt --all -- --check
cargo test -p boreal-source -p boreal-memory --locked --offline
```

Result: 2 source unit tests, 4 source-engine tests, 7 source-index tests, 3
memory unit tests, and 11 memory publisher tests passed; no failures or ignored
tests were reported. The newly added checks are:

- `persistent_restart_keeps_old_citation_after_recapture_with_new_bytes`: a
  later capture at one origin creates a distinct immutable source version and
  the earlier citation verifies before and after another catalog restart.
- `publication_retry_removes_only_abandoned_publisher_temps`: a retry removes
  only publisher-owned abandoned temp files, publishes successfully, and keeps
  an unrelated human edit visible and conflict-protected.
- `concurrent_same_operation_publication_has_one_commit_identity`: eight
  concurrent publishers in one process produce one commit and seven duplicate
  receipts with the same publication identity.

Existing evidence also remains green for missing/corrupt source blobs, parser
failure retention, stale parser repair, deterministic retrieval, staged Git
publication restart, commit read-back, fresh-clone reimport, tamper detection,
doctor findings, and second-repair stability.

## Acceptance disposition

| Required P3-09 claim | Result | Residual blocker |
| --- | --- | --- |
| Source intake/restart preserves immutable versions and citations | bounded PASS | Application/store source registration and job recovery are not exercised here |
| Git publication retry/fresh clone preserves provenance | bounded PASS | No OS process-crash matrix across every publication/outbox boundary |
| Publication concurrency is idempotent | same-process PASS | Cross-process locking/queue recovery is unmeasured; current mutex is process-local |
| Source/memory work does not materially extend claim holds | NOT RUN | Claim transaction timing and SQLite hold instrumentation are outside the permitted files |
| P3-07 independent review and P3-08 reconciliation | recorded with findings/deferrals | Formal independent sign-off and integrated owner responses remain open |

P3-09 must not be marked passed from this result. The current evidence is
appropriate as a bounded source/memory handoff and as input to integrated P3
revalidation once the application/store owners provide the outbox, crash
injection, cross-process, and claim-hold measurement seams.

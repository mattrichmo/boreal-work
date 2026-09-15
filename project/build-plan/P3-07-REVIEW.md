# P3-07 — Source/memory provenance review

Date: 2026-09-15
Scope: `crates/source/**`, `crates/memory/**`, their tests, and the S03 gate
records. No CLI, service, TUI, migration, or shared-schema files were reviewed
as implementation scope for this pass.

Review basis: the prior Luna source/memory pass plus coordinator verification
of the current working tree. This is a finding-producing review; independent
release sign-off is not claimed by this record.

Disposition: **NO-PASS — bounded crate evidence is useful, but integrated P3
acceptance remains open.**

## Findings

| ID | Severity | Finding | Evidence / disposition |
| --- | --- | --- | --- |
| P3-R01 | pass | Source scope, immutable version identity, citation identity, and unavailable/corrupt blob states are explicit. | `source_engine.rs` covers traversal, cross-project authorization, duplicate capture, changed bytes, missing blobs, and tampering. The persistent restart/recapture test proves the old citation remains valid after a new version is captured. |
| P3-R02 | pass | Parser identity/version drift and failed parsing are retained rather than treated as empty success. | `source_index.rs::parser_failure_is_retained_and_retryable`, stale-parser doctor/repair coverage, and persistent index reload pass. |
| P3-R03 | pass with boundary | Source text is handled as data by the plain-text parser; no command dispatch exists in these crates. | The source parser only produces bounded line records. A full unfamiliar-harness prompt/data trust test is outside this crate-only review and is not claimed. |
| P3-R04 | pass with boundary | Published memory preserves project, operation, source citation, content digest, manifest identity, and Git revision. | `publisher.rs` proves deterministic identity, provenance-preserving staged restart, fresh-clone import, and tamper rejection. |
| P3-R05 | partial | Atomic publication temp recovery and same-process duplicate publication are now covered, but all required crash boundaries are not injected. | The abandoned-temp and concurrent-publication tests pass. There is no process-crash harness for before staging, after commit/before acknowledgement, or after acknowledgement/index scheduling. |
| P3-R06 | partial | Fresh-clone restoration and canonical-file repair behavior are covered; source blob backup/restore and complete publication/job reconciliation are not. | Fresh-clone, doctor, and idempotent repair tests pass. The source/memory crates do not own the SQLite publication outbox or application acknowledgement path. |
| P3-R07 | blocker | Claim-hold isolation is unmeasured. | No source/memory-only test can establish the required p50/p95/max claim transaction hold budget because claims and SQLite transaction instrumentation belong to domain/store/application. |
| P3-R08 | blocker | Cross-process publication serialization is unproven. | The new mutex protects concurrent publishers in one process. It does not establish a multi-process lock/queue contract or recovery of an abandoned inter-process lock. |

## Focused evidence run

```text
cargo fmt --all -- --check
PASS

cargo test -p boreal-source -p boreal-memory --locked --offline
PASS — source 2 unit + 4 source-engine + 7 source-index tests;
       memory 3 unit + 11 publisher tests; 0 failures
```

This review records concrete progress without converting bounded crate tests
into a P3 gate pass.

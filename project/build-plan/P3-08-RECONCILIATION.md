# P3-08 — Source/memory provenance reconciliation

Date: 2026-09-15
Reconciler: coordinator, with prior Luna source/memory findings preserved.
Disposition: **PARTIAL RECONCILIATION — no P3 acceptance authorization.**

The review findings in `P3-07-REVIEW.md` are retained. The changes in this
bounded pass address concrete source/memory behavior only; integration gaps are
recorded as owner-bound deferrals rather than hidden behind passing unit tests.

| Finding | Disposition | Changed artifact / evidence | Gate effect |
| --- | --- | --- | --- |
| P3-R01 immutable source/citation identity | resolved for the bounded crate slice | `crates/source/tests/source_index.rs`: persistent recapture/restart keeps the old source bytes and citation valid while creating a distinct new version | Does not prove application/store integration |
| P3-R02 parser failure and drift | resolved for the bounded crate slice | Existing retained-failure, stale-parser, doctor, repair, and persistent-index tests remain green | Does not prove crash-injected worker recovery |
| P3-R03 data/trust boundary | bounded evidence retained | Plain-text parser has no command execution path; no unfamiliar-harness claim is made | Full trust-boundary review remains open at integration gate |
| P3-R04 publication provenance/fresh clone | resolved for the bounded Git slice | Existing staged restart, deterministic manifest, commit read-back, fresh-clone, and tamper tests remain green | Does not prove SQLite outbox acknowledgement |
| P3-R05 abandoned temp and same-process duplicate race | fixed and tested | `crates/memory/src/lib.rs` removes only publisher-owned abandoned temp files; publisher tests cover retry and eight concurrent same-operation calls | Cross-process serialization remains open |
| P3-R06 complete crash/retry matrix | deferred with owner | Application/store integration owner; source/memory crates have no permitted outbox or acknowledgement seam in this task | Blocks P3-09 full crash-matrix claim |
| P3-R07 claim-hold measurement | deferred with owner | Domain/store/application benchmark and transaction instrumentation; forbidden to add in this source/memory-only write set | Blocks the claim-hold acceptance criterion |
| P3-R08 cross-process publication lock | deferred with owner | Publication-service/integration owner; the current mutex is deliberately documented as process-local | Blocks multi-process publication acceptance |

## Reconciliation rules preserved

- Canonical source bytes, source versions, citations, manifests, and published
  notes are never rewritten to make a test pass.
- Failed, unavailable, tampered, staged, and conflicting states remain visible.
- The new retry cleanup recognizes only publisher-generated temp filename
  prefixes and leaves unrelated human files untouched; a dirty checkout still
  fails closed.
- No shared schema, application route, CLI, service, TUI, or migration change
  was introduced to manufacture missing integration evidence.

P3-08 is recorded as reconciled findings with explicit deferrals, not as a
clean gate.

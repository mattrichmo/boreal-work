# PF-S02-T10 — coordinator integration request

Base source: `784a41b3802c29a76721c55eef2e9493283396c2` (dirty combined tree).

The corrective attempt stopped before producing a source patch. The request is
to assign a fresh T10 attempt with the same exclusive paths and serialize the
following root/schema work:

- production schema and v2→v3 migration must create and verify every additive
  table before the opener returns;
- identity installation must be idempotent and fail closed on partial rows;
- pinned requirement sets must be written during canonical work creation and
  checked by status/claim/close paths;
- operation identity must be recorded at the root operation boundary and
  exact replay/context mismatch must be read back without duplicate effects;
- recovery/job persistence must remain transactional with root mutation intent;
- `crates/store/tests/production_integration.rs` must exercise the combined
  production opener, not a temporary module-registration copy.

No plan ledger, package manifest, source file, live database or prior evidence
was modified by this handoff.

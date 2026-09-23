# PF-S02-T04 — Attempt 7 start record

- Task: `PF-S02-T04` — persist immutable acceptance profiles and pinned requirements.
- Attempt: `7`.
- Source commit: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`.
- Scope: reconcile only the noncanonical `schema-v2` seam fixture in `crates/store/tests/production_store_seams.rs`.
- Excluded: canonical store production code, `STATE.json`, plan/ledger files, `memory/`, unrelated tests, commit, and push.

The fixture now registers a distinct compatibility profile and persists its
immutable requirement snapshot through the public profile API before inserting
the legacy seam rows directly. Its observed gate uses the normalized public
identity (`w1:verification`).

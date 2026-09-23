# PF-S02-T04 — Attempt 5 evidence record

- Record: `PF-S02-T04/attempt-5` / acceptance row `AC-06`.
- Evidence class: store and source-bound pure contract.
- Input commit: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`.
- Final source: same commit plus the two owned uncommitted changes recorded in `COMMANDS.md`; the combined worktree remained dirty for unrelated coordinator evidence and `memory/`.
- Setup: SQLite in-memory and temporary file stores through the existing store APIs; corruption cases use isolated test fixtures and restore immutable triggers before readback.

## Implemented behavior

1. `ProfileVersion::new` canonicalizes JSON before retaining it, so equivalent formatting/key order has one content identity and its digest is deterministic.
2. `PinnedRequirements` exposes required declarations and required-kind checks from its immutable declaration set rather than live observations.
3. `ProfileStore::current_pinned_requirements` reads the latest persisted proof revision and fails closed with `StoreError::Corrupt` when the snapshot is absent or disappears.
4. `ProfileStore::current_required_declarations` gives shared status/closeout code a no-empty-fallback read path.
5. Tests cover deleted observations, missing snapshots, malformed profile/child rows, profile drift, sibling profile versions, conflicting re-pins, restart persistence, and canonical content identity.

## Direct observed results

- Focused target: `cargo test --locked --offline -p boreal-store --test production_profile_requirements` — exit `0`, 16/16 passed.
- Store integration: `cargo test --locked --offline -p boreal-store` — exit `0`, 165 passed, 1 intentional ignore.
- Store lint: strict all-target Clippy — exit `0`.
- Formatting and diff checks — exit `0`.

These are store/fixture results only. They are not a real service lifecycle, native release, or installed-product claim.

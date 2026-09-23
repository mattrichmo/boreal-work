# PF-S02-T04 — Attempt 8 evidence

## Results

| Check | Result |
|---|---|
| `status_gate_queries_are_batched_for_large_projects` | **1 passed, 0 failed** |
| `store_contracts` | **24 passed, 0 failed** |
| Full `boreal-store` package | **Passed; all targets green, one benchmark ignored** |
| Strict store Clippy | **Passed** |
| Workspace formatting | **Passed** |
| `git diff --check` | **Passed** |

The batching regression asserts that a 250-work status read prepares fewer
than 20 statements. It passed after the status path was changed from one
`current_pinned_requirements` call per work item to bounded header, child, and
observed-gate relation scans.

## Integrity behavior retained

- Canonical production stores still report a missing pinned snapshot as a
  scoped `acceptance_requirements_corrupt` diagnostic.
- Existing malformed pinned headers, profile drift, malformed JSON, child
  drift, duplicate children, and missing children remain scoped diagnostics;
  they are not converted into an empty requirement set.
- Noncanonical schema-v2 fixtures without an opted-in pinned snapshot retain
  the historical observed-gate fallback. A malformed existing snapshot is not
  eligible for that fallback.
- The final `gate_rows.retain` step removes rows belonging to quarantined
  works, so a corrupt snapshot cannot regain authority through observed rows.

## Exact source identity

- Base commit: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Current `crates/store/src/lib.rs` SHA-256:
  `571d79aac7db0bcb832aff152562b1222cf926c161c81a18e1b68103d0a11b67`
- Current `crates/store/tests/storage_remediation.rs` SHA-256:
  `8248710cced546476cc857fed38c29f429e6550f22a33efd09c9355d67df442c`
- Current store source diff against the base commit: `517` insertions,
  `59` deletions.

The working tree contains other coordinator/worker changes and an untracked
runtime `memory/` directory. This bounded worker did not modify or include
those paths.

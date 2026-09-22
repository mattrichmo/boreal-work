# PF-S02-T11 — attempt 22 validation commands

All commands ran from `/Users/cybertron/Code/boreal-work` against the dirty
combined tree. No command committed, pushed, or changed plan/state records.

| Command | Result |
|---|---|
| `cargo check --locked -p boreal-application` | PASS |
| `cargo check -p boreal-application` | PASS |
| `cargo test --locked -p boreal-application --no-run` | PASS; all application test targets compiled |
| `cargo test --locked -p boreal-application --test knowledge memory_draft_review_publish_and_search_preserve_provenance` | PASS; 1/1 |
| `LC_ALL=C git diff --check -- crates/application/src/knowledge.rs crates/application/tests/knowledge.rs` | PASS |

An earlier whole-file focused run, before the application transition mapping
was corrected, failed with `external readback side-effect identity does not
match the admitted effect`. The adapter was then corrected to record
`running -> side_effect_started -> readback_required` before reconciliation;
the targeted rerun passed.

Not run in this bounded attempt: full application test execution, strict
clippy, and workspace format verification.

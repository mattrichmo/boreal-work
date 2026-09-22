# PF-S01-T05 attempt 2 — evidence

The status/action contract freezes three axes (availability, integrity, and
product status), one Rust evaluator, status/3 precedence, queued versus hard
blocked semantics, structured stable reasons, timers, server action
descriptors, safe recovery actions, older-client behavior, corruption scope,
and conformance limitations. The reason registry is machine-readable and
keeps `expired_review`, rejected-review intervention, `complete`, and
close-only dependency satisfaction distinct.

Changed product paths:

- `project/spec/production/status-and-actions.md`
- `project/spec/production/reason-registry.json`

The first worker attempt was interrupted before evidence; no acceptance was
inferred. The first independent review then rejected four contract-level
inconsistencies (ordering, quarantine mapping, status/2 compatibility, and
registry completeness), preserved in `REVIEW-ANSCOMBE.md`. The artifact was
amended to align remaining-reason ordering with the transition fixture,
define `integrity=quarantined` as `display_status=blocked`, specify exact
status/2 mappings and fail-closed actions, and encode the complete reason
shape plus compatibility codes. The contract, JSON, and Markdown checks were
rerun after amendment. Independent reviewer Anscombe accepted the amended
artifacts; the acceptance record is `REVIEW-ANSCOMBE-2.md`. Reconciliation and
sprint revalidation remain required; no product/service/release claim is made.

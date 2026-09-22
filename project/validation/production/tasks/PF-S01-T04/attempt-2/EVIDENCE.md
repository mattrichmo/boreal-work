# PF-S01-T04 attempt 2 — evidence

The contract separates renewable execution lease, non-renewable hard budget,
sealed submission, review, close intent, and durable recovery obligation. It
preserves `--ttl` as the lease alias, D27's two-hour default hard deadline,
exact-boundary expiry, D21 `expired_review`, D22 same-subject close intent,
safe stop/resource reconciliation, adoption, retry fencing, cancellation, and
reopen semantics. Failed evidence and historical attempts remain durable.

The first worker attempt was interrupted before producing evidence; no claim
was inferred. The replacement artifact is:

- `project/spec/production/execution-submission-contract.md`

The baseline expiry gap and evidence-store reconciliation are named as open
implementation gates, not hidden behind the contract. Independent review,
reconciliation, and sprint revalidation remain required.

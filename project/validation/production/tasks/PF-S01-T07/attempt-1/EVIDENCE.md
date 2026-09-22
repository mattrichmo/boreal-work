# PF-S01-T07 attempt 1 — evidence

The contract fixes close-only dependency satisfaction, project-scoped graph
integrity, deterministic reopen impact, scoped gate/edge exceptions,
truth-preserving cancellation/replacement, corruption limits, protocol action
descriptors, and conformance vectors. It preserves failed proof and historical
acceptance rather than rewriting facts.

Changed path:

- `project/spec/production/dependencies-overrides-reopen.md`

The first independent review rejected three contract gaps (universal impact
preview, future-versus-historical expiry/revocation effects, and exact
gate/proof binding); the rejection is preserved in `REVIEW-ANSCOMBE.md`. The
artifact was amended to add a preview digest for every override class, define
active-claim/close-intent/downstream effects, and bind gate exceptions to
gate ID, proof generation, profile, requirement digest, and target revision.
Contract and Markdown checks were rerun after amendment. Independent reviewer
Anscombe accepted the artifact; the record is `REVIEW-ANSCOMBE-2.md`. The
PF-S01 reconciliation/revalidation chain remains required.

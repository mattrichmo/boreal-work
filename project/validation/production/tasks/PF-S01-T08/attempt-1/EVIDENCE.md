# PF-S01-T08 attempt 1 — evidence

The service contract freezes the single Rust service boundary, route/use-case
mapping, envelopes/outcomes, transactional authorization, unknown readback,
external-job stages, pagination/subscription gaps, maintenance election,
bounded diagnostics, and fail-closed compatibility. The matrix freezes N/N-1
and database/artifact evolution without allowing old clients to reconstruct
new lifecycle policy.

Changed paths:

- `project/spec/production/service-contract.md`
- `project/spec/production/compatibility-matrix.md`

The first independent review rejected the draft for incomplete public-route
coverage and insufficiently explicit quarantine/error-envelope behavior; see
`REVIEW-KEPLER.md`. The contract was amended to cover the missing route
families and to specify the `integrity_quarantined` registry entry, trusted
revision behavior, and forward-write restriction. PF-S01-T11 still owns
integrating that entry into the protocol registry. Kepler independently
re-reviewed the amended artifacts and accepted this task-level contract scope;
see `REVIEW-KEPLER-2.md`. The PF-S01 reconciliation/revalidation chain remains
required.

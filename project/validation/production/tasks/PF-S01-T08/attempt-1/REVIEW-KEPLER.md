# PF-S01-T08 attempt 1 — independent review (rejected)

Reviewer: Kepler (`01a0c72f-ec1a-7823-ab71-c7d1a83a7761`)
Decision: rejected pending amendment

## Findings

1. The contract did not previously make the corruption/quarantine behavior a
   typed protocol contract. `project/spec/protocol/error-registry.json` does
   not yet contain `integrity_quarantined`. The service contract must specify
   the authoritative error entry, envelope outcome, trusted-revision behavior,
   and the forward-write restriction; PF-S01-T11 must integrate the registry
   entry before implementation can claim this behavior.
2. The service route table did not explicitly map all public routes in
   `INTERFACES.md`. The missing families were `commands`/`prime`,
   `setup`/`init`, `dashboard`, `doctor`, raw/source/context/search/decision,
   and sync routes. Each must map to one Rust use case and typed response.

## Required disposition

The contract was amended to add the missing route mappings and an explicit
`integrity_quarantined` registry entry/envelope contract. The registry remains
an S01-T11 integration responsibility and this review does not authorize
implementation, protocol migration, or wider sprint acceptance.

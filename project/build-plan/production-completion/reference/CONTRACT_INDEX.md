# Authoritative contract outputs to load after PF-S01

These are **planned repository outputs**, not files that already exist in the supplied baseline. Implementation requires PF-S01-T92 acceptance plus the relevant contract contents at the dispatched source revision. `contract-manifest.json` binds the accepted versions. Baseline references remain useful for finding drift, never for overruling an accepted amendment.

| Owning task | Contract topic | Planned files |
| --- | --- | --- |
| PF-S01-T01 | Freeze launch scope, authority boundaries and terminology | `project/spec/production/scope-and-boundaries.md` |
| PF-S01-T02 | Freeze identity, revisions, operation outcomes and actor threat model | `project/spec/production/identity-revisions-authority.md` |
| PF-S01-T03 | Choose cycle-backed sprints and container acceptance | `project/spec/production/planning-and-cycle-contract.md` |
| PF-S01-T04 | Resolve execution budget, sealed submissions and safe ownership release | `project/spec/production/execution-submission-contract.md` |
| PF-S01-T05 | Freeze status precedence, integrity axes and permitted actions | `project/spec/production/status-and-actions.md`, `project/spec/production/reason-registry.json` |
| PF-S01-T06 | Freeze profiles, proof selection and independent review policy | `project/spec/production/acceptance-and-proof.md`, `project/spec/production/profile-registry.json` |
| PF-S01-T07 | Freeze dependency, reopen and override truth-preservation rules | `project/spec/production/dependencies-overrides-reopen.md` |
| PF-S01-T08 | Freeze protocol, external jobs and compatibility evolution | `project/spec/production/service-contract.md`, `project/spec/production/compatibility-matrix.md` |
| PF-S01-T09 | Set security, resource, support and release acceptance budgets | `project/spec/production/release-support-and-budgets.md` |
| PF-S01-T10 | Freeze source, curated memory and retained legacy parity contracts | `project/spec/production/source-memory-parity.md` |
| PF-S01-T11 | Integrate versioned contracts, conformance oracle and plan amendment | `project/spec/production/contract-manifest.json`, `project/spec/production/conformance-matrix.json` |

All mutation work loads identity/revisions/authority plus the relevant lifecycle, acceptance, dependency and action rules. Planning work additionally loads cycle/scope/launch rules. Every public adapter loads the service compatibility contract. Release/security/maintenance work loads target/budget/backup/rollback rules. Source/memory/workflow work loads citation, publication, trust and parity rules. If an expected contract file is absent or incompatible, stop the affected task and report the missing prerequisite.

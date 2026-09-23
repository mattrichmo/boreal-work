# PF-S03-T10 oracle source binding

This record is the tracked policy input for the PF-S03-T10 pure-domain oracle.
Exact checkout identity is supplied by the external generated validation
manifest used with the combined oracle run. A policy or source change
therefore requires a new reviewed record rather than silently reusing vectors.

source_binding: `external-generated-validation-input`
manifest_env: `BOREAL_PRODUCTION_ORACLE_MANIFEST`
accepted_contract_source_revision: `784a41b3802c29a76721c55eef2e9493283396c2`
fixture_revision: `m02-candidate.1`

artifact::project/spec/production/contract-manifest.json = `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`
artifact::project/spec/production/status-and-actions.md = `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94`
artifact::project/spec/transition-table.md = `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38`
artifact::project/spec/production/reason-registry.json = `fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70`

## Bounded policy finding

The accepted status/3 artifact specifies a `scheduled` product status and a
`scheduled_start` reason. The current pure domain API has no corresponding
`DerivedStatus::Scheduled` or `ReasonCode::ScheduledStart`; its executable
schedule primitive exposes `ScheduleDecision::scheduled`, and its compatible
status/action path remains queued and fail-closed. This attempt proves that
primitive and compatibility behavior, but does not silently add a new public
enum. A production-domain contract amendment or implementation task is
required before status/3 `scheduled` display semantics can be claimed.

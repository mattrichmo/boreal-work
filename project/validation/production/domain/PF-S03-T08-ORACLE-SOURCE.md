# PF-S03-T08 oracle source binding

This record is the tracked policy/artifact input for the PF-S03-T08
pure-domain oracle. Exact checkout identity is supplied by a generated
validation manifest so a committed record never contains a hash of its own
future commit.

source_binding: `external-generated-validation-input`
manifest_env: `BOREAL_PRODUCTION_ORACLE_MANIFEST`
accepted_contract_source_revision: `784a41b3802c29a76721c55eef2e9493283396c2`
fixture_revision: `m02-candidate.1`
worktree_state: `reported by the external manifest; untracked paths are excluded from artifact identity`

## Normative artifact hashes

```text
artifact::project/spec/production/contract-manifest.json = `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`
artifact::project/spec/production/status-and-actions.md = `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94`
artifact::project/spec/transition-table.md = `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38`
artifact::project/spec/production/reason-registry.json = `fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70`
```

## Bound domain source hashes

These are the exact implementation inputs used by the pure-domain target at
the current committed revision. They are not evidence of store, application,
service, serializer, or release behavior.

```text
artifact::crates/domain/src/lib.rs = `ada0f43743b0adcb29a4c95557d41d89a6763852483a61f6540e08749dad2e0c`
artifact::crates/domain/src/status_evaluator.rs = `3065f7419686b075f2a329ee1ad4dd43d0d542dcd99cf151a247a80ceab92d3f`
artifact::crates/domain/src/actions.rs = `8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7`
artifact::crates/domain/src/decision_inputs.rs = `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d`
artifact::crates/domain/src/dependencies.rs = `43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112`
artifact::crates/domain/src/time_policy.rs = `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58`
artifact::crates/domain/tests/production_properties.rs = `f520e5c7804fb0204694d2eb03869599bce45b25f8e73ff6e06783763888384b`
artifact::project/validation/production/domain/PF-S03-T08-ORACLE.md = `50a8e50d57b7276ddb438e98988153841d15cf6b737135f71eeedeb5095f07a5`
```

## Contract identity and compatibility boundary

The target binds `boreal.work-status/3` and `boreal.work-transition/2` as
normative policy identities. It does not add or advertise a public status/3
serializer. Schedule semantics are tested through the existing pure-domain
decision values, while status/2 compatibility remains `queued` plus the
scheduled-start reason and a denied claim at the pre-activation boundary.

The generated manifest records live `HEAD` and SHA-256 for every compiled
normative, domain, and T08/T10 oracle artifact. The test requires it, checks
that its revision still equals live `HEAD`, and compares each digest to the
compiled bytes. The tracked hashes above remain independently enforced.

## Regeneration rule for integration

Generate the external manifest from the exact checkout immediately before the
focused target and pass it through `BOREAL_PRODUCTION_ORACLE_MANIFEST`. A
source or contract change requires a fresh manifest and focused result; do not
reuse an old manifest or receipt.

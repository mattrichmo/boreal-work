# PF-S03-T08 oracle source binding

This record is the source-bound input for the PF-S03-T08 pure-domain oracle.
The focused target reads these fields, verifies the committed `HEAD`, and
computes SHA-256 over the included contract and domain implementation bytes.
The worker did not commit or push; the coordinator must regenerate the
committed-revision field and rerun the target if integration produces a new
`HEAD`.

base_source_revision: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
current_source_revision: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
accepted_contract_source_revision: `784a41b3802c29a76721c55eef2e9493283396c2`
fixture_revision: `m02-candidate.1`
worktree_state: `dirty; unrelated worker paths are preserved; no commit or push by this worker`

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
artifact::crates/domain/tests/production_properties.rs = `9f88c311759c119d4c35eec5deec5882442dd0e23845fcbe7ef5e189726f0439`
artifact::project/validation/production/domain/PF-S03-T08-ORACLE.md = `f354a5299a8ed1a6130e31205978abf8043bb94a3be84969457aca516bb07a8d`
```

## Contract identity and compatibility boundary

The target binds `boreal.work-status/3` and `boreal.work-transition/2` as
normative policy identities. It does not add or advertise a public status/3
serializer. Schedule semantics are tested through the existing pure-domain
decision values, while status/2 compatibility remains `queued` plus the
scheduled-start reason and a denied claim at the pre-activation boundary.

## Regeneration rule for integration

If the coordinator's final integration commit is not
`0d9611a017d5dc167e92fe79e8d65756fbac2d5a`, regenerate
`current_source_revision` here to that exact committed `HEAD`, recompute every
`artifact::` hash above (including the test target and oracle document if
their bytes changed), rerun the focused target with `--nocapture`, and update
the attempt-4 `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md` identities. A
source or contract implementation change also requires the corresponding
hash update and a fresh focused result; do not reuse this receipt.

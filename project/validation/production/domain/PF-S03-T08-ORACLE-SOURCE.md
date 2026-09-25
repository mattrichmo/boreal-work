# PF-S03-T08 oracle source binding

This record is the tracked policy/artifact input for the PF-S03-T08
pure-domain oracle. Exact checkout identity is supplied by a generated
validation manifest so a committed record never contains a hash of its own
future commit.

source_binding: `external-generated-git-and-worktree-snapshot`
manifest_env: `BOREAL_PRODUCTION_ORACLE_MANIFEST`
accepted_contract_source_revision: `784a41b3802c29a76721c55eef2e9493283396c2`
fixture_revision: `m02-candidate.1`
worktree_state: `reported by the external manifest; tracked and non-ignored untracked files are bound`

## Normative artifact hashes

```text
artifact::project/spec/production/contract-manifest.json = `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`
artifact::project/spec/production/status-and-actions.md = `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94`
artifact::project/spec/transition-table.md = `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38`
artifact::project/spec/production/reason-registry.json = `fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70`
artifact::project/validation/production/domain/PF-S03-T08-ORACLE.md = `50a8e50d57b7276ddb438e98988153841d15cf6b737135f71eeedeb5095f07a5`
```

## Contract identity and compatibility boundary

The target binds `boreal.work-status/3` and `boreal.work-transition/2` as
normative policy identities. It does not add or advertise a public status/3
serializer. Schedule semantics are tested through the existing pure-domain
decision values, while status/2 compatibility remains `queued` plus the
scheduled-start reason and a denied claim at the pre-activation boundary.

The generated manifest records live `HEAD`, a framed SHA-256 over the tracked
and non-ignored untracked source tree, and explicit SHA-256 values for the
normative, domain, and T08/T10 oracle artifacts. The test requires it, checks
that its revision still equals live `HEAD`, and compares included bytes with
the generated manifest. Mutable implementation files are not pinned to stale
tracked hashes; the accepted contract source revision above remains historical
contract provenance, while the external manifest binds the exact candidate
being tested.

## Regeneration rule for integration

Generate the external manifest from the exact checkout immediately before the
focused target and pass it through `BOREAL_PRODUCTION_ORACLE_MANIFEST`. A
source or contract change requires a fresh manifest and focused result; do not
reuse an old manifest or receipt.

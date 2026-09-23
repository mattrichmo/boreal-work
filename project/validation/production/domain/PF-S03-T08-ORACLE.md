# PF-S03-T08 pure-domain oracle

The executable target `crates/domain/tests/production_properties.rs` is bound
to the accepted policy artifacts and the T08-owned source record
`PF-S03-T08-ORACLE-SOURCE.md`, rather than to an implementation branch:

| Identity | Value |
| --- | --- |
| Status contract | `boreal.work-status/3` |
| Transition contract | `boreal.work-transition/2` |
| Fixture revision | `m02-candidate.1` |
| Accepted contract source | `784a41b3802c29a76721c55eef2e9493283396c2` |
| Current committed source revision at attempt-5 start | `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9` |
| Contract manifest SHA-256 | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa` |
| Status/actions SHA-256 | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| Transition table SHA-256 | `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38` |
| Reason registry SHA-256 | `fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70` |

Changing any contract, fixture, policy, or accepted source identity requires
an intentional oracle update and a fresh task attempt. The test also embeds
the contract markers so a missing or renamed policy artifact cannot silently
look like a passing property run.

## Pure-domain coverage

- Four fixed LCG seeds (`0x5eed_0001`, `0x5eed_0029`, `0x5eed_00a7`,
  `0x5eed_01f3`) generate 256 status cases each. Each assertion reports the
  seed, case index, and serialized input. A deterministic shrinker reduces
  fields in a failing case and the replay test preserves a serialized minimal
  case instead of treating a seed alone as the counterexample.
- The normative status vectors cover terminal, expiry review, blocked, draft,
  claimed, in-progress, needs-verification, awaiting-review, complete, paused,
  retry-wait, queued, ready, operator-only, role-denied, and container-planning
  branches. Combined facts verify primary precedence, secondary reason
  retention, stable ordering, timers, idempotence, and permutation invariance.
- The action matrix supplies a positive vector for every one of the 27 public
  actions and negative vectors for non-ready statuses, role denial, operator-
  only claim, unavailable/stale/incompatible availability, degraded and
  quarantined integrity, stale snapshot/entity/proof/fence, missing or
  malformed facts, active holds, and self-review.
- Exact lease and hard-budget equality, renewal immutability, backward-clock
  expiry stability, terminal stability, and explicit closed/cancelled reopen
  transitions are covered.
- The transition crosswalk names every normative `T01`–`T18` and `I01`–`I15`
  vector and checks that each ID exists in the normative transition table.
  Each pure-domain row executes a distinct transition, status, action,
  deadline, review, receipt, or dependency assertion. In particular, I04
  denies a claim while retaining the incumbent fenced attempt, I06 rejects
  self-review while accepting an independent reviewer, and I08 rejects
  complete/verified/cancelled prerequisites with the typed unmet reason while
  retaining each raw observation. Service-only operation identity, revision,
  audit, close-intent, replay, and external-resource rows remain explicitly
  bounded rather than simulated.
- Close-only dependency vectors accept only an exact accepted closed identity
  and proof generation. Complete, verified, cancelled, failed, unaccepted,
  revoked, mismatched, unreadable, corrupt, stale, invalid-revision, and
  out-of-window waiver observations remain unmet while raw observations are
  retained.
- Schedule semantics use the existing pure-domain decision values at before,
  equality, and activation boundaries. No public status/3 serializer is
  introduced or advertised; status/2 compatibility remains `queued` plus the
  scheduled-start reason and a non-claimable action before activation.

If coordinator integration changes the committed `HEAD` or any bound bytes,
the source record's `current_source_revision` and affected `artifact::`
hashes must be regenerated, then the focused target and latest attempt
must be rerun on that exact tree.

This is pure-domain evidence only. It does not claim store transactions,
authenticated service behavior, operation replay/readback, genuine verifier
execution, process/resource recovery, TUI behavior, installation, native
targets, or release qualification. Those are separate acceptance layers.

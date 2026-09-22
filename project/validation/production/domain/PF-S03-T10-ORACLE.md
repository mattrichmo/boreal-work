# PF-S03-T10 deterministic oracle

## Bound identity

This oracle is bound to the following reviewed inputs:

| Identity | Value |
| --- | --- |
| Status contract | `boreal.work-status/3` |
| Transition contract | `boreal.work-transition/2` |
| Fixture revision | `m02-candidate.1` |
| Source input revision | `784a41b3802c29a76721c55eef2e9493283396c2` (dirty working tree) |
| `status-and-actions.md` SHA-256 | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| `transition-table.md` SHA-256 | `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38` |
| `contract-manifest.json` SHA-256 | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |
| Final test target SHA-256 | `4455551dcad2120596fbb7d9edbcfb8c95edd6752792d1d1f7c1943e4fe8cb89` |

Changing any bound contract or policy requires a new oracle review and a new
source identity. These values are asserted by the focused target; they do not
claim that the current source advertises or exposes every target protocol.

## Coverage crosswalk

The following is the complete mapping of the normative transition vectors.
Pure-domain entries execute the public domain predicates in
`production_properties.rs`. Service-only entries are deliberately recorded as
boundaries rather than simulated with fake operation IDs, audit rows, or
close-intent persistence.

### Legal vectors

| Vector | Pure-domain executor or boundary | Assertion |
| --- | --- | --- |
| T01 | `transition_lifecycle` | draft publishes to open |
| T02 | `transition_attempt` | claimed attempt accepts |
| T03 | `transition_attempt` | accepted attempt starts only after accept |
| T04 | `transition_attempt` | accepted starts running |
| T05 | `transition_attempt` | running submits to verifying |
| T06 | `validate_receipt_subject` | receipt binds work, attempt, fence and gate |
| T07 | `validate_independent_review` | independent reviewer is accepted; self-review is rejected |
| T08 | `evaluate_close` | close readiness requires the matching proof context/gaps |
| T09 | `evaluate_close` | incomplete close remains not-ready |
| T10 | `transition_attempt` | release is a terminal attempt transition, not success |
| T11 | exhaustive attempt transition oracle | failure transition is only legal from running/verifying |
| T12 | action policy and status precedence | hard intervention denies claim while retaining safe routes |
| T13 | `evaluate_status` / policy fixtures | pause/retry policy precedes ordinary dispatch |
| T14 | `transition_lifecycle` | open cancellation is explicit |
| T15 | `transition_lifecycle` | closed/cancelled reopen is explicit |
| T16 | exact deadline/status fixtures | equality at lease or hard deadline yields expiry review |
| T17 | `transition_attempt` and expiry fixtures | expiry-pending expires; no blind reclaim is modeled |
| T18 | service-only boundary | expiry resolution persists an operator disposition and is covered by store/service gates |

### Illegal vectors

| Vector | Pure-domain executor or boundary | Assertion |
| --- | --- | --- |
| I01 | `reject_derived_status_write` | derived status is read-only |
| I02 | action policy | draft/queued claim is denied by status |
| I03 | action policy and status precedence | hold, pause, retry and expiry states are not claimable |
| I04 | action request binding | missing/stale attempt or fence is denied |
| I05 | `evaluate_close` and attempt transitions | premature close/finish remains denied or not-ready |
| I06 | `validate_independent_review` | self-review is rejected |
| I07 | service-only boundary | close-intent persistence cannot be truthfully represented by a pure enum test |
| I08 | `dependency_satisfied` | complete/verified/cancelled do not satisfy closed-only edges |
| I09 | expiry fixtures | expired work cannot be blindly reclaimed |
| I10 | `validate_fence` | stale fence is rejected without mutation |
| I11 | `validate_receipt_subject` | wrong subject/attempt/fence is retained as a mismatch |
| I12 | attempt deadline/renewal fixtures | renew-after-expiry and hard-budget extension are rejected |
| I13 | action role policy and review validation | role denial and self-review are typed |
| I14 | service-only boundary | operation replay/different-payload conflict requires persistent journal readback |
| I15 | `validate_dependencies` | dependency cycles are rejected |

## Status/action dimensions

- `scheduled` is tested through the pure schedule predicate at before/equality/
  after boundaries. The status/2 compatibility assertion is queued plus a
  non-claimable action; no status/3 value is fabricated in the current
  `DerivedStatus` enum.
- Availability `stale`, `unavailable`, and `incompatible` allow inspection and
  deny claim with the typed availability reason.
- Integrity `degraded` and `quarantined` deny forward progress while allowing
  an operator repair route; the test retains the diagnostic code and scope.
- Explicit allow/deny vectors cover ready claim, terminal/draft/queued/blocked
  denial, expiry recovery, role-sensitive action behavior, and safe inspection.

## Counterexample policy

Generated cases retain the fixed LCG seed and case index in every failure
message, serialize all case fields, and pass through a deterministic shrinker
that reduces lifecycle, vectors, attempts, gates, and timers without random
state. The focused target includes a replay assertion for the minimized form.
This is pure-domain evidence only; no service receipt or external effect is
claimed.


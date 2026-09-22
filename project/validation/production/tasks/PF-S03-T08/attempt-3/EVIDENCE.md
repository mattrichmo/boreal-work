# PF-S03-T08 — attempt 3 evidence

## Identity

- Record: `PF-S03-T08/attempt-3`.
- Evidence class: pure domain/property/differential/exhaustive test evidence.
- Input Git source: `b543d41008301f7745c899e95f5cb7203ca64917` on branch
  `codex/apply-responsive-terminal-overlay`, dirty.
- Final owned test SHA-256:
  `098d5938b10a371dbeb59f923158ad9e571025f8e46cc13b253144f595165fad`.
- Final oracle SHA-256:
  `152960000e878afdbd0e4d6f1b3e47cba2e80ca97cc3f28f6889d5f668687be3`.
- Domain implementation hashes were unchanged by this attempt:
  `lib.rs` `8c8293e61be01be9d699f405d38bcbfd34d35033440ad6f757c233645c05c2e7`,
  `actions.rs` `8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7`,
  `decision_inputs.rs` `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d`,
  `status_evaluator.rs` `a2bbe9d64569f1be5f34cc2ab1c51d62b1ad45e9a2141dca3727c23efc2afcac`,
  `dependencies.rs` `43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112`.
- Frozen policy identities are recorded in the executable test and oracle:
  status/3, transition/2, fixture `m02-candidate.1`, contract manifest
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`,
  status/actions `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94`,
  transition `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38`,
  reason registry `fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70`.

## Repaired coverage

The previously rejected R1–R6 scope is addressed as follows:

1. Status vectors explicitly cover every status expressible by the current
   domain evaluator, plus the status/3 `scheduled` compatibility boundary and
   all availability/integrity dimensions through current decision/action
   exports.
2. Every one of the 27 action kinds has a positive vector. The negative matrix
   asserts typed status, role, operator-only, availability, integrity, stale
   snapshot/entity/proof/fence, invalid-fact, hold, and self-review denials.
3. All normative `T01`–`T18` and `I01`–`I15` IDs are executable crosswalk
   entries. Pure-domain anchors are exercised; service-only operation identity,
   revision, audit, close-intent, and external-resource rows are explicitly
   labeled boundaries rather than faked as unit proof.
4. Contract IDs, fixture revision, accepted source revision, current input
   HEAD, and policy hashes are asserted in the test and repeated here.
5. Generated cases report seed, case index, and serialized input; the
   deterministic shrinker and replay assertions preserve a minimal serialized
   counterexample path.
6. Historical failed/released/cancelled attempts remain status-invariant, and
   superseded/rejected submissions/reviews do not alter independent claim
   authority. Failed evidence remains in the prior attempts and malformed
   dependency observations retain their raw input.

## Observed results

| Assertion | Observed result |
| --- | --- |
| Focused `production_properties` | 20 passed, 0 failed. |
| Generated property matrix | 4 fixed seeds × 256 status cases, with repeated and reversed-input comparisons. |
| Transition matrix | Every `AttemptPhase × AttemptOperation` and `PersistedLifecycle × WorkOperation` pair; all derived status writes rejected. |
| Deadline matrix | Lease/hard equality, earlier-clock precedence, renewal immutability, exact status boundary, backward-clock retained expiry. |
| Dependency matrix | Only exact accepted closed outcome satisfies; complete/verified/cancelled/failed/unaccepted/revoked/mismatched/malformed/waiver-boundary cases remain unmet. |
| Malformed facts | Unreadable, stale, contradictory terminal/proof/review/execution/integrity/action facts fail closed with typed diagnostics. |
| Domain full suite | 136 unit/integration tests passed; doc-tests 0/0. |
| Strict domain Clippy | Passed with `-D warnings`. |
| Owned rustfmt | Passed. |
| Contract validator | Passed. |
| Whitespace check | Passed. |
| Workspace rustfmt | Not passed: unrelated pre-existing drift in application/CLI files outside the grant. |

## Layer boundary and limitations

This record proves deterministic pure-domain behavior only. It does not prove
SQLite transaction/revision boundaries, authenticated service routes,
operation replay/readback, genuine verifier execution, process/resource stop,
store snapshot completeness, CLI/TUI behavior, native packaging, installation,
publication, or release qualification. Those require their own integration
layers and the PF-S03-T90 → T91 → T92 review/reconciliation/revalidation chain.

Attempts 1 and 2, including the rejected review and its six findings, remain
unchanged. No operation, receipt, service response, reviewer identity,
acceptance decision, plan-ledger edit, commit, or push was fabricated.

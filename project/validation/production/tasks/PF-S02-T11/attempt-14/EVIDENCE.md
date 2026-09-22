# PF-S02-T11 — attempt 14 evidence

## Disposition

**Ready for independent review with a bounded combined-tree blocker.** This
attempt does not accept PF-S02-T11, change plan state, or authorize production
use.

## Exact source identity

- Repository: `/Users/cybertron/Code/boreal-work`
- Base HEAD: `70514f0e`
- The worktree was already dirty with unaccepted concurrent T04/T08/T10
  changes. This attempt edited only its granted application files and its
  evidence directory.
- `crates/application/src/evidence.rs` SHA-256:
  `4917ffad001ad4bd89ca46bf74a2c961800ccb9ad9b9f398d8072605f59533de`
- `crates/application/tests/production_external_jobs.rs` SHA-256:
  `a6a87a93b255d40990e0c1e521038cef29d51163eca095662a9233b81a5d155b`

## Implemented invariant

The external callback is now authorized only by a typed
`ExternalEffectAcquisition::Won` result. The acquisition path performs the
durable compare-and-transition from `admitted` to `running`. If that transition
reports a conflict, it reads the job again and returns `AlreadyRunning`,
`Pending`, `Terminal`, or an explicit typed `Conflict`; it never grants the
callback to the loser. The existing `start` method remains a compatibility
resolution wrapper, while `execute` consumes the typed acquisition result.

The test addition uses two independent SQLite connections against one
file-backed project, pre-admits one job, synchronizes two competing callers,
and asserts both callers observe the same durable `running` record while the
callback counter is exactly one. Existing sequential replay, restart,
identity-bound, pending, rejected, readback, and digest-bound tests remain in
the target.

## Validation evidence

Passed:

- Owned-file rustfmt check.
- Owned-file `git diff --check`.
- Contract validator.
- `boreal-memory` tests: 31 total (9 unit, 22 publisher), plus doc-tests.

Blocked before execution:

- The focused external-job target.
- Application runtime tests.
- CLI compatibility tests.
- Store external-job boundary tests.
- Whole-workspace format check.

The common compile blocker is outside this attempt's write lease:

```text
error[E0063]: missing fields `activation_at` and `schedule`
in initializer of `StatusContext<'_>`
--> crates/store/src/status_evaluation.rs:146:28
```

The current domain-side `StatusContext` has been extended by concurrent
decision-engine work, while this protected store initializer has not yet been
reconciled. The owner is the coordinator/protected store integration steward;
the fix must supply the canonical fields or reconcile the accepted decision
contract, not weaken the domain type. After that repair, rerun every blocked
command on the exact combined tree.

## Limitations

This attempt does not prove service-backed verifier execution, memory
publication, update, backup, resource-release acknowledgement, or production
call-site wiring. Those remain explicit protected integration requests in
`INTEGRATION-REQUESTS.md`.

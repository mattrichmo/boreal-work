# PF-S03-T06 attempt 1 — evidence

## Identity

- Evidence class: pure domain source and focused unit tests.
- Task / attempt: `PF-S03-T06` / `attempt-1`.
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined
  worktree.
- Toolchain: `rustc 1.85.0`, `cargo 1.85.0`.
- Owned source hashes are recorded in `COMMANDS.md`.
- No service binary, store transaction, verifier receipt, native artifact, or
  publication identity was produced; those layers are outside this task.

## Implemented invariant

`crates/domain/src/actions.rs` supplies a transport-free, deterministic action
authority over typed canonical facts. It provides:

- a stable action vocabulary covering inspection/history/readback, publish,
  claim/attempt lifecycle, checkpoint/evidence/submit/review/closeout, stop/
  release, policy pause/resume, cancel/reopen, scoped exceptions, and repair;
- server-produced descriptors carrying target identity, expected project/entity/
  proof revisions, current attempt/fence, required roles, required inputs,
  confirmation text, and read-only/recovery classification;
- one `evaluate_action` path for mutation rechecks and one
  `evaluate_actions` projection that uses the same policy;
- fail-closed authenticated and project-scoped principal checks, including
  delegated-principal field validation and role-specific actor ownership;
- typed stale snapshot/entity/proof/fence, scope, integrity, availability,
  policy, hold, phase, recovery, submission, and independent-review denials;
- deterministic sorting/deduplication of required inputs and safe recovery
  routes, including canonical selection of multiple active holds;
- typed `DerivedStatus`/`ReasonCode` inputs only. No display-status string or
  client helper is consulted for authorization.

## Acceptance-row observations

| Required behavior | Pure test evidence |
| --- | --- |
| Blocked work denies claim and close while allowing safe authorized stop | `blocked_work_denies_claim_and_close_but_allows_owner_stop` passed; active hold remains visible and stop retains attempt/fence descriptor. |
| Ready work can deny a particular actor without becoming globally blocked | `ready_actor_denial_is_actor_specific_not_a_blocked_status` and `operator_only_ready_work_requires_operator_without_changing_status` passed. |
| No adapter infers permission from status strings | All policy entry points consume `DerivedStatus` and typed `ReasonCode`; focused tests call the Rust policy directly. |
| Scope, revisions, proof, and fences are bound | `foreign_scope_and_invalid_delegation_fail_closed` and `revision_and_fence_are_required_again_at_mutation_boundary` passed. |
| Quarantined facts deny forward progress but expose repair | `quarantined_scope_exposes_repair_but_denies_forward_progress` passed. |
| Descriptor and hold decisions are deterministic | `descriptors_are_complete_and_stably_ordered` and the reordered-hold assertion in `blocked_work_denies_claim_and_close_but_allows_owner_stop` passed. |

## Validation disposition

- Focused action policy: passed, 7/7.
- Full `boreal-domain`: passed, 116/116 and 0 doc tests.
- Domain test-target check: passed.
- Strict domain all-target clippy: passed with `-D warnings`.
- Owned-file rustfmt: passed.
- `git diff --check`: passed.
- Workspace-wide rustfmt: passed on the final exact-tree rerun. An earlier
  pre-final probe observed an unrelated line-wrap difference in
  `crates/store/tests/production_identity_revisions.rs:284`; this worker did
  not edit that off-scope path.

The focused test currently compiles `actions.rs` through a local source-path
shim because the shared public registration is coordinator-owned. This is not
presented as public API integration evidence; the required integration patch
and combined-tree rerun are explicit in `INTEGRATION-REQUEST.md`.

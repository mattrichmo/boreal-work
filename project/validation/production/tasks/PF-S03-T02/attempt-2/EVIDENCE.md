# PF-S03-T02 attempt 2 — independent validation evidence

## Record and decision

- Task / attempt: `PF-S03-T02` / `attempt-2`.
- Acceptance row: `AC-08` contribution only.
- Evidence class: current-source inspection plus fresh pure-domain checks.
- Independent reviewer: Codex validation reviewer; implementation worker was
  not used as the reviewer.
- Decision: **rejected for PF-S03-T02 acceptance** because two must-have
  bounded evaluator invariants are not satisfied by the integrated source.
- This is not a sprint, service, native, publication, or release decision.

## Exact source and contract identities

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/status_evaluator.rs` | `1eba7eb050489a5a433e11f62486854d8400db3932c5eac7640068129f0474f9` |
| `crates/domain/tests/production_status_precedence.rs` | `48e31ece43e9e73ca9b73b370fc8eab2c30af7eed4f1dd7e6e51c97b58c7a0e6` |
| `crates/domain/src/lib.rs` | `6f75fcd37496dbff5bc0d5a51b593696781f47818a44edffcd8617d6ef4f78b2` |
| `crates/domain/src/decision_inputs.rs` | `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d` |
| `crates/domain/tests/production_decision_inputs.rs` | `b6f093098c603f34a12cc571df00c1b4c0d308395c6536fffbd93a34a8df64d8` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |
| `project/spec/production/status-and-actions.md` | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| `project/spec/production/reason-registry.json` | `fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70` |
| `project/spec/production/acceptance-and-proof.md` | `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245` |
| `project/spec/production/execution-submission-contract.md` | `539088128f18bc6fef8bbd855ca6a140c4d02ba33bffc799179b128c2a8393a4` |
| `project/spec/production/dependencies-overrides-reopen.md` | `3543fb5f1c3af51304826c66e02a3eb10dd0c1972cc35e77585c1b43a5a0a151` |
| `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md` | `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e` |
| `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T02.md` | `7d4e2588c9fe0d64be82a75b26679b9d0e42308a632f63c9c55e76e0fc042b5a` |

The accepted prerequisite handoff accepts only PF-S03-T01's typed input
artifact and public boundary; it does not accept PF-S03-T02 or the sprint.

## Acceptance checks

| Bounded criterion | Fresh result | Review disposition |
| --- | --- | --- |
| Paused plus prerequisite retains both reasons and resume action | Focused test passed: `paused_precedes_open_prerequisite_and_retains_the_safe_resume_action` | Passed for the exercised active/idle input. |
| Expiry beats hold and retains expiry facts | Focused test passed for a `Running` attempt at `as_of=200`; full domain suite also passed | Incomplete: the retained `Expired` phase loses elapsed-clock reasons; Finding `PF-S03-T02-R1`. |
| Failed proof vs rejected review vs missing review | Focused test passed for an active `Verifying` attempt | Incomplete: no-current-attempt proof/review facts can become `ready`; Finding `PF-S03-T02-R2`. |
| Deterministic reason ordering and equivalent permutations | Focused permutation test passed; full M02 permutation coverage passed | Passed for represented facts. The source-level findings are not permutation-dependent. |
| Typed next-safe-action output | Focused draft/retry/queue/pause/operator/claimed/active/complete cases passed; full domain suite passed | Passed for the existing status/2-shaped `DomainAction` branches. Full status/3 action descriptors remain later-slice scope. |
| Fresh formatting, check, tests, strict clippy | All commands in `COMMANDS.md` exited `0` | Green checks do not override the two semantic findings. |

## Finding PF-S03-T02-R1 — expired attempts omit elapsed-clock secondary reasons

- Severity: `P1` / must-have acceptance defect.
- Source: `crates/domain/src/status_evaluator.rs:22-37` and `:167-184`.
- Observed source behavior: `attempt` retains `AttemptPhase::Expired`, but
  `live_attempt = attempt.filter(|current| !current.phase.is_terminal())`
  removes it. `expiry_pending` therefore still selects `ExpiredReview`, but
  the `LeaseElapsed` and `HardBudgetElapsed` reasons are appended only inside
  the `if let Some(current) = live_attempt` block. An expired attempt with
  `lease_deadline <= as_of`, `max_attempt_deadline <= as_of`, and a hard hold
  consequently returns the expiry status and hold without the elapsed-clock
  secondary reasons.
- Expected rule: the task card requires expiry plus hold to preserve all
  applicable reasons; the accepted status contract identifies the elapsed
  clock as the original expiry reason, and the transition fixtures require
  `hard_budget_elapsed`/`lease_elapsed` at the deadline. The attempt phase
  becoming `Expired` must not erase those historical facts.
- Worker coverage gap: the worker vector uses `AttemptPhase::Running` at the
  deadline only (`production_status_precedence.rs:86-118`). No expired-phase
  regression protects the persisted/reviewed expiry state.
- Evidence limit: source-derived deterministic reproduction; no product code
  was changed to manufacture a failing test.
- Required bounded correction: PF-S03-T02 domain owner, restricted to
  `status_evaluator.rs` and its production precedence test, must preserve the
  elapsed-clock reasons for retained expiry state and add the terminal-expiry
  vector. Rerun focused test, full domain tests, format, and strict clippy.

## Finding PF-S03-T02-R2 — proof/review failures disappear without a current attempt

- Severity: `P1` / must-have proof-gating defect.
- Source: `crates/domain/src/status_evaluator.rs:95-114`, `:216-264`; the
  current input boundary is `crates/domain/src/lib.rs:982-1015`.
- Observed source behavior: failed/open gate facts are added only when
  `proof_phase` is true, and `proof_phase` is true only for a current attempt
  in `Verifying` or `Completed`. If `current_attempt` is absent while
  `context.gates` contains a failed technical gate or failed review gate, the
  evaluator does not add `GateFailed`/`ReviewRejected`; it then reaches the
  no-attempt eligibility branch and can return `Ready` with `Claim`.
- Expected rule: the accepted proof contract requires rejected review to remain
  distinguishable and never reduce to missing proof; the execution/submission
  contract says a sealed submission remains reviewable after lease release and
  failed evidence remains retained. The status transition contract includes
  submitted/close-intent proof gaps independently of the live execution phase.
- Integrated consequence: `StatusContext` has no submission/proof-context
  input, so the evaluator cannot distinguish a released submission awaiting
  proof/review from a genuinely idle task. The worker test covers only an
  active `AttemptPhase::Verifying` attempt (`production_status_precedence.rs:
  121-203`). This is a bounded evaluator/input-contract gap, not a service
  claim.
- Required bounded correction: PF-S03-T02/PF-S03-T04 domain/application owner
  must carry retained submission/review facts into the decision boundary or
  otherwise make failed/open proof state authoritative after execution release;
  add technical-failure, rejected-review, and missing-review vectors with no
  current attempt. Rerun focused, full domain, relevant store/application
  status tests, format, and strict clippy.

## Scope and non-findings

The accepted status/3 contract also names scheduled status, availability and
integrity dimensions, structured action descriptors, and additional reason
codes. Those are explicitly additive/later-slice capabilities and are not
claimed as PF-S03-T02 acceptance here. This review does not convert those
known boundaries into PF-S03-T02 findings. It does, however, reject the two
failures above because they occur in the task's own precedence/reason/proof
behavior and directly undermine AC-08.

No service operation, database migration, genuine verifier, native package,
publication, or release command was run. The local workflow probe was typed
`service_busy`; no lock was broken and no state mutation was attempted.


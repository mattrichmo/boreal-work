# R-DOMAIN-TEST — crates/domain/tests/m02_status.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/domain/tests/m02_status.rs:L1–L500`  
**File SHA-256:** `643258faffc8a1efa0bde14e53a107e35a56cb6c70162f03e260265207bf5a7b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Authored candidate status regressions; existing coverage is not a pass on the fresh source.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,500p' 'crates/domain/tests/m02_status.rs'
```

## Exact baseline excerpt

````text
    1 | //! M02 candidate regressions. These exercise the real pure evaluator, not a
    2 | //! second implementation in a client or a test-only status assignment API.
    3 | use boreal_domain::*;
    4 | 
    5 | fn task(id: &str) -> WorkItem {
    6 |     WorkItem::new("project".into(), id.into(), WorkKind::Task, None, id).open()
    7 | }
    8 | 
    9 | fn attempt(phase: AttemptPhase) -> Attempt {
   10 |     let mut attempt = Attempt::claim(
   11 |         "task".into(),
   12 |         "attempt".into(),
   13 |         "agent".into(),
   14 |         Fence(1),
   15 |         TimestampMs(0),
   16 |         Some(100),
   17 |         Some(200),
   18 |     )
   19 |     .unwrap();
   20 |     attempt.phase = phase;
   21 |     attempt
   22 | }
   23 | 
   24 | fn decide(
   25 |     work: &WorkItem,
   26 |     prerequisites: &[WorkItem],
   27 |     current: Option<&Attempt>,
   28 |     gates: &[GateRequirement],
   29 |     role: ActorRole,
   30 |     now: u64,
   31 |     retry: Option<u64>,
   32 | ) -> StatusDecision {
   33 |     let actor = ActorContext {
   34 |         actor_id: "agent".into(),
   35 |         role,
   36 |     };
   37 |     let mut context = StatusContext::new(
   38 |         work,
   39 |         prerequisites,
   40 |         current,
   41 |         gates,
   42 |         &actor,
   43 |         TimestampMs(now),
   44 |         Revision(17),
   45 |     );
   46 |     context.retry_not_before = retry.map(TimestampMs);
   47 |     evaluate_status(context)
   48 | }
   49 | 
   50 | fn idle(work: &WorkItem, prerequisites: &[WorkItem], retry: Option<u64>) -> StatusDecision {
   51 |     decide(
   52 |         work,
   53 |         prerequisites,
   54 |         None,
   55 |         &work.acceptance_profile.gates,
   56 |         ActorRole::Agent,
   57 |         10,
   58 |         retry,
   59 |     )
   60 | }
   61 | 
   62 | fn codes(decision: &StatusDecision) -> Vec<String> {
   63 |     decision
   64 |         .reason_codes
   65 |         .iter()
   66 |         .map(ReasonCode::stable_code)
   67 |         .collect()
   68 | }
   69 | 
   70 | #[test]
   71 | fn paused_precedes_retry_and_dependency_without_hiding_reasons() {
   72 |     let mut work = task("task");
   73 |     work.dispatch_policy = DispatchPolicy::Paused;
   74 |     let result = idle(&work, &[task("upstream")], Some(50));
   75 |     assert_eq!(result.display_status, DerivedStatus::Paused);
   76 |     assert_eq!(result.primary_reason, ReasonCode::Paused);
   77 |     assert_eq!(
   78 |         codes(&result),
   79 |         [
   80 |             "paused",
   81 |             "prerequisite_open(upstream)",
   82 |             "retry_not_before(50)"
   83 |         ]
   84 |     );
   85 |     assert_eq!(result.next_status_change_at, Some(TimestampMs(50)));
   86 |     assert!(!result.claimable_for_actor);
   87 | }
   88 | 
   89 | #[test]
   90 | fn hold_precedes_pause_retry_and_dependency() {
   91 |     let mut work = task("task");
   92 |     work.dispatch_policy = DispatchPolicy::Paused;
   93 |     work.hard_holds = vec![ReasonCode::HardHold("security_hold".into())];
   94 |     let result = idle(&work, &[task("upstream")], Some(50));
   95 |     assert_eq!(result.display_status, DerivedStatus::Blocked);
   96 |     assert_eq!(
   97 |         codes(&result),
   98 |         [
   99 |             "security_hold",
  100 |             "paused",
  101 |             "prerequisite_open(upstream)",
  102 |             "retry_not_before(50)"
  103 |         ]
  104 |     );
  105 |     assert!(!result.claimable_for_actor);
  106 | }
  107 | 
  108 | #[test]
  109 | fn idle_retry_precedes_dependency_and_ends_at_exact_boundary() {
  110 |     let work = task("task");
  111 |     let prerequisites = [task("upstream")];
  112 |     let before = decide(
  113 |         &work,
  114 |         &prerequisites,
  115 |         None,
  116 |         &work.acceptance_profile.gates,
  117 |         ActorRole::Agent,
  118 |         49,
  119 |         Some(50),
  120 |     );
  121 |     assert_eq!(before.display_status, DerivedStatus::RetryWait);
  122 |     assert_eq!(before.next_status_change_at, Some(TimestampMs(50)));
  123 |     let at = decide(
  124 |         &work,
  125 |         &prerequisites,
  126 |         None,
  127 |         &work.acceptance_profile.gates,
  128 |         ActorRole::Agent,
  129 |         50,
  130 |         Some(50),
  131 |     );
  132 |     assert_eq!(at.display_status, DerivedStatus::Queued);
  133 |     assert_eq!(at.next_status_change_at, None);
  134 | }
  135 | 
  136 | #[test]
  137 | fn active_attempt_precedes_dispatch_and_dependencies_but_not_a_hold() {
  138 |     let mut work = task("task");
  139 |     work.dispatch_policy = DispatchPolicy::Paused;
  140 |     let current = attempt(AttemptPhase::Running);
  141 |     let prerequisites = [task("upstream")];
  142 |     let result = decide(
  143 |         &work,
  144 |         &prerequisites,
  145 |         Some(&current),
  146 |         &work.acceptance_profile.gates,
  147 |         ActorRole::Agent,
  148 |         10,
  149 |         Some(50),
  150 |     );
  151 |     assert_eq!(result.display_status, DerivedStatus::InProgress);
  152 |     assert!(codes(&result).contains(&"paused".into()));
  153 |     assert!(codes(&result).contains(&"prerequisite_open(upstream)".into()));
  154 |     work.hard_holds
  155 |         .push(ReasonCode::HardHold("security_hold".into()));
  156 |     let held = decide(
  157 |         &work,
  158 |         &prerequisites,
  159 |         Some(&current),
  160 |         &work.acceptance_profile.gates,
  161 |         ActorRole::Agent,
  162 |         10,
  163 |         None,
  164 |     );
  165 |     assert_eq!(held.display_status, DerivedStatus::Blocked);
  166 |     assert!(codes(&held).contains(&"attempt_active".into()));
  167 | }
  168 | 
  169 | #[test]
  170 | fn expiry_has_one_primary_reason_and_retains_both_elapsed_clocks() {
  171 |     let mut work = task("task");
  172 |     work.hard_holds
  173 |         .push(ReasonCode::HardHold("security_hold".into()));
  174 |     let current = attempt(AttemptPhase::Running);
  175 |     let result = decide(
  176 |         &work,
  177 |         &[task("upstream")],
  178 |         Some(&current),
  179 |         &work.acceptance_profile.gates,
  180 |         ActorRole::Agent,
  181 |         200,
  182 |         None,
  183 |     );
  184 |     assert_eq!(result.display_status, DerivedStatus::ExpiredReview);
  185 |     assert_eq!(result.primary_reason, ReasonCode::ExpiryReviewRequired);
  186 |     for code in [
  187 |         "hard_budget_elapsed",
  188 |         "lease_elapsed",
  189 |         "security_hold",
  190 |         "prerequisite_open(upstream)",
  191 |     ] {
  192 |         assert!(codes(&result).contains(&code.to_string()));
  193 |     }
  194 |     assert_eq!(result.next_status_change_at, None);
  195 | }
  196 | 
  197 | #[test]
  198 | fn closed_and_cancelled_win_over_all_nonterminal_inputs() {
  199 |     for lifecycle in [PersistedLifecycle::Closed, PersistedLifecycle::Cancelled] {
  200 |         let mut work = task("task");
  201 |         work.lifecycle = lifecycle;
  202 |         work.dispatch_policy = DispatchPolicy::Paused;
  203 |         work.hard_holds
  204 |             .push(ReasonCode::HardHold("security_hold".into()));
  205 |         let current = attempt(AttemptPhase::Running);
  206 |         let result = decide(
  207 |             &work,
  208 |             &[task("upstream")],
  209 |             Some(&current),
  210 |             &work.acceptance_profile.gates,
  211 |             ActorRole::Agent,
  212 |             201,
  213 |             Some(500),
  214 |         );
  215 |         assert_eq!(
  216 |             result.display_status,
  217 |             if lifecycle == PersistedLifecycle::Closed {
  218 |                 DerivedStatus::Closed
  219 |             } else {
  220 |                 DerivedStatus::Cancelled
  221 |             }
  222 |         );
  223 |         assert!(!result.claimable_for_actor);
  224 |         assert_eq!(result.next_action, None);
  225 |         assert_eq!(result.next_status_change_at, None);
  226 |     }
  227 | }
  228 | 
  229 | #[test]
  230 | fn historical_failure_release_and_cancel_do_not_skip_idle_predicates() {
  231 |     for phase in [
  232 |         AttemptPhase::Failed,
  233 |         AttemptPhase::Released,
  234 |         AttemptPhase::Cancelled,
  235 |     ] {
  236 |         let mut work = task("task");
  237 |         work.dispatch_policy = DispatchPolicy::Paused;
  238 |         let current = attempt(phase);
  239 |         let with_history = decide(
  240 |             &work,
  241 |             &[task("upstream")],
  242 |             Some(&current),
  243 |             &work.acceptance_profile.gates,
  244 |             ActorRole::Agent,
  245 |             500,
  246 |             None,
  247 |         );
  248 |         let without_history = decide(
  249 |             &work,
  250 |             &[task("upstream")],
  251 |             None,
  252 |             &work.acceptance_profile.gates,
  253 |             ActorRole::Agent,
  254 |             500,
  255 |             None,
  256 |         );
  257 |         assert_eq!(with_history, without_history);
  258 |         assert_eq!(with_history.display_status, DerivedStatus::Paused);
  259 |     }
  260 | }
  261 | 
  262 | #[test]
  263 | fn reviewed_profile_uses_gate_kind_with_work_scoped_ids() {
  264 |     let mut work = task("task");
  265 |     work.acceptance_profile = AcceptanceProfile::reviewed();
  266 |     for gate in &mut work.acceptance_profile.gates {
  267 |         gate.id = format!("task:{}", gate.id).into();
  268 |     }
  269 |     let gates = work
  270 |         .acceptance_profile
  271 |         .gates
  272 |         .iter()
  273 |         .cloned()
  274 |         .map(|gate| {
  275 |             if gate.kind == GateKind::Review {
  276 |                 gate
  277 |             } else {
  278 |                 gate.satisfied()
  279 |             }
  280 |         })
  281 |         .collect::<Vec<_>>();
  282 |     let current = attempt(AttemptPhase::Verifying);
  283 |     let result = decide(
  284 |         &work,
  285 |         &[],
  286 |         Some(&current),
  287 |         &gates,
  288 |         ActorRole::Agent,
  289 |         10,
  290 |         None,
  291 |     );
  292 |     assert_eq!(result.display_status, DerivedStatus::AwaitingReview);
  293 |     assert_eq!(result.gate_gaps, [GateId::new("task:review")]);
  294 |     assert!(codes(&result).contains(&"gate_open(task:review)".into()));
  295 | }
  296 | 
  297 | #[test]
  298 | fn failed_review_blocks_and_failed_technical_gate_still_needs_proof() {
  299 |     let mut work = task("task");
  300 |     work.acceptance_profile = AcceptanceProfile::reviewed();
  301 |     let mut gates = work.acceptance_profile.gates.clone();
  302 |     for gate in &mut gates {
  303 |         gate.state = GateState::Satisfied;
  304 |     }
  305 |     let current = attempt(AttemptPhase::Verifying);
  306 |     gates
  307 |         .iter_mut()
  308 |         .find(|gate| gate.kind == GateKind::Review)
  309 |         .unwrap()
  310 |         .state = GateState::Failed;
  311 |     assert_eq!(
  312 |         decide(
  313 |             &work,
  314 |             &[],
  315 |             Some(&current),
  316 |             &gates,
  317 |             ActorRole::Agent,
  318 |             10,
  319 |             None
  320 |         )
  321 |         .display_status,
  322 |         DerivedStatus::Blocked
  323 |     );
  324 |     gates
  325 |         .iter_mut()
  326 |         .find(|gate| gate.kind == GateKind::Review)
  327 |         .unwrap()
  328 |         .state = GateState::Satisfied;
  329 |     gates
  330 |         .iter_mut()
  331 |         .find(|gate| gate.kind == GateKind::Verification)
  332 |         .unwrap()
  333 |         .state = GateState::Failed;
  334 |     let technical = decide(
  335 |         &work,
  336 |         &[],
  337 |         Some(&current),
  338 |         &gates,
  339 |         ActorRole::Agent,
  340 |         10,
  341 |         None,
  342 |     );
  343 |     assert_eq!(technical.display_status, DerivedStatus::NeedsVerification);
  344 |     assert!(codes(&technical).contains(&"gate_failed(verification)".into()));
  345 | }
  346 | 
  347 | #[test]
  348 | fn missing_or_duplicate_declared_gates_are_integrity_errors() {
  349 |     let work = task("task");
  350 |     let mut gates = work.acceptance_profile.gates.clone();
  351 |     gates.pop();
  352 |     let missing = decide(&work, &[], None, &gates, ActorRole::Agent, 10, None);
  353 |     assert_eq!(missing.display_status, DerivedStatus::Blocked);
  354 |     assert!(codes(&missing).contains(&"gate_missing(summary)".into()));
  355 |     let mut gates = work.acceptance_profile.gates.clone();
  356 |     gates.push(gates[0].clone());
  357 |     assert_eq!(
  358 |         decide(&work, &[], None, &gates, ActorRole::Agent, 10, None).display_status,
  359 |         DerivedStatus::Blocked
  360 |     );
  361 | }
  362 | 
  363 | #[test]
  364 | fn actor_roles_change_claimability_not_display_readiness() {
  365 |     let mut work = task("task");
  366 |     for role in [
  367 |         ActorRole::Agent,
  368 |         ActorRole::Reviewer,
  369 |         ActorRole::Operator,
  370 |         ActorRole::Publisher,
  371 |     ] {
  372 |         let result = decide(
  373 |             &work,
  374 |             &[],
  375 |             None,
  376 |             &work.acceptance_profile.gates,
  377 |             role,
  378 |             10,
  379 |             None,
  380 |         );
  381 |         assert_eq!(result.display_status, DerivedStatus::Ready);
  382 |         assert_eq!(
  383 |             result.claimable_for_actor,
  384 |             matches!(role, ActorRole::Agent | ActorRole::Operator)
  385 |         );
  386 |     }
  387 |     work.dispatch_policy = DispatchPolicy::OperatorOnly;
  388 |     for role in [
  389 |         ActorRole::Agent,
  390 |         ActorRole::Reviewer,
  391 |         ActorRole::Operator,
  392 |         ActorRole::Publisher,
  393 |     ] {
  394 |         let result = decide(
  395 |             &work,
  396 |             &[],
  397 |             None,
  398 |             &work.acceptance_profile.gates,
  399 |             role,
  400 |             10,
  401 |             None,
  402 |         );
  403 |         assert_eq!(result.display_status, DerivedStatus::Ready);
  404 |         assert_eq!(result.claimable_for_actor, role == ActorRole::Operator);
  405 |         assert!(codes(&result).contains(&"operator_only".into()));
  406 |     }
  407 | }
  408 | 
  409 | #[test]
  410 | fn complete_and_cancelled_never_satisfy_close_only_edges() {
  411 |     let work = task("task");
  412 |     let upstream = task("upstream");
  413 |     let mut current = attempt(AttemptPhase::Completed);
  414 |     current.work_id = upstream.id.clone();
  415 |     let gates = upstream
  416 |         .acceptance_profile
  417 |         .gates
  418 |         .iter()
  419 |         .cloned()
  420 |         .map(GateRequirement::satisfied)
  421 |         .collect::<Vec<_>>();
  422 |     let complete = decide(
  423 |         &upstream,
  424 |         &[],
  425 |         Some(&current),
  426 |         &gates,
  427 |         ActorRole::Agent,
  428 |         500,
  429 |         None,
  430 |     );
  431 |     assert_eq!(complete.display_status, DerivedStatus::Complete);
  432 |     assert_eq!(
  433 |         idle(&work, &[upstream.clone()], None).display_status,
  434 |         DerivedStatus::Queued
  435 |     );
  436 |     let mut cancelled = upstream.clone();
  437 |     cancelled.lifecycle = PersistedLifecycle::Cancelled;
  438 |     assert_eq!(
  439 |         idle(&work, &[cancelled], None).display_status,
  440 |         DerivedStatus::Queued
  441 |     );
  442 |     let mut closed = upstream;
  443 |     closed.lifecycle = PersistedLifecycle::Closed;
  444 |     assert_eq!(
  445 |         idle(&work, &[closed], None).display_status,
  446 |         DerivedStatus::Ready
  447 |     );
  448 | }
  449 | 
  450 | #[test]
  451 | fn permutations_and_duplicate_facts_do_not_change_the_decision() {
  452 |     let mut work = task("task");
  453 |     work.hard_holds = vec![
  454 |         ReasonCode::HardHold("z_hold".into()),
  455 |         ReasonCode::HardHold("a_hold".into()),
  456 |     ];
  457 |     let mut prerequisites = vec![task("z"), task("a")];
  458 |     let first = idle(&work, &prerequisites, None);
  459 |     for _ in 0..8 {
  460 |         work.hard_holds.reverse();
  461 |         prerequisites.reverse();
  462 |         work.acceptance_profile.gates.reverse();
  463 |         assert_eq!(idle(&work, &prerequisites, None), first);
  464 |     }
  465 |     work.hard_holds.push(work.hard_holds[0].clone());
  466 |     prerequisites.push(prerequisites[0].clone());
  467 |     assert_eq!(idle(&work, &prerequisites, None), first);
  468 |     assert_eq!(codes(&first)[0], first.primary_reason.stable_code());
  469 | }
  470 | 
  471 | #[test]
  472 | fn attempt_for_another_work_is_blocked_without_mutating_inputs() {
  473 |     let work = task("different");
  474 |     let current = attempt(AttemptPhase::Running);
  475 |     let original = current.clone();
  476 |     let result = decide(
  477 |         &work,
  478 |         &[],
  479 |         Some(&current),
  480 |         &work.acceptance_profile.gates,
  481 |         ActorRole::Agent,
  482 |         10,
  483 |         None,
  484 |     );
  485 |     assert_eq!(result.display_status, DerivedStatus::Blocked);
  486 |     assert!(codes(&result).contains(&"attempt_subject_mismatch".into()));
  487 |     assert_eq!(current, original);
  488 | }
  489 | 
  490 | #[test]
  491 | fn derived_status_is_not_a_writable_lifecycle() {
  492 |     for status in [
  493 |         DerivedStatus::Ready,
  494 |         DerivedStatus::Complete,
  495 |         DerivedStatus::Closed,
  496 |         DerivedStatus::Paused,
  497 |     ] {
  498 |         assert!(reject_derived_status_write(status).is_err());
  499 |     }
  500 | }
````

# R-EVALUATOR — crates/domain/src/status_evaluator.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/domain/src/status_evaluator.rs:L1–L327`  
**File SHA-256:** `6b0aca698af8d7ddf1ec1b4b4099a6b1a0b6adc43a0c68481b2606ca14aa43ca`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Extracted pure status decision: preserve source predicates and all reasons; complete action contract without adapters rederiving it.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,327p' 'crates/domain/src/status_evaluator.rs'
```

## Exact baseline excerpt

````text
    1 | //! One pure decision over canonical inputs. Reads and transactional claim
    2 | //! authorization both call this function; adapters must not repair its result.
    3 | use crate::{
    4 |     ActorContext, ActorRole, AttemptPhase, CurrentAttempt, DerivedStatus, DispatchPolicy,
    5 |     DomainAction, GateId, GateKind, GateRequirement, GateState, PersistedLifecycle, ReasonCode,
    6 |     StatusContext, StatusDecision, WorkItem, WorkKind,
    7 | };
    8 | 
    9 | type PrimaryDecision = (DerivedStatus, bool, Option<DomainAction>, ReasonCode);
   10 | 
   11 | /// M02 precedence: terminal; expiry/integrity/hold; draft; current attempt;
   12 | /// pause; retry; normal prerequisites; readiness. Facts are accumulated before
   13 | /// selecting the primary status so higher precedence never hides another cause.
   14 | pub fn evaluate_status(context: StatusContext<'_>) -> StatusDecision {
   15 |     let work = context.work;
   16 |     // A released/failed/cancelled attempt is history, not an eligibility input.
   17 |     // In particular, its old deadline must never expire a later idle task.
   18 |     let attempt = context.current_attempt.filter(|current| {
   19 |         !matches!(
   20 |             current.phase,
   21 |             AttemptPhase::Failed | AttemptPhase::Released | AttemptPhase::Cancelled
   22 |         )
   23 |     });
   24 |     let live_attempt = attempt.filter(|current| !current.phase.is_terminal());
   25 |     let expiry = live_attempt.and_then(|current| current.expiry_reason(context.as_of));
   26 |     let expiry_pending = expiry.is_some()
   27 |         || attempt.is_some_and(|current| {
   28 |             matches!(
   29 |                 current.phase,
   30 |                 AttemptPhase::ExpiryPending | AttemptPhase::Expired
   31 |             ) || current.review_required_after_expiry
   32 |         });
   33 |     let retry_at = context.retry_not_before.filter(|at| *at > context.as_of);
   34 |     let mut reasons = Vec::new();
   35 |     let mut hard_reasons = work.hard_holds.clone();
   36 |     let mut prerequisites = context
   37 |         .prerequisites
   38 |         .iter()
   39 |         .filter(|item| item.lifecycle != PersistedLifecycle::Closed)
   40 |         .map(|item| ReasonCode::PrerequisiteOpen(item.id.clone()))
   41 |         .collect::<Vec<_>>();
   42 |     sort_reasons(&mut prerequisites);
   43 | 
   44 |     if attempt.is_some_and(|current| current.work_id != work.id || work.kind != WorkKind::Task) {
   45 |         hard_reasons.push(ReasonCode::AttemptSubjectMismatch);
   46 |     }
   47 |     // Required profile rows may not disappear from the snapshot. An open gate
   48 |     // is normal missing proof; a missing/mistyped *gate definition* is integrity.
   49 |     for declared in &work.acceptance_profile.gates {
   50 |         let actual = context.gates.iter().find(|gate| gate.id == declared.id);
   51 |         match actual {
   52 |             None if declared.required => {
   53 |                 hard_reasons.push(ReasonCode::GateMissing(declared.id.clone()));
   54 |             }
   55 |             Some(actual)
   56 |                 if actual.kind != declared.kind || actual.required != declared.required =>
   57 |             {
   58 |                 hard_reasons.push(ReasonCode::GateInvalid(declared.id.clone()));
   59 |             }
   60 |             _ => {}
   61 |         }
   62 |     }
   63 |     let mut gate_ids = std::collections::BTreeSet::new();
   64 |     for gate in context.gates {
   65 |         if !gate_ids.insert(gate.id.clone()) {
   66 |             hard_reasons.push(ReasonCode::GateInvalid(gate.id.clone()));
   67 |         }
   68 |     }
   69 |     let mut gaps = context
   70 |         .gates
   71 |         .iter()
   72 |         .filter(|gate| gate.required && gate.state != GateState::Satisfied)
   73 |         .map(|gate| gate.id.clone())
   74 |         .collect::<Vec<_>>();
   75 |     gaps.extend(work.acceptance_profile.gates.iter().filter_map(|declared| {
   76 |         (declared.required && !gate_ids.contains(&declared.id)).then(|| declared.id.clone())
   77 |     }));
   78 |     gaps.sort();
   79 |     gaps.dedup();
   80 |     let proof_phase = attempt.is_some_and(|current| {
   81 |         matches!(
   82 |             current.phase,
   83 |             AttemptPhase::Verifying | AttemptPhase::Completed
   84 |         )
   85 |     });
   86 |     if proof_phase {
   87 |         for gate in context.gates.iter().filter(|gate| gate.required) {
   88 |             match gate.state {
   89 |                 GateState::Open => reasons.push(ReasonCode::GateOpen(gate.id.clone())),
   90 |                 GateState::Failed if gate.kind == GateKind::Review => {
   91 |                     hard_reasons.push(ReasonCode::ReviewRejected(gate.id.clone()));
   92 |                 }
   93 |                 GateState::Failed => reasons.push(ReasonCode::GateFailed(gate.id.clone())),
   94 |                 GateState::Satisfied => {}
   95 |             }
   96 |         }
   97 |     }
   98 |     sort_reasons(&mut hard_reasons);
   99 |     reasons.extend(hard_reasons.iter().cloned());
  100 |     reasons.extend(prerequisites.iter().cloned());
  101 |     if work.lifecycle == PersistedLifecycle::Draft {
  102 |         reasons.push(ReasonCode::NotPublished);
  103 |     }
  104 |     match work.dispatch_policy {
  105 |         DispatchPolicy::Paused => reasons.push(ReasonCode::Paused),
  106 |         DispatchPolicy::OperatorOnly => reasons.push(ReasonCode::OperatorOnly),
  107 |         DispatchPolicy::Automatic => {}
  108 |     }
  109 |     if work.kind == WorkKind::Task
  110 |         && matches!(
  111 |             context.actor.role,
  112 |             ActorRole::Reviewer | ActorRole::Publisher
  113 |         )
  114 |     {
  115 |         reasons.push(ReasonCode::RoleDenied);
  116 |     }
  117 |     if let Some(at) = retry_at {
  118 |         reasons.push(ReasonCode::RetryNotBefore(at));
  119 |     }
  120 |     if expiry_pending {
  121 |         reasons.push(ReasonCode::ExpiryReviewRequired);
  122 |     }
  123 |     // Both elapsed clocks remain visible even when the hard budget is primary.
  124 |     if let Some(current) = live_attempt {
  125 |         if context.as_of >= current.lease_deadline {
  126 |             reasons.push(ReasonCode::LeaseElapsed);
  127 |         }
  128 |         if context.as_of >= current.max_attempt_deadline {
  129 |             reasons.push(ReasonCode::HardBudgetElapsed);
  130 |         }
  131 |         match current.phase {
  132 |             AttemptPhase::Claimed => reasons.push(ReasonCode::AttemptUnaccepted),
  133 |             AttemptPhase::Accepted | AttemptPhase::Running => {
  134 |                 reasons.push(ReasonCode::AttemptActive)
  135 |             }
  136 |             _ => {}
  137 |         }
  138 |     }
  139 |     let (display_status, claimable, action, primary) =
  140 |         if work.lifecycle == PersistedLifecycle::Closed {
  141 |             pending(DerivedStatus::Closed, None, ReasonCode::TerminalClosed)
  142 |         } else if work.lifecycle == PersistedLifecycle::Cancelled {
  143 |             pending(
  144 |                 DerivedStatus::Cancelled,
  145 |                 None,
  146 |                 ReasonCode::TerminalCancelled,
  147 |             )
  148 |         } else if expiry_pending {
  149 |             pending(
  150 |                 DerivedStatus::ExpiredReview,
  151 |                 Some(DomainAction::ReviewExpiry),
  152 |                 ReasonCode::ExpiryReviewRequired,
  153 |             )
  154 |         } else if let Some(reason) = hard_reasons.first() {
  155 |             pending(
  156 |                 DerivedStatus::Blocked,
  157 |                 Some(DomainAction::ResolveHold),
  158 |                 reason.clone(),
  159 |             )
  160 |         } else if work.lifecycle == PersistedLifecycle::Draft {
  161 |             pending(
  162 |                 DerivedStatus::Draft,
  163 |                 Some(DomainAction::PublishWork),
  164 |                 ReasonCode::NotPublished,
  165 |             )
  166 |         } else if let Some(current) = attempt {
  167 |             match current.phase {
  168 |                 AttemptPhase::Claimed => pending(
  169 |                     DerivedStatus::Claimed,
  170 |                     Some(DomainAction::AcceptAttempt),
  171 |                     ReasonCode::AttemptUnaccepted,
  172 |                 ),
  173 |                 AttemptPhase::Accepted | AttemptPhase::Running => pending(
  174 |                     DerivedStatus::InProgress,
  175 |                     Some(DomainAction::ResumeAttempt),
  176 |                     ReasonCode::AttemptActive,
  177 |                 ),
  178 |                 AttemptPhase::Verifying | AttemptPhase::Completed => {
  179 |                     proof_decision(context.gates, &gaps)
  180 |                 }
  181 |                 AttemptPhase::ExpiryPending | AttemptPhase::Expired => pending(
  182 |                     DerivedStatus::ExpiredReview,
  183 |                     Some(DomainAction::ReviewExpiry),
  184 |                     ReasonCode::ExpiryReviewRequired,
  185 |                 ),
  186 |                 AttemptPhase::Failed | AttemptPhase::Released | AttemptPhase::Cancelled => {
  187 |                     unreachable!("historical attempts were filtered")
  188 |                 }
  189 |             }
  190 |         } else if work.dispatch_policy == DispatchPolicy::Paused {
  191 |             pending(
  192 |                 DerivedStatus::Paused,
  193 |                 Some(DomainAction::ResumePolicy),
  194 |                 ReasonCode::Paused,
  195 |             )
  196 |         } else if let Some(at) = retry_at {
  197 |             pending(
  198 |                 DerivedStatus::RetryWait,
  199 |                 Some(DomainAction::WaitUntil),
  200 |                 ReasonCode::RetryNotBefore(at),
  201 |             )
  202 |         } else if let Some(reason) = prerequisites.first() {
  203 |             pending(
  204 |                 DerivedStatus::Queued,
  205 |                 Some(DomainAction::WaitForPrerequisite),
  206 |                 reason.clone(),
  207 |             )
  208 |         } else if work.kind != WorkKind::Task {
  209 |             // Provisional planning label, not a descendant rollup or launch signal.
  210 |             // S01-T05/S03-T05 remain open until complete rollups are implemented.
  211 |             pending(DerivedStatus::Queued, None, ReasonCode::ContainerPlanning)
  212 |         } else {
  213 |             eligibility(work, context.actor)
  214 |         };
  215 | 
  216 |     let primary_code = primary.stable_code();
  217 |     reasons.retain(|reason| reason.stable_code() != primary_code);
  218 |     sort_reasons(&mut reasons);
  219 |     reasons.insert(0, primary.clone());
  220 |     // Timers belong to this evaluator, not to individual read adapters. A
  221 |     // secondary reason disappearing is also a status-snapshot change.
  222 |     let next_status_change_at = if work.lifecycle.is_terminal() || expiry_pending {
  223 |         None
  224 |     } else {
  225 |         live_attempt
  226 |             .into_iter()
  227 |             .flat_map(|current| [current.lease_deadline, current.max_attempt_deadline])
  228 |             .chain(retry_at)
  229 |             .filter(|at| *at > context.as_of)
  230 |             .min()
  231 |     };
  232 |     let mut dependents = context.affected_dependents.to_vec();
  233 |     dependents.sort();
  234 |     dependents.dedup();
  235 |     StatusDecision {
  236 |         work_id: work.id.clone(),
  237 |         project_revision: context.project_revision,
  238 |         as_of: context.as_of,
  239 |         next_status_change_at,
  240 |         display_status,
  241 |         primary_reason: primary,
  242 |         reason_codes: reasons,
  243 |         claimable_for_actor: claimable,
  244 |         next_action: action,
  245 |         current_attempt: attempt.map(|current| CurrentAttempt {
  246 |             attempt_id: current.attempt_id.clone(),
  247 |             fence: current.fence,
  248 |             phase: current.phase,
  249 |         }),
  250 |         gate_gaps: gaps,
  251 |         affected_dependents: dependents,
  252 |     }
  253 | }
  254 | 
  255 | fn sort_reasons(reasons: &mut Vec<ReasonCode>) {
  256 |     reasons.sort_by_key(ReasonCode::stable_code);
  257 |     reasons.dedup_by(|left, right| left.stable_code() == right.stable_code());
  258 | }
  259 | 
  260 | fn pending(
  261 |     status: DerivedStatus,
  262 |     action: Option<DomainAction>,
  263 |     reason: ReasonCode,
  264 | ) -> PrimaryDecision {
  265 |     (status, false, action, reason)
  266 | }
  267 | 
  268 | fn eligibility(work: &WorkItem, actor: &ActorContext) -> PrimaryDecision {
  269 |     if work.dispatch_policy == DispatchPolicy::OperatorOnly {
  270 |         let allowed = actor.role == ActorRole::Operator;
  271 |         let action = if allowed {
  272 |             DomainAction::Claim
  273 |         } else {
  274 |             DomainAction::RequestOperatorClaim
  275 |         };
  276 |         return (
  277 |             DerivedStatus::Ready,
  278 |             allowed,
  279 |             Some(action),
  280 |             ReasonCode::OperatorOnly,
  281 |         );
  282 |     }
  283 |     if matches!(actor.role, ActorRole::Agent | ActorRole::Operator) {
  284 |         (
  285 |             DerivedStatus::Ready,
  286 |             true,
  287 |             Some(DomainAction::Claim),
  288 |             ReasonCode::Eligible,
  289 |         )
  290 |     } else {
  291 |         pending(
  292 |             DerivedStatus::Ready,
  293 |             Some(DomainAction::RequestOperatorClaim),
  294 |             ReasonCode::RoleDenied,
  295 |         )
  296 |     }
  297 | }
  298 | 
  299 | fn proof_decision(gates: &[GateRequirement], gaps: &[GateId]) -> PrimaryDecision {
  300 |     if gaps.is_empty() {
  301 |         return pending(
  302 |             DerivedStatus::Complete,
  303 |             Some(DomainAction::FinishClose),
  304 |             ReasonCode::CloseoutPending,
  305 |         );
  306 |     }
  307 |     // Persisted gate IDs are work-scoped ("task:review"). Kind, not the bare
  308 |     // string "review", determines whether only independent review remains.
  309 |     let only_review = gaps.iter().all(|id| {
  310 |         gates
  311 |             .iter()
  312 |             .any(|gate| gate.id == *id && gate.kind == GateKind::Review)
  313 |     });
  314 |     if only_review {
  315 |         pending(
  316 |             DerivedStatus::AwaitingReview,
  317 |             Some(DomainAction::RequestReview),
  318 |             ReasonCode::ReviewRequired,
  319 |         )
  320 |     } else {
  321 |         pending(
  322 |             DerivedStatus::NeedsVerification,
  323 |             Some(DomainAction::ProvideEvidence),
  324 |             ReasonCode::VerificationRequired,
  325 |         )
  326 |     }
  327 | }
````

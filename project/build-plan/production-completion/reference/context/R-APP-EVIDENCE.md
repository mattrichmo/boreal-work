# R-APP-EVIDENCE — crates/application/src/evidence.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/evidence.rs:L640–L790`  
**File SHA-256:** `855a672f1eafe9354524c20c80620a681367bf80c1281e20a59dd49884c40590`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Acceptance matching selects latest matching gate before complete context validation; unify with store subject filtering.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '640,790p' 'crates/application/src/evidence.rs'
```

## Exact baseline excerpt

````text
  640 | }
  641 | 
  642 | impl AcceptanceEvaluation {
  643 |     pub fn required_satisfied(&self, profile: &AcceptanceDefinition) -> bool {
  644 |         profile
  645 |             .gates
  646 |             .iter()
  647 |             .filter(|gate| gate.required)
  648 |             .all(|gate| {
  649 |                 self.gates
  650 |                     .iter()
  651 |                     .find(|result| result.gate_id == gate.id)
  652 |                     .is_some_and(|result| result.state == GateState::Satisfied)
  653 |             })
  654 |     }
  655 | 
  656 |     pub fn open_required(&self, profile: &AcceptanceDefinition) -> Vec<GateId> {
  657 |         let mut ids = profile
  658 |             .gates
  659 |             .iter()
  660 |             .filter(|gate| gate.required)
  661 |             .filter(|gate| {
  662 |                 self.gates
  663 |                     .iter()
  664 |                     .find(|result| result.gate_id == gate.id)
  665 |                     .is_none_or(|result| result.state != GateState::Satisfied)
  666 |             })
  667 |             .map(|gate| gate.id.clone())
  668 |             .collect::<Vec<_>>();
  669 |         ids.sort();
  670 |         ids
  671 |     }
  672 | }
  673 | 
  674 | pub fn evaluate_acceptance(
  675 |     definition: &AcceptanceDefinition,
  676 |     receipts: &[ReceiptPayload],
  677 |     base: &ReceiptExpectationBase,
  678 | ) -> Result<AcceptanceEvaluation, EvidenceValidationError> {
  679 |     definition.validate()?;
  680 |     let mut gates = definition.gates.clone();
  681 |     gates.sort_by(|left, right| left.id.cmp(&right.id));
  682 |     let results = gates
  683 |         .into_iter()
  684 |         .map(|gate| {
  685 |             let expected = ReceiptExpectation {
  686 |                 work_id: base.work_id.clone(),
  687 |                 attempt_id: base.attempt_id.clone(),
  688 |                 fence: base.fence,
  689 |                 source_snapshot_hash: base.source_snapshot_hash.clone(),
  690 |                 config_identity: base.config_identity.clone(),
  691 |                 profile_id: definition.id.clone(),
  692 |                 profile_version: definition.version.clone(),
  693 |                 gate: gate.clone(),
  694 |             };
  695 |             let mut candidates = receipts
  696 |                 .iter()
  697 |                 .filter(|receipt| receipt.gate_id == gate.id)
  698 |                 .collect::<Vec<_>>();
  699 |             candidates.sort_by(|left, right| {
  700 |                 left.ended_at
  701 |                     .cmp(&right.ended_at)
  702 |                     .then_with(|| left.receipt_id.cmp(&right.receipt_id))
  703 |             });
  704 |             let result = candidates.last().map_or_else(
  705 |                 || AcceptanceGateResult {
  706 |                     gate_id: gate.id.clone(),
  707 |                     kind: gate.kind,
  708 |                     state: GateState::Open,
  709 |                     receipt_id: None,
  710 |                     reason: None,
  711 |                 },
  712 |                 |receipt| match receipt.validate_for(&expected) {
  713 |                     Ok(()) if receipt.result == ReceiptResult::Passed => AcceptanceGateResult {
  714 |                         gate_id: gate.id.clone(),
  715 |                         kind: gate.kind,
  716 |                         state: GateState::Satisfied,
  717 |                         receipt_id: Some(receipt.receipt_id.clone()),
  718 |                         reason: None,
  719 |                     },
  720 |                     Ok(()) => AcceptanceGateResult {
  721 |                         gate_id: gate.id.clone(),
  722 |                         kind: gate.kind,
  723 |                         state: GateState::Failed,
  724 |                         receipt_id: Some(receipt.receipt_id.clone()),
  725 |                         reason: Some(EvidenceErrorCode::ReceiptExitNonzero),
  726 |                     },
  727 |                     Err(error) => AcceptanceGateResult {
  728 |                         gate_id: gate.id.clone(),
  729 |                         kind: gate.kind,
  730 |                         state: GateState::Failed,
  731 |                         receipt_id: Some(receipt.receipt_id.clone()),
  732 |                         reason: Some(error.code()),
  733 |                     },
  734 |                 },
  735 |             );
  736 |             result
  737 |         })
  738 |         .collect();
  739 |     Ok(AcceptanceEvaluation {
  740 |         profile_id: definition.id.clone(),
  741 |         profile_version: definition.version.clone(),
  742 |         gates: results,
  743 |     })
  744 | }
  745 | 
  746 | #[derive(Clone, Debug, Eq, PartialEq)]
  747 | pub struct ReceiptExpectationBase {
  748 |     pub work_id: WorkId,
  749 |     pub attempt_id: AttemptId,
  750 |     pub fence: Fence,
  751 |     pub source_snapshot_hash: SourceVersionId,
  752 |     pub config_identity: ConfigIdentity,
  753 | }
  754 | 
  755 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  756 | pub enum ReviewDecision {
  757 |     Accepted,
  758 |     Rejected,
  759 | }
  760 | 
  761 | #[derive(Clone, Debug, Eq, PartialEq)]
  762 | pub struct ReviewDecisionRequest {
  763 |     pub review_id: String,
  764 |     pub work_id: WorkId,
  765 |     pub attempt_id: AttemptId,
  766 |     pub fence: Fence,
  767 |     pub reviewer_actor_id: ActorId,
  768 |     pub attempt_actor_id: ActorId,
  769 |     pub reviewer_role: ActorRole,
  770 |     pub decision: ReviewDecision,
  771 |     pub reason: String,
  772 |     pub source_snapshot_hash: SourceVersionId,
  773 |     pub config_identity: ConfigIdentity,
  774 |     pub policy_version: String,
  775 | }
  776 | 
  777 | #[derive(Clone, Debug, Eq, PartialEq)]
  778 | pub struct ReviewExpectation {
  779 |     pub work_id: WorkId,
  780 |     pub attempt_id: AttemptId,
  781 |     pub fence: Fence,
  782 |     pub source_snapshot_hash: SourceVersionId,
  783 |     pub config_identity: ConfigIdentity,
  784 |     pub policy_version: String,
  785 | }
  786 | 
  787 | pub fn validate_review_decision(
  788 |     review: &ReviewDecisionRequest,
  789 |     definition: &AcceptanceDefinition,
  790 |     expected: &ReviewExpectation,
````

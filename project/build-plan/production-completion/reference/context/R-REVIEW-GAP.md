# R-REVIEW-GAP — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L3585–L3655`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Review projection distinguishes only accepted from not-accepted and can turn rejection into missing proof.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '3585,3655p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 3585 |                 .entry(row.work_id.clone())
 3586 |                 .or_insert_with(|| GateDiagnostics {
 3587 |                     project_id: project_id.to_owned(),
 3588 |                     work_id: row.work_id.clone(),
 3589 |                     attempt_id: attempt_id.map(str::to_owned),
 3590 |                     fence,
 3591 |                     revision,
 3592 |                     gates: Vec::new(),
 3593 |                     missing: Vec::new(),
 3594 |                 });
 3595 | 
 3596 |             let (state, receipt_id, reason) = match (attempt_id, fence) {
 3597 |                 (Some(attempt_id), Some(fence)) => {
 3598 |                     let key = (
 3599 |                         row.work_id.clone(),
 3600 |                         attempt_id.to_owned(),
 3601 |                         fence,
 3602 |                         row.gate_id.clone(),
 3603 |                     );
 3604 |                     if let Some(receipt) = receipts.get(&key) {
 3605 |                         let state = if receipt.result == ReceiptOutcome::Passed
 3606 |                             && receipt.rejection_code.is_none()
 3607 |                         {
 3608 |                             GateState::Satisfied
 3609 |                         } else {
 3610 |                             GateState::Failed
 3611 |                         };
 3612 |                         let reason = receipt.rejection_code.clone().or_else(|| {
 3613 |                             (receipt.result != ReceiptOutcome::Passed)
 3614 |                                 .then(|| receipt_outcome_name(receipt.result).to_owned())
 3615 |                         });
 3616 |                         (state, Some(receipt.receipt_id.clone()), reason)
 3617 |                     } else {
 3618 |                         let review_key = (
 3619 |                             row.work_id.clone(),
 3620 |                             attempt_id.to_owned(),
 3621 |                             fence,
 3622 |                             row.gate_id.clone(),
 3623 |                         );
 3624 |                         let review_satisfied = row.kind == GateKind::Review
 3625 |                             && reviews.get(&review_key).copied().unwrap_or(false);
 3626 |                         let summary_satisfied = row.kind == GateKind::Summary
 3627 |                             && summaries.get(&row.work_id).is_some_and(|summary| {
 3628 |                                 let Some(attempt) = current_attempts.get(&row.work_id) else {
 3629 |                                     return false;
 3630 |                                 };
 3631 |                                 summary.attempt_id == attempt_id
 3632 |                                     && summary.fence == fence
 3633 |                                     && summary.source_version_id
 3634 |                                         == attempt.source_version_id.clone().unwrap_or_default()
 3635 |                                     && summary.config_identity == attempt.config_identity
 3636 |                                     && summary.profile_id == row.profile_id
 3637 |                                     && summary.profile_version == row.profile_version
 3638 |                                     && summary.body_size > 0
 3639 |                                     && summary.body_size <= MAX_SUMMARY_BODY_BYTES
 3640 |                                     && valid_sha256_digest(&summary.body_digest)
 3641 |                             });
 3642 |                         if review_satisfied || summary_satisfied {
 3643 |                             (GateState::Satisfied, None, None)
 3644 |                         } else {
 3645 |                             (
 3646 |                                 GateState::Open,
 3647 |                                 None,
 3648 |                                 Some("current_proof_missing".to_owned()),
 3649 |                             )
 3650 |                         }
 3651 |                     }
 3652 |                 }
 3653 |                 _ => (row.state, None, None),
 3654 |             };
 3655 |             entry.gates.push(GateDiagnostic {
````

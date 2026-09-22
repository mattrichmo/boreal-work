# R-RECEIPT-SELECT — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L6600–L6705`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Boolean review lookup and receipt selection by subject; reconcile all evidence-selection helpers.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '6600,6705p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 6600 |             missing,
 6601 |         })
 6602 |     }
 6603 | 
 6604 |     fn current_review_is_accepted(
 6605 |         &self,
 6606 |         work_id: &str,
 6607 |         attempt_id: &str,
 6608 |         fence: u64,
 6609 |         gate_id: &str,
 6610 |     ) -> Result<bool, StoreError> {
 6611 |         let mut statement = self.prepare(
 6612 |             "SELECT decision FROM review
 6613 |              WHERE work_id = ?1 AND attempt_id = ?2 AND fence = ?3 AND gate_id = ?4
 6614 |              ORDER BY created_at DESC, review_id DESC LIMIT 1",
 6615 |         )?;
 6616 |         statement.bind_text(1, work_id)?;
 6617 |         statement.bind_text(2, attempt_id)?;
 6618 |         statement.bind_i64(3, fence)?;
 6619 |         statement.bind_text(4, gate_id)?;
 6620 |         if statement.step()? != SQLITE_ROW {
 6621 |             return Ok(false);
 6622 |         }
 6623 |         Ok(parse_review_decision(&statement.column_text(0)?)? == ReviewDecision::Accepted)
 6624 |     }
 6625 | 
 6626 |     fn current_summary_satisfies_gate(
 6627 |         &self,
 6628 |         project_id: &str,
 6629 |         work_id: &str,
 6630 |         attempt_id: &str,
 6631 |         fence: u64,
 6632 |         gate_id: &str,
 6633 |     ) -> Result<bool, StoreError> {
 6634 |         let Some(summary) = self.current_summary(project_id, work_id)? else {
 6635 |             return Ok(false);
 6636 |         };
 6637 |         let Some(attempt) = self.attempt_record(attempt_id, false)? else {
 6638 |             return Ok(false);
 6639 |         };
 6640 |         let Some(gate) = self.gate(project_id, work_id, gate_id)? else {
 6641 |             return Ok(false);
 6642 |         };
 6643 |         Ok(summary.attempt_id == attempt_id
 6644 |             && summary.fence == fence
 6645 |             && summary.source_version_id == attempt.source_version_id.clone().unwrap_or_default()
 6646 |             && summary.config_identity == attempt.config_identity
 6647 |             && summary.profile_id == gate.profile_id
 6648 |             && summary.profile_version == gate.profile_version
 6649 |             && summary.body_size > 0
 6650 |             && summary.body_size <= MAX_SUMMARY_BODY_BYTES
 6651 |             && valid_sha256_digest(&summary.body_digest))
 6652 |     }
 6653 | 
 6654 |     fn latest_receipt_for_gate(
 6655 |         &self,
 6656 |         gate_id: &str,
 6657 |         work_id: &str,
 6658 |         attempt_id: &str,
 6659 |         fence: u64,
 6660 |     ) -> Result<Option<String>, StoreError> {
 6661 |         let mut statement = self.prepare(
 6662 |             "SELECT receipt_id FROM receipt
 6663 |              WHERE gate_id = ?1 AND work_id = ?2 AND attempt_id = ?3 AND fence = ?4
 6664 |              ORDER BY ended_at DESC, receipt_id DESC LIMIT 1",
 6665 |         )?;
 6666 |         statement.bind_text(1, gate_id)?;
 6667 |         statement.bind_text(2, work_id)?;
 6668 |         statement.bind_text(3, attempt_id)?;
 6669 |         statement.bind_i64(4, fence)?;
 6670 |         if statement.step()? == SQLITE_ROW {
 6671 |             Ok(Some(statement.column_text(0)?))
 6672 |         } else {
 6673 |             Ok(None)
 6674 |         }
 6675 |     }
 6676 | 
 6677 |     fn validate_close_subject(&self, request: &CloseIntentRequest) -> Result<(), StoreError> {
 6678 |         let attempt = self
 6679 |             .attempt_record(&request.attempt_id, false)?
 6680 |             .ok_or_else(|| StoreError::NotFound {
 6681 |                 entity: "attempt",
 6682 |                 id: request.attempt_id.clone(),
 6683 |             })?;
 6684 |         if attempt.project_id != request.project_id || attempt.work_id != request.work_id {
 6685 |             return Err(StoreError::WrongSubject {
 6686 |                 expected: format!("{}/{}", request.project_id, request.work_id),
 6687 |                 actual: format!("{}/{}", attempt.project_id, attempt.work_id),
 6688 |             });
 6689 |         }
 6690 |         if attempt.fence != request.fence {
 6691 |             return Err(StoreError::StaleFence {
 6692 |                 expected: request.fence,
 6693 |                 actual: attempt.fence,
 6694 |             });
 6695 |         }
 6696 |         Ok(())
 6697 |     }
 6698 | 
 6699 |     fn finalize_close_rows(&self, request: &CloseIntentRequest) -> Result<(), StoreError> {
 6700 |         let mut intent = self.prepare(
 6701 |             "UPDATE close_intent SET state = 'finalized', finalized_at = ?1
 6702 |              WHERE close_intent_id = ?2 AND state = 'open'",
 6703 |         )?;
 6704 |         intent.bind_text(1, &request.at)?;
 6705 |         intent.bind_text(2, &request.close_intent_id)?;
````

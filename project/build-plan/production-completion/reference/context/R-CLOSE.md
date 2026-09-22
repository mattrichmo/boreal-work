# R-CLOSE — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L5760–L5905`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Accepted closeout writes must bind exact requirements, context, authority, intent and resulting operation/audit outcome.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '5760,5905p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 5760 |                     summary_id, state, created_at
 5761 |                  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11)",
 5762 |             )?;
 5763 |             statement.bind_text(1, &request.close_intent_id)?;
 5764 |             statement.bind_text(2, &request.work_id)?;
 5765 |             statement.bind_text(3, &request.attempt_id)?;
 5766 |             statement.bind_i64(4, request.fence)?;
 5767 |             statement.bind_text(5, &request.operation_id)?;
 5768 |             statement.bind_optional_text(6, request.source_version_id.as_deref())?;
 5769 |             statement.bind_text(7, &request.config_identity)?;
 5770 |             statement.bind_text(8, &request.profile_id)?;
 5771 |             statement.bind_i64(9, request.profile_version)?;
 5772 |             statement.bind_optional_text(10, request.summary_id.as_deref())?;
 5773 |             statement.bind_text(11, &request.at)?;
 5774 |             statement.run()?;
 5775 |             let revision = self.bump_revision_in_transaction(&request.project_id)?;
 5776 |             let result_json = close_intent_result_json(&request.close_intent_id, "open")?;
 5777 |             self.append_operation(&OperationRecord {
 5778 |                 operation_id: request.operation_id.clone(),
 5779 |                 project_id: request.project_id.clone(),
 5780 |                 command: "close.create".to_owned(),
 5781 |                 actor_id: request.actor_id.clone(),
 5782 |                 session_id: request.session_id.clone(),
 5783 |                 expected_revision: request.expected_project_revision,
 5784 |                 attempt_id: Some(request.attempt_id.clone()),
 5785 |                 fence: Some(request.fence),
 5786 |                 request_digest: request.request_digest.clone(),
 5787 |                 outcome: OperationOutcome::Changed,
 5788 |                 result_json: result_json.clone(),
 5789 |                 revision: revision.0,
 5790 |                 created_at: request.at.clone(),
 5791 |                 completed_at: Some(request.at.clone()),
 5792 |             })?;
 5793 |             self.append_audit_event(&AuditEventRecord {
 5794 |                 project_id: request.project_id.clone(),
 5795 |                 revision: revision.0,
 5796 |                 operation_id: request.operation_id.clone(),
 5797 |                 event_type: "close.requested".to_owned(),
 5798 |                 subject_type: "work".to_owned(),
 5799 |                 subject_id: request.work_id.clone(),
 5800 |                 actor_id: request.actor_id.clone(),
 5801 |                 session_id: request.session_id.clone(),
 5802 |                 fence: Some(request.fence),
 5803 |                 as_of: request.at.clone(),
 5804 |                 payload_json: result_json,
 5805 |             })?;
 5806 |             Ok(CloseIntentResult {
 5807 |                 close_intent: self
 5808 |                     .close_intent(&request.project_id, &request.close_intent_id)?
 5809 |                     .ok_or_else(|| {
 5810 |                         StoreError::Corrupt("close intent disappeared after insert".to_owned())
 5811 |                     })?,
 5812 |                 revision: revision.0,
 5813 |                 replayed: false,
 5814 |                 diagnostics: None,
 5815 |             })
 5816 |         })();
 5817 |         finish_transaction(self, result)
 5818 |     }
 5819 | 
 5820 |     pub fn request_close_intent(
 5821 |         &self,
 5822 |         request: impl Borrow<CloseIntentRequest>,
 5823 |     ) -> Result<CloseIntentResult, StoreError> {
 5824 |         self.create_close_intent(request)
 5825 |     }
 5826 | 
 5827 |     /// Finalizes a matching intent and closes the work atomically. If gates
 5828 |     /// are still open, the intent remains open and a rejected operation with
 5829 |     /// complete diagnostics is durably recorded for replay/readback.
 5830 |     pub fn finalize_close_intent(
 5831 |         &self,
 5832 |         request: impl Borrow<CloseIntentRequest>,
 5833 |     ) -> Result<CloseIntentResult, StoreError> {
 5834 |         let request = request.borrow();
 5835 |         if let Some(existing) = self.operation(&request.operation_id)? {
 5836 |             return self.replay_close_operation(request, &existing);
 5837 |         }
 5838 |         self.execute_batch("BEGIN IMMEDIATE")?;
 5839 |         let result = (|| {
 5840 |             if let Some(existing) = self.operation(&request.operation_id)? {
 5841 |                 return self.replay_close_operation(request, &existing);
 5842 |             }
 5843 |             check_expected_revision(
 5844 |                 self.project_revision(&request.project_id)?.0,
 5845 |                 request.expected_project_revision,
 5846 |             )?;
 5847 |             let intent = self
 5848 |                 .close_intent(&request.project_id, &request.close_intent_id)?
 5849 |                 .ok_or_else(|| StoreError::NotFound {
 5850 |                     entity: "close intent",
 5851 |                     id: request.close_intent_id.clone(),
 5852 |                 })?;
 5853 |             validate_close_intent_match(request, &intent)?;
 5854 |             if intent.state != CloseIntentState::Open {
 5855 |                 return Err(StoreError::Conflict(format!(
 5856 |                     "close intent is not open: {:?}",
 5857 |                     intent.state
 5858 |                 )));
 5859 |             }
 5860 |             self.validate_close_subject(request)?;
 5861 |             let mut diagnostics = self.gate_diagnostics(
 5862 |                 &request.project_id,
 5863 |                 &request.work_id,
 5864 |                 &request.attempt_id,
 5865 |                 request.fence,
 5866 |             )?;
 5867 |             let attempt = self
 5868 |                 .attempt_record(&request.attempt_id, false)?
 5869 |                 .ok_or_else(|| StoreError::NotFound {
 5870 |                     entity: "attempt",
 5871 |                     id: request.attempt_id.clone(),
 5872 |                 })?;
 5873 |             if !attempt.current || !matches!(attempt.phase, AttemptPhase::Verifying) {
 5874 |                 diagnostics.missing.push("attempt_not_verifying".to_owned());
 5875 |                 diagnostics.missing.sort();
 5876 |                 diagnostics.missing.dedup();
 5877 |             }
 5878 |             if self.summary_required(&request.project_id, &request.work_id)?
 5879 |                 && !self.current_summary_matches_close(request, &attempt)?
 5880 |             {
 5881 |                 diagnostics.missing.push("summary".to_owned());
 5882 |                 diagnostics.missing.sort();
 5883 |                 diagnostics.missing.dedup();
 5884 |             }
 5885 |             if !diagnostics.missing.is_empty() {
 5886 |                 let revision = self.bump_revision_in_transaction(&request.project_id)?;
 5887 |                 let result_json =
 5888 |                     close_rejected_result_json(&request.close_intent_id, &diagnostics.missing)?;
 5889 |                 self.append_operation(&OperationRecord {
 5890 |                     operation_id: request.operation_id.clone(),
 5891 |                     project_id: request.project_id.clone(),
 5892 |                     command: "close.finalize".to_owned(),
 5893 |                     actor_id: request.actor_id.clone(),
 5894 |                     session_id: request.session_id.clone(),
 5895 |                     expected_revision: request.expected_project_revision,
 5896 |                     attempt_id: Some(request.attempt_id.clone()),
 5897 |                     fence: Some(request.fence),
 5898 |                     request_digest: request.request_digest.clone(),
 5899 |                     outcome: OperationOutcome::Rejected,
 5900 |                     result_json: result_json.clone(),
 5901 |                     revision: revision.0,
 5902 |                     created_at: request.at.clone(),
 5903 |                     completed_at: Some(request.at.clone()),
 5904 |                 })?;
 5905 |                 self.append_audit_event(&AuditEventRecord {
````

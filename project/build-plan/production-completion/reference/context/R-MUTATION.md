# R-MUTATION — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L3690–L3830`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Attempt mutation checks; inspect revision/fence interpretation and legal action-specific policy inside the transaction.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '3690,3830p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 3690 |         match statement.step()? {
 3691 |             SQLITE_ROW => self.attempt_record(&statement.column_text(0)?, true),
 3692 |             SQLITE_DONE => Ok(None),
 3693 |             _ => unreachable!(),
 3694 |         }
 3695 |     }
 3696 | 
 3697 |     /// Reads the one current attempt owned by a session in a project. This is
 3698 |     /// deliberately an exact indexed lookup rather than a bounded work scan.
 3699 |     pub fn current_attempt_for_session(
 3700 |         &self,
 3701 |         project_id: &str,
 3702 |         session_id: &str,
 3703 |     ) -> Result<Option<AttemptRecord>, StoreError> {
 3704 |         let mut statement = self.prepare(
 3705 |             "SELECT a.attempt_id
 3706 |              FROM attempt a
 3707 |              JOIN work_item wi ON wi.work_id = a.work_id
 3708 |              WHERE wi.project_id = ?1 AND a.session_id = ?2 AND a.current = 1
 3709 |              LIMIT 1",
 3710 |         )?;
 3711 |         statement.bind_text(1, project_id)?;
 3712 |         statement.bind_text(2, session_id)?;
 3713 |         match statement.step()? {
 3714 |             SQLITE_ROW => self.attempt_record(&statement.column_text(0)?, true),
 3715 |             SQLITE_DONE => Ok(None),
 3716 |             _ => unreachable!(),
 3717 |         }
 3718 |     }
 3719 | 
 3720 |     /// Applies one fenced attempt mutation in a short `BEGIN IMMEDIATE`
 3721 |     /// transaction. The attempt row, reservation projection, project
 3722 |     /// revision, operation receipt, and audit event commit or roll back as a
 3723 |     /// unit.
 3724 |     pub fn apply_attempt_mutation(
 3725 |         &self,
 3726 |         request: impl Borrow<AttemptMutationRequest>,
 3727 |     ) -> Result<AttemptMutationResult, StoreError> {
 3728 |         let request = request.borrow();
 3729 |         self.execute_batch("BEGIN IMMEDIATE")?;
 3730 |         let result = (|| {
 3731 |             if let Some(existing) = self.operation(&request.operation_id)? {
 3732 |                 return self.replay_attempt_operation(request, &existing);
 3733 |             }
 3734 | 
 3735 |             let actual_revision = self.project_revision(&request.project_id)?.0;
 3736 |             for expected in [
 3737 |                 request.expected_project_revision,
 3738 |                 request.expected_work_revision,
 3739 |             ]
 3740 |             .into_iter()
 3741 |             .flatten()
 3742 |             {
 3743 |                 if expected != actual_revision {
 3744 |                     return Err(StoreError::StaleRevision {
 3745 |                         expected,
 3746 |                         actual: actual_revision,
 3747 |                     });
 3748 |                 }
 3749 |             }
 3750 |             let current = self
 3751 |                 .attempt_record(&request.attempt_id, false)?
 3752 |                 .ok_or_else(|| StoreError::NotFound {
 3753 |                     entity: "attempt",
 3754 |                     id: request.attempt_id.clone(),
 3755 |                 })?;
 3756 |             self.validate_attempt_subject(request, &current)?;
 3757 |             if current.fence != request.fence {
 3758 |                 return Err(StoreError::StaleFence {
 3759 |                     expected: request.fence,
 3760 |                     actual: current.fence,
 3761 |                 });
 3762 |             }
 3763 |             if let Some(expected) = request.expected_attempt_revision {
 3764 |                 if expected != current.fence {
 3765 |                     return Err(StoreError::StaleFence {
 3766 |                         expected,
 3767 |                         actual: current.fence,
 3768 |                     });
 3769 |                 }
 3770 |             }
 3771 |             if !current.current {
 3772 |                 return Err(StoreError::NotCurrent {
 3773 |                     attempt_id: request.attempt_id.clone(),
 3774 |                 });
 3775 |             }
 3776 |             if let Some(expected) = request.expected_phase {
 3777 |                 if expected != current.phase {
 3778 |                     return Err(StoreError::Conflict(format!(
 3779 |                         "attempt phase changed: expected {expected:?}, actual {:?}",
 3780 |                         current.phase
 3781 |                     )));
 3782 |                 }
 3783 |             }
 3784 |             if let Some(expected) = request.expected_lease_deadline.as_deref() {
 3785 |                 if expected != current.lease_deadline {
 3786 |                     return Err(StoreError::Conflict(format!(
 3787 |                         "lease deadline changed: expected {expected}, actual {}",
 3788 |                         current.lease_deadline
 3789 |                     )));
 3790 |                 }
 3791 |             }
 3792 |             if let Some(expected) = request.expected_hard_deadline.as_deref() {
 3793 |                 if expected != current.hard_deadline {
 3794 |                     return Err(StoreError::Conflict(format!(
 3795 |                         "hard deadline changed: expected {expected}, actual {}",
 3796 |                         current.hard_deadline
 3797 |                     )));
 3798 |                 }
 3799 |             }
 3800 | 
 3801 |             let permits_expired_time = matches!(
 3802 |                 request.mutation,
 3803 |                 AttemptMutationKind::Expire { .. } | AttemptMutationKind::Cancel { .. }
 3804 |             );
 3805 |             if !permits_expired_time {
 3806 |                 if timestamp_cmp(&request.at, &current.hard_deadline) != std::cmp::Ordering::Less {
 3807 |                     return Err(StoreError::HardDeadlineElapsed);
 3808 |                 }
 3809 |                 if timestamp_cmp(&request.at, &current.lease_deadline) != std::cmp::Ordering::Less {
 3810 |                     return Err(StoreError::LeaseExpired);
 3811 |                 }
 3812 |             }
 3813 | 
 3814 |             let (_, event_type) = self.apply_attempt_row(request, &current)?;
 3815 |             let updated = self
 3816 |                 .attempt_record(&request.attempt_id, false)?
 3817 |                 .ok_or_else(|| {
 3818 |                     StoreError::Corrupt("attempt disappeared during mutation".to_owned())
 3819 |                 })?;
 3820 |             let revision = self.bump_revision_in_transaction(&request.project_id)?;
 3821 |             let result_json = attempt_result_json(
 3822 |                 &request.attempt_id,
 3823 |                 request.fence,
 3824 |                 updated.phase,
 3825 |                 &updated.lease_deadline,
 3826 |                 &updated.hard_deadline,
 3827 |             )?;
 3828 |             let operation = OperationRecord {
 3829 |                 operation_id: request.operation_id.clone(),
 3830 |                 project_id: request.project_id.clone(),
````

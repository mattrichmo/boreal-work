# R-EXPIRY-GAP — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L4110–L4210`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Attempt termination/current-pointer and reservation updates; durable unresolved recovery must outlive current ownership.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '4110,4210p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 4110 |                     operation,
 4111 |                 })
 4112 |             }
 4113 |         };
 4114 | 
 4115 |         match &request.mutation {
 4116 |             AttemptMutationKind::Accept => {
 4117 |                 let mut statement = self.prepare(
 4118 |                     "UPDATE attempt
 4119 |                      SET state = 'accepted', accepted_at = ?1,
 4120 |                          harness_id = COALESCE(harness_id, ?2),
 4121 |                          session_id = COALESCE(session_id, ?3)
 4122 |                      WHERE attempt_id = ?4 AND current = 1",
 4123 |                 )?;
 4124 |                 statement.bind_text(1, &request.at)?;
 4125 |                 statement.bind_optional_text(2, request.harness_id.as_deref())?;
 4126 |                 statement.bind_optional_text(3, request.session_id.as_deref())?;
 4127 |                 statement.bind_text(4, &request.attempt_id)?;
 4128 |                 statement.run()?;
 4129 |             }
 4130 |             AttemptMutationKind::Start | AttemptMutationKind::Submit => {
 4131 |                 let state = phase_name(phase);
 4132 |                 let mut statement = self.prepare(
 4133 |                     "UPDATE attempt SET state = ?1 WHERE attempt_id = ?2 AND current = 1",
 4134 |                 )?;
 4135 |                 statement.bind_text(1, state)?;
 4136 |                 statement.bind_text(2, &request.attempt_id)?;
 4137 |                 statement.run()?;
 4138 |             }
 4139 |             AttemptMutationKind::Heartbeat { .. } => {
 4140 |                 let mut statement = self.prepare(
 4141 |                     "UPDATE attempt SET last_heartbeat_at = ?1
 4142 |                      WHERE attempt_id = ?2 AND current = 1",
 4143 |                 )?;
 4144 |                 statement.bind_text(1, &request.at)?;
 4145 |                 statement.bind_text(2, &request.attempt_id)?;
 4146 |                 statement.run()?;
 4147 |             }
 4148 |             AttemptMutationKind::RenewLease { lease_deadline } => {
 4149 |                 let mut statement = self.prepare(
 4150 |                     "UPDATE attempt SET lease_deadline = ?1
 4151 |                      WHERE attempt_id = ?2 AND current = 1",
 4152 |                 )?;
 4153 |                 statement.bind_text(1, lease_deadline)?;
 4154 |                 statement.bind_text(2, &request.attempt_id)?;
 4155 |                 statement.run()?;
 4156 |             }
 4157 |             AttemptMutationKind::Release
 4158 |             | AttemptMutationKind::Fail
 4159 |             | AttemptMutationKind::Expire { .. }
 4160 |             | AttemptMutationKind::Cancel { .. } => {
 4161 |                 let reason = request.reason.as_deref().unwrap_or(operation);
 4162 |                 let mut statement = self.prepare(
 4163 |                     "UPDATE attempt
 4164 |                      SET current = 0, state = ?1, terminal_at = ?2,
 4165 |                          terminal_reason = ?3
 4166 |                      WHERE attempt_id = ?4 AND current = 1",
 4167 |                 )?;
 4168 |                 statement.bind_text(1, phase_name(phase))?;
 4169 |                 statement.bind_text(2, &request.at)?;
 4170 |                 statement.bind_text(3, reason)?;
 4171 |                 statement.bind_text(4, &request.attempt_id)?;
 4172 |                 statement.run()?;
 4173 | 
 4174 |                 let reservation_state = if phase == AttemptPhase::Expired {
 4175 |                     "expired"
 4176 |                 } else {
 4177 |                     "released"
 4178 |                 };
 4179 |                 let mut reservation = self.prepare(
 4180 |                     "UPDATE reservation
 4181 |                      SET state = ?1, released_at = ?2
 4182 |                      WHERE attempt_id = ?3 AND state = 'active'",
 4183 |                 )?;
 4184 |                 reservation.bind_text(1, reservation_state)?;
 4185 |                 reservation.bind_text(2, &request.at)?;
 4186 |                 reservation.bind_text(3, &request.attempt_id)?;
 4187 |                 reservation.run()?;
 4188 |             }
 4189 |         }
 4190 |         Ok((phase, event_type(&request.mutation)))
 4191 |     }
 4192 | 
 4193 |     fn attempt_record(
 4194 |         &self,
 4195 |         attempt_id: &str,
 4196 |         current_only: bool,
 4197 |     ) -> Result<Option<AttemptRecord>, StoreError> {
 4198 |         let suffix = if current_only {
 4199 |             " AND a.current = 1"
 4200 |         } else {
 4201 |             ""
 4202 |         };
 4203 |         let sql = format!(
 4204 |             "SELECT wi.project_id, a.work_id, a.attempt_id, a.actor_id,
 4205 |                     a.harness_id, a.session_id, a.fence, a.current, a.state,
 4206 |                     a.claimed_at, a.accepted_at, a.lease_deadline,
 4207 |                     a.max_attempt_deadline, a.last_heartbeat_at,
 4208 |                     a.last_checkpoint_at, a.review_required_after_expiry,
 4209 |                     a.stop_requested_at, a.stop_acknowledged_at, a.terminal_at,
 4210 |                     a.terminal_reason, a.source_version_id, a.config_identity,
````

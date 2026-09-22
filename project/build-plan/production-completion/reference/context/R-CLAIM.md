# R-CLAIM — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L3160–L3305`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Canonical claim snapshot/evaluator under the write transaction; candidate must be proven under races and fresh source.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '3160,3305p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 3160 |             "unknown",
 3161 |         )
 3162 |     }
 3163 | 
 3164 |     /// Claim an eligible work item while freezing the source/configuration
 3165 |     /// context that later witnessed evidence must match.
 3166 |     #[allow(clippy::too_many_arguments)]
 3167 |     pub fn claim_work_with_context(
 3168 |         &self,
 3169 |         project_id: &str,
 3170 |         work_id: &str,
 3171 |         actor_id: &str,
 3172 |         harness_id: &str,
 3173 |         session_id: Option<&str>,
 3174 |         attempt_id: &str,
 3175 |         operation_id: &str,
 3176 |         request_digest: &str,
 3177 |         expected_revision: Option<u64>,
 3178 |         claimed_at: &str,
 3179 |         lease_deadline: &str,
 3180 |         max_attempt_deadline: &str,
 3181 |         source_version_id: Option<&str>,
 3182 |         config_identity: &str,
 3183 |     ) -> Result<ClaimResult, StoreError> {
 3184 |         if let Some(existing) = self.operation(operation_id)? {
 3185 |             return self.replay_claim(
 3186 |                 project_id,
 3187 |                 work_id,
 3188 |                 actor_id,
 3189 |                 harness_id,
 3190 |                 session_id,
 3191 |                 request_digest,
 3192 |                 &existing,
 3193 |             );
 3194 |         }
 3195 | 
 3196 |         self.execute_batch("BEGIN IMMEDIATE")?;
 3197 |         let result = (|| {
 3198 |             // Re-read the operation after acquiring the write lock. This closes
 3199 |             // the race where two retries both observed a missing operation.
 3200 |             if let Some(existing) = self.operation(operation_id)? {
 3201 |                 return self.replay_claim(
 3202 |                     project_id,
 3203 |                     work_id,
 3204 |                     actor_id,
 3205 |                     harness_id,
 3206 |                     session_id,
 3207 |                     request_digest,
 3208 |                     &existing,
 3209 |                 );
 3210 |             }
 3211 |             let current_revision = self.project_revision(project_id)?.0;
 3212 |             if let Some(expected) = expected_revision {
 3213 |                 if expected != current_revision {
 3214 |                     return Err(StoreError::StaleRevision {
 3215 |                         expected,
 3216 |                         actual: current_revision,
 3217 |                     });
 3218 |                 }
 3219 |             }
 3220 | 
 3221 |             if let Some(session_id) = session_id {
 3222 |                 self.session_for_claim(project_id, session_id, actor_id, harness_id)?;
 3223 |             }
 3224 | 
 3225 |             let claimed_at_ms = status_evaluation::canonical_status_timestamp(claimed_at)?;
 3226 |             let lease_at_ms = status_evaluation::canonical_status_timestamp(lease_deadline)?;
 3227 |             let hard_at_ms = status_evaluation::canonical_status_timestamp(max_attempt_deadline)?;
 3228 |             if lease_at_ms <= claimed_at_ms || hard_at_ms <= claimed_at_ms {
 3229 |                 return Err(StoreError::Invalid(
 3230 |                     "claim deadlines must be strictly after claimed_at".to_owned(),
 3231 |                 ));
 3232 |             }
 3233 |             let decision =
 3234 |                 self.status_decision_in_transaction(project_id, work_id, actor_id, claimed_at_ms)?;
 3235 |             if !decision.claimable_for_actor {
 3236 |                 return Err(StoreError::Conflict(format!(
 3237 |                     "not_claimable: {}",
 3238 |                     decision.primary_reason.stable_code()
 3239 |                 )));
 3240 |             }
 3241 | 
 3242 |             let fence = self.next_fence(work_id)?;
 3243 |             let mut attempt = self.prepare(
 3244 |                 "INSERT INTO attempt
 3245 |                 (attempt_id, work_id, actor_id, harness_id, session_id, fence, current, state,
 3246 |                   claimed_at, lease_deadline, max_attempt_deadline, source_version_id, config_identity,
 3247 |                   binary_identity, protocol_version, schema_version)
 3248 |                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'claimed', ?7, ?8, ?9,
 3249 |                          ?10, ?11, 'unknown', 'boreal.protocol.envelope.v1', 2)",
 3250 |             )?;
 3251 |             attempt.bind_text(1, attempt_id)?;
 3252 |             attempt.bind_text(2, work_id)?;
 3253 |             attempt.bind_text(3, actor_id)?;
 3254 |             attempt.bind_text(4, harness_id)?;
 3255 |             attempt.bind_optional_text(5, session_id)?;
 3256 |             attempt.bind_i64(6, fence)?;
 3257 |             attempt.bind_text(7, claimed_at)?;
 3258 |             attempt.bind_text(8, lease_deadline)?;
 3259 |             attempt.bind_text(9, max_attempt_deadline)?;
 3260 |             attempt.bind_optional_text(10, source_version_id)?;
 3261 |             attempt.bind_text(11, config_identity)?;
 3262 |             attempt.run()?;
 3263 | 
 3264 |             let reservation_id = format!("reservation:{attempt_id}");
 3265 |             let mut reservation = self.prepare(
 3266 |                 "INSERT INTO reservation
 3267 |                  (reservation_id, work_id, attempt_id, fence, state, lease_deadline)
 3268 |                  VALUES (?1, ?2, ?3, ?4, 'active', ?5)",
 3269 |             )?;
 3270 |             reservation.bind_text(1, &reservation_id)?;
 3271 |             reservation.bind_text(2, work_id)?;
 3272 |             reservation.bind_text(3, attempt_id)?;
 3273 |             reservation.bind_i64(4, fence)?;
 3274 |             reservation.bind_text(5, lease_deadline)?;
 3275 |             reservation.run()?;
 3276 | 
 3277 |             let revision = self.bump_revision_in_transaction(project_id)?;
 3278 |             let operation = OperationRecord {
 3279 |                 operation_id: operation_id.to_owned(),
 3280 |                 project_id: project_id.to_owned(),
 3281 |                 command: "work.claim".to_owned(),
 3282 |                 actor_id: actor_id.to_owned(),
 3283 |                 session_id: session_id.map(str::to_owned),
 3284 |                 expected_revision,
 3285 |                 attempt_id: Some(attempt_id.to_owned()),
 3286 |                 fence: Some(fence),
 3287 |                 request_digest: request_digest.to_owned(),
 3288 |                 outcome: OperationOutcome::Changed,
 3289 |                 result_json: json_object(json!({
 3290 |                     "attempt_id": attempt_id,
 3291 |                     "fence": fence,
 3292 |                 }))?,
 3293 |                 revision: revision.0,
 3294 |                 created_at: claimed_at.to_owned(),
 3295 |                 completed_at: Some(claimed_at.to_owned()),
 3296 |             };
 3297 |             self.append_operation(&operation)?;
 3298 |             self.append_audit_event(&AuditEventRecord {
 3299 |                 project_id: project_id.to_owned(),
 3300 |                 revision: revision.0,
 3301 |                 operation_id: operation_id.to_owned(),
 3302 |                 event_type: "attempt.claimed".to_owned(),
 3303 |                 subject_type: "attempt".to_owned(),
 3304 |                 subject_id: attempt_id.to_owned(),
 3305 |                 actor_id: actor_id.to_owned(),
````

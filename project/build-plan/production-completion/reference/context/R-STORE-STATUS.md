# R-STORE-STATUS — crates/store/src/status_evaluation.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/status_evaluation.rs:L1–L240`  
**File SHA-256:** `472fa14deae85b34ff5c0d213370bbabc9002380e04835693c2476cd003a871d`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Store-side snapshot conversion and domain status handoff; one source of decoded canonical facts.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,240p' 'crates/store/src/status_evaluation.rs'
```

## Exact baseline excerpt

````text
    1 | //! Canonical snapshot decoding shared by status reads and claim authorization.
    2 | //! All status policy remains in boreal_domain::evaluate_status. No SQL WHERE
    3 | //! clause, adapter, or persisted display field decides eligibility here.
    4 | use super::*;
    5 | use boreal_domain::{
    6 |     evaluate_status, ActorContext, ActorId, ActorRole, Attempt, DeadlineSource, Fence, Revision,
    7 |     StatusContext, StatusDecision, TimestampMs,
    8 | };
    9 | 
   10 | pub(crate) fn canonical_status_timestamp(value: &str) -> Result<TimestampMs, StoreError> {
   11 |     let digits = value
   12 |         .strip_prefix("unix-ms:")
   13 |         .filter(|digits| !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()));
   14 |     digits
   15 |         .and_then(|digits| digits.parse::<u64>().ok())
   16 |         .map(TimestampMs)
   17 |         .ok_or_else(|| StoreError::Corrupt(format!("invalid canonical timestamp: {value}")))
   18 | }
   19 | 
   20 | impl StatusWorkRecord {
   21 |     pub fn status_retry_not_before(&self) -> Result<Option<TimestampMs>, StoreError> {
   22 |         self.retry_not_before
   23 |             .as_deref()
   24 |             .map(canonical_status_timestamp)
   25 |             .transpose()
   26 |     }
   27 | 
   28 |     /// Decode canonical attempt clocks once, identically for readers/writers.
   29 |     /// Historical tN/RFC3339 strings are not silently compared lexicographically.
   30 |     pub fn status_attempt(&self) -> Result<Option<Attempt>, StoreError> {
   31 |         self.current_attempt
   32 |             .as_ref()
   33 |             .map(|attempt| {
   34 |                 Ok(Attempt {
   35 |                     work_id: attempt.work_id.clone().into(),
   36 |                     attempt_id: attempt.attempt_id.clone().into(),
   37 |                     actor_id: attempt.actor_id.clone().into(),
   38 |                     harness_id: attempt.harness_id.clone().map(Into::into),
   39 |                     session_id: attempt.session_id.clone().map(Into::into),
   40 |                     fence: Fence::new(attempt.fence),
   41 |                     phase: attempt.phase,
   42 |                     claimed_at: canonical_status_timestamp(&attempt.claimed_at)?,
   43 |                     accepted_at: attempt
   44 |                         .accepted_at
   45 |                         .as_deref()
   46 |                         .map(canonical_status_timestamp)
   47 |                         .transpose()?,
   48 |                     lease_deadline: canonical_status_timestamp(&attempt.lease_deadline)?,
   49 |                     max_attempt_deadline: canonical_status_timestamp(&attempt.hard_deadline)?,
   50 |                     deadline_source: DeadlineSource::Explicit,
   51 |                     last_heartbeat_at: attempt
   52 |                         .last_heartbeat_at
   53 |                         .as_deref()
   54 |                         .map(canonical_status_timestamp)
   55 |                         .transpose()?,
   56 |                     last_checkpoint_at: attempt
   57 |                         .last_checkpoint_at
   58 |                         .as_deref()
   59 |                         .map(canonical_status_timestamp)
   60 |                         .transpose()?,
   61 |                     review_required_after_expiry: attempt.review_required_after_expiry,
   62 |                 })
   63 |             })
   64 |             .transpose()
   65 |     }
   66 | }
   67 | 
   68 | impl SqliteStore {
   69 |     /// Role comes from durable authority, never from a caller-supplied role flag.
   70 |     pub fn actor_context(&self, actor_id: &str) -> Result<ActorContext, StoreError> {
   71 |         let mut row = self.prepare("SELECT role FROM actor WHERE actor_id = ?1")?;
   72 |         row.bind_text(1, actor_id)?;
   73 |         if row.step()? != SQLITE_ROW {
   74 |             return Err(StoreError::NotFound {
   75 |                 entity: "actor",
   76 |                 id: actor_id.to_owned(),
   77 |             });
   78 |         }
   79 |         let role = match row.column_text(0)?.as_str() {
   80 |             "agent" => ActorRole::Agent,
   81 |             "reviewer" => ActorRole::Reviewer,
   82 |             "operator" => ActorRole::Operator,
   83 |             "publisher" => ActorRole::Publisher,
   84 |             role => return Err(StoreError::Corrupt(format!("invalid actor role: {role}"))),
   85 |         };
   86 |         Ok(ActorContext {
   87 |             actor_id: ActorId::new(actor_id),
   88 |             role,
   89 |         })
   90 |     }
   91 | 
   92 |     /// Freeze work, graph, attempt, gate and actor policy in the same read.
   93 |     pub fn read_project_status_for_actor(
   94 |         &self,
   95 |         project_id: &str,
   96 |         actor_id: &str,
   97 |     ) -> Result<(ProjectStatusRead, ActorContext), StoreError> {
   98 |         self.execute_batch("BEGIN")?;
   99 |         let result = (|| {
  100 |             let actor = self.actor_context(actor_id)?;
  101 |             let snapshot = self.read_project_status_in_transaction(project_id)?;
  102 |             Ok((snapshot, actor))
  103 |         })();
  104 |         finish_transaction(self, result)
  105 |     }
  106 | 
  107 |     /// Caller must hold the write transaction. This does not open a nested
  108 |     /// transaction or use a previously displayed (possibly stale) decision.
  109 |     pub(crate) fn status_decision_in_transaction(
  110 |         &self,
  111 |         project_id: &str,
  112 |         work_id: &str,
  113 |         actor_id: &str,
  114 |         as_of: TimestampMs,
  115 |     ) -> Result<StatusDecision, StoreError> {
  116 |         let actor = self.actor_context(actor_id)?;
  117 |         let snapshot = self.read_project_status_in_transaction(project_id)?;
  118 |         let row = snapshot
  119 |             .works
  120 |             .iter()
  121 |             .find(|row| row.work.id.as_str() == work_id)
  122 |             .ok_or_else(|| {
  123 |                 StoreError::Conflict(format!(
  124 |                     "not_claimable: work {work_id} is absent, foreign, or corrupt"
  125 |                 ))
  126 |             })?;
  127 |         let prerequisites = snapshot
  128 |             .dependencies
  129 |             .iter()
  130 |             .filter(|edge| edge.dependent_id == row.work.id)
  131 |             .filter_map(|edge| {
  132 |                 snapshot
  133 |                     .works
  134 |                     .iter()
  135 |                     .find(|item| item.work.id == edge.prerequisite_id)
  136 |             })
  137 |             .map(|item| item.work.clone())
  138 |             .collect::<Vec<_>>();
  139 |         let dependents = snapshot
  140 |             .dependencies
  141 |             .iter()
  142 |             .filter(|edge| edge.prerequisite_id == row.work.id)
  143 |             .map(|edge| edge.dependent_id.clone())
  144 |             .collect::<Vec<_>>();
  145 |         let attempt = row.status_attempt()?;
  146 |         Ok(evaluate_status(StatusContext {
  147 |             work: &row.work,
  148 |             prerequisites: &prerequisites,
  149 |             current_attempt: attempt.as_ref(),
  150 |             gates: &row.work.acceptance_profile.gates,
  151 |             actor: &actor,
  152 |             as_of,
  153 |             project_revision: Revision(snapshot.revision.0),
  154 |             retry_not_before: row.status_retry_not_before()?,
  155 |             affected_dependents: &dependents,
  156 |         }))
  157 |     }
  158 | }
  159 | 
  160 | /// Quarantine corrupt canonical inputs without removing healthy siblings.
  161 | /// Broken endpoints are hard reasons on their dependent, never a dropped edge
  162 | /// that accidentally makes the dependent ready. This function never persists
  163 | /// a repair, a replacement record, or a display status.
  164 | pub(crate) fn diagnose_status_integrity(snapshot: &mut ProjectStatusRead) {
  165 |     let mut valid = Vec::with_capacity(snapshot.works.len());
  166 |     for mut row in std::mem::take(&mut snapshot.works) {
  167 |         let clocks = row
  168 |             .status_retry_not_before()
  169 |             .and_then(|_| row.status_attempt());
  170 |         match clocks {
  171 |             Err(error) => snapshot.diagnostics.push(StatusRecordDiagnostic {
  172 |                 work_id: row.work.id.to_string(),
  173 |                 title: Some(row.work.title.clone()),
  174 |                 code: "invalid_status_clock".to_owned(),
  175 |                 detail: error.to_string(),
  176 |             }),
  177 |             Ok(_) => {
  178 |                 if row.current_attempt.as_ref().is_some_and(|attempt| {
  179 |                     matches!(
  180 |                         attempt.phase,
  181 |                         AttemptPhase::Failed | AttemptPhase::Released | AttemptPhase::Cancelled
  182 |                     )
  183 |                 }) {
  184 |                     row.work
  185 |                         .hard_holds
  186 |                         .push(ReasonCode::HardHold("invalid_current_attempt".to_owned()));
  187 |                     snapshot.diagnostics.push(StatusRecordDiagnostic {
  188 |                         work_id: row.work.id.to_string(),
  189 |                         title: Some(row.work.title.clone()),
  190 |                         code: "invalid_current_attempt".to_owned(),
  191 |                         detail: "terminal historical attempt is still marked current; use an explicit repair".to_owned(),
  192 |                     });
  193 |                 }
  194 |                 valid.push(row);
  195 |             }
  196 |         }
  197 |     }
  198 |     let items = valid
  199 |         .iter()
  200 |         .map(|row| (row.work.id.clone(), row.work.clone()))
  201 |         .collect::<BTreeMap<_, _>>();
  202 |     for row in &mut valid {
  203 |         let parent = row.work.parent_id.as_ref().and_then(|id| items.get(id));
  204 |         let missing_parent = row.work.parent_id.is_some() && parent.is_none();
  205 |         if missing_parent || boreal_domain::validate_parent(&row.work, parent).is_err() {
  206 |             row.work
  207 |                 .hard_holds
  208 |                 .push(ReasonCode::HardHold("invalid_parent".to_owned()));
  209 |             snapshot.diagnostics.push(StatusRecordDiagnostic {
  210 |                 work_id: row.work.id.to_string(),
  211 |                 title: Some(row.work.title.clone()),
  212 |                 code: "invalid_parent".to_owned(),
  213 |                 detail: "parent is absent, foreign, corrupt, or has an incompatible kind"
  214 |                     .to_owned(),
  215 |             });
  216 |         }
  217 |         for edge in snapshot
  218 |             .dependencies
  219 |             .iter()
  220 |             .filter(|edge| edge.dependent_id == row.work.id)
  221 |         {
  222 |             if !items.contains_key(&edge.prerequisite_id) {
  223 |                 row.work.hard_holds.push(ReasonCode::HardHold(format!(
  224 |                     "orphaned_dependency({})",
  225 |                     edge.prerequisite_id
  226 |                 )));
  227 |                 snapshot.diagnostics.push(StatusRecordDiagnostic {
  228 |                     work_id: row.work.id.to_string(),
  229 |                     title: Some(row.work.title.clone()),
  230 |                     code: "orphaned_dependency".to_owned(),
  231 |                     detail: format!(
  232 |                         "prerequisite {} is absent, foreign, or corrupt",
  233 |                         edge.prerequisite_id
  234 |                     ),
  235 |                 });
  236 |             }
  237 |         }
  238 |     }
  239 |     snapshot.works = valid;
  240 | }
````

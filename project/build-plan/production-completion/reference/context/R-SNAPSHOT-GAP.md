# R-SNAPSHOT-GAP — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L3003–L3100`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Shared project snapshot eagerly preloads relations and reconstructs profile requirements from gate diagnostics.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '3003,3100p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 3003 |     // Used by both read transactions and the canonical claim write transaction.
 3004 |     // The caller owns the transaction boundary; never open a nested BEGIN here.
 3005 |     fn read_project_status_in_transaction(
 3006 |         &self,
 3007 |         project_id: &str,
 3008 |     ) -> Result<ProjectStatusRead, StoreError> {
 3009 |         let revision = self.project_revision(project_id)?;
 3010 |         let mut count = self.prepare("SELECT COUNT(*) FROM work_item WHERE project_id = ?1")?;
 3011 |         count.bind_text(1, project_id)?;
 3012 |         let total = match count.step()? {
 3013 |             SQLITE_ROW => count.column_u64(0)?,
 3014 |             _ => return Err(StoreError::Corrupt("missing work total".to_owned())),
 3015 |         };
 3016 | 
 3017 |         // These two relations are independent of each work row. Fetching
 3018 |         // them once keeps the canonical read consistent while removing
 3019 |         // two avoidable N+1 query families from large status snapshots.
 3020 |         let current_attempts = self.current_attempts_for_project(project_id)?;
 3021 |         let active_holds = self.active_hard_holds_for_project(project_id)?;
 3022 |         let gate_diagnostics =
 3023 |             self.status_gate_diagnostics_for_project(project_id, &current_attempts, revision.0)?;
 3024 | 
 3025 |         let mut rows = self.prepare(
 3026 |             "SELECT work_id, project_id, kind, parent_id, lifecycle,
 3027 |                     dispatch_policy, retry_not_before, priority,
 3028 |                     acceptance_profile_id, acceptance_profile_version,
 3029 |                     title, description
 3030 |              FROM work_item WHERE project_id = ?1 ORDER BY work_id",
 3031 |         )?;
 3032 |         rows.bind_text(1, project_id)?;
 3033 |         let mut works = Vec::with_capacity(total as usize);
 3034 |         let mut record_diagnostics = Vec::new();
 3035 |         while rows.step()? == SQLITE_ROW {
 3036 |             let work_id = rows.column_text(0)?;
 3037 |             let current_attempt = current_attempts.get(&work_id).cloned();
 3038 |             let diagnostics =
 3039 |                 gate_diagnostics
 3040 |                     .get(&work_id)
 3041 |                     .cloned()
 3042 |                     .unwrap_or_else(|| GateDiagnostics {
 3043 |                         project_id: project_id.to_owned(),
 3044 |                         work_id: work_id.clone(),
 3045 |                         attempt_id: current_attempt
 3046 |                             .as_ref()
 3047 |                             .map(|attempt| attempt.attempt_id.clone()),
 3048 |                         fence: current_attempt.as_ref().map(|attempt| attempt.fence),
 3049 |                         revision: revision.0,
 3050 |                         gates: Vec::new(),
 3051 |                         missing: Vec::new(),
 3052 |                     });
 3053 |             let gates = diagnostics
 3054 |                 .gates
 3055 |                 .iter()
 3056 |                 .map(|gate| GateRequirement {
 3057 |                     id: gate.gate_id.clone().into(),
 3058 |                     kind: gate.kind,
 3059 |                     required: gate.required,
 3060 |                     state: gate.state,
 3061 |                 })
 3062 |                 .collect();
 3063 |             let title = rows.column_text(10).ok();
 3064 |             let work = (|| {
 3065 |                 Ok::<WorkItem, StoreError>(WorkItem {
 3066 |                     id: WorkId::new(work_id.clone()),
 3067 |                     project_id: ProjectId::new(rows.column_text(1)?),
 3068 |                     kind: parse_work_kind(&rows.column_text(2)?)?,
 3069 |                     parent_id: rows.column_optional_text(3)?.map(WorkId::new),
 3070 |                     title: rows.column_text(10)?,
 3071 |                     description: rows.column_text(11)?,
 3072 |                     lifecycle: parse_lifecycle(&rows.column_text(4)?)?,
 3073 |                     priority: u8::try_from(rows.column_u64(7)?).map_err(|_| {
 3074 |                         StoreError::Corrupt(format!("work {work_id} has priority outside u8 range"))
 3075 |                     })?,
 3076 |                     dispatch_policy: parse_dispatch_policy(&rows.column_text(5)?)?,
 3077 |                     hard_holds: active_holds.get(&work_id).cloned().unwrap_or_default(),
 3078 |                     acceptance_profile: AcceptanceProfile {
 3079 |                         id: ProfileId::new(rows.column_text(8)?),
 3080 |                         version: rows.column_u64(9)?.to_string(),
 3081 |                         gates,
 3082 |                     },
 3083 |                 })
 3084 |             })();
 3085 |             match work {
 3086 |                 Ok(work) => works.push(StatusWorkRecord {
 3087 |                     work,
 3088 |                     retry_not_before: rows.column_optional_text(6)?,
 3089 |                     current_attempt,
 3090 |                     gate_diagnostics: diagnostics,
 3091 |                 }),
 3092 |                 Err(error) => record_diagnostics.push(StatusRecordDiagnostic {
 3093 |                     work_id,
 3094 |                     title,
 3095 |                     code: "corrupt_record".to_owned(),
 3096 |                     detail: error.to_string(),
 3097 |                 }),
 3098 |             }
 3099 |         }
 3100 | 
````

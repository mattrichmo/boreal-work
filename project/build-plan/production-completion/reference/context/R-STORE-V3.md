# R-STORE-V3 — crates/store/src/work_model_v3.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/work_model_v3.rs:L1–L260`  
**File SHA-256:** `9614cb4f5993ed9946164c7622e88bd30567af58fdbc3ffe0a1da03a577036b4`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing cycle/assignment persistence entry points and compatibility scaffolding; read corresponding tests before extending.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/store/src/work_model_v3.rs'
```

## Exact baseline excerpt

````text
    1 | //! Transactional persistence adapters for the additive work-model/3 tables.
    2 | //!
    3 | //! The v3 model is deliberately kept in a child module so the schema-2
    4 | //! lifecycle code remains stable while application adapters are introduced.
    5 | //! All mutations below use the same operation/revision/audit boundary as the
    6 | //! original store; callers never need to issue raw SQL for hierarchy or
    7 | //! intake records.
    8 | 
    9 | use super::{
   10 |     json_object, AuditEventRecord, MutationResult, OperationOutcome, OperationRecord, SqliteStore,
   11 |     StoreError, SQLITE_ROW,
   12 | };
   13 | use serde_json::json;
   14 | 
   15 | #[derive(Clone, Debug, Eq, PartialEq)]
   16 | pub struct V3MutationContext {
   17 |     pub project_id: String,
   18 |     pub actor_id: String,
   19 |     pub operation_id: String,
   20 |     pub request_digest: String,
   21 |     pub expected_revision: Option<u64>,
   22 |     pub now: String,
   23 | }
   24 | 
   25 | #[derive(Clone, Debug, Eq, PartialEq)]
   26 | pub struct WorkNodeV3Input {
   27 |     pub project_id: String,
   28 |     pub work_id: String,
   29 |     pub decomposition_kind: String,
   30 |     pub execution_mode: String,
   31 |     pub parent_id: Option<String>,
   32 |     pub created_at: String,
   33 |     pub updated_at: String,
   34 | }
   35 | 
   36 | #[derive(Clone, Debug, Eq, PartialEq)]
   37 | pub struct WorkNodeV3Record {
   38 |     pub project_id: String,
   39 |     pub work_id: String,
   40 |     pub decomposition_kind: String,
   41 |     pub execution_mode: String,
   42 |     pub parent_id: Option<String>,
   43 |     pub created_at: String,
   44 |     pub updated_at: String,
   45 | }
   46 | 
   47 | #[derive(Clone, Debug, Eq, PartialEq)]
   48 | pub struct CycleSeriesV3Input {
   49 |     pub project_id: String,
   50 |     pub series_id: String,
   51 |     pub name: String,
   52 |     pub lifecycle: String,
   53 |     pub timezone: String,
   54 |     pub tzdb_identity: String,
   55 |     pub created_at: String,
   56 |     pub updated_at: String,
   57 | }
   58 | 
   59 | #[derive(Clone, Debug, Eq, PartialEq)]
   60 | pub struct CycleSeriesV3Record {
   61 |     pub project_id: String,
   62 |     pub series_id: String,
   63 |     pub name: String,
   64 |     pub lifecycle: String,
   65 |     pub timezone: String,
   66 |     pub tzdb_identity: String,
   67 |     pub revision: u64,
   68 |     pub created_at: String,
   69 |     pub updated_at: String,
   70 | }
   71 | 
   72 | #[derive(Clone, Debug, Eq, PartialEq)]
   73 | pub struct CycleTemplateV3Input {
   74 |     pub project_id: String,
   75 |     pub template_version_id: String,
   76 |     pub series_id: String,
   77 |     pub version: u64,
   78 |     pub effective_from_slot_ordinal: u64,
   79 |     pub interval_weeks: u64,
   80 |     pub anchor_local_date: String,
   81 |     pub anchor_local_time: String,
   82 |     pub anchor_weekday: u8,
   83 |     pub recurrence_end_kind: String,
   84 |     pub recurrence_end_count: Option<u64>,
   85 |     pub recurrence_end_local_date: Option<String>,
   86 |     pub name_pattern: String,
   87 |     pub goal_template: String,
   88 |     pub timezone: String,
   89 |     pub tzdb_identity: String,
   90 |     pub gap_policy: String,
   91 |     pub fold_policy: String,
   92 |     pub weekdays: Vec<u8>,
   93 |     pub created_at: String,
   94 | }
   95 | 
   96 | #[derive(Clone, Debug, Eq, PartialEq)]
   97 | pub struct CycleV3Input {
   98 |     pub project_id: String,
   99 |     pub cycle_id: String,
  100 |     pub series_id: String,
  101 |     pub template_version_id: String,
  102 |     pub slot_ordinal: u64,
  103 |     pub name: String,
  104 |     pub goal: String,
  105 |     pub lifecycle: String,
  106 |     pub scheduled_start_utc_ms: i64,
  107 |     pub scheduled_end_utc_ms: Option<i64>,
  108 |     pub scheduled_start_local: String,
  109 |     pub scheduled_start_utc_offset_minutes: i64,
  110 |     pub timezone: String,
  111 |     pub tzdb_identity: String,
  112 |     pub gap_policy: String,
  113 |     pub fold_policy: String,
  114 |     pub created_at: String,
  115 |     pub updated_at: String,
  116 | }
  117 | 
  118 | #[derive(Clone, Debug, Eq, PartialEq)]
  119 | pub struct CycleAssignmentV3Input {
  120 |     pub project_id: String,
  121 |     pub assignment_id: String,
  122 |     pub cycle_id: String,
  123 |     pub work_id: String,
  124 |     pub state: String,
  125 |     pub activation_policy: String,
  126 |     pub activation_at_utc_ms: Option<i64>,
  127 |     pub predecessor_id: Option<String>,
  128 |     pub successor_id: Option<String>,
  129 |     pub created_at: String,
  130 |     pub updated_at: String,
  131 | }
  132 | 
  133 | /// The read projections intentionally reuse the validated write shape.  They
  134 | /// are value copies, not mutable references to canonical rows.
  135 | pub type CycleV3Record = CycleV3Input;
  136 | pub type CycleTemplateV3Record = CycleTemplateV3Input;
  137 | pub type CycleAssignmentV3Record = CycleAssignmentV3Input;
  138 | 
  139 | #[derive(Clone, Debug, Eq, PartialEq)]
  140 | pub struct IntakeBucketV3Input {
  141 |     pub project_id: String,
  142 |     pub bucket_id: String,
  143 |     pub name: String,
  144 |     pub archived: bool,
  145 |     pub created_at: String,
  146 |     pub updated_at: String,
  147 | }
  148 | 
  149 | #[derive(Clone, Debug, Eq, PartialEq)]
  150 | pub struct IntakeItemV3Input {
  151 |     pub project_id: String,
  152 |     pub intake_id: String,
  153 |     pub bucket_id: String,
  154 |     pub kind: String,
  155 |     pub lifecycle: String,
  156 |     pub content: String,
  157 |     pub content_revision: u64,
  158 |     pub content_digest: String,
  159 |     pub captured_at: String,
  160 |     pub updated_at: String,
  161 |     pub revisit_at_utc_ms: Option<i64>,
  162 | }
  163 | 
  164 | #[derive(Clone, Debug, Eq, PartialEq)]
  165 | pub struct IntakeItemV3Record {
  166 |     pub project_id: String,
  167 |     pub intake_id: String,
  168 |     pub bucket_id: String,
  169 |     pub kind: String,
  170 |     pub lifecycle: String,
  171 |     pub content: String,
  172 |     pub content_revision: u64,
  173 |     pub content_digest: String,
  174 |     pub captured_at: String,
  175 |     pub updated_at: String,
  176 |     pub revisit_at_utc_ms: Option<i64>,
  177 | }
  178 | 
  179 | #[derive(Clone, Debug, Eq, PartialEq)]
  180 | pub struct IntakePromotionV3Input {
  181 |     pub project_id: String,
  182 |     pub promotion_id: String,
  183 |     pub intake_id: String,
  184 |     pub intake_revision: u64,
  185 |     pub intake_digest: String,
  186 |     pub target_kind: String,
  187 |     pub target_id: String,
  188 |     pub actor_id: String,
  189 |     pub operation_id: String,
  190 |     pub created_at: String,
  191 | }
  192 | 
  193 | #[derive(Clone, Debug, Eq, PartialEq)]
  194 | pub struct ContainerDispositionV3Input {
  195 |     pub project_id: String,
  196 |     pub disposition_id: String,
  197 |     pub container_work_id: String,
  198 |     pub descendant_work_id: String,
  199 |     pub kind: String,
  200 |     pub descendant_revision: u64,
  201 |     pub descendant_outcome_digest: String,
  202 |     pub replacement_work_id: Option<String>,
  203 |     pub reason: Option<String>,
  204 |     pub supersedes_id: Option<String>,
  205 |     pub created_at: String,
  206 | }
  207 | 
  208 | impl SqliteStore {
  209 |     pub fn create_work_node_v3(
  210 |         &self,
  211 |         context: &V3MutationContext,
  212 |         input: &WorkNodeV3Input,
  213 |     ) -> Result<MutationResult, StoreError> {
  214 |         ensure_project(&context.project_id, &input.project_id)?;
  215 |         self.v3_mutation(
  216 |             context,
  217 |             "work.node.create",
  218 |             "work_node",
  219 |             &input.work_id,
  220 |             || {
  221 |                 let mut statement = self.prepare(
  222 |                     "INSERT INTO work_node_v3
  223 |                  (work_id, project_id, decomposition_kind, execution_mode,
  224 |                   parent_id, created_at, updated_at)
  225 |                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  226 |                 )?;
  227 |                 statement.bind_text(1, &input.work_id)?;
  228 |                 statement.bind_text(2, &input.project_id)?;
  229 |                 statement.bind_text(3, &input.decomposition_kind)?;
  230 |                 statement.bind_text(4, &input.execution_mode)?;
  231 |                 statement.bind_optional_text(5, input.parent_id.as_deref())?;
  232 |                 statement.bind_text(6, &input.created_at)?;
  233 |                 statement.bind_text(7, &input.updated_at)?;
  234 |                 statement.run()
  235 |             },
  236 |         )
  237 |     }
  238 | 
  239 |     pub fn work_nodes_v3(&self, project_id: &str) -> Result<Vec<WorkNodeV3Record>, StoreError> {
  240 |         let mut statement = self.prepare(
  241 |             "SELECT project_id, work_id, decomposition_kind, execution_mode,
  242 |                     parent_id, created_at, updated_at
  243 |              FROM work_node_v3 WHERE project_id = ?1 ORDER BY work_id",
  244 |         )?;
  245 |         statement.bind_text(1, project_id)?;
  246 |         let mut rows = Vec::new();
  247 |         while statement.step()? == SQLITE_ROW {
  248 |             rows.push(WorkNodeV3Record {
  249 |                 project_id: statement.column_text(0)?,
  250 |                 work_id: statement.column_text(1)?,
  251 |                 decomposition_kind: statement.column_text(2)?,
  252 |                 execution_mode: statement.column_text(3)?,
  253 |                 parent_id: statement.column_optional_text(4)?,
  254 |                 created_at: statement.column_text(5)?,
  255 |                 updated_at: statement.column_text(6)?,
  256 |             });
  257 |         }
  258 |         Ok(rows)
  259 |     }
  260 | 
````

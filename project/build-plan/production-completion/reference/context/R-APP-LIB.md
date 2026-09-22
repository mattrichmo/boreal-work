# R-APP-LIB — crates/application/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/lib.rs:L1–L280`  
**File SHA-256:** `35c412fdc9e320489ec98a0fc71fdba421e2643b8056373dc544f16d9f34ec01`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Application entry points, shared types and allowed adapter direction; shared module root needs a single writer.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,280p' 'crates/application/src/lib.rs'
```

## Exact baseline excerpt

````text
    1 | //! Authoritative v2 use cases and adapter-facing read models.
    2 | //!
    3 | //! CLI, service, and TUI code call this layer. They do not open SQLite or
    4 | //! apply lifecycle transitions themselves.
    5 | 
    6 | mod runtime;
    7 | mod status;
    8 | 
    9 | mod evidence;
   10 | mod evidence_store;
   11 | mod guidance;
   12 | mod hierarchy;
   13 | mod intake;
   14 | mod knowledge;
   15 | mod operation_identity;
   16 | mod planning_v3;
   17 | mod session;
   18 | mod sqlite_adapter;
   19 | mod workflow_assets;
   20 | 
   21 | use boreal_domain::{validate_parent, ProjectId, WorkItem};
   22 | pub use boreal_store::OperationReadback;
   23 | use boreal_store::{
   24 |     ClaimResult, SqliteStore, StoreError, WorkEditInput, WorkHoldAddInput, WorkPage, WorkRecord,
   25 | };
   26 | pub use evidence::*;
   27 | pub use guidance::{
   28 |     guide, guide_checked, Directive, DirectiveSeverity, DirectiveValidationError, GuidanceContext,
   29 | };
   30 | pub use hierarchy::*;
   31 | pub use intake::*;
   32 | pub use knowledge::*;
   33 | pub use operation_identity::{canonical_request_digest, sha256_content_digest};
   34 | pub use planning_v3::*;
   35 | use serde_json::json;
   36 | pub use session::{
   37 |     SessionRegistrationRequest, SessionRegistrationResult, StoreSessionRegistrationRequest,
   38 | };
   39 | pub use sqlite_adapter::SqliteAttemptAdapter;
   40 | pub use status::*;
   41 | use std::fmt;
   42 | pub use workflow_assets::{WorkflowAsset, WorkflowAssetError, WorkflowRegistry};
   43 | // Re-export the v3 planning vocabulary at the application boundary so CLI,
   44 | // service adapters, and integration tests do not reach through the adapter
   45 | // layer into the domain crate for request/response types.
   46 | pub use boreal_domain::work_model_v3::{
   47 |     CycleAssignment, CycleAssignmentState, CycleId, CycleInstance, CycleLifecycle, CycleSeries,
   48 |     CycleSeriesLifecycle, CycleTemplate, DecompositionKind, ExecutionMode, FoldPolicy, GapPolicy,
   49 |     IntakeBucket, IntakeBucketId, IntakeItem, IntakeItemId, IntakeKind, IntakeLifecycle,
   50 |     IntakePromotion, PromotionId, PromotionTargetKind, TimeResolution, WorkNode,
   51 | };
   52 | 
   53 | pub use runtime::{
   54 |     AcceptAttemptRequest, AttemptAdapterError, AttemptCommand, AttemptCommandKind,
   55 |     AttemptLifecycleAdapter, AttemptMutation, AttemptPolicy, AttemptPolicyError, AttemptRequest,
   56 |     AttemptSnapshot, CancelAttemptRequest, EndAttemptRequest, ExpireAttemptRequest,
   57 |     HeartbeatAttemptRequest, LivenessMetadata, RenewLeaseAttemptRequest, StopConfirmation,
   58 | };
   59 | 
   60 | pub const API_VERSION: &str = "v2";
   61 | 
   62 | #[derive(Clone, Debug, Eq, PartialEq)]
   63 | pub struct OperationResult<T> {
   64 |     pub operation_id: String,
   65 |     pub snapshot_revision: u64,
   66 |     pub changed: bool,
   67 |     pub value: T,
   68 | }
   69 | 
   70 | #[derive(Debug)]
   71 | pub enum ApplicationError {
   72 |     Store(StoreError),
   73 |     AttemptAdapter(AttemptAdapterError),
   74 |     AttemptPolicy(AttemptPolicyError),
   75 |     Evidence(EvidenceValidationError),
   76 |     Planning(PlanningError),
   77 |     Invalid(String),
   78 | }
   79 | 
   80 | impl fmt::Display for ApplicationError {
   81 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
   82 |         match self {
   83 |             Self::Store(error) => error.fmt(formatter),
   84 |             Self::AttemptAdapter(error) => error.fmt(formatter),
   85 |             Self::AttemptPolicy(error) => error.fmt(formatter),
   86 |             Self::Evidence(error) => error.fmt(formatter),
   87 |             Self::Planning(error) => error.fmt(formatter),
   88 |             Self::Invalid(message) => formatter.write_str(message),
   89 |         }
   90 |     }
   91 | }
   92 | 
   93 | impl std::error::Error for ApplicationError {}
   94 | 
   95 | impl From<StoreError> for ApplicationError {
   96 |     fn from(error: StoreError) -> Self {
   97 |         Self::Store(error)
   98 |     }
   99 | }
  100 | 
  101 | impl From<AttemptAdapterError> for ApplicationError {
  102 |     fn from(error: AttemptAdapterError) -> Self {
  103 |         Self::AttemptAdapter(error)
  104 |     }
  105 | }
  106 | 
  107 | impl From<AttemptPolicyError> for ApplicationError {
  108 |     fn from(error: AttemptPolicyError) -> Self {
  109 |         Self::AttemptPolicy(error)
  110 |     }
  111 | }
  112 | 
  113 | impl From<PlanningError> for ApplicationError {
  114 |     fn from(error: PlanningError) -> Self {
  115 |         Self::Planning(error)
  116 |     }
  117 | }
  118 | 
  119 | pub struct WorkApplication<'a> {
  120 |     store: &'a SqliteStore,
  121 | }
  122 | 
  123 | impl WorkApplication<'_> {
  124 |     pub(crate) fn store_ref(&self) -> &SqliteStore {
  125 |         self.store
  126 |     }
  127 | }
  128 | 
  129 | impl<'a> WorkApplication<'a> {
  130 |     pub fn new(store: &'a SqliteStore) -> Self {
  131 |         Self { store }
  132 |     }
  133 | 
  134 |     /// Build a bounded declared-gate receipt without executing or persisting
  135 |     /// anything. Process adapters use this seam after they have returned
  136 |     /// bounded result data.
  137 |     pub fn build_bounded_evidence_receipt(
  138 |         &self,
  139 |         request: &EvidenceRunRequest,
  140 |         execution: &BoundedExecutionResult,
  141 |     ) -> Result<EvidenceRunResult, ApplicationError> {
  142 |         build_bounded_evidence_receipt(request, execution).map_err(ApplicationError::from)
  143 |     }
  144 | 
  145 |     #[allow(clippy::too_many_arguments)]
  146 |     pub fn init_project(
  147 |         &self,
  148 |         project_id: &ProjectId,
  149 |         actor_id: &str,
  150 |         actor_role: &str,
  151 |         credential_ref: &str,
  152 |         display_name: &str,
  153 |         now: &str,
  154 |         operation_id: impl Into<String>,
  155 |     ) -> Result<OperationResult<()>, ApplicationError> {
  156 |         let operation_id = operation_id.into();
  157 |         let request_digest = canonical_request_digest(
  158 |             "project.init/v1",
  159 |             json!({
  160 |                 "project_id": project_id.as_str(),
  161 |                 "actor_id": actor_id,
  162 |                 "actor_role": actor_role,
  163 |                 "credential_ref": credential_ref,
  164 |                 "display_name": display_name,
  165 |             }),
  166 |         );
  167 |         let mutation = self.store.initialize_project(
  168 |             project_id.as_str(),
  169 |             actor_id,
  170 |             actor_role,
  171 |             credential_ref,
  172 |             display_name,
  173 |             &operation_id,
  174 |             &request_digest,
  175 |             now,
  176 |         )?;
  177 |         Ok(OperationResult {
  178 |             operation_id,
  179 |             snapshot_revision: mutation.revision,
  180 |             changed: !mutation.replayed,
  181 |             value: (),
  182 |         })
  183 |     }
  184 | 
  185 |     pub fn create_work(
  186 |         &self,
  187 |         work: &WorkItem,
  188 |         now: &str,
  189 |         operation_id: impl Into<String>,
  190 |     ) -> Result<OperationResult<WorkRecord>, ApplicationError> {
  191 |         self.create_work_as(work, "agent-1", now, operation_id)
  192 |     }
  193 | 
  194 |     pub fn create_work_checked(
  195 |         &self,
  196 |         work: &WorkItem,
  197 |         expected_revision: Option<u64>,
  198 |         now: &str,
  199 |         operation_id: impl Into<String>,
  200 |     ) -> Result<OperationResult<WorkRecord>, ApplicationError> {
  201 |         self.create_work_as_checked(work, "agent-1", expected_revision, now, operation_id)
  202 |     }
  203 | 
  204 |     pub fn create_work_as(
  205 |         &self,
  206 |         work: &WorkItem,
  207 |         actor_id: &str,
  208 |         now: &str,
  209 |         operation_id: impl Into<String>,
  210 |     ) -> Result<OperationResult<WorkRecord>, ApplicationError> {
  211 |         self.create_work_as_with_expected(work, actor_id, None, now, operation_id)
  212 |     }
  213 | 
  214 |     /// Revision-checked work creation for callers operating from a status
  215 |     /// snapshot. The expected revision is part of the operation digest and is
  216 |     /// enforced again by the store transaction.
  217 |     pub fn create_work_as_checked(
  218 |         &self,
  219 |         work: &WorkItem,
  220 |         actor_id: &str,
  221 |         expected_revision: Option<u64>,
  222 |         now: &str,
  223 |         operation_id: impl Into<String>,
  224 |     ) -> Result<OperationResult<WorkRecord>, ApplicationError> {
  225 |         let expected_revision = expected_revision.ok_or_else(|| {
  226 |             ApplicationError::Invalid("work creation requires --expected-revision".to_owned())
  227 |         })?;
  228 |         self.create_work_as_with_expected(
  229 |             work,
  230 |             actor_id,
  231 |             Some(expected_revision),
  232 |             now,
  233 |             operation_id,
  234 |         )
  235 |     }
  236 | 
  237 |     fn create_work_as_with_expected(
  238 |         &self,
  239 |         work: &WorkItem,
  240 |         actor_id: &str,
  241 |         expected_revision: Option<u64>,
  242 |         now: &str,
  243 |         operation_id: impl Into<String>,
  244 |     ) -> Result<OperationResult<WorkRecord>, ApplicationError> {
  245 |         if work.project_id.as_str().is_empty() || work.title.trim().is_empty() {
  246 |             return Err(ApplicationError::Invalid(
  247 |                 "project and title are required".to_owned(),
  248 |             ));
  249 |         }
  250 |         if work.parent_id.is_none()
  251 |             && !matches!(
  252 |                 work.kind,
  253 |                 boreal_domain::WorkKind::Milestone | boreal_domain::WorkKind::Task
  254 |             )
  255 |         {
  256 |             return Err(ApplicationError::Invalid(
  257 |                 "sprints require a parent; root work must be a milestone or task".to_owned(),
  258 |             ));
  259 |         }
  260 |         let operation_id = operation_id.into();
  261 |         let mut request = json!({
  262 |             "project_id": work.project_id.as_str(),
  263 |             "work_id": work.id.as_str(),
  264 |             "actor_id": actor_id,
  265 |             "kind": format!("{:?}", work.kind).to_ascii_lowercase(),
  266 |             "parent_id": work.parent_id.as_ref().map(|id| id.as_str()),
  267 |             "title": work.title,
  268 |             "description": work.description,
  269 |             "lifecycle": format!("{:?}", work.lifecycle).to_ascii_lowercase(),
  270 |             "priority": work.priority,
  271 |             "dispatch_policy": format!("{:?}", work.dispatch_policy).to_ascii_lowercase(),
  272 |             "hard_holds": work.hard_holds.iter().map(|hold| hold.stable_code()).collect::<Vec<_>>(),
  273 |             "acceptance_profile": {
  274 |                 "id": work.acceptance_profile.id.as_str(),
  275 |                 "version": work.acceptance_profile.version,
  276 |                 "gates": work.acceptance_profile.gates.iter().map(|gate| json!({
  277 |                     "id": gate.id.as_str(),
  278 |                     "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
  279 |                     "required": gate.required,
  280 |                     "state": format!("{:?}", gate.state).to_ascii_lowercase(),
````

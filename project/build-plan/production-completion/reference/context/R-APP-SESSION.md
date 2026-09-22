# R-APP-SESSION — crates/application/src/session.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/session.rs:L1–L199`  
**File SHA-256:** `a25d0b68ae951b42a80dd702b5592bd7e7e23ca1c5eac2929ad14e1a7cfd61e9`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Actor/session registration and binding; authenticate principal rather than trusting role/ID text.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,199p' 'crates/application/src/session.rs'
```

## Exact baseline excerpt

````text
    1 | //! Application use cases for durable actor/harness session registration.
    2 | 
    3 | use boreal_domain::{ActorId, HarnessId, OperationId, ProjectId, SessionId, TimestampMs};
    4 | use boreal_store::SessionRecord;
    5 | 
    6 | use crate::{canonical_request_digest, ApplicationError, OperationResult, WorkApplication};
    7 | use serde_json::{json, Value};
    8 | 
    9 | pub use boreal_store::{
   10 |     SessionRegistrationRequest as StoreSessionRegistrationRequest, SessionRegistrationResult,
   11 | };
   12 | 
   13 | /// Typed application request for registering one project-scoped session.
   14 | #[derive(Clone, Debug, Eq, PartialEq)]
   15 | pub struct SessionRegistrationRequest {
   16 |     pub project_id: ProjectId,
   17 |     pub session_id: SessionId,
   18 |     pub actor_id: ActorId,
   19 |     pub harness_id: HarnessId,
   20 |     pub operation_id: OperationId,
   21 |     pub request_digest: String,
   22 |     pub expected_project_revision: Option<u64>,
   23 |     pub started_at: TimestampMs,
   24 | }
   25 | 
   26 | impl SessionRegistrationRequest {
   27 |     pub fn new(
   28 |         project_id: ProjectId,
   29 |         session_id: SessionId,
   30 |         actor_id: ActorId,
   31 |         harness_id: HarnessId,
   32 |         operation_id: OperationId,
   33 |         started_at: TimestampMs,
   34 |     ) -> Self {
   35 |         let request_digest = canonical_request_digest(
   36 |             "session.register/v1",
   37 |             json!({
   38 |                 "project_id": project_id.as_str(),
   39 |                 "session_id": session_id.as_str(),
   40 |                 "actor_id": actor_id.as_str(),
   41 |                 "harness_id": harness_id.as_str(),
   42 |                 "expected_project_revision": Value::Null,
   43 |             }),
   44 |         );
   45 |         Self {
   46 |             project_id,
   47 |             session_id,
   48 |             actor_id,
   49 |             harness_id,
   50 |             operation_id,
   51 |             request_digest,
   52 |             expected_project_revision: None,
   53 |             started_at,
   54 |         }
   55 |     }
   56 | }
   57 | 
   58 | impl WorkApplication<'_> {
   59 |     /// Registers a session and returns its durable readback. Reusing the same
   60 |     /// operation ID and request digest is idempotent and does not advance the
   61 |     /// project revision.
   62 |     pub fn register_session(
   63 |         &self,
   64 |         request: &SessionRegistrationRequest,
   65 |     ) -> Result<OperationResult<SessionRecord>, ApplicationError> {
   66 |         let result = self
   67 |             .store_ref()
   68 |             .register_session(StoreSessionRegistrationRequest {
   69 |                 project_id: request.project_id.as_str().to_owned(),
   70 |                 session_id: request.session_id.as_str().to_owned(),
   71 |                 actor_id: request.actor_id.as_str().to_owned(),
   72 |                 harness_id: request.harness_id.as_str().to_owned(),
   73 |                 operation_id: request.operation_id.as_str().to_owned(),
   74 |                 request_digest: request.request_digest.clone(),
   75 |                 expected_project_revision: request.expected_project_revision,
   76 |                 started_at: stamp(request.started_at),
   77 |             })?;
   78 |         Ok(OperationResult {
   79 |             operation_id: request.operation_id.as_str().to_owned(),
   80 |             snapshot_revision: result.revision,
   81 |             changed: !result.replayed,
   82 |             value: result.session,
   83 |         })
   84 |     }
   85 | 
   86 |     /// Convenience form for callers that already use the store's canonical
   87 |     /// timestamp text representation.
   88 |     #[allow(clippy::too_many_arguments)]
   89 |     pub fn register_session_as(
   90 |         &self,
   91 |         project_id: &ProjectId,
   92 |         actor_id: &str,
   93 |         harness_id: &str,
   94 |         session_id: &str,
   95 |         started_at: &str,
   96 |         operation_id: impl Into<String>,
   97 |     ) -> Result<OperationResult<SessionRecord>, ApplicationError> {
   98 |         let operation_id = OperationId::new(operation_id);
   99 |         let request = SessionRegistrationRequest {
  100 |             project_id: project_id.clone(),
  101 |             session_id: SessionId::new(session_id),
  102 |             actor_id: ActorId::new(actor_id),
  103 |             harness_id: HarnessId::new(harness_id),
  104 |             request_digest: canonical_request_digest(
  105 |                 "session.register/v1",
  106 |                 json!({
  107 |                     "project_id": project_id.as_str(),
  108 |                     "session_id": session_id,
  109 |                     "actor_id": actor_id,
  110 |                     "harness_id": harness_id,
  111 |                     "expected_project_revision": Value::Null,
  112 |                 }),
  113 |             ),
  114 |             operation_id,
  115 |             expected_project_revision: None,
  116 |             started_at: parse_stamp(started_at)?,
  117 |         };
  118 |         self.register_session(&request)
  119 |     }
  120 | 
  121 |     pub fn session(
  122 |         &self,
  123 |         project_id: &ProjectId,
  124 |         session_id: &SessionId,
  125 |     ) -> Result<Option<SessionRecord>, ApplicationError> {
  126 |         Ok(self
  127 |             .store_ref()
  128 |             .session(project_id.as_str(), session_id.as_str())?)
  129 |     }
  130 | 
  131 |     pub fn session_for_claim(
  132 |         &self,
  133 |         project_id: &ProjectId,
  134 |         session_id: &SessionId,
  135 |         actor_id: &ActorId,
  136 |         harness_id: &HarnessId,
  137 |     ) -> Result<SessionRecord, ApplicationError> {
  138 |         Ok(self.store_ref().session_for_claim(
  139 |             project_id.as_str(),
  140 |             session_id.as_str(),
  141 |             actor_id.as_str(),
  142 |             harness_id.as_str(),
  143 |         )?)
  144 |     }
  145 | 
  146 |     /// End a durable session after the caller has explicitly made sure it has
  147 |     /// no live work. The store repeats that check in the same transaction so a
  148 |     /// read-then-write race cannot abandon a current fenced attempt.
  149 |     pub fn end_session_as(
  150 |         &self,
  151 |         project_id: &ProjectId,
  152 |         session_id: &str,
  153 |         actor_id: &str,
  154 |         expected_project_revision: Option<u64>,
  155 |         ended_at: &str,
  156 |         operation_id: impl Into<String>,
  157 |     ) -> Result<OperationResult<SessionRecord>, ApplicationError> {
  158 |         let operation_id = operation_id.into();
  159 |         let request_digest = canonical_request_digest(
  160 |             "session.end/v1",
  161 |             json!({
  162 |                 "project_id": project_id.as_str(),
  163 |                 "session_id": session_id,
  164 |                 "actor_id": actor_id,
  165 |                 "expected_project_revision": expected_project_revision,
  166 |             }),
  167 |         );
  168 |         let result = self.store_ref().end_session(
  169 |             project_id.as_str(),
  170 |             session_id,
  171 |             actor_id,
  172 |             &operation_id,
  173 |             &request_digest,
  174 |             expected_project_revision,
  175 |             ended_at,
  176 |         )?;
  177 |         Ok(OperationResult {
  178 |             operation_id,
  179 |             snapshot_revision: result.revision,
  180 |             changed: !result.replayed,
  181 |             value: result.session,
  182 |         })
  183 |     }
  184 | }
  185 | 
  186 | fn stamp(value: TimestampMs) -> String {
  187 |     format!("unix-ms:{}", value.as_millis())
  188 | }
  189 | 
  190 | fn parse_stamp(value: &str) -> Result<TimestampMs, ApplicationError> {
  191 |     let value = value.strip_prefix("unix-ms:").ok_or_else(|| {
  192 |         ApplicationError::Invalid(format!("unsupported session timestamp format: {value}"))
  193 |     })?;
  194 |     value.parse::<u64>().map(TimestampMs).map_err(|_| {
  195 |         ApplicationError::Invalid(
  196 |             "session timestamp must contain an unsigned millisecond value".to_owned(),
  197 |         )
  198 |     })
  199 | }
````

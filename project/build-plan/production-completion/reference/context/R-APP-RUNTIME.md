# R-APP-RUNTIME — crates/application/src/runtime.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/runtime.rs:L1–L260`  
**File SHA-256:** `0fe0aa504fbe93b750a80e8639efaefba130cf9054c04ebf4f35e6dd2ddf7c60`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Execution lifecycle use cases and recovery coordination above the store.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/application/src/runtime.rs'
```

## Exact baseline excerpt

````text
    1 | //! Fenced attempt runtime policy and the adapter boundary for lifecycle writes.
    2 | //!
    3 | //! The store currently exposes only the atomic claim primitive.  This module
    4 | //! therefore keeps the P2 lifecycle contract typed and persistence-neutral:
    5 | //! adapters receive one command that they must apply atomically, and must
    6 | //! recheck the expected phase, fence, deadlines, and operation identity in
    7 | //! their transaction.  The policy in this file is pure and is shared by all
    8 | //! adapters.
    9 | 
   10 | use boreal_domain::{
   11 |     ActorId, AttemptId, AttemptPhase, Fence, HarnessId, OperationId, ProjectId, SessionId,
   12 |     TimestampMs, WorkId, DEFAULT_HARD_TIME_LIMIT_MS, DEFAULT_LEASE_TTL_MS,
   13 | };
   14 | use boreal_store::StoreError;
   15 | 
   16 | use crate::{ApplicationError, OperationResult, WorkApplication};
   17 | 
   18 | pub const DEFAULT_HARD_ATTEMPT_TIME_LIMIT_MS: u64 = DEFAULT_HARD_TIME_LIMIT_MS;
   19 | pub const DEFAULT_RENEWABLE_LEASE_TTL_MS: u64 = DEFAULT_LEASE_TTL_MS;
   20 | 
   21 | /// A stop acknowledgement or an operator-reviewed safe recovery is required
   22 | /// before an expired attempt can be made terminal.  This prevents a late
   23 | /// timer from silently handing a shared worktree to a replacement attempt.
   24 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
   25 | pub enum StopConfirmation {
   26 |     AdapterAcknowledged,
   27 |     ReviewedSafeRecovery,
   28 | }
   29 | 
   30 | #[derive(Clone, Debug, Eq, PartialEq)]
   31 | pub struct LivenessMetadata {
   32 |     pub phase: Option<AttemptPhase>,
   33 |     pub tool: Option<String>,
   34 |     pub process: Option<String>,
   35 | }
   36 | 
   37 | impl LivenessMetadata {
   38 |     pub fn empty() -> Self {
   39 |         Self {
   40 |             phase: None,
   41 |             tool: None,
   42 |             process: None,
   43 |         }
   44 |     }
   45 | }
   46 | 
   47 | #[derive(Clone, Debug, Eq, PartialEq)]
   48 | pub struct AttemptRequest {
   49 |     pub project_id: ProjectId,
   50 |     pub work_id: WorkId,
   51 |     pub attempt_id: AttemptId,
   52 |     pub actor_id: ActorId,
   53 |     pub harness_id: Option<HarnessId>,
   54 |     pub session_id: Option<SessionId>,
   55 |     pub fence: Fence,
   56 |     pub operation_id: OperationId,
   57 |     pub request_digest: String,
   58 |     pub at: TimestampMs,
   59 | }
   60 | 
   61 | impl AttemptRequest {
   62 |     #[allow(clippy::too_many_arguments)]
   63 |     pub fn new(
   64 |         project_id: ProjectId,
   65 |         work_id: WorkId,
   66 |         attempt_id: AttemptId,
   67 |         actor_id: ActorId,
   68 |         harness_id: Option<HarnessId>,
   69 |         session_id: Option<SessionId>,
   70 |         fence: Fence,
   71 |         operation_id: OperationId,
   72 |         request_digest: impl Into<String>,
   73 |         at: TimestampMs,
   74 |     ) -> Self {
   75 |         Self {
   76 |             project_id,
   77 |             work_id,
   78 |             attempt_id,
   79 |             actor_id,
   80 |             harness_id,
   81 |             session_id,
   82 |             fence,
   83 |             operation_id,
   84 |             request_digest: request_digest.into(),
   85 |             at,
   86 |         }
   87 |     }
   88 | }
   89 | 
   90 | pub type AcceptAttemptRequest = AttemptRequest;
   91 | pub type StartAttemptRequest = AttemptRequest;
   92 | pub type SubmitAttemptRequest = AttemptRequest;
   93 | 
   94 | #[derive(Clone, Debug, Eq, PartialEq)]
   95 | pub struct HeartbeatAttemptRequest {
   96 |     pub attempt: AttemptRequest,
   97 |     pub liveness: LivenessMetadata,
   98 | }
   99 | 
  100 | #[derive(Clone, Debug, Eq, PartialEq)]
  101 | pub struct RenewLeaseAttemptRequest {
  102 |     pub attempt: AttemptRequest,
  103 |     pub lease_ttl_ms: u64,
  104 | }
  105 | 
  106 | #[derive(Clone, Debug, Eq, PartialEq)]
  107 | pub struct EndAttemptRequest {
  108 |     pub attempt: AttemptRequest,
  109 |     pub reason: Option<String>,
  110 | }
  111 | 
  112 | #[derive(Clone, Debug, Eq, PartialEq)]
  113 | pub struct ExpireAttemptRequest {
  114 |     pub attempt: AttemptRequest,
  115 |     pub confirmation: StopConfirmation,
  116 |     pub reason: Option<String>,
  117 | }
  118 | 
  119 | #[derive(Clone, Debug, Eq, PartialEq)]
  120 | pub struct CancelAttemptRequest {
  121 |     pub attempt: AttemptRequest,
  122 |     pub confirmation: Option<StopConfirmation>,
  123 |     pub reason: Option<String>,
  124 | }
  125 | 
  126 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  127 | pub enum AttemptCommandKind {
  128 |     Accept,
  129 |     Start,
  130 |     Heartbeat,
  131 |     RenewLease {
  132 |         lease_ttl_ms: u64,
  133 |     },
  134 |     Submit,
  135 |     Release,
  136 |     Fail,
  137 |     Expire {
  138 |         confirmation: StopConfirmation,
  139 |     },
  140 |     Cancel {
  141 |         confirmation: Option<StopConfirmation>,
  142 |     },
  143 | }
  144 | 
  145 | #[derive(Clone, Debug, Eq, PartialEq)]
  146 | pub struct AttemptCommand {
  147 |     pub project_id: ProjectId,
  148 |     pub work_id: WorkId,
  149 |     pub attempt_id: AttemptId,
  150 |     pub actor_id: ActorId,
  151 |     pub harness_id: Option<HarnessId>,
  152 |     pub session_id: Option<SessionId>,
  153 |     pub fence: Fence,
  154 |     pub operation_id: OperationId,
  155 |     pub request_digest: String,
  156 |     pub at: TimestampMs,
  157 |     pub expected_phase: AttemptPhase,
  158 |     pub expected_lease_deadline: TimestampMs,
  159 |     pub expected_hard_deadline: TimestampMs,
  160 |     pub kind: AttemptCommandKind,
  161 |     pub liveness: Option<LivenessMetadata>,
  162 |     pub reason: Option<String>,
  163 | }
  164 | 
  165 | #[derive(Clone, Debug, Eq, PartialEq)]
  166 | pub struct AttemptSnapshot {
  167 |     pub project_id: ProjectId,
  168 |     pub work_id: WorkId,
  169 |     pub attempt_id: AttemptId,
  170 |     pub actor_id: ActorId,
  171 |     pub harness_id: Option<HarnessId>,
  172 |     pub session_id: Option<SessionId>,
  173 |     pub fence: Fence,
  174 |     pub phase: AttemptPhase,
  175 |     pub claimed_at: TimestampMs,
  176 |     pub accepted_at: Option<TimestampMs>,
  177 |     pub lease_deadline: TimestampMs,
  178 |     pub hard_deadline: TimestampMs,
  179 |     pub current: bool,
  180 | }
  181 | 
  182 | impl AttemptSnapshot {
  183 |     pub fn effective_expiry(&self, at: TimestampMs) -> Option<ExpiryKind> {
  184 |         if at >= self.hard_deadline {
  185 |             Some(ExpiryKind::HardBudget)
  186 |         } else if at >= self.lease_deadline {
  187 |             Some(ExpiryKind::Lease)
  188 |         } else {
  189 |             None
  190 |         }
  191 |     }
  192 | }
  193 | 
  194 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  195 | pub enum ExpiryKind {
  196 |     Lease,
  197 |     HardBudget,
  198 | }
  199 | 
  200 | #[derive(Clone, Debug, Eq, PartialEq)]
  201 | pub struct AttemptMutation {
  202 |     pub operation_id: OperationId,
  203 |     pub request_digest: String,
  204 |     pub attempt_id: AttemptId,
  205 |     pub fence: Fence,
  206 |     pub phase: AttemptPhase,
  207 |     pub lease_deadline: TimestampMs,
  208 |     pub hard_deadline: TimestampMs,
  209 |     pub revision: u64,
  210 |     pub changed: bool,
  211 |     pub replayed: bool,
  212 | }
  213 | 
  214 | /// Adapter-facing atomic lifecycle contract.
  215 | ///
  216 | /// `transact_attempt` is one short store transaction: it must re-read the
  217 | /// current attempt, reject stale fences and elapsed deadlines, apply the
  218 | /// legal transition, persist its audit/operation result, and commit one
  219 | /// revision.  An adapter must return the committed result with `replayed` set
  220 | /// for a duplicate operation ID.  It must never return success for an unknown
  221 | /// outcome.  `read_attempt_operation` exists so a caller can resolve a timeout
  222 | /// or disconnect without guessing whether a mutation committed.
  223 | pub trait AttemptLifecycleAdapter {
  224 |     fn current_attempt(
  225 |         &self,
  226 |         project_id: &ProjectId,
  227 |         attempt_id: &AttemptId,
  228 |     ) -> Result<AttemptSnapshot, AttemptAdapterError>;
  229 | 
  230 |     fn transact_attempt(
  231 |         &self,
  232 |         command: AttemptCommand,
  233 |     ) -> Result<AttemptMutation, AttemptAdapterError>;
  234 | 
  235 |     fn read_attempt_operation(
  236 |         &self,
  237 |         project_id: &ProjectId,
  238 |         operation_id: &OperationId,
  239 |     ) -> Result<Option<AttemptMutation>, AttemptAdapterError>;
  240 | }
  241 | 
  242 | #[derive(Clone, Debug, Eq, PartialEq)]
  243 | pub enum AttemptAdapterError {
  244 |     Store(StoreError),
  245 |     NotFound { entity: &'static str, id: String },
  246 |     StaleFence { expected: Fence, current: Fence },
  247 |     LeaseExpired,
  248 |     Conflict(String),
  249 |     Busy(String),
  250 |     UnknownOutcome(String),
  251 |     Rejected(String),
  252 | }
  253 | 
  254 | impl std::fmt::Display for AttemptAdapterError {
  255 |     fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
  256 |         match self {
  257 |             Self::Store(error) => error.fmt(formatter),
  258 |             Self::NotFound { entity, id } => write!(formatter, "{entity} not found: {id}"),
  259 |             Self::StaleFence { .. } => formatter.write_str("stale_fence"),
  260 |             Self::LeaseExpired => formatter.write_str("lease_expired"),
````

# R-DOMAIN — crates/domain/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/domain/src/lib.rs:L1–L280`  
**File SHA-256:** `e1ac55358a52de43c820c82bcffd8c0783cd60d44429626db25919df22e7cc1c`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing domain identity, lifecycle, actor and gate types; inspect referenced implementations and focused tests.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,280p' 'crates/domain/src/lib.rs'
```

## Exact baseline excerpt

````text
    1 | //! Pure Boreal v2 domain types and invariants.
    2 | //!
    3 | //! This crate deliberately contains no persistence, serialization, terminal,
    4 | //! or process-execution code. Adapters provide canonical rows and consume the
    5 | //! decisions produced here.
    6 | 
    7 | use std::{fmt, str::FromStr};
    8 | 
    9 | /// Version-3 work-model value objects and pure validators.  This module is
   10 | /// additive: schema-2 rows and lifecycle APIs remain available until a store
   11 | /// migration and capability negotiation are integrated by the owning lanes.
   12 | pub mod work_model_v3;
   13 | 
   14 | mod status_evaluator;
   15 | pub use status_evaluator::evaluate_status;
   16 | 
   17 | /// The default immutable attempt budget, measured from `claimed_at`.
   18 | pub const DEFAULT_HARD_TIME_LIMIT_MS: u64 = 2 * 60 * 60 * 1_000;
   19 | /// The initial renewable ownership lease fixture.
   20 | pub const DEFAULT_LEASE_TTL_MS: u64 = 30 * 60 * 1_000;
   21 | 
   22 | macro_rules! typed_id {
   23 |     ($name:ident) => {
   24 |         #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
   25 |         pub struct $name(String);
   26 | 
   27 |         impl $name {
   28 |             pub fn new(value: impl Into<String>) -> Self {
   29 |                 Self(value.into())
   30 |             }
   31 | 
   32 |             pub fn parse(value: impl Into<String>) -> Result<Self, IdentifierError> {
   33 |                 let value = value.into();
   34 |                 if value.is_empty()
   35 |                     || value.len() > 255
   36 |                     || value
   37 |                         .chars()
   38 |                         .any(|character| character.is_control() || character.is_whitespace())
   39 |                 {
   40 |                     return Err(IdentifierError::invalid(stringify!($name), value));
   41 |                 }
   42 |                 Ok(Self(value))
   43 |             }
   44 | 
   45 |             pub fn as_str(&self) -> &str {
   46 |                 &self.0
   47 |             }
   48 |         }
   49 | 
   50 |         impl From<String> for $name {
   51 |             fn from(value: String) -> Self {
   52 |                 Self::new(value)
   53 |             }
   54 |         }
   55 | 
   56 |         impl From<&str> for $name {
   57 |             fn from(value: &str) -> Self {
   58 |                 Self::new(value)
   59 |             }
   60 |         }
   61 | 
   62 |         impl FromStr for $name {
   63 |             type Err = IdentifierError;
   64 | 
   65 |             fn from_str(value: &str) -> Result<Self, Self::Err> {
   66 |                 Self::parse(value)
   67 |             }
   68 |         }
   69 | 
   70 |         impl fmt::Display for $name {
   71 |             fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
   72 |                 formatter.write_str(self.as_str())
   73 |             }
   74 |         }
   75 |     };
   76 | }
   77 | 
   78 | typed_id!(ProjectId);
   79 | typed_id!(WorkId);
   80 | typed_id!(AttemptId);
   81 | typed_id!(ActorId);
   82 | typed_id!(HarnessId);
   83 | typed_id!(SessionId);
   84 | typed_id!(OperationId);
   85 | typed_id!(GateId);
   86 | typed_id!(ReceiptId);
   87 | typed_id!(ProfileId);
   88 | typed_id!(SourceVersionId);
   89 | typed_id!(ConfigIdentity);
   90 | 
   91 | #[derive(Clone, Debug, Eq, PartialEq)]
   92 | pub struct IdentifierError {
   93 |     pub type_name: &'static str,
   94 |     pub value: String,
   95 | }
   96 | 
   97 | impl IdentifierError {
   98 |     fn invalid(type_name: &'static str, value: String) -> Self {
   99 |         Self { type_name, value }
  100 |     }
  101 | }
  102 | 
  103 | impl fmt::Display for IdentifierError {
  104 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  105 |         write!(
  106 |             formatter,
  107 |             "invalid {} identifier: {:?}",
  108 |             self.type_name, self.value
  109 |         )
  110 |     }
  111 | }
  112 | 
  113 | impl std::error::Error for IdentifierError {}
  114 | 
  115 | /// Milliseconds on the authoritative service/store clock.
  116 | #[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
  117 | pub struct TimestampMs(pub u64);
  118 | 
  119 | impl TimestampMs {
  120 |     pub const fn from_millis(value: u64) -> Self {
  121 |         Self(value)
  122 |     }
  123 | 
  124 |     pub const fn as_millis(self) -> u64 {
  125 |         self.0
  126 |     }
  127 | 
  128 |     pub fn checked_add(self, duration_ms: u64) -> Result<Self, DomainError> {
  129 |         self.0
  130 |             .checked_add(duration_ms)
  131 |             .map(Self)
  132 |             .ok_or(DomainError::TimestampOverflow)
  133 |     }
  134 | }
  135 | 
  136 | impl fmt::Display for TimestampMs {
  137 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  138 |         self.0.fmt(formatter)
  139 |     }
  140 | }
  141 | 
  142 | #[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
  143 | pub struct Revision(pub u64);
  144 | 
  145 | #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
  146 | pub struct Fence(pub u64);
  147 | 
  148 | impl Fence {
  149 |     pub const fn new(value: u64) -> Self {
  150 |         Self(value)
  151 |     }
  152 | 
  153 |     pub const fn get(self) -> u64 {
  154 |         self.0
  155 |     }
  156 | 
  157 |     pub fn next(self) -> Result<Self, DomainError> {
  158 |         self.0
  159 |             .checked_add(1)
  160 |             .map(Self)
  161 |             .ok_or(DomainError::FenceOverflow)
  162 |     }
  163 | }
  164 | 
  165 | impl fmt::Display for Fence {
  166 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  167 |         self.0.fmt(formatter)
  168 |     }
  169 | }
  170 | 
  171 | /// The only work lifecycle values that may be persisted.
  172 | #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
  173 | pub enum PersistedLifecycle {
  174 |     Draft,
  175 |     Open,
  176 |     Closed,
  177 |     Cancelled,
  178 | }
  179 | 
  180 | pub type Lifecycle = PersistedLifecycle;
  181 | 
  182 | impl PersistedLifecycle {
  183 |     pub const fn is_terminal(self) -> bool {
  184 |         matches!(self, Self::Closed | Self::Cancelled)
  185 |     }
  186 | }
  187 | 
  188 | /// Human-facing status derived from canonical lifecycle, graph, policy,
  189 | /// attempt, gate, and clock inputs. It is never a writable persistence field.
  190 | #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
  191 | pub enum DerivedStatus {
  192 |     Draft,
  193 |     Queued,
  194 |     Ready,
  195 |     Claimed,
  196 |     InProgress,
  197 |     NeedsVerification,
  198 |     AwaitingReview,
  199 |     Complete,
  200 |     Closed,
  201 |     Blocked,
  202 |     Paused,
  203 |     RetryWait,
  204 |     ExpiredReview,
  205 |     Cancelled,
  206 | }
  207 | 
  208 | pub type WorkStatus = DerivedStatus;
  209 | 
  210 | #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
  211 | pub enum WorkKind {
  212 |     Milestone,
  213 |     Sprint,
  214 |     Task,
  215 | }
  216 | 
  217 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  218 | pub enum DispatchPolicy {
  219 |     Automatic,
  220 |     OperatorOnly,
  221 |     Paused,
  222 | }
  223 | 
  224 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  225 | pub enum ActorRole {
  226 |     Agent,
  227 |     Reviewer,
  228 |     Operator,
  229 |     Publisher,
  230 | }
  231 | 
  232 | #[derive(Clone, Debug, Eq, PartialEq)]
  233 | pub struct ActorContext {
  234 |     pub actor_id: ActorId,
  235 |     pub role: ActorRole,
  236 | }
  237 | 
  238 | /// A canonical work row. Its effective status is obtained with
  239 | /// [`evaluate_status`].
  240 | #[derive(Clone, Debug, Eq, PartialEq)]
  241 | pub struct WorkItem {
  242 |     pub id: WorkId,
  243 |     pub project_id: ProjectId,
  244 |     pub kind: WorkKind,
  245 |     pub parent_id: Option<WorkId>,
  246 |     pub title: String,
  247 |     pub description: String,
  248 |     pub lifecycle: PersistedLifecycle,
  249 |     pub priority: u8,
  250 |     pub dispatch_policy: DispatchPolicy,
  251 |     pub hard_holds: Vec<ReasonCode>,
  252 |     pub acceptance_profile: AcceptanceProfile,
  253 | }
  254 | 
  255 | impl WorkItem {
  256 |     pub fn new(
  257 |         project_id: ProjectId,
  258 |         id: WorkId,
  259 |         kind: WorkKind,
  260 |         parent_id: Option<WorkId>,
  261 |         title: impl Into<String>,
  262 |     ) -> Self {
  263 |         Self {
  264 |             id,
  265 |             project_id,
  266 |             kind,
  267 |             parent_id,
  268 |             title: title.into(),
  269 |             description: String::new(),
  270 |             lifecycle: PersistedLifecycle::Draft,
  271 |             priority: 0,
  272 |             dispatch_policy: DispatchPolicy::Automatic,
  273 |             hard_holds: Vec::new(),
  274 |             acceptance_profile: AcceptanceProfile::focused(),
  275 |         }
  276 |     }
  277 | 
  278 |     pub fn open(mut self) -> Self {
  279 |         self.lifecycle = PersistedLifecycle::Open;
  280 |         self
````

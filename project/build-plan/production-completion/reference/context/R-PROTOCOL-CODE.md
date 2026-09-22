# R-PROTOCOL-CODE — crates/protocol/src/models.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/protocol/src/models.rs:L1–L300`  
**File SHA-256:** `bff24d6d3ffdf60441926289e038edf72d8523932b5684810cb4bc3cbf61a2f3`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Wire DTO definitions; field additions, action descriptors and typed diagnostics require compatibility tests.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,300p' 'crates/protocol/src/models.rs'
```

## Exact baseline excerpt

````text
    1 | //! Typed read-model and evidence DTOs for the v2 protocol.
    2 | //!
    3 | //! These structs mirror the versioned fixture vocabulary. They intentionally
    4 | //! contain no domain or persistence logic; validation of lifecycle policy
    5 | //! remains in the domain/application crates.
    6 | 
    7 | use serde::{Deserialize, Serialize};
    8 | 
    9 | /// Common project/actor context carried by planning and operator routes.
   10 | ///
   11 | /// The application owns authorization and revision checks; this DTO only
   12 | /// freezes the wire vocabulary shared by the CLI, service, and TUI adapters.
   13 | #[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
   14 | pub struct RouteContextDto {
   15 |     pub project_id: String,
   16 |     pub actor_id: String,
   17 |     #[serde(default, skip_serializing_if = "Option::is_none")]
   18 |     pub harness_id: Option<String>,
   19 |     #[serde(default, skip_serializing_if = "Option::is_none")]
   20 |     pub session_id: Option<String>,
   21 |     #[serde(default, skip_serializing_if = "Option::is_none")]
   22 |     pub expected_revision: Option<u64>,
   23 | }
   24 | 
   25 | /// Versioned payload for the public dependency-add route.
   26 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
   27 | pub struct DependencyAddDto {
   28 |     pub project_id: String,
   29 |     pub prerequisite_id: String,
   30 |     pub dependent_id: String,
   31 |     pub actor_id: String,
   32 |     #[serde(default, skip_serializing_if = "Option::is_none")]
   33 |     pub expected_revision: Option<u64>,
   34 | }
   35 | 
   36 | /// Bounded read-only operator diagnostic request.
   37 | #[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
   38 | pub struct DoctorDto {
   39 |     #[serde(default, skip_serializing_if = "Option::is_none")]
   40 |     pub project_id: Option<String>,
   41 |     #[serde(default, skip_serializing_if = "Option::is_none")]
   42 |     pub actor_id: Option<String>,
   43 | }
   44 | 
   45 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
   46 | pub struct StatusDto {
   47 |     pub schema_version: String,
   48 |     pub fixture_id: Option<String>,
   49 |     pub work_id: String,
   50 |     pub display_status: String,
   51 |     pub lifecycle: String,
   52 |     #[serde(default)]
   53 |     pub reason_codes: Vec<String>,
   54 |     /// Additive M02 field; absent in pre-M02 readers/fixtures.
   55 |     #[serde(default, skip_serializing_if = "Option::is_none")]
   56 |     pub primary_reason: Option<String>,
   57 |     #[serde(default, skip_serializing_if = "Vec::is_empty")]
   58 |     pub diagnostics: Vec<StatusDiagnosticDto>,
   59 |     pub claimable_for_actor: bool,
   60 |     pub next_action: Option<NextActionDto>,
   61 |     pub attempt: Option<AttemptDto>,
   62 |     #[serde(default)]
   63 |     pub gates: GateSummaryDto,
   64 |     #[serde(default)]
   65 |     pub dependency: DependencyDto,
   66 |     pub as_of: String,
   67 |     pub next_status_change_at: Option<String>,
   68 | }
   69 | 
   70 | /// Bounded record-level read diagnostic. A diagnostic is not lifecycle state
   71 | /// and must never be used as permission to mutate the underlying record.
   72 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
   73 | pub struct StatusDiagnosticDto {
   74 |     pub work_id: String,
   75 |     #[serde(default, skip_serializing_if = "Option::is_none")]
   76 |     pub title: Option<String>,
   77 |     pub code: String,
   78 |     pub detail: String,
   79 | }
   80 | 
   81 | #[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
   82 | pub struct GateSummaryDto {
   83 |     #[serde(default)]
   84 |     pub open: Vec<GateDto>,
   85 |     #[serde(default)]
   86 |     pub satisfied: Vec<GateDto>,
   87 | }
   88 | 
   89 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
   90 | pub struct GateDto {
   91 |     pub gate_id: String,
   92 |     pub kind: String,
   93 |     pub required: bool,
   94 |     pub state: String,
   95 |     #[serde(default)]
   96 |     pub reason: Option<String>,
   97 | }
   98 | 
   99 | #[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
  100 | pub struct DependencyDto {
  101 |     #[serde(default)]
  102 |     pub prerequisites: Vec<PrerequisiteDto>,
  103 | }
  104 | 
  105 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  106 | pub struct PrerequisiteDto {
  107 |     pub work_id: String,
  108 |     pub display_status: String,
  109 |     pub satisfies_default: bool,
  110 | }
  111 | 
  112 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  113 | pub struct AttemptDto {
  114 |     pub attempt_id: String,
  115 |     pub fence: u64,
  116 |     pub phase: String,
  117 |     pub actor_id: Option<String>,
  118 |     pub harness_id: Option<String>,
  119 |     pub session_id: Option<String>,
  120 |     pub lease_deadline: Option<String>,
  121 |     pub hard_deadline: Option<String>,
  122 | }
  123 | 
  124 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  125 | pub struct NextActionDto {
  126 |     pub directive_id: String,
  127 |     pub severity: String,
  128 |     pub title: String,
  129 |     pub instruction: String,
  130 |     pub subject: SubjectDto,
  131 |     #[serde(default)]
  132 |     pub safe_argv: Vec<String>,
  133 |     pub cwd: String,
  134 |     pub runner: String,
  135 |     pub shell: bool,
  136 | }
  137 | 
  138 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  139 | pub struct SubjectDto {
  140 |     #[serde(rename = "type")]
  141 |     pub subject_type: String,
  142 |     pub id: String,
  143 | }
  144 | 
  145 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  146 | pub struct ListDto {
  147 |     pub schema_version: String,
  148 |     pub fixture_id: Option<String>,
  149 |     pub kind: String,
  150 |     #[serde(default)]
  151 |     pub items: Vec<ListItemDto>,
  152 |     #[serde(default, skip_serializing_if = "Vec::is_empty")]
  153 |     pub diagnostics: Vec<StatusDiagnosticDto>,
  154 |     pub page: PageDto,
  155 |     pub counts: CountsDto,
  156 |     pub source_revision: u64,
  157 |     pub as_of: String,
  158 | }
  159 | 
  160 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  161 | pub struct ListItemDto {
  162 |     pub work_id: String,
  163 |     pub title: String,
  164 |     pub display_status: String,
  165 |     #[serde(default)]
  166 |     pub reason_codes: Vec<String>,
  167 | }
  168 | 
  169 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  170 | pub struct PageDto {
  171 |     pub limit: u64,
  172 |     pub returned: u64,
  173 |     pub has_more: bool,
  174 |     pub next_cursor: Option<String>,
  175 | }
  176 | 
  177 | #[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
  178 | pub struct CountsDto {
  179 |     pub matched: u64,
  180 |     pub queued: u64,
  181 |     pub ready: u64,
  182 |     pub blocked: u64,
  183 |     pub in_progress: u64,
  184 |     pub expired_review: u64,
  185 |     pub closed: u64,
  186 | }
  187 | 
  188 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  189 | pub struct AgentGuideDto {
  190 |     pub kind: String,
  191 |     pub guide_schema_version: String,
  192 |     pub context: GuidanceContextDto,
  193 |     pub status: GuidanceStatusDto,
  194 |     #[serde(default)]
  195 |     pub requirements: Vec<RequirementDto>,
  196 |     pub next_action: Option<NextActionDto>,
  197 |     pub provenance: GuidanceProvenanceDto,
  198 |     pub selection_key: String,
  199 | }
  200 | 
  201 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  202 | pub struct GuidanceContextDto {
  203 |     pub mode: String,
  204 |     pub project_id: String,
  205 |     pub actor_id: String,
  206 |     pub harness_id: Option<String>,
  207 |     pub session_id: Option<String>,
  208 |     pub project_revision: u64,
  209 | }
  210 | 
  211 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  212 | pub struct GuidanceStatusDto {
  213 |     pub state: String,
  214 |     pub display_status: String,
  215 |     pub work_id: Option<String>,
  216 |     pub attempt_id: Option<String>,
  217 |     pub fence: Option<u64>,
  218 |     pub summary: String,
  219 | }
  220 | 
  221 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  222 | pub struct RequirementDto {
  223 |     pub id: String,
  224 |     pub kind: String,
  225 |     pub severity: String,
  226 |     pub state: String,
  227 |     pub reason: String,
  228 | }
  229 | 
  230 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  231 | pub struct GuidanceProvenanceDto {
  232 |     pub registry_version: String,
  233 |     pub registry_path: String,
  234 |     pub source_snapshot_hash: String,
  235 |     pub config_identity: String,
  236 |     #[serde(default)]
  237 |     pub gap_codes: Vec<String>,
  238 |     #[serde(default)]
  239 |     pub workflow_refs: Vec<String>,
  240 | }
  241 | 
  242 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  243 | pub struct AgentNextDto {
  244 |     pub kind: String,
  245 |     pub next_schema_version: String,
  246 |     pub mode: String,
  247 |     pub selection: String,
  248 |     pub status: NextStatusDto,
  249 |     pub reason: NextReasonDto,
  250 |     pub next_action: Option<NextActionDto>,
  251 |     #[serde(default)]
  252 |     pub context_refs: Vec<ContextRefDto>,
  253 |     pub no_goal: bool,
  254 | }
  255 | 
  256 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  257 | pub struct NextStatusDto {
  258 |     pub display_status: String,
  259 |     pub work_id: Option<String>,
  260 |     #[serde(default)]
  261 |     pub reason_codes: Vec<String>,
  262 |     pub claimable_for_actor: bool,
  263 | }
  264 | 
  265 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  266 | pub struct NextReasonDto {
  267 |     pub code: String,
  268 |     pub message: String,
  269 |     pub selection_key: String,
  270 | }
  271 | 
  272 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  273 | pub struct ContextRefDto {
  274 |     #[serde(rename = "type")]
  275 |     pub reference_type: String,
  276 |     pub id: String,
  277 |     pub revision: u64,
  278 | }
  279 | 
  280 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  281 | pub struct ReceiptDto {
  282 |     pub schema_version: String,
  283 |     pub fixture_id: Option<String>,
  284 |     pub receipt_id: String,
  285 |     pub operation_id: String,
  286 |     pub subject: ReceiptSubjectDto,
  287 |     pub executable: String,
  288 |     pub argv: Vec<String>,
  289 |     pub cwd: String,
  290 |     pub exit_code: i32,
  291 |     pub started_at: String,
  292 |     pub ended_at: String,
  293 |     pub source_snapshot_hash: String,
  294 |     pub config_identity: String,
  295 |     pub environment_fingerprint: String,
  296 |     pub output_digest: String,
  297 |     pub output_ref: Option<String>,
  298 |     pub coverage: CoverageDto,
  299 |     pub attestation: String,
  300 |     pub result: String,
````

# R-APP-EVIDENCE-STORE — crates/application/src/evidence_store.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/evidence_store.rs:L1–L260`  
**File SHA-256:** `28bfddb8925e14e7fcc3e6db98a0cfe86891aaf14e5765c46a4e1092f33f72e4`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Evidence persistence, close-intent and receipt-to-store interfaces; no synthesized proof.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/application/src/evidence_store.rs'
```

## Exact baseline excerpt

````text
    1 | //! Durable application façade for receipts, reviews, and proof-gated closeout.
    2 | 
    3 | use boreal_domain::{
    4 |     ActorId, AttemptId, ConfigIdentity, Fence, GateId, GateKind, ProfileId, ReceiptId,
    5 |     ReceiptResult, SourceVersionId, TimestampMs, WorkId,
    6 | };
    7 | use boreal_store::{
    8 |     CloseIntentRequest, CloseIntentResult, EvidenceExecutionAdmissionRequest,
    9 |     EvidenceExecutionAdmissionResult, EvidenceExecutionRecord, ReceiptAcceptanceExpectation,
   10 |     ReceiptAttestation, ReceiptInsertRequest, ReceiptInsertResult, ReceiptOutcome, ReceiptRecord,
   11 |     ReceiptSubmissionKind, ReviewDecision as StoreReviewDecision, ReviewInsertRequest, StoreError,
   12 |     SummaryInsertRequest, SummaryInsertResult,
   13 | };
   14 | use serde_json::{json, Value};
   15 | 
   16 | use crate::{
   17 |     canonical_request_digest, validate_review_decision, AcceptanceDefinition, AcceptanceEvaluation,
   18 |     AcceptanceGateDefinition, ApplicationError, CloseIntent, CloseoutInput, EvidenceErrorCode,
   19 |     EvidenceRunRequest, EvidenceRunResult, ReceiptExpectation, ReceiptExpectationBase,
   20 |     ReceiptPayload, ReviewDecision, ReviewDecisionRequest, SqliteStore, SummaryPayload,
   21 |     WorkApplication,
   22 | };
   23 | 
   24 | impl WorkApplication<'_> {
   25 |     pub fn record_receipt(
   26 |         &self,
   27 |         actor_id: &str,
   28 |         session_id: Option<&str>,
   29 |         receipt: &ReceiptPayload,
   30 |         expected_project_revision: Option<u64>,
   31 |         now: TimestampMs,
   32 |     ) -> Result<ReceiptInsertResult, ApplicationError> {
   33 |         if receipt.attestation == crate::ExecutorAttestation::BorealWitnessed {
   34 |             return Err(ApplicationError::Evidence(
   35 |                 crate::EvidenceValidationError::new(
   36 |                     EvidenceErrorCode::WitnessedReceiptImportDenied,
   37 |                 ),
   38 |             ));
   39 |         }
   40 |         let expected = self.current_receipt_expectation(receipt, actor_id, session_id)?;
   41 |         receipt
   42 |             .validate_for_import(&expected)
   43 |             .map_err(ApplicationError::from)?;
   44 | 
   45 |         // An imported/self-reported passing payload is retained as a rejected
   46 |         // fact. It is never allowed to satisfy a gate merely because its JSON
   47 |         // says `result: passed` or names an observable. External attestation is
   48 |         // the only imported form that may remain eligible for acceptance.
   49 |         let (result, rejection_code) =
   50 |             if receipt.result == ReceiptResult::Passed && !receipt.attestation.is_gate_trusted() {
   51 |                 (
   52 |                     ReceiptOutcome::Rejected,
   53 |                     Some(EvidenceErrorCode::ReceiptAttestationMissing.as_str()),
   54 |                 )
   55 |             } else {
   56 |                 (receipt_outcome(receipt.result), None)
   57 |             };
   58 |         self.insert_receipt(
   59 |             actor_id,
   60 |             session_id,
   61 |             receipt,
   62 |             &expected,
   63 |             ReceiptSubmissionKind::ExternalImport,
   64 |             expected_project_revision,
   65 |             now,
   66 |             result,
   67 |             rejection_code,
   68 |         )
   69 |     }
   70 | 
   71 |     /// Reserve one witnessed execution before the adapter creates artifacts or
   72 |     /// launches a process. A replay returns the existing journal record and is
   73 |     /// deliberately not permission to run the command again.
   74 |     pub fn admit_witnessed_execution(
   75 |         &self,
   76 |         actor_id: &str,
   77 |         session_id: Option<&str>,
   78 |         request: &EvidenceRunRequest,
   79 |         artifact_ref: &str,
   80 |         now: TimestampMs,
   81 |     ) -> Result<EvidenceExecutionAdmissionResult, ApplicationError> {
   82 |         let project_id = self.project_for_work(request.expectation.work_id.as_str())?;
   83 |         let gate_id = self.store().gate_id_for_work(
   84 |             &project_id,
   85 |             request.expectation.work_id.as_str(),
   86 |             request.expectation.gate.id.as_str(),
   87 |         )?;
   88 |         let profile_version = request.expectation.profile_version.parse().map_err(|_| {
   89 |             ApplicationError::Evidence(crate::EvidenceValidationError::new(
   90 |                 EvidenceErrorCode::ReceiptPolicyMismatch,
   91 |             ))
   92 |         })?;
   93 |         let request_digest = canonical_request_digest(
   94 |             "evidence.execution.admit/v1",
   95 |             json!({
   96 |                 "operation_id": request.operation_id.as_str(),
   97 |                 "receipt_id": request.receipt_id.as_str(),
   98 |                 "project_id": project_id.as_str(),
   99 |                 "work_id": request.expectation.work_id.as_str(),
  100 |                 "attempt_id": request.expectation.attempt_id.as_str(),
  101 |                 "fence": request.expectation.fence.get(),
  102 |                 "gate_id": gate_id.as_str(),
  103 |                 "source_version_id": request.expectation.source_snapshot_hash.as_str(),
  104 |                 "config_identity": request.expectation.config_identity.as_str(),
  105 |                 "profile_id": request.expectation.profile_id.as_str(),
  106 |                 "profile_version": request.expectation.profile_version,
  107 |                 "gate_kind": format!("{:?}", request.expectation.gate.kind),
  108 |                 "gate_required": request.expectation.gate.required,
  109 |                 "requires_attestation": request.expectation.gate.requires_attestation,
  110 |                 "required_observables": request.expectation.gate.required_observables,
  111 |                 "command": request.expectation.gate.command.as_ref().map(|command| json!({
  112 |                     "executable": command.executable,
  113 |                     "argv": command.argv,
  114 |                 })),
  115 |                 "cwd": request.cwd,
  116 |                 "environment_fingerprint": request.environment_fingerprint,
  117 |                 "artifact_ref": artifact_ref,
  118 |             }),
  119 |         );
  120 |         Ok(self
  121 |             .store()
  122 |             .admit_evidence_execution(EvidenceExecutionAdmissionRequest {
  123 |                 operation_id: request.operation_id.as_str().to_owned(),
  124 |                 project_id,
  125 |                 work_id: request.expectation.work_id.as_str().to_owned(),
  126 |                 attempt_id: request.expectation.attempt_id.as_str().to_owned(),
  127 |                 fence: request.expectation.fence.get(),
  128 |                 gate_id,
  129 |                 actor_id: actor_id.to_owned(),
  130 |                 session_id: session_id.map(str::to_owned),
  131 |                 request_digest,
  132 |                 artifact_ref: artifact_ref.to_owned(),
  133 |                 source_version_id: Some(
  134 |                     request.expectation.source_snapshot_hash.as_str().to_owned(),
  135 |                 ),
  136 |                 config_identity: request.expectation.config_identity.as_str().to_owned(),
  137 |                 profile_id: request.expectation.profile_id.as_str().to_owned(),
  138 |                 profile_version,
  139 |                 admitted_at: stamp(now),
  140 |             })?)
  141 |     }
  142 | 
  143 |     pub fn start_witnessed_execution(
  144 |         &self,
  145 |         operation_id: &str,
  146 |         now: TimestampMs,
  147 |     ) -> Result<EvidenceExecutionRecord, ApplicationError> {
  148 |         Ok(self
  149 |             .store()
  150 |             .start_evidence_execution(operation_id, &stamp(now))?)
  151 |     }
  152 | 
  153 |     pub fn finish_witnessed_execution(
  154 |         &self,
  155 |         operation_id: &str,
  156 |         exit_code: Option<i32>,
  157 |         now: TimestampMs,
  158 |     ) -> Result<EvidenceExecutionRecord, ApplicationError> {
  159 |         Ok(self
  160 |             .store()
  161 |             .finish_evidence_execution(operation_id, &stamp(now), exit_code)?)
  162 |     }
  163 | 
  164 |     pub fn mark_witnessed_execution_unknown(
  165 |         &self,
  166 |         operation_id: &str,
  167 |         failure_code: &str,
  168 |     ) -> Result<EvidenceExecutionRecord, ApplicationError> {
  169 |         Ok(self
  170 |             .store()
  171 |             .mark_evidence_execution_unknown(operation_id, failure_code)?)
  172 |     }
  173 | 
  174 |     /// Record a receipt produced by the trusted bounded execution adapter.
  175 |     /// The ordinary `record_receipt` path is intentionally an import path and
  176 |     /// rejects `BorealWitnessed`; callers must provide the application-built
  177 |     /// run request/result pair so the full declared command and observable
  178 |     /// expectation is checked again immediately before persistence.
  179 |     pub fn record_witnessed_execution(
  180 |         &self,
  181 |         actor_id: &str,
  182 |         session_id: Option<&str>,
  183 |         request: &EvidenceRunRequest,
  184 |         result: &EvidenceRunResult,
  185 |         expected_project_revision: Option<u64>,
  186 |         now: TimestampMs,
  187 |     ) -> Result<ReceiptInsertResult, ApplicationError> {
  188 |         if request.attestation != crate::ExecutorAttestation::BorealWitnessed
  189 |             || result.receipt.attestation != crate::ExecutorAttestation::BorealWitnessed
  190 |         {
  191 |             return Err(ApplicationError::Evidence(
  192 |                 crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptAttestationMissing),
  193 |             ));
  194 |         }
  195 |         result
  196 |             .receipt
  197 |             .validate_for(&request.expectation)
  198 |             .map_err(ApplicationError::from)?;
  199 |         self.ensure_current_context(&result.receipt, &request.expectation, actor_id, session_id)?;
  200 |         self.insert_receipt(
  201 |             actor_id,
  202 |             session_id,
  203 |             &result.receipt,
  204 |             &request.expectation,
  205 |             ReceiptSubmissionKind::WitnessedExecutor,
  206 |             expected_project_revision,
  207 |             now,
  208 |             receipt_outcome(result.receipt.result),
  209 |             None,
  210 |         )
  211 |     }
  212 | 
  213 |     /// Record an imported receipt with a caller-supplied complete expectation.
  214 |     /// This is useful to adapters that already resolved a declared command and
  215 |     /// observable policy. It still compares the expectation to the persisted
  216 |     /// current attempt/work/gate context before accepting the fact.
  217 |     pub fn record_receipt_with_expectation(
  218 |         &self,
  219 |         actor_id: &str,
  220 |         session_id: Option<&str>,
  221 |         receipt: &ReceiptPayload,
  222 |         expected: &ReceiptExpectation,
  223 |         expected_project_revision: Option<u64>,
  224 |         now: TimestampMs,
  225 |     ) -> Result<ReceiptInsertResult, ApplicationError> {
  226 |         if receipt.attestation == crate::ExecutorAttestation::BorealWitnessed {
  227 |             return Err(ApplicationError::Evidence(
  228 |                 crate::EvidenceValidationError::new(
  229 |                     EvidenceErrorCode::WitnessedReceiptImportDenied,
  230 |                 ),
  231 |             ));
  232 |         }
  233 |         self.ensure_current_context(receipt, expected, actor_id, session_id)?;
  234 |         receipt
  235 |             .validate_for_import(expected)
  236 |             .map_err(ApplicationError::from)?;
  237 |         let (result, rejection_code) =
  238 |             if receipt.result == ReceiptResult::Passed && !receipt.attestation.is_gate_trusted() {
  239 |                 (
  240 |                     ReceiptOutcome::Rejected,
  241 |                     Some(EvidenceErrorCode::ReceiptAttestationMissing.as_str()),
  242 |                 )
  243 |             } else {
  244 |                 (receipt_outcome(receipt.result), None)
  245 |             };
  246 |         self.insert_receipt(
  247 |             actor_id,
  248 |             session_id,
  249 |             receipt,
  250 |             expected,
  251 |             ReceiptSubmissionKind::ExternalImport,
  252 |             expected_project_revision,
  253 |             now,
  254 |             result,
  255 |             rejection_code,
  256 |         )
  257 |     }
  258 | 
  259 |     /// Evaluate only proof eligible for the supplied current attempt. The
  260 |     /// store's work-level gate state is deliberately ignored here: it is a
````

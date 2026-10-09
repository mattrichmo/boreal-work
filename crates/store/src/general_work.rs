//! Additive, immutable persistence for general-work requirements, accepted
//! input lineage, produced artifacts, typed observations, and decisions.
//!
//! Source bytes remain in the existing content-addressed source/blob store.
//! This module stores only project-scoped version identities and provenance.

use super::work_model_v3::V3MutationContext;
use super::{checksum, finish_transaction, MutationResult, SqliteStore, StoreError, SQLITE_ROW};
use boreal_domain::ActorRole;
use serde_json::{json, Value};

pub const GENERAL_WORK_SCHEMA_VERSION: u64 = 1;
const GENERAL_WORK_TABLES: &[&str] = &[
    "boreal_work_contract_v1",
    "boreal_work_input_set_v1",
    "boreal_work_accepted_input_v1",
    "boreal_output_submission_v1",
    "boreal_produced_artifact_v1",
    "boreal_artifact_inspection_v1",
    "boreal_artifact_decision_v1",
    "boreal_external_wait_v1",
    "boreal_external_wait_event_v1",
];
const GENERAL_WORK_IMMUTABILITY_TRIGGERS: &[&str] = &[
    "boreal_work_contract_v1_immutable_update",
    "boreal_work_contract_v1_immutable_delete",
    "boreal_work_input_set_v1_immutable_update",
    "boreal_work_input_set_v1_immutable_delete",
    "boreal_work_accepted_input_v1_immutable_update",
    "boreal_work_accepted_input_v1_immutable_delete",
    "boreal_output_submission_v1_immutable_update",
    "boreal_output_submission_v1_immutable_delete",
    "boreal_produced_artifact_v1_immutable_update",
    "boreal_produced_artifact_v1_immutable_delete",
    "boreal_artifact_inspection_v1_immutable_update",
    "boreal_artifact_inspection_v1_immutable_delete",
    "boreal_artifact_decision_v1_immutable_update",
    "boreal_artifact_decision_v1_immutable_delete",
    "boreal_external_wait_v1_immutable_update",
    "boreal_external_wait_v1_immutable_delete",
    "boreal_external_wait_event_v1_immutable_update",
    "boreal_external_wait_event_v1_immutable_delete",
];
pub const GENERAL_WORK_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_work_contract_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  contract_revision INTEGER NOT NULL CHECK (contract_revision > 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision >= 0),
  rigor_profile_id TEXT NOT NULL CHECK (trim(rigor_profile_id) <> ''),
  rigor_profile_version INTEGER NOT NULL CHECK (rigor_profile_version > 0),
  requirements_json TEXT NOT NULL CHECK (length(requirements_json) <= 262144),
  requirements_digest TEXT NOT NULL CHECK (trim(requirements_digest) <> ''),
  amendment_reason TEXT,
  actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
  created_at TEXT NOT NULL CHECK (trim(created_at) <> ''),
  legacy_gate_policy TEXT NOT NULL CHECK (legacy_gate_policy IN ('preserve','general_work')),
  PRIMARY KEY (project_id, work_id, contract_revision),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE TABLE IF NOT EXISTS boreal_work_input_set_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  input_revision INTEGER NOT NULL CHECK (input_revision > 0),
  contract_revision INTEGER NOT NULL CHECK (contract_revision > 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision >= 0),
  bindings_digest TEXT NOT NULL CHECK (trim(bindings_digest) <> ''),
  amendment_reason TEXT,
  actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
  created_at TEXT NOT NULL CHECK (trim(created_at) <> ''),
  PRIMARY KEY (project_id, work_id, input_revision),
  FOREIGN KEY (project_id, work_id, contract_revision)
    REFERENCES boreal_work_contract_v1(project_id, work_id, contract_revision),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE TABLE IF NOT EXISTS boreal_work_accepted_input_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  input_revision INTEGER NOT NULL CHECK (input_revision > 0),
  input_key TEXT NOT NULL CHECK (trim(input_key) <> '' AND length(input_key) <= 64),
  role TEXT NOT NULL CHECK (trim(role) <> '' AND length(role) <= 128),
  required INTEGER NOT NULL CHECK (required IN (0,1)),
  source_version_id TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (trim(content_digest) <> ''),
  media_type TEXT NOT NULL CHECK (trim(media_type) <> ''),
  byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  availability_snapshot TEXT NOT NULL,
  source_access_scope TEXT NOT NULL,
  producing_work_id TEXT,
  producing_submission_id TEXT,
  producing_artifact_id TEXT,
  accepted_by TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (project_id, work_id, input_revision, input_key),
  FOREIGN KEY (project_id, work_id, input_revision)
    REFERENCES boreal_work_input_set_v1(project_id, work_id, input_revision),
  FOREIGN KEY (project_id, source_version_id)
    REFERENCES source_version(project_id, source_version_id),
  CHECK ((producing_work_id IS NULL AND producing_submission_id IS NULL AND producing_artifact_id IS NULL)
      OR (producing_work_id IS NOT NULL AND producing_submission_id IS NOT NULL AND producing_artifact_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS boreal_output_submission_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  fence INTEGER NOT NULL CHECK (fence > 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  contract_revision INTEGER NOT NULL CHECK (contract_revision > 0),
  input_revision INTEGER NOT NULL CHECK (input_revision >= 0),
  rigor_profile_id TEXT NOT NULL,
  rigor_profile_version INTEGER NOT NULL CHECK (rigor_profile_version > 0),
  producer_actor_id TEXT NOT NULL,
  artifact_set_digest TEXT NOT NULL CHECK (trim(artifact_set_digest) <> ''),
  submitted_at TEXT NOT NULL CHECK (trim(submitted_at) <> ''),
  operation_id TEXT NOT NULL UNIQUE,
  project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
  PRIMARY KEY (project_id, work_id, submission_id),
  FOREIGN KEY (project_id, work_id, contract_revision)
    REFERENCES boreal_work_contract_v1(project_id, work_id, contract_revision),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (attempt_id) REFERENCES attempt(attempt_id)
);
CREATE TABLE IF NOT EXISTS boreal_produced_artifact_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL CHECK (trim(artifact_id) <> '' AND length(artifact_id) <= 255),
  requirement_key TEXT NOT NULL CHECK (trim(requirement_key) <> '' AND length(requirement_key) <= 64),
  source_version_id TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (trim(content_digest) <> ''),
  media_type TEXT NOT NULL CHECK (trim(media_type) <> ''),
  byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  availability_snapshot TEXT NOT NULL,
  access_scope TEXT NOT NULL,
  producer_actor_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  fence INTEGER NOT NULL CHECK (fence > 0),
  captured_at TEXT NOT NULL,
  PRIMARY KEY (project_id, work_id, submission_id, artifact_id),
  FOREIGN KEY (project_id, work_id, submission_id)
    REFERENCES boreal_output_submission_v1(project_id, work_id, submission_id),
  FOREIGN KEY (project_id, source_version_id)
    REFERENCES source_version(project_id, source_version_id)
);
CREATE INDEX IF NOT EXISTS boreal_produced_artifact_source_v1
  ON boreal_produced_artifact_v1(project_id, source_version_id);
CREATE TABLE IF NOT EXISTS boreal_artifact_inspection_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  inspection_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  inspector_actor_id TEXT NOT NULL,
  inspector_kind TEXT NOT NULL CHECK (inspector_kind IN ('automatic','human')),
  outcome TEXT NOT NULL CHECK (outcome IN ('passed','failed','unavailable')),
  criteria_json TEXT NOT NULL CHECK (length(criteria_json) <= 65536),
  inspected_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (project_id, work_id, inspection_id),
  FOREIGN KEY (project_id, work_id, submission_id, artifact_id)
    REFERENCES boreal_produced_artifact_v1(project_id, work_id, submission_id, artifact_id)
);
CREATE TABLE IF NOT EXISTS boreal_artifact_decision_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  contract_revision INTEGER NOT NULL CHECK (contract_revision > 0),
  input_revision INTEGER NOT NULL CHECK (input_revision >= 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  artifact_set_digest TEXT NOT NULL,
  reviewer_actor_id TEXT NOT NULL,
  producer_actor_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','needs_revision')),
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  decided_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (project_id, work_id, decision_id),
  FOREIGN KEY (project_id, work_id, submission_id)
    REFERENCES boreal_output_submission_v1(project_id, work_id, submission_id)
);
CREATE TABLE IF NOT EXISTS boreal_external_wait_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  wait_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (trim(category) <> '' AND length(category) <= 64),
  reason TEXT NOT NULL CHECK (trim(reason) <> '' AND length(reason) <= 2000),
  accountable_kind TEXT NOT NULL CHECK (accountable_kind IN ('person_or_role','external_service')),
  accountable_ref TEXT NOT NULL CHECK (trim(accountable_ref) <> '' AND length(accountable_ref) <= 255),
  expected_decision_or_output TEXT NOT NULL CHECK (trim(expected_decision_or_output) <> '' AND length(expected_decision_or_output) <= 2000),
  follow_up_json TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  project_revision INTEGER NOT NULL CHECK (project_revision >= 0),
  PRIMARY KEY (project_id, work_id, wait_id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE TABLE IF NOT EXISTS boreal_external_wait_event_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  wait_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('resolved','cancelled')),
  actor_id TEXT NOT NULL,
  result TEXT,
  rationale TEXT NOT NULL CHECK (trim(rationale) <> '' AND length(rationale) <= 2000),
  occurred_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (project_id, work_id, wait_id, event_id),
  FOREIGN KEY (project_id, work_id, wait_id)
    REFERENCES boreal_external_wait_v1(project_id, work_id, wait_id),
  CHECK ((state = 'resolved' AND result IS NOT NULL AND trim(result) <> '') OR state = 'cancelled')
);
CREATE INDEX IF NOT EXISTS boreal_external_wait_work_v1
  ON boreal_external_wait_v1(project_id, work_id, created_at);
CREATE TRIGGER IF NOT EXISTS boreal_work_contract_v1_immutable_update BEFORE UPDATE ON boreal_work_contract_v1
BEGIN SELECT RAISE(ABORT,'work_contract_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_work_contract_v1_immutable_delete BEFORE DELETE ON boreal_work_contract_v1
BEGIN SELECT RAISE(ABORT,'work_contract_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_work_input_set_v1_immutable_update BEFORE UPDATE ON boreal_work_input_set_v1
BEGIN SELECT RAISE(ABORT,'work_input_set_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_work_input_set_v1_immutable_delete BEFORE DELETE ON boreal_work_input_set_v1
BEGIN SELECT RAISE(ABORT,'work_input_set_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_work_accepted_input_v1_immutable_update BEFORE UPDATE ON boreal_work_accepted_input_v1
BEGIN SELECT RAISE(ABORT,'work_accepted_input_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_work_accepted_input_v1_immutable_delete BEFORE DELETE ON boreal_work_accepted_input_v1
BEGIN SELECT RAISE(ABORT,'work_accepted_input_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_output_submission_v1_immutable_update BEFORE UPDATE ON boreal_output_submission_v1
BEGIN SELECT RAISE(ABORT,'output_submission_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_output_submission_v1_immutable_delete BEFORE DELETE ON boreal_output_submission_v1
BEGIN SELECT RAISE(ABORT,'output_submission_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_produced_artifact_v1_immutable_update BEFORE UPDATE ON boreal_produced_artifact_v1
BEGIN SELECT RAISE(ABORT,'produced_artifact_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_produced_artifact_v1_immutable_delete BEFORE DELETE ON boreal_produced_artifact_v1
BEGIN SELECT RAISE(ABORT,'produced_artifact_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_artifact_inspection_v1_immutable_update BEFORE UPDATE ON boreal_artifact_inspection_v1
BEGIN SELECT RAISE(ABORT,'artifact_inspection_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_artifact_inspection_v1_immutable_delete BEFORE DELETE ON boreal_artifact_inspection_v1
BEGIN SELECT RAISE(ABORT,'artifact_inspection_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_artifact_decision_v1_immutable_update BEFORE UPDATE ON boreal_artifact_decision_v1
BEGIN SELECT RAISE(ABORT,'artifact_decision_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_artifact_decision_v1_immutable_delete BEFORE DELETE ON boreal_artifact_decision_v1
BEGIN SELECT RAISE(ABORT,'artifact_decision_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_external_wait_v1_immutable_update BEFORE UPDATE ON boreal_external_wait_v1
BEGIN SELECT RAISE(ABORT,'external_wait_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_external_wait_v1_immutable_delete BEFORE DELETE ON boreal_external_wait_v1
BEGIN SELECT RAISE(ABORT,'external_wait_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_external_wait_event_v1_immutable_update BEFORE UPDATE ON boreal_external_wait_event_v1
BEGIN SELECT RAISE(ABORT,'external_wait_event_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_external_wait_event_v1_immutable_delete BEFORE DELETE ON boreal_external_wait_event_v1
BEGIN SELECT RAISE(ABORT,'external_wait_event_immutable'); END;
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkContractRevisionInput {
    pub work_id: String,
    pub expected_contract_revision: u64,
    pub new_contract_revision: u64,
    pub rigor_profile_id: String,
    pub rigor_profile_version: u64,
    pub requirements_json: String,
    pub amendment_reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkContractRevisionRecord {
    pub project_id: String,
    pub work_id: String,
    pub contract_revision: u64,
    pub proof_revision: u64,
    pub rigor_profile_id: String,
    pub rigor_profile_version: u64,
    pub requirements_json: String,
    pub requirements_digest: String,
    pub amendment_reason: Option<String>,
    pub actor_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
    pub legacy_gate_policy: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedInputBindingInput {
    pub input_key: String,
    pub role: String,
    pub required: bool,
    pub source_version_id: String,
    pub producing_work_id: Option<String>,
    pub producing_submission_id: Option<String>,
    pub producing_artifact_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedInputSetInput {
    pub work_id: String,
    pub expected_contract_revision: u64,
    pub expected_input_revision: u64,
    pub new_input_revision: u64,
    pub bindings: Vec<AcceptedInputBindingInput>,
    pub amendment_reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedInputBindingRecord {
    pub input_revision: u64,
    pub input_key: String,
    pub role: String,
    pub required: bool,
    pub source_version_id: String,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub availability: String,
    pub access_scope: String,
    pub producing_work_id: Option<String>,
    pub producing_submission_id: Option<String>,
    pub producing_artifact_id: Option<String>,
    pub accepted_by: String,
    pub accepted_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedInputSetRecord {
    pub project_id: String,
    pub work_id: String,
    pub input_revision: u64,
    pub contract_revision: u64,
    pub proof_revision: u64,
    pub bindings_digest: String,
    pub amendment_reason: Option<String>,
    pub actor_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
    pub bindings: Vec<AcceptedInputBindingRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProducedArtifactInput {
    pub artifact_id: String,
    pub requirement_key: String,
    pub source_version_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputSubmissionInput {
    pub work_id: String,
    pub submission_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub proof_revision: u64,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub artifacts: Vec<ProducedArtifactInput>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputSubmissionRecord {
    pub project_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub proof_revision: u64,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub rigor_profile_id: String,
    pub rigor_profile_version: u64,
    pub producer_actor_id: String,
    pub artifact_set_digest: String,
    pub submitted_at: String,
    pub artifacts: Vec<ProducedArtifactRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputAcceptanceRecord {
    pub project_id: String,
    pub work_id: String,
    pub project_revision: u64,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub proof_revision: u64,
    pub rigor_profile_id: String,
    pub rigor_profile_version: u64,
    pub submission_id: Option<String>,
    pub artifact_set_digest: Option<String>,
    pub coverage: boreal_domain::deliverables::OutputCoverage,
    pub safe_next_operations: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProducedArtifactRecord {
    pub artifact_id: String,
    pub requirement_key: String,
    pub source_version_id: String,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub availability: String,
    pub access_scope: String,
    pub producer_actor_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub captured_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactInspectionRecord {
    pub project_id: String,
    pub work_id: String,
    pub inspection_id: String,
    pub submission_id: String,
    pub artifact_id: String,
    pub artifact_digest: String,
    pub inspector_actor_id: String,
    pub inspector_kind: String,
    pub outcome: String,
    pub criteria_json: String,
    pub inspected_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactDecisionRecord {
    pub project_id: String,
    pub work_id: String,
    pub decision_id: String,
    pub submission_id: String,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub proof_revision: u64,
    pub artifact_set_digest: String,
    pub reviewer_actor_id: String,
    pub producer_actor_id: String,
    pub decision: String,
    pub reason: String,
    pub decided_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactEvidenceRecord {
    pub project_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub inspections: Vec<ArtifactInspectionRecord>,
    pub decisions: Vec<ArtifactDecisionRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactInspectionInput {
    pub work_id: String,
    pub inspection_id: String,
    pub submission_id: String,
    pub artifact_id: String,
    pub artifact_digest: String,
    pub inspector_kind: String,
    pub outcome: String,
    pub criteria_json: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactDecisionInput {
    pub work_id: String,
    pub decision_id: String,
    pub submission_id: String,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub proof_revision: u64,
    pub artifact_set_digest: String,
    pub producer_actor_id: String,
    pub decision: String,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalWaitInput {
    pub work_id: String,
    pub wait_id: String,
    pub category: String,
    pub reason: String,
    pub accountable_kind: String,
    pub accountable_ref: String,
    pub expected_decision_or_output: String,
    pub follow_up_json: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalWaitRecord {
    pub project_id: String,
    pub work_id: String,
    pub wait_id: String,
    pub category: String,
    pub reason: String,
    pub accountable_kind: String,
    pub accountable_ref: String,
    pub expected_decision_or_output: String,
    pub follow_up_json: Option<String>,
    pub state: String,
    pub created_by: String,
    pub created_at: String,
    pub resolved_by: Option<String>,
    pub result: Option<String>,
    pub resolution_rationale: Option<String>,
    pub resolved_at: Option<String>,
    pub cancelled_by: Option<String>,
    pub cancellation_reason: Option<String>,
    pub cancelled_at: Option<String>,
}

impl SqliteStore {
    pub fn ensure_general_work_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema(
            "general_work",
            GENERAL_WORK_SCHEMA_VERSION,
            GENERAL_WORK_SCHEMA_SQL,
        )?;
        self.verify_general_work_schema_contract()
    }

    fn verify_general_work_schema_contract(&self) -> Result<(), StoreError> {
        for table in GENERAL_WORK_TABLES {
            if !self.table_exists(table)? {
                return Err(StoreError::Corrupt(format!(
                    "general-work schema is missing required table {table}"
                )));
            }
        }
        for trigger in GENERAL_WORK_IMMUTABILITY_TRIGGERS {
            if !self.schema_object_exists("trigger", trigger)? {
                return Err(StoreError::Corrupt(format!(
                    "general-work schema is missing required immutability trigger {trigger}"
                )));
            }
        }
        Ok(())
    }

    pub fn set_work_contract_v1(
        &self,
        context: &V3MutationContext,
        input: &WorkContractRevisionInput,
    ) -> Result<MutationResult, StoreError> {
        validate_contract_input(input)?;
        let (requirements_json, requirements_digest) =
            canonical_json_and_digest(&input.requirements_json)?;
        let payload = json!({
            "work_id": input.work_id,
            "expected_contract_revision": input.expected_contract_revision,
            "new_contract_revision": input.new_contract_revision,
            "rigor_profile_id": input.rigor_profile_id,
            "rigor_profile_version": input.rigor_profile_version,
            "requirements_json": requirements_json,
            "requirements_digest": requirements_digest,
            "amendment_reason": input.amendment_reason,
        });
        let context = context.with_payload(payload);
        self.fact_mutation(
            &context,
            "work.contract.set/v1",
            "work",
            &input.work_id,
            &[ActorRole::Operator],
            || {
                self.require_general_work_schema()?;
                self.require_work(&context.project_id, &input.work_id)?;
                self.require_no_active_attempt(&input.work_id)?;
                self.require_amendable_work(&context.project_id, &input.work_id)?;
                let current = self.latest_contract_revision(&context.project_id, &input.work_id)?;
                if current != input.expected_contract_revision {
                    return Err(StoreError::StaleRevision { expected: input.expected_contract_revision, actual: current });
                }
                self.require_general_work_amendment_reason(
                    &context.project_id,
                    &input.work_id,
                    current,
                    input.amendment_reason.as_deref(),
                    "output contract",
                )?;
                if input.new_contract_revision != current + 1 {
                    return Err(StoreError::Invalid("new contract revision must be exactly the next revision".into()));
                }
                let legacy_gate_policy = if current > 0 {
                    // A new general-work rigor can deliberately supersede the
                    // legacy command-gate policy only through this revisioned,
                    // reasoned amendment. Historical gates and receipts remain
                    // immutable and readable.
                    if is_nonsoftware_general_rigor(&input.rigor_profile_id) {
                        "general_work".to_owned()
                    } else {
                        "preserve".to_owned()
                    }
                } else {
                    self.initial_legacy_gate_policy(&context.project_id, &input.work_id, &input.rigor_profile_id)?
                };
                let proof_revision = self.advance_general_work_proof(&context.project_id, &input.work_id, &context.now)?;
                let project_revision = self.project_revision(&context.project_id)?.0 + 1;
                let mut insert = self.prepare("INSERT INTO boreal_work_contract_v1 (project_id,work_id,contract_revision,proof_revision,rigor_profile_id,rigor_profile_version,requirements_json,requirements_digest,amendment_reason,actor_id,operation_id,project_revision,created_at,legacy_gate_policy) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)")?;
                insert.bind_text(1, &context.project_id)?;
                insert.bind_text(2, &input.work_id)?;
                insert.bind_i64(3, input.new_contract_revision)?;
                insert.bind_i64(4, proof_revision)?;
                insert.bind_text(5, &input.rigor_profile_id)?;
                insert.bind_i64(6, input.rigor_profile_version)?;
                insert.bind_text(7, &requirements_json)?;
                insert.bind_text(8, &requirements_digest)?;
                bind_optional_text(&mut insert, 9, input.amendment_reason.as_deref())?;
                insert.bind_text(10, &context.actor_id)?;
                insert.bind_text(11, &context.operation_id)?;
                insert.bind_i64(12, project_revision)?;
                insert.bind_text(13, &context.now)?;
                insert.bind_text(14, &legacy_gate_policy)?;
                insert.run()?;
                Ok(())
            },
        )
    }

    pub fn work_contract_v1(
        &self,
        project_id: &str,
        work_id: &str,
        revision: Option<u64>,
    ) -> Result<Option<WorkContractRevisionRecord>, StoreError> {
        self.require_general_work_schema()?;
        let mut query = self.prepare(if revision.is_some() {
            "SELECT project_id,work_id,contract_revision,proof_revision,rigor_profile_id,rigor_profile_version,requirements_json,requirements_digest,amendment_reason,actor_id,operation_id,project_revision,created_at,legacy_gate_policy FROM boreal_work_contract_v1 WHERE project_id=?1 AND work_id=?2 AND contract_revision=?3"
        } else {
            "SELECT project_id,work_id,contract_revision,proof_revision,rigor_profile_id,rigor_profile_version,requirements_json,requirements_digest,amendment_reason,actor_id,operation_id,project_revision,created_at,legacy_gate_policy FROM boreal_work_contract_v1 WHERE project_id=?1 AND work_id=?2 ORDER BY contract_revision DESC LIMIT 1"
        })?;
        query.bind_text(1, project_id)?;
        query.bind_text(2, work_id)?;
        if let Some(revision) = revision {
            query.bind_i64(3, revision)?;
        }
        if query.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(WorkContractRevisionRecord {
            project_id: query.column_text(0)?,
            work_id: query.column_text(1)?,
            contract_revision: query.column_u64(2)?,
            proof_revision: query.column_u64(3)?,
            rigor_profile_id: query.column_text(4)?,
            rigor_profile_version: query.column_u64(5)?,
            requirements_json: query.column_text(6)?,
            requirements_digest: query.column_text(7)?,
            amendment_reason: query.column_optional_text(8)?,
            actor_id: query.column_text(9)?,
            operation_id: query.column_text(10)?,
            project_revision: query.column_u64(11)?,
            created_at: query.column_text(12)?,
            legacy_gate_policy: query.column_text(13)?,
        }))
    }

    pub fn set_accepted_input_set_v1(
        &self,
        context: &V3MutationContext,
        input: &AcceptedInputSetInput,
    ) -> Result<MutationResult, StoreError> {
        validate_input_set(input)?;
        let payload = json!({
            "work_id": input.work_id,
            "expected_contract_revision": input.expected_contract_revision,
            "expected_input_revision": input.expected_input_revision,
            "new_input_revision": input.new_input_revision,
            "bindings": input.bindings.iter().map(|binding| json!({
                "input_key": binding.input_key,"role": binding.role,"required": binding.required,
                "source_version_id": binding.source_version_id,"producing_work_id": binding.producing_work_id,
                "producing_submission_id": binding.producing_submission_id,"producing_artifact_id": binding.producing_artifact_id,
            })).collect::<Vec<_>>(),
            "amendment_reason": input.amendment_reason,
        });
        let context = context.with_payload(payload);
        self.fact_mutation(&context, "work.inputs.accept/v1", "work", &input.work_id, &[ActorRole::Operator], || {
            self.require_general_work_schema()?;
            self.require_work(&context.project_id, &input.work_id)?;
            self.require_no_active_attempt(&input.work_id)?;
            self.require_amendable_work(&context.project_id, &input.work_id)?;
            let contract = self.latest_contract_revision(&context.project_id, &input.work_id)?;
            if contract == 0 {
                return Err(StoreError::Conflict(
                    "accepted inputs require an existing immutable output contract revision".into(),
                ));
            }
            if contract != input.expected_contract_revision {
                return Err(StoreError::StaleRevision { expected: input.expected_contract_revision, actual: contract });
            }
            let current = self.latest_input_revision(&context.project_id, &input.work_id)?;
            if current != input.expected_input_revision {
                return Err(StoreError::StaleRevision { expected: input.expected_input_revision, actual: current });
            }
            self.require_general_work_amendment_reason(
                &context.project_id,
                &input.work_id,
                current,
                input.amendment_reason.as_deref(),
                "accepted input set",
            )?;
            if input.new_input_revision != current + 1 { return Err(StoreError::Invalid("new input revision must be exactly the next revision".into())); }
            let mut rows = Vec::with_capacity(input.bindings.len());
            let mut keys = std::collections::BTreeSet::new();
            for binding in &input.bindings {
                if !keys.insert(binding.input_key.as_str()) {
                    return Err(StoreError::Conflict("duplicate accepted input key".into()));
                }
                let source = self.source_version(&context.project_id, &binding.source_version_id)?
                    .ok_or_else(|| StoreError::NotFound { entity: "source version", id: binding.source_version_id.clone() })?;
                if binding.required && source.availability != "available" {
                    return Err(StoreError::Conflict(format!("required input {} is {}", binding.input_key, source.availability)));
                }
                match (&binding.producing_work_id, &binding.producing_submission_id, &binding.producing_artifact_id) {
                    (None,None,None) => {},
                    (Some(upstream),Some(submission),Some(artifact)) => self.require_exact_produced_artifact(&context.project_id, upstream, submission, artifact, &binding.source_version_id)?,
                    _ => return Err(StoreError::Invalid("produced input lineage requires work, submission, and artifact identities".into())),
                }
                rows.push((binding.clone(), source));
            }
            let proof_revision = self.advance_general_work_proof(&context.project_id, &input.work_id, &context.now)?;
            let project_revision = self.project_revision(&context.project_id)?.0 + 1;
            let bindings_json = json!(rows.iter().map(|(binding, source)| json!({
                "input_key": binding.input_key,"role": binding.role,"required": binding.required,
                "source_version_id": source.source_version_id,"content_digest": source.content_digest,
                "media_type": source.media_type,"byte_count": source.byte_count,
                "availability": source.availability,"access_scope": source.access_scope,
                "producing_work_id": binding.producing_work_id,"producing_submission_id": binding.producing_submission_id,
                "producing_artifact_id": binding.producing_artifact_id,
            })).collect::<Vec<_>>());
            let (bindings_json, digest) = canonical_json_and_digest(&bindings_json.to_string())?;
            let mut header = self.prepare("INSERT INTO boreal_work_input_set_v1 (project_id,work_id,input_revision,contract_revision,proof_revision,bindings_digest,amendment_reason,actor_id,operation_id,project_revision,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)")?;
            header.bind_text(1, &context.project_id)?; header.bind_text(2, &input.work_id)?;
            header.bind_i64(3, input.new_input_revision)?; header.bind_i64(4, contract)?;
            header.bind_i64(5, proof_revision)?; header.bind_text(6, &digest)?;
            bind_optional_text(&mut header, 7, input.amendment_reason.as_deref())?;
            header.bind_text(8, &context.actor_id)?; header.bind_text(9, &context.operation_id)?;
            header.bind_i64(10, project_revision)?; header.bind_text(11, &context.now)?; header.run()?;
            for (binding, source) in rows {
                let mut insert = self.prepare("INSERT INTO boreal_work_accepted_input_v1 (project_id,work_id,input_revision,input_key,role,required,source_version_id,content_digest,media_type,byte_count,availability_snapshot,source_access_scope,producing_work_id,producing_submission_id,producing_artifact_id,accepted_by,accepted_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)")?;
                insert.bind_text(1, &context.project_id)?; insert.bind_text(2, &input.work_id)?;
                insert.bind_i64(3, input.new_input_revision)?; insert.bind_text(4, &binding.input_key)?;
                insert.bind_text(5, &binding.role)?;
                insert.bind_i64(6, if binding.required { 1 } else { 0 })?;
                insert.bind_text(7, &source.source_version_id)?; insert.bind_text(8, &source.content_digest)?;
                insert.bind_text(9, &source.media_type)?; insert.bind_i64(10, source.byte_count)?;
                insert.bind_text(11, &source.availability)?; insert.bind_text(12, &source.access_scope)?;
                bind_optional_text(&mut insert, 13, binding.producing_work_id.as_deref())?;
                bind_optional_text(&mut insert, 14, binding.producing_submission_id.as_deref())?;
                bind_optional_text(&mut insert, 15, binding.producing_artifact_id.as_deref())?;
                insert.bind_text(16, &context.actor_id)?; insert.bind_text(17, &context.now)?; insert.run()?;
            }
            let _ = bindings_json;
            Ok(())
        })
    }

    pub fn accepted_input_set_v1(
        &self,
        project_id: &str,
        work_id: &str,
        input_revision: Option<u64>,
    ) -> Result<Option<AcceptedInputSetRecord>, StoreError> {
        self.require_general_work_schema()?;
        let mut header = self.prepare(if input_revision.is_some() {
            "SELECT input_revision,contract_revision,proof_revision,bindings_digest,amendment_reason,actor_id,operation_id,project_revision,created_at FROM boreal_work_input_set_v1 WHERE project_id=?1 AND work_id=?2 AND input_revision=?3"
        } else {
            "SELECT input_revision,contract_revision,proof_revision,bindings_digest,amendment_reason,actor_id,operation_id,project_revision,created_at FROM boreal_work_input_set_v1 WHERE project_id=?1 AND work_id=?2 ORDER BY input_revision DESC LIMIT 1"
        })?;
        header.bind_text(1, project_id)?;
        header.bind_text(2, work_id)?;
        if let Some(revision) = input_revision {
            header.bind_i64(3, revision)?;
        }
        if header.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let mut record = AcceptedInputSetRecord {
            project_id: project_id.to_owned(),
            work_id: work_id.to_owned(),
            input_revision: header.column_u64(0)?,
            contract_revision: header.column_u64(1)?,
            proof_revision: header.column_u64(2)?,
            bindings_digest: header.column_text(3)?,
            amendment_reason: header.column_optional_text(4)?,
            actor_id: header.column_text(5)?,
            operation_id: header.column_text(6)?,
            project_revision: header.column_u64(7)?,
            created_at: header.column_text(8)?,
            bindings: Vec::new(),
        };
        let mut query = self.prepare("SELECT input_revision,input_key,role,required,source_version_id,content_digest,media_type,byte_count,availability_snapshot,source_access_scope,producing_work_id,producing_submission_id,producing_artifact_id,accepted_by,accepted_at FROM boreal_work_accepted_input_v1 WHERE project_id=?1 AND work_id=?2 AND input_revision=?3 ORDER BY input_key")?;
        query.bind_text(1, project_id)?;
        query.bind_text(2, work_id)?;
        query.bind_i64(3, record.input_revision)?;
        while query.step()? == SQLITE_ROW {
            record.bindings.push(AcceptedInputBindingRecord {
                input_revision: query.column_u64(0)?,
                input_key: query.column_text(1)?,
                role: query.column_text(2)?,
                required: query.column_bool(3)?,
                source_version_id: query.column_text(4)?,
                content_digest: query.column_text(5)?,
                media_type: query.column_text(6)?,
                byte_count: query.column_u64(7)?,
                availability: query.column_text(8)?,
                access_scope: query.column_text(9)?,
                producing_work_id: query.column_optional_text(10)?,
                producing_submission_id: query.column_optional_text(11)?,
                producing_artifact_id: query.column_optional_text(12)?,
                accepted_by: query.column_text(13)?,
                accepted_at: query.column_text(14)?,
            });
        }
        Ok(Some(record))
    }

    pub fn submit_output_artifacts_v1(
        &self,
        context: &V3MutationContext,
        input: &OutputSubmissionInput,
    ) -> Result<(MutationResult, OutputSubmissionRecord), StoreError> {
        validate_output_submission(input)?;
        let payload = json!({"work_id":input.work_id,"submission_id":input.submission_id,"attempt_id":input.attempt_id,"fence":input.fence,
            "proof_revision":input.proof_revision,"contract_revision":input.contract_revision,"input_revision":input.input_revision,
            "artifacts":input.artifacts.iter().map(|a| json!({"artifact_id":a.artifact_id,"requirement_key":a.requirement_key,"source_version_id":a.source_version_id})).collect::<Vec<_>>()});
        let context = context.with_payload(payload);
        let mutation = self.fact_mutation(&context, "work.outputs.submit/v1", "work", &input.work_id, &[ActorRole::Agent,ActorRole::Operator], || {
            self.require_general_work_schema()?;
            self.require_work(&context.project_id,&input.work_id)?;
            if self.latest_contract_revision(&context.project_id,&input.work_id)? != input.contract_revision { return Err(StoreError::Conflict("output submission contract revision is stale".into())); }
            if self.latest_input_revision(&context.project_id,&input.work_id)? != input.input_revision { return Err(StoreError::Conflict("output submission input revision is stale".into())); }
            let (profile_id,profile_version,requirements_json) = self.contract_profile_and_requirements(&context.project_id,&input.work_id,input.contract_revision)?;
            let current_proof = self.proof_revision(&context.project_id,&input.work_id)?;
            if current_proof != input.proof_revision { return Err(StoreError::StaleRevision{expected:input.proof_revision,actual:current_proof}); }
            let mut attempt=self.prepare("SELECT actor_id,state,current FROM attempt WHERE attempt_id=?1 AND work_id=?2 AND fence=?3")?;
            attempt.bind_text(1,&input.attempt_id)?;attempt.bind_text(2,&input.work_id)?;attempt.bind_i64(3,input.fence)?;
            if attempt.step()?!=SQLITE_ROW || attempt.column_text(0)?!=context.actor_id || !attempt.column_bool(2)? || !matches!(attempt.column_text(1)?.as_str(),"running"|"verifying") {
                return Err(StoreError::Conflict("output submission must bind the current actor-owned attempt and fence".into()));
            }
            let requirements:Value=serde_json::from_str(&requirements_json).map_err(|_|StoreError::Corrupt("pinned output requirements are invalid JSON".into()))?;
            let declared=requirements.get("requirements").and_then(Value::as_array).ok_or_else(||StoreError::Corrupt("pinned output requirements are missing".into()))?;
            let mut artifact_records=Vec::new(); let mut unique=std::collections::BTreeSet::new();
            for artifact in &input.artifacts {
                if !unique.insert(artifact.artifact_id.as_str()) { return Err(StoreError::Conflict("duplicate artifact id in submission".into())); }
                let requirement=declared.iter().find(|row|row.get("requirement_key").and_then(Value::as_str)==Some(&artifact.requirement_key)).ok_or_else(||StoreError::Invalid(format!("output requirement {} is not declared",artifact.requirement_key)))?;
                let source=self.source_version(&context.project_id,&artifact.source_version_id)?.ok_or_else(||StoreError::NotFound{entity:"source version",id:artifact.source_version_id.clone()})?;
                if source.byte_count > 1_073_741_824 { return Err(StoreError::Invalid("produced artifact exceeds the 1 GiB bound".into())); }
                let media=requirement.get("allowed_media_types").and_then(Value::as_array).is_some_and(|types|types.iter().any(|value|value.as_str().is_some_and(|candidate|candidate.eq_ignore_ascii_case(&source.media_type))));
                if !media { return Err(StoreError::Conflict(format!("artifact {} has media type outside requirement {}",artifact.artifact_id,artifact.requirement_key))); }
                if source.availability!="available" { return Err(StoreError::Conflict(format!("artifact {} bytes are {}",artifact.artifact_id,source.availability))); }
                artifact_records.push(ProducedArtifactRecord{artifact_id:artifact.artifact_id.clone(),requirement_key:artifact.requirement_key.clone(),source_version_id:source.source_version_id,content_digest:source.content_digest,media_type:source.media_type,byte_count:source.byte_count,availability:source.availability,access_scope:source.access_scope,producer_actor_id:context.actor_id.clone(),attempt_id:input.attempt_id.clone(),fence:input.fence,captured_at:context.now.clone()});
            }
            for requirement in declared {
                let key=requirement.get("requirement_key").and_then(Value::as_str).unwrap_or_default();
                let max=requirement.get("maximum_count").and_then(Value::as_u64).unwrap_or(0) as usize;
                if input.artifacts.iter().filter(|artifact|artifact.requirement_key==key).count()>max {return Err(StoreError::Conflict(format!("too many artifacts for requirement {key}")));}
            }
            artifact_records.sort_by(|a,b|a.artifact_id.cmp(&b.artifact_id));
            let artifact_set_json=json!(artifact_records.iter().map(|a|json!({"artifact_id":a.artifact_id,"requirement_key":a.requirement_key,"source_version_id":a.source_version_id,"content_digest":a.content_digest,"media_type":a.media_type,"byte_count":a.byte_count})).collect::<Vec<_>>()).to_string();
            let (_,artifact_set_digest)=canonical_json_and_digest(&artifact_set_json)?;
            let project_revision=self.project_revision(&context.project_id)?.0+1;
            let mut header=self.prepare("INSERT INTO boreal_output_submission_v1(project_id,work_id,submission_id,attempt_id,fence,proof_revision,contract_revision,input_revision,rigor_profile_id,rigor_profile_version,producer_actor_id,artifact_set_digest,submitted_at,operation_id,project_revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)")?;
            header.bind_text(1,&context.project_id)?;header.bind_text(2,&input.work_id)?;header.bind_text(3,&input.submission_id)?;header.bind_text(4,&input.attempt_id)?;header.bind_i64(5,input.fence)?;header.bind_i64(6,input.proof_revision)?;header.bind_i64(7,input.contract_revision)?;header.bind_i64(8,input.input_revision)?;header.bind_text(9,&profile_id)?;header.bind_i64(10,profile_version)?;header.bind_text(11,&context.actor_id)?;header.bind_text(12,&artifact_set_digest)?;header.bind_text(13,&context.now)?;header.bind_text(14,&context.operation_id)?;header.bind_i64(15,project_revision)?;header.run()?;
            for artifact in &artifact_records { let mut row=self.prepare("INSERT INTO boreal_produced_artifact_v1(project_id,work_id,submission_id,artifact_id,requirement_key,source_version_id,content_digest,media_type,byte_count,availability_snapshot,access_scope,producer_actor_id,attempt_id,fence,captured_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)")?;row.bind_text(1,&context.project_id)?;row.bind_text(2,&input.work_id)?;row.bind_text(3,&input.submission_id)?;row.bind_text(4,&artifact.artifact_id)?;row.bind_text(5,&artifact.requirement_key)?;row.bind_text(6,&artifact.source_version_id)?;row.bind_text(7,&artifact.content_digest)?;row.bind_text(8,&artifact.media_type)?;row.bind_i64(9,artifact.byte_count)?;row.bind_text(10,&artifact.availability)?;row.bind_text(11,&artifact.access_scope)?;row.bind_text(12,&artifact.producer_actor_id)?;row.bind_text(13,&artifact.attempt_id)?;row.bind_i64(14,artifact.fence)?;row.bind_text(15,&artifact.captured_at)?;row.run()?; }
            Ok(())
        })?;
        let record = self
            .output_submission_v1(&context.project_id, &input.work_id, &input.submission_id)?
            .ok_or_else(|| {
                StoreError::Corrupt("output submission committed without its readback".into())
            })?;
        Ok((mutation, record))
    }

    pub fn output_submission_v1(
        &self,
        project_id: &str,
        work_id: &str,
        submission_id: &str,
    ) -> Result<Option<OutputSubmissionRecord>, StoreError> {
        self.require_general_work_schema()?;
        let mut q=self.prepare("SELECT project_id,work_id,submission_id,attempt_id,fence,proof_revision,contract_revision,input_revision,rigor_profile_id,rigor_profile_version,producer_actor_id,artifact_set_digest,submitted_at FROM boreal_output_submission_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3")?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        q.bind_text(3, submission_id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let mut record = OutputSubmissionRecord {
            project_id: q.column_text(0)?,
            work_id: q.column_text(1)?,
            submission_id: q.column_text(2)?,
            attempt_id: q.column_text(3)?,
            fence: q.column_u64(4)?,
            proof_revision: q.column_u64(5)?,
            contract_revision: q.column_u64(6)?,
            input_revision: q.column_u64(7)?,
            rigor_profile_id: q.column_text(8)?,
            rigor_profile_version: q.column_u64(9)?,
            producer_actor_id: q.column_text(10)?,
            artifact_set_digest: q.column_text(11)?,
            submitted_at: q.column_text(12)?,
            artifacts: Vec::new(),
        };
        let mut a=self.prepare("SELECT artifact_id,requirement_key,source_version_id,content_digest,media_type,byte_count,availability_snapshot,access_scope,producer_actor_id,attempt_id,fence,captured_at FROM boreal_produced_artifact_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 ORDER BY artifact_id")?;
        a.bind_text(1, project_id)?;
        a.bind_text(2, work_id)?;
        a.bind_text(3, submission_id)?;
        while a.step()? == SQLITE_ROW {
            record.artifacts.push(ProducedArtifactRecord {
                artifact_id: a.column_text(0)?,
                requirement_key: a.column_text(1)?,
                source_version_id: a.column_text(2)?,
                content_digest: a.column_text(3)?,
                media_type: a.column_text(4)?,
                byte_count: a.column_u64(5)?,
                availability: a.column_text(6)?,
                access_scope: a.column_text(7)?,
                producer_actor_id: a.column_text(8)?,
                attempt_id: a.column_text(9)?,
                fence: a.column_u64(10)?,
                captured_at: a.column_text(11)?,
            });
        }
        Ok(Some(record))
    }

    /// Read the immutable inspection and decision history for one exact
    /// submission. A single SQLite snapshot keeps both lists mutually
    /// consistent while later observations may continue to append.
    pub fn artifact_evidence_v1(
        &self,
        project_id: &str,
        work_id: &str,
        submission_id: &str,
    ) -> Result<Option<ArtifactEvidenceRecord>, StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            self.require_general_work_schema()?;
            let mut exists = self.prepare(
                "SELECT 1 FROM boreal_output_submission_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3",
            )?;
            exists.bind_text(1, project_id)?;
            exists.bind_text(2, work_id)?;
            exists.bind_text(3, submission_id)?;
            if exists.step()? != SQLITE_ROW {
                return Ok(None);
            }

            let mut inspections = Vec::new();
            let mut query = self.prepare(
                "SELECT inspection_id,artifact_id,artifact_digest,inspector_actor_id,inspector_kind,outcome,criteria_json,inspected_at
                 FROM boreal_artifact_inspection_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 ORDER BY rowid",
            )?;
            query.bind_text(1, project_id)?;
            query.bind_text(2, work_id)?;
            query.bind_text(3, submission_id)?;
            while query.step()? == SQLITE_ROW {
                inspections.push(ArtifactInspectionRecord {
                    project_id: project_id.to_owned(),
                    work_id: work_id.to_owned(),
                    inspection_id: query.column_text(0)?,
                    submission_id: submission_id.to_owned(),
                    artifact_id: query.column_text(1)?,
                    artifact_digest: query.column_text(2)?,
                    inspector_actor_id: query.column_text(3)?,
                    inspector_kind: query.column_text(4)?,
                    outcome: query.column_text(5)?,
                    criteria_json: query.column_text(6)?,
                    inspected_at: query.column_text(7)?,
                });
            }

            let mut decisions = Vec::new();
            let mut query = self.prepare(
                "SELECT decision_id,contract_revision,input_revision,proof_revision,artifact_set_digest,reviewer_actor_id,producer_actor_id,decision,reason,decided_at
                 FROM boreal_artifact_decision_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 ORDER BY rowid",
            )?;
            query.bind_text(1, project_id)?;
            query.bind_text(2, work_id)?;
            query.bind_text(3, submission_id)?;
            while query.step()? == SQLITE_ROW {
                decisions.push(ArtifactDecisionRecord {
                    project_id: project_id.to_owned(),
                    work_id: work_id.to_owned(),
                    decision_id: query.column_text(0)?,
                    submission_id: submission_id.to_owned(),
                    contract_revision: query.column_u64(1)?,
                    input_revision: query.column_u64(2)?,
                    proof_revision: query.column_u64(3)?,
                    artifact_set_digest: query.column_text(4)?,
                    reviewer_actor_id: query.column_text(5)?,
                    producer_actor_id: query.column_text(6)?,
                    decision: query.column_text(7)?,
                    reason: query.column_text(8)?,
                    decided_at: query.column_text(9)?,
                });
            }

            Ok(Some(ArtifactEvidenceRecord {
                project_id: project_id.to_owned(),
                work_id: work_id.to_owned(),
                submission_id: submission_id.to_owned(),
                inspections,
                decisions,
            }))
        })();
        finish_transaction(self, result)
    }

    /// Read the latest artifact contract against the newest submission for
    /// this work. The result is revision-bound and includes optional gaps for
    /// user display, while only required failures affect close readiness.
    pub fn output_acceptance_v1(
        &self,
        project_id: &str,
        work_id: &str,
        expected_project_revision: u64,
    ) -> Result<Option<OutputAcceptanceRecord>, StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            self.require_general_work_schema()?;
            let project_revision = self.project_revision(project_id)?.0;
            if project_revision != expected_project_revision {
                return Err(StoreError::StaleRevision {
                    expected: expected_project_revision,
                    actual: project_revision,
                });
            }
            let Some(contract_record) = self.work_contract_v1(project_id, work_id, None)? else {
                return Ok(None);
            };
            let requirements = parse_output_requirements(&contract_record.requirements_json)
                .map_err(|error| {
                    StoreError::Corrupt(format!("stored output contract is invalid: {error}"))
                })?;
            let rigor = boreal_domain::deliverables::RigorProfile::supported(
                contract_record.rigor_profile_id.clone(),
                u32::try_from(contract_record.rigor_profile_version).map_err(|_| {
                    StoreError::Corrupt("rigor profile version is too large".into())
                })?,
            )
            .map_err(|error| {
                StoreError::Corrupt(format!("stored general-work rigor is invalid: {error:?}"))
            })?;
            let input_revision = self.latest_input_revision(project_id, work_id)?;
            let proof_revision = self.proof_revision(project_id, work_id)?;
            let mut latest = self.prepare(
                "SELECT submission_id FROM boreal_output_submission_v1
             WHERE project_id=?1 AND work_id=?2 ORDER BY rowid DESC LIMIT 1",
            )?;
            latest.bind_text(1, project_id)?;
            latest.bind_text(2, work_id)?;
            let submission_id = if latest.step()? == SQLITE_ROW {
                Some(latest.column_text(0)?)
            } else {
                None
            };
            let submission = match &submission_id {
                Some(id) => self.output_submission_v1(project_id, work_id, id)?,
                None => None,
            };
            let coverage = match &submission {
                Some(submission)
                    if submission.contract_revision != contract_record.contract_revision
                        || submission.input_revision != input_revision
                        || submission.proof_revision != proof_revision =>
                {
                    boreal_domain::deliverables::OutputCoverage {
                        accepted: false,
                        issues: vec![boreal_domain::deliverables::CoverageIssue::StaleSubmission],
                        covered_requirement_keys: Vec::new(),
                    }
                }
                Some(submission) => self.evaluate_output_submission_v1(
                    project_id,
                    work_id,
                    &contract_record,
                    &requirements,
                    &rigor,
                    submission,
                )?,
                None => evaluate_empty_output_contract(
                    project_id,
                    work_id,
                    &contract_record,
                    &requirements,
                    &rigor,
                    input_revision,
                    proof_revision,
                )?,
            };
            let safe_next_operations = safe_next_work_operations(&coverage);
            Ok(Some(OutputAcceptanceRecord {
                project_id: project_id.to_owned(),
                work_id: work_id.to_owned(),
                project_revision,
                contract_revision: contract_record.contract_revision,
                input_revision,
                proof_revision,
                rigor_profile_id: contract_record.rigor_profile_id,
                rigor_profile_version: contract_record.rigor_profile_version,
                submission_id,
                artifact_set_digest: submission.map(|value| value.artifact_set_digest),
                coverage,
                safe_next_operations,
            }))
        })();
        finish_transaction(self, result)
    }

    fn evaluate_output_submission_v1(
        &self,
        project_id: &str,
        work_id: &str,
        contract_record: &WorkContractRevisionRecord,
        requirements: &[boreal_domain::deliverables::OutputRequirement],
        rigor: &boreal_domain::deliverables::RigorProfile,
        submission: &OutputSubmissionRecord,
    ) -> Result<boreal_domain::deliverables::OutputCoverage, StoreError> {
        let submission_id = &submission.submission_id;
        let mut inspections = Vec::new();
        if self.table_exists("boreal_artifact_inspection_v1")? {
            let mut q = self.prepare(
                "SELECT inspection_id,artifact_id,artifact_digest,inspector_actor_id,inspector_kind,outcome,criteria_json,inspected_at
                 FROM boreal_artifact_inspection_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 ORDER BY rowid",
            )?;
            q.bind_text(1, project_id)?;
            q.bind_text(2, work_id)?;
            q.bind_text(3, submission_id)?;
            while q.step()? == SQLITE_ROW {
                let inspector_kind = match q.column_text(4)?.as_str() {
                    "automatic" => boreal_domain::deliverables::InspectorKind::Automatic,
                    "human" => boreal_domain::deliverables::InspectorKind::Human,
                    other => {
                        return Err(StoreError::Corrupt(format!(
                            "unknown artifact inspector kind: {other}"
                        )))
                    }
                };
                inspections.push(boreal_domain::deliverables::ArtifactInspection {
                    inspection_id: q.column_text(0)?,
                    project_id: project_id.into(),
                    work_id: work_id.into(),
                    submission_id: submission_id.clone(),
                    artifact_id: q.column_text(1)?,
                    artifact_digest: q.column_text(2)?,
                    inspector_actor_id: q.column_text(3)?.into(),
                    inspector_kind,
                    outcome: parse_inspection_outcome(&q.column_text(5)?)?,
                    criteria: parse_inspection_criteria(&q.column_text(6)?)?,
                    inspected_at: super::status_evaluation::canonical_status_timestamp(
                        &q.column_text(7)?,
                    )?,
                });
            }
        }
        let decision = {
            let mut q = self.prepare(
                "SELECT decision_id,contract_revision,input_revision,proof_revision,artifact_set_digest,reviewer_actor_id,producer_actor_id,decision,reason,decided_at
                 FROM boreal_artifact_decision_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 ORDER BY rowid DESC LIMIT 1",
            )?;
            q.bind_text(1, project_id)?;
            q.bind_text(2, work_id)?;
            q.bind_text(3, submission_id)?;
            if q.step()? == SQLITE_ROW {
                let decision_kind = match q.column_text(7)?.as_str() {
                    "approved" => boreal_domain::deliverables::AcceptanceDecisionKind::Approved,
                    "rejected" => boreal_domain::deliverables::AcceptanceDecisionKind::Rejected,
                    "needs_revision" => {
                        boreal_domain::deliverables::AcceptanceDecisionKind::NeedsRevision
                    }
                    other => {
                        return Err(StoreError::Corrupt(format!(
                            "unknown artifact decision: {other}"
                        )))
                    }
                };
                Some(boreal_domain::deliverables::ArtifactDecision {
                    decision_id: q.column_text(0)?,
                    project_id: project_id.into(),
                    work_id: work_id.into(),
                    submission_id: submission_id.clone(),
                    contract_revision: q.column_u64(1)?,
                    input_revision: q.column_u64(2)?,
                    proof_revision: q.column_u64(3)?,
                    artifact_set_digest: q.column_text(4)?,
                    reviewer_actor_id: q.column_text(5)?.into(),
                    producer_actor_id: q.column_text(6)?.into(),
                    decision: decision_kind,
                    reason: q.column_text(8)?,
                    decided_at: super::status_evaluation::canonical_status_timestamp(
                        &q.column_text(9)?,
                    )?,
                })
            } else {
                None
            }
        };
        let artifacts = submission
            .artifacts
            .iter()
            .map(|artifact| {
                Ok(boreal_domain::deliverables::ProducedArtifact {
                    artifact_id: artifact.artifact_id.clone(),
                    requirement_key: boreal_domain::deliverables::RequirementKey::parse(
                        artifact.requirement_key.clone(),
                    )
                    .map_err(|_| {
                        StoreError::Corrupt(
                            "stored produced artifact has invalid requirement key".into(),
                        )
                    })?,
                    submission_id: submission_id.clone(),
                    identity: boreal_domain::deliverables::ArtifactIdentity {
                        project_id: project_id.into(),
                        source_version_id: artifact.source_version_id.clone().into(),
                        content_digest: artifact.content_digest.clone(),
                        media_type: artifact.media_type.clone(),
                        byte_count: artifact.byte_count,
                        availability: parse_artifact_availability(&artifact.availability)?,
                    },
                    producing_work_id: work_id.into(),
                    attempt_id: artifact.attempt_id.clone(),
                    fence: artifact.fence,
                    producer_actor_id: artifact.producer_actor_id.clone().into(),
                    captured_at: super::status_evaluation::canonical_status_timestamp(
                        &artifact.captured_at,
                    )?,
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        let contract = boreal_domain::deliverables::OutputContract {
            project_id: project_id.into(),
            work_id: work_id.into(),
            revision: contract_record.contract_revision,
            requirements: requirements.to_vec(),
            digest: contract_record.requirements_digest.clone(),
        };
        boreal_domain::deliverables::evaluate_output_coverage(
            &contract,
            rigor,
            submission_id,
            submission.input_revision,
            submission.proof_revision,
            &artifacts,
            &inspections,
            decision.as_ref(),
            &submission.artifact_set_digest,
        )
        .map_err(|error| {
            StoreError::Corrupt(format!("output acceptance evaluation failed: {error:?}"))
        })
    }

    /// Return close blockers from the latest immutable artifact contract and
    /// exact current attempt result. Called by the canonical close/readiness
    /// gate; empty legacy contracts preserve the old close behavior.
    pub fn general_work_close_gaps_v1(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: Option<&str>,
        fence: Option<u64>,
    ) -> Result<Vec<String>, StoreError> {
        if !self.table_exists("boreal_work_contract_v1")? {
            return Ok(Vec::new());
        }
        let mut gaps = Vec::new();
        if self.table_exists("boreal_external_wait_v1")? {
            let mut waits=self.prepare("SELECT w.wait_id FROM boreal_external_wait_v1 w WHERE w.project_id=?1 AND w.work_id=?2 AND NOT EXISTS(SELECT 1 FROM boreal_external_wait_event_v1 e WHERE e.project_id=w.project_id AND e.work_id=w.work_id AND e.wait_id=w.wait_id) ORDER BY w.wait_id")?;
            waits.bind_text(1, project_id)?;
            waits.bind_text(2, work_id)?;
            while waits.step()? == SQLITE_ROW {
                gaps.push(format!("external_wait:{}", waits.column_text(0)?));
            }
        }
        let Some(contract_record) = self.work_contract_v1(project_id, work_id, None)? else {
            return Ok(gaps);
        };
        let requirements =
            parse_output_requirements(&contract_record.requirements_json).map_err(|error| {
                StoreError::Corrupt(format!("stored output contract is invalid: {error}"))
            })?;
        let rigor = boreal_domain::deliverables::RigorProfile::supported(
            contract_record.rigor_profile_id.clone(),
            u32::try_from(contract_record.rigor_profile_version)
                .map_err(|_| StoreError::Corrupt("rigor profile version is too large".into()))?,
        )
        .map_err(|error| {
            StoreError::Corrupt(format!("stored general-work rigor is invalid: {error:?}"))
        })?;
        // A task that declares no required outputs continues to use its
        // registered legacy close contract unless an output submission exists.
        let submission_id = match (attempt_id, fence) {
            (Some(attempt_id), Some(fence)) => {
                let mut q=self.prepare("SELECT submission_id FROM boreal_output_submission_v1 WHERE project_id=?1 AND work_id=?2 AND attempt_id=?3 AND fence=?4 ORDER BY rowid DESC LIMIT 1")?;
                q.bind_text(1, project_id)?;
                q.bind_text(2, work_id)?;
                q.bind_text(3, attempt_id)?;
                q.bind_i64(4, fence)?;
                if q.step()? == SQLITE_ROW {
                    Some(q.column_text(0)?)
                } else {
                    None
                }
            }
            _ => None,
        };
        let Some(submission_id) = submission_id else {
            let coverage = evaluate_empty_output_contract(
                project_id,
                work_id,
                &contract_record,
                &requirements,
                &rigor,
                self.latest_input_revision(project_id, work_id)?,
                self.proof_revision(project_id, work_id)?,
            )?;
            gaps.extend(coverage_issue_gaps(&coverage.issues));
            return Ok(gaps);
        };
        let submission = self
            .output_submission_v1(project_id, work_id, &submission_id)?
            .ok_or_else(|| {
                StoreError::Corrupt("output submission disappeared during close check".into())
            })?;
        let current_proof = self.proof_revision(project_id, work_id)?;
        let current_contract = self.latest_contract_revision(project_id, work_id)?;
        let current_inputs = self.latest_input_revision(project_id, work_id)?;
        if submission.contract_revision != current_contract
            || submission.input_revision != current_inputs
            || submission.proof_revision != current_proof
        {
            gaps.push("output_submission_stale".into());
            return Ok(gaps);
        }
        let coverage = self.evaluate_output_submission_v1(
            project_id,
            work_id,
            &contract_record,
            &requirements,
            &rigor,
            &submission,
        )?;
        gaps.extend(coverage_issue_gaps(&coverage.issues));
        gaps.sort();
        gaps.dedup();
        Ok(gaps)
    }

    pub fn record_artifact_inspection_v1(
        &self,
        context: &V3MutationContext,
        input: &ArtifactInspectionInput,
    ) -> Result<MutationResult, StoreError> {
        validate_inspection(input)?;
        let (criteria_json, _) = canonical_json_and_digest(&input.criteria_json)?;
        let payload = json!({"work_id":input.work_id,"inspection_id":input.inspection_id,"submission_id":input.submission_id,"artifact_id":input.artifact_id,"artifact_digest":input.artifact_digest,"inspector_kind":input.inspector_kind,"outcome":input.outcome,"criteria_json":criteria_json});
        let context = context.with_payload(payload);
        self.fact_mutation(&context,"work.artifact.inspect/v1","work",&input.work_id,&[ActorRole::Reviewer,ActorRole::Operator],||{
            self.require_general_work_schema()?;
            let mut inspector=self.prepare("SELECT role FROM actor WHERE actor_id=?1")?;inspector.bind_text(1,&context.actor_id)?;
            if inspector.step()?!=SQLITE_ROW { return Err(StoreError::NotFound{entity:"inspector",id:context.actor_id.clone()}); }
            let inspector_role=inspector.column_text(0)?;drop(inspector);
            if !matches!(inspector_role.as_str(),"reviewer"|"operator") { return Err(StoreError::Invalid("human artifact inspection requires a reviewer or operator principal".into())); }
            let mut artifact=self.prepare("SELECT content_digest,producer_actor_id FROM boreal_produced_artifact_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 AND artifact_id=?4")?;artifact.bind_text(1,&context.project_id)?;artifact.bind_text(2,&input.work_id)?;artifact.bind_text(3,&input.submission_id)?;artifact.bind_text(4,&input.artifact_id)?;
            if artifact.step()?!=SQLITE_ROW || artifact.column_text(0)?!=input.artifact_digest { return Err(StoreError::Conflict("inspection must name the exact produced artifact digest".into())); }
            if artifact.column_text(1)? == context.actor_id { return Err(StoreError::Invalid("human artifact inspection must be performed by someone other than the producer".into())); }
            let mut row=self.prepare("INSERT INTO boreal_artifact_inspection_v1(project_id,work_id,inspection_id,submission_id,artifact_id,artifact_digest,inspector_actor_id,inspector_kind,outcome,criteria_json,inspected_at,operation_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")?;row.bind_text(1,&context.project_id)?;row.bind_text(2,&input.work_id)?;row.bind_text(3,&input.inspection_id)?;row.bind_text(4,&input.submission_id)?;row.bind_text(5,&input.artifact_id)?;row.bind_text(6,&input.artifact_digest)?;row.bind_text(7,&context.actor_id)?;row.bind_text(8,&input.inspector_kind)?;row.bind_text(9,&input.outcome)?;row.bind_text(10,&criteria_json)?;row.bind_text(11,&context.now)?;row.bind_text(12,&context.operation_id)?;row.run()?;Ok(())
        })
    }

    pub fn record_artifact_decision_v1(
        &self,
        context: &V3MutationContext,
        input: &ArtifactDecisionInput,
    ) -> Result<MutationResult, StoreError> {
        validate_decision(input)?;
        let payload = json!({"work_id":input.work_id,"decision_id":input.decision_id,"submission_id":input.submission_id,"contract_revision":input.contract_revision,"input_revision":input.input_revision,"proof_revision":input.proof_revision,"artifact_set_digest":input.artifact_set_digest,"producer_actor_id":input.producer_actor_id,"decision":input.decision,"reason":input.reason});
        let context = context.with_payload(payload);
        self.fact_mutation(&context,"work.artifact.decide/v1","work",&input.work_id,&[ActorRole::Reviewer,ActorRole::Operator],||{
            self.require_general_work_schema()?;
            let mut submission=self.prepare("SELECT contract_revision,input_revision,proof_revision,artifact_set_digest,producer_actor_id,rigor_profile_id,rigor_profile_version FROM boreal_output_submission_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3")?;submission.bind_text(1,&context.project_id)?;submission.bind_text(2,&input.work_id)?;submission.bind_text(3,&input.submission_id)?;
            if submission.step()?!=SQLITE_ROW || submission.column_u64(0)?!=input.contract_revision || submission.column_u64(1)?!=input.input_revision || submission.column_u64(2)?!=input.proof_revision || submission.column_text(3)?!=input.artifact_set_digest || submission.column_text(4)?!=input.producer_actor_id {return Err(StoreError::Conflict("decision must bind the exact output submission and artifact set".into()));}
            let rigor_id=submission.column_text(5)?;
            let rigor_version=u32::try_from(submission.column_u64(6)?).map_err(|_|StoreError::Corrupt("stored rigor version is too large".into()))?;
            let requires_independent=boreal_domain::deliverables::RigorProfile::supported(rigor_id,rigor_version).map_err(|error|StoreError::Corrupt(format!("stored output rigor is invalid: {error:?}")))?.requires_independent_decision();
            if requires_independent && context.actor_id==input.producer_actor_id {return Err(StoreError::Invalid("selected rigor requires an actor independent from the producer".into()));}
            if self.latest_contract_revision(&context.project_id,&input.work_id)?!=input.contract_revision || self.latest_input_revision(&context.project_id,&input.work_id)?!=input.input_revision || self.proof_revision(&context.project_id,&input.work_id)?!=input.proof_revision {return Err(StoreError::Conflict("decision refers to stale requirements, inputs, or proof revision".into()));}
            let mut row=self.prepare("INSERT INTO boreal_artifact_decision_v1(project_id,work_id,decision_id,submission_id,contract_revision,input_revision,proof_revision,artifact_set_digest,reviewer_actor_id,producer_actor_id,decision,reason,decided_at,operation_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)")?;row.bind_text(1,&context.project_id)?;row.bind_text(2,&input.work_id)?;row.bind_text(3,&input.decision_id)?;row.bind_text(4,&input.submission_id)?;row.bind_i64(5,input.contract_revision)?;row.bind_i64(6,input.input_revision)?;row.bind_i64(7,input.proof_revision)?;row.bind_text(8,&input.artifact_set_digest)?;row.bind_text(9,&context.actor_id)?;row.bind_text(10,&input.producer_actor_id)?;row.bind_text(11,&input.decision)?;row.bind_text(12,&input.reason)?;row.bind_text(13,&context.now)?;row.bind_text(14,&context.operation_id)?;row.run()?;Ok(())
        })
    }

    pub fn create_external_wait_v1(
        &self,
        context: &V3MutationContext,
        input: &ExternalWaitInput,
    ) -> Result<MutationResult, StoreError> {
        validate_wait(input)?;
        let follow_up_json = match &input.follow_up_json {
            Some(json) => Some(canonical_json_and_digest(json)?.0),
            None => None,
        };
        let payload = json!({"work_id":input.work_id,"wait_id":input.wait_id,"category":input.category,"reason":input.reason,"accountable_kind":input.accountable_kind,"accountable_ref":input.accountable_ref,"expected_decision_or_output":input.expected_decision_or_output,"follow_up":follow_up_json});
        let context = context.with_payload(payload);
        self.fact_mutation(&context,"work.wait.create/v1","work",&input.work_id,&[ActorRole::Agent,ActorRole::Operator],||{
            self.require_general_work_schema()?;self.require_work(&context.project_id,&input.work_id)?;self.require_amendable_work(&context.project_id,&input.work_id)?;
            let project_revision=self.project_revision(&context.project_id)?.0+1;
            let mut row=self.prepare("INSERT INTO boreal_external_wait_v1(project_id,work_id,wait_id,category,reason,accountable_kind,accountable_ref,expected_decision_or_output,follow_up_json,created_by,created_at,operation_id,project_revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)")?;
            row.bind_text(1,&context.project_id)?;row.bind_text(2,&input.work_id)?;row.bind_text(3,&input.wait_id)?;row.bind_text(4,&input.category)?;row.bind_text(5,&input.reason)?;row.bind_text(6,&input.accountable_kind)?;row.bind_text(7,&input.accountable_ref)?;row.bind_text(8,&input.expected_decision_or_output)?;bind_optional_text(&mut row,9,follow_up_json.as_deref())?;row.bind_text(10,&context.actor_id)?;row.bind_text(11,&context.now)?;row.bind_text(12,&context.operation_id)?;row.bind_i64(13,project_revision)?;row.run()?;Ok(())
        })
    }

    pub fn resolve_external_wait_v1(
        &self,
        context: &V3MutationContext,
        work_id: &str,
        wait_id: &str,
        state: &str,
        result: Option<&str>,
        rationale: &str,
    ) -> Result<MutationResult, StoreError> {
        if !matches!(state, "resolved" | "cancelled")
            || rationale.trim().is_empty()
            || rationale.len() > 2000
            || rationale.chars().any(char::is_control)
            || result.is_some_and(|value| {
                value.trim().is_empty()
                    || value.len() > 2000
                    || value.chars().any(char::is_control)
            })
            || (state == "resolved" && result.is_none())
            || (state == "cancelled" && result.is_some())
        {
            return Err(StoreError::Invalid("wait transition needs a valid terminal state, rationale, and a resolution result when resolved".into()));
        }
        let payload = json!({"work_id":work_id,"wait_id":wait_id,"state":state,"result":result,"rationale":rationale});
        let context = context.with_payload(payload);
        self.fact_mutation(&context,"work.wait.resolve/v1","work",work_id,&[ActorRole::Agent,ActorRole::Reviewer,ActorRole::Operator],||{
            self.require_general_work_schema()?;
            let mut query=self.prepare("SELECT accountable_kind,accountable_ref FROM boreal_external_wait_v1 WHERE project_id=?1 AND work_id=?2 AND wait_id=?3")?;query.bind_text(1,&context.project_id)?;query.bind_text(2,work_id)?;query.bind_text(3,wait_id)?;
            if query.step()?!=SQLITE_ROW{return Err(StoreError::NotFound{entity:"external wait",id:wait_id.into()});}
            let accountable_kind=query.column_text(0)?;let accountable_ref=query.column_text(1)?;
            if self.canonical_production {
                let (role,_)=self.principal_authority(&context.project_id,&context.actor_id)?;
                let role_ref=match role {ActorRole::Agent=>"agent",ActorRole::Reviewer=>"reviewer",ActorRole::Operator=>"operator",ActorRole::Publisher=>"publisher"};
                if !matches!(role,ActorRole::Reviewer|ActorRole::Operator) && !(accountable_kind=="person_or_role"&&(accountable_ref==context.actor_id||accountable_ref==role_ref)) {
                    return Err(StoreError::Invalid("wait resolution requires the accountable person or a reviewer/operator".into()));
                }
            }
            let mut latest=self.prepare("SELECT state FROM boreal_external_wait_event_v1 WHERE project_id=?1 AND work_id=?2 AND wait_id=?3 ORDER BY rowid DESC LIMIT 1")?;latest.bind_text(1,&context.project_id)?;latest.bind_text(2,work_id)?;latest.bind_text(3,wait_id)?;
            if latest.step()?==SQLITE_ROW {return Err(StoreError::Conflict("external wait is already resolved or cancelled".into()));}
            let mut event=self.prepare("INSERT INTO boreal_external_wait_event_v1(project_id,work_id,wait_id,event_id,state,actor_id,result,rationale,occurred_at,operation_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;event.bind_text(1,&context.project_id)?;event.bind_text(2,work_id)?;event.bind_text(3,wait_id)?;event.bind_text(4,&format!("event:{}",context.operation_id))?;event.bind_text(5,state)?;event.bind_text(6,&context.actor_id)?;bind_optional_text(&mut event,7,result)?;event.bind_text(8,rationale)?;event.bind_text(9,&context.now)?;event.bind_text(10,&context.operation_id)?;event.run()?;Ok(())
        })
    }

    pub fn external_waits_v1(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        include_terminal: bool,
    ) -> Result<Vec<ExternalWaitRecord>, StoreError> {
        self.require_general_work_schema()?;
        let sql = if work_id.is_some() {
            "SELECT w.project_id,w.work_id,w.wait_id,w.category,w.reason,w.accountable_kind,w.accountable_ref,w.expected_decision_or_output,w.follow_up_json,w.created_by,w.created_at,e.state,e.actor_id,e.result,e.rationale,e.occurred_at FROM boreal_external_wait_v1 w LEFT JOIN boreal_external_wait_event_v1 e ON e.project_id=w.project_id AND e.work_id=w.work_id AND e.wait_id=w.wait_id AND e.rowid=(SELECT MAX(n.rowid) FROM boreal_external_wait_event_v1 n WHERE n.project_id=w.project_id AND n.work_id=w.work_id AND n.wait_id=w.wait_id) WHERE w.project_id=?1 AND w.work_id=?2 ORDER BY w.created_at,w.wait_id"
        } else {
            "SELECT w.project_id,w.work_id,w.wait_id,w.category,w.reason,w.accountable_kind,w.accountable_ref,w.expected_decision_or_output,w.follow_up_json,w.created_by,w.created_at,e.state,e.actor_id,e.result,e.rationale,e.occurred_at FROM boreal_external_wait_v1 w LEFT JOIN boreal_external_wait_event_v1 e ON e.project_id=w.project_id AND e.work_id=w.work_id AND e.wait_id=w.wait_id AND e.rowid=(SELECT MAX(n.rowid) FROM boreal_external_wait_event_v1 n WHERE n.project_id=w.project_id AND n.work_id=w.work_id AND n.wait_id=w.wait_id) WHERE w.project_id=?1 ORDER BY w.created_at,w.wait_id"
        };
        let mut query = self.prepare(sql)?;
        query.bind_text(1, project_id)?;
        if let Some(work_id) = work_id {
            query.bind_text(2, work_id)?;
        }
        let mut rows = Vec::new();
        while query.step()? == SQLITE_ROW {
            let state = query
                .column_optional_text(11)?
                .unwrap_or_else(|| "open".into());
            if !include_terminal && state != "open" {
                continue;
            }
            let is_resolved = state == "resolved";
            let is_cancelled = state == "cancelled";
            let terminal_actor = query.column_optional_text(12)?;
            let terminal_result = query.column_optional_text(13)?;
            let terminal_reason = query.column_optional_text(14)?;
            let terminal_at = query.column_optional_text(15)?;
            rows.push(ExternalWaitRecord {
                project_id: query.column_text(0)?,
                work_id: query.column_text(1)?,
                wait_id: query.column_text(2)?,
                category: query.column_text(3)?,
                reason: query.column_text(4)?,
                accountable_kind: query.column_text(5)?,
                accountable_ref: query.column_text(6)?,
                expected_decision_or_output: query.column_text(7)?,
                follow_up_json: query.column_optional_text(8)?,
                created_by: query.column_text(9)?,
                created_at: query.column_text(10)?,
                state,
                resolved_by: is_resolved.then(|| terminal_actor.clone()).flatten(),
                result: is_resolved.then(|| terminal_result.clone()).flatten(),
                resolution_rationale: is_resolved.then(|| terminal_reason.clone()).flatten(),
                resolved_at: is_resolved.then(|| terminal_at.clone()).flatten(),
                cancelled_by: is_cancelled.then(|| terminal_actor).flatten(),
                cancellation_reason: is_cancelled.then(|| terminal_reason).flatten(),
                cancelled_at: is_cancelled.then(|| terminal_at).flatten(),
            });
        }
        Ok(rows)
    }

    pub fn active_external_wait_blocks_work_v1(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<bool, StoreError> {
        self.require_general_work_schema()?;
        let mut query=self.prepare("SELECT EXISTS(SELECT 1 FROM boreal_external_wait_v1 w WHERE w.project_id=?1 AND w.work_id=?2 AND NOT EXISTS(SELECT 1 FROM boreal_external_wait_event_v1 e WHERE e.project_id=w.project_id AND e.work_id=w.work_id AND e.wait_id=w.wait_id))")?;
        query.bind_text(1, project_id)?;
        query.bind_text(2, work_id)?;
        if query.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "wait status query returned no row".into(),
            ));
        }
        Ok(query.column_bool(0)?)
    }

    pub fn general_work_legacy_gate_overrides_for_project(
        &self,
        project_id: &str,
    ) -> Result<std::collections::BTreeSet<String>, StoreError> {
        if !self.table_exists("boreal_work_contract_v1")? {
            return Ok(std::collections::BTreeSet::new());
        }
        let mut q = self.prepare(
            "SELECT c.work_id,c.rigor_profile_id,c.legacy_gate_policy
             FROM boreal_work_contract_v1 c
             WHERE c.project_id=?1
               AND c.contract_revision=(SELECT MAX(latest.contract_revision)
                   FROM boreal_work_contract_v1 latest
                   WHERE latest.project_id=c.project_id AND latest.work_id=c.work_id)",
        )?;
        q.bind_text(1, project_id)?;
        let mut work_ids = std::collections::BTreeSet::new();
        while q.step()? == SQLITE_ROW {
            let work_id = q.column_text(0)?;
            let rigor_id = q.column_text(1)?;
            let policy = q.column_text(2)?;
            if policy == "general_work" && is_nonsoftware_general_rigor(&rigor_id) {
                work_ids.insert(work_id);
            } else if policy != "preserve" && policy != "general_work" {
                return Err(StoreError::Corrupt(format!(
                    "unknown legacy gate policy: {policy}"
                )));
            }
        }
        Ok(work_ids)
    }

    fn require_general_work_schema(&self) -> Result<(), StoreError> {
        if !self.table_exists("boreal_work_contract_v1")?
            || !self.table_exists("boreal_external_wait_v1")?
        {
            return Err(StoreError::Corrupt(
                "general-work contract schema is unavailable; upgrade the local store".into(),
            ));
        }
        Ok(())
    }

    fn require_work(&self, project_id: &str, work_id: &str) -> Result<(), StoreError> {
        let mut q = self.prepare("SELECT 1 FROM work_item WHERE project_id=?1 AND work_id=?2")?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work",
                id: work_id.into(),
            });
        }
        Ok(())
    }
    fn latest_contract_revision(&self, project_id: &str, work_id: &str) -> Result<u64, StoreError> {
        self.latest_work_revision(
            "boreal_work_contract_v1",
            "contract_revision",
            project_id,
            work_id,
        )
    }
    fn latest_input_revision(&self, project_id: &str, work_id: &str) -> Result<u64, StoreError> {
        self.latest_work_revision(
            "boreal_work_input_set_v1",
            "input_revision",
            project_id,
            work_id,
        )
    }
    fn latest_work_revision(
        &self,
        table: &str,
        column: &str,
        project_id: &str,
        work_id: &str,
    ) -> Result<u64, StoreError> {
        let sql = format!(
            "SELECT COALESCE(MAX({column}),0) FROM {table} WHERE project_id=?1 AND work_id=?2"
        );
        let mut q = self.prepare(&sql)?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt("revision query returned no row".into()));
        }
        q.column_u64(0)
    }
    fn proof_revision(&self, project_id: &str, work_id: &str) -> Result<u64, StoreError> {
        let mut q = self.prepare(
            "SELECT proof_revision FROM boreal_entity_revision WHERE project_id=?1 AND work_id=?2",
        )?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work revision",
                id: work_id.into(),
            });
        }
        q.column_u64(0)
    }
    fn advance_general_work_proof(
        &self,
        project_id: &str,
        work_id: &str,
        now: &str,
    ) -> Result<u64, StoreError> {
        let mut q=self.prepare("UPDATE boreal_entity_revision SET proof_revision=proof_revision+1,updated_at=?3 WHERE project_id=?1 AND work_id=?2 RETURNING proof_revision")?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        q.bind_text(3, now)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work revision",
                id: work_id.into(),
            });
        }
        q.column_u64(0)
    }
    fn require_no_active_attempt(&self, work_id: &str) -> Result<(), StoreError> {
        let mut q =
            self.prepare("SELECT attempt_id FROM attempt WHERE work_id=?1 AND current=1 LIMIT 1")?;
        q.bind_text(1, work_id)?;
        if q.step()? == SQLITE_ROW {
            return Err(StoreError::Conflict(
                "work contract or accepted inputs cannot change while an attempt is active".into(),
            ));
        }
        Ok(())
    }
    fn initial_legacy_gate_policy(
        &self,
        project_id: &str,
        work_id: &str,
        rigor_profile_id: &str,
    ) -> Result<String, StoreError> {
        let mut q =
            self.prepare("SELECT lifecycle FROM work_item WHERE project_id=?1 AND work_id=?2")?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work",
                id: work_id.into(),
            });
        }
        let lifecycle = q.column_text(0)?;
        if lifecycle == "draft" && is_nonsoftware_general_rigor(rigor_profile_id) {
            Ok("general_work".into())
        } else {
            Ok("preserve".into())
        }
    }
    fn require_amendable_work(&self, project_id: &str, work_id: &str) -> Result<(), StoreError> {
        let mut q =
            self.prepare("SELECT lifecycle FROM work_item WHERE project_id=?1 AND work_id=?2")?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work",
                id: work_id.into(),
            });
        }
        match q.column_text(0)?.as_str() {
            "draft" | "open" => Ok(()),
            "closed" | "cancelled" => Err(StoreError::Conflict(
                "closed or cancelled work requires the existing explicit reopen policy before amendment".into(),
            )),
            lifecycle => Err(StoreError::Corrupt(format!(
                "unknown work lifecycle for general-work mutation: {lifecycle}"
            ))),
        }
    }
    fn require_general_work_amendment_reason(
        &self,
        project_id: &str,
        work_id: &str,
        current_revision: u64,
        reason: Option<&str>,
        subject: &str,
    ) -> Result<(), StoreError> {
        let mut query =
            self.prepare("SELECT lifecycle FROM work_item WHERE project_id=?1 AND work_id=?2")?;
        query.bind_text(1, project_id)?;
        query.bind_text(2, work_id)?;
        if query.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work",
                id: work_id.into(),
            });
        }
        let is_published = query.column_text(0)? == "open";
        if (current_revision > 0 || is_published)
            && reason.is_none_or(|value| value.trim().is_empty() || value.len() > 2000)
        {
            return Err(StoreError::Invalid(format!(
                "a published or revised {subject} requires a bounded amendment reason"
            )));
        }
        Ok(())
    }
    fn contract_profile_and_requirements(
        &self,
        project_id: &str,
        work_id: &str,
        revision: u64,
    ) -> Result<(String, u64, String), StoreError> {
        let mut q=self.prepare("SELECT rigor_profile_id,rigor_profile_version,requirements_json FROM boreal_work_contract_v1 WHERE project_id=?1 AND work_id=?2 AND contract_revision=?3")?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        q.bind_i64(3, revision)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work contract revision",
                id: revision.to_string(),
            });
        }
        Ok((q.column_text(0)?, q.column_u64(1)?, q.column_text(2)?))
    }
    fn require_exact_produced_artifact(
        &self,
        project_id: &str,
        work_id: &str,
        submission_id: &str,
        artifact_id: &str,
        source_version_id: &str,
    ) -> Result<(), StoreError> {
        let mut q=self.prepare("SELECT 1 FROM boreal_produced_artifact_v1 WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 AND artifact_id=?4 AND source_version_id=?5")?;
        q.bind_text(1, project_id)?;
        q.bind_text(2, work_id)?;
        q.bind_text(3, submission_id)?;
        q.bind_text(4, artifact_id)?;
        q.bind_text(5, source_version_id)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::Conflict(
                "accepted input lineage does not match an exact produced artifact revision".into(),
            ));
        }
        Ok(())
    }
}

fn validate_contract_input(input: &WorkContractRevisionInput) -> Result<(), StoreError> {
    for (field, value) in [
        ("work_id", input.work_id.as_str()),
        ("rigor_profile_id", input.rigor_profile_id.as_str()),
    ] {
        if value.trim().is_empty() || value.len() > 255 {
            return Err(StoreError::Invalid(format!(
                "{field} is required and bounded"
            )));
        }
    }
    boreal_domain::deliverables::RigorProfile::supported(
        input.rigor_profile_id.clone(),
        u32::try_from(input.rigor_profile_version)
            .map_err(|_| StoreError::Invalid("rigor profile version is too large".into()))?,
    )
    .map_err(|_| {
        StoreError::Invalid("unsupported or unregistered general-work rigor profile".into())
    })?;
    if input.expected_contract_revision > 0
        && input
            .amendment_reason
            .as_deref()
            .is_none_or(|reason| reason.trim().is_empty() || reason.len() > 2000)
    {
        return Err(StoreError::Invalid(
            "a contract amendment requires a bounded reason".into(),
        ));
    }
    parse_output_requirements(&input.requirements_json)?;
    Ok(())
}

fn is_nonsoftware_general_rigor(profile_id: &str) -> bool {
    matches!(
        profile_id,
        boreal_domain::deliverables::RigorProfile::LIGHTWEIGHT
            | boreal_domain::deliverables::RigorProfile::DELIVERABLES
            | boreal_domain::deliverables::RigorProfile::REVIEWED_ARTIFACTS
    )
}

fn parse_output_requirements(
    raw: &str,
) -> Result<Vec<boreal_domain::deliverables::OutputRequirement>, StoreError> {
    use boreal_domain::deliverables::{
        DeliverableType, OutputRequirement, RequirementKey, ValidationCriterion,
    };
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| StoreError::Invalid("requirements_json is invalid JSON".into()))?;
    let rows = value
        .get("requirements")
        .and_then(Value::as_array)
        .ok_or_else(|| StoreError::Invalid("requirements must be an array".into()))?;
    if rows.len() > boreal_domain::deliverables::MAX_OUTPUT_REQUIREMENTS {
        return Err(StoreError::Invalid(
            "requirements exceed the 64 declaration bound".into(),
        ));
    }
    let mut requirements = Vec::with_capacity(rows.len());
    let mut keys = std::collections::BTreeSet::new();
    for row in rows {
        let text = |field: &str| {
            row.get(field)
                .and_then(Value::as_str)
                .ok_or_else(|| StoreError::Invalid(format!("requirement {field} must be text")))
        };
        let key = RequirementKey::parse(text("requirement_key")?.to_owned())
            .map_err(|_| StoreError::Invalid("invalid output requirement key".into()))?;
        if !keys.insert(key.clone()) {
            return Err(StoreError::Invalid(format!(
                "duplicate output requirement key {}",
                key.as_str()
            )));
        }
        let deliverable_type = match text("deliverable_type")? {
            "document" => DeliverableType::Document,
            "image" => DeliverableType::Image,
            "data" => DeliverableType::Data,
            "archive" => DeliverableType::Archive,
            "code" => DeliverableType::Code,
            "other" => DeliverableType::Other,
            _ => return Err(StoreError::Invalid("unsupported deliverable type".into())),
        };
        let media_types = row
            .get("allowed_media_types")
            .and_then(Value::as_array)
            .ok_or_else(|| StoreError::Invalid("allowed_media_types must be an array".into()))?
            .iter()
            .map(|media| {
                media
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| StoreError::Invalid("media types must be text".into()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let criteria_values = row
            .get("criteria")
            .and_then(Value::as_array)
            .ok_or_else(|| StoreError::Invalid("criteria must be an array".into()))?;
        let criteria = criteria_values
            .iter()
            .map(|criterion| {
                let kind = criterion
                    .get("kind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| StoreError::Invalid("criterion kind must be text".into()))?;
                let value = criterion
                    .get("value")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        StoreError::Invalid("criterion value must be unsigned".into())
                    })?;
                match kind {
                    "minimum_bytes" => Ok(ValidationCriterion::MinimumBytes(value)),
                    "maximum_bytes" => Ok(ValidationCriterion::MaximumBytes(value)),
                    "minimum_image_width" => u32::try_from(value)
                        .map(ValidationCriterion::MinimumImageWidth)
                        .map_err(|_| {
                            StoreError::Invalid("image width criterion is too large".into())
                        }),
                    "minimum_image_height" => u32::try_from(value)
                        .map(ValidationCriterion::MinimumImageHeight)
                        .map_err(|_| {
                            StoreError::Invalid("image height criterion is too large".into())
                        }),
                    _ => Err(StoreError::Invalid("unsupported output criterion".into())),
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        let requirement = OutputRequirement {
            key,
            purpose: text("purpose")?.to_owned(),
            required: row
                .get("required")
                .and_then(Value::as_bool)
                .ok_or_else(|| StoreError::Invalid("required must be boolean".into()))?,
            deliverable_type,
            allowed_media_types: media_types,
            minimum_count: row
                .get("minimum_count")
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok())
                .ok_or_else(|| StoreError::Invalid("minimum_count must be u16".into()))?,
            maximum_count: row
                .get("maximum_count")
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok())
                .ok_or_else(|| StoreError::Invalid("maximum_count must be u16".into()))?,
            criteria,
        };
        requirement.validate().map_err(|error| {
            StoreError::Invalid(format!("invalid output requirement: {error:?}"))
        })?;
        requirements.push(requirement);
    }
    Ok(requirements)
}

fn evaluate_empty_output_contract(
    project_id: &str,
    work_id: &str,
    contract_record: &WorkContractRevisionRecord,
    requirements: &[boreal_domain::deliverables::OutputRequirement],
    rigor: &boreal_domain::deliverables::RigorProfile,
    input_revision: u64,
    proof_revision: u64,
) -> Result<boreal_domain::deliverables::OutputCoverage, StoreError> {
    let contract = boreal_domain::deliverables::OutputContract {
        project_id: project_id.into(),
        work_id: work_id.into(),
        revision: contract_record.contract_revision,
        requirements: requirements.to_vec(),
        digest: contract_record.requirements_digest.clone(),
    };
    boreal_domain::deliverables::evaluate_output_coverage(
        &contract,
        rigor,
        "",
        input_revision,
        proof_revision,
        &[],
        &[],
        None,
        "",
    )
    .map_err(|error| StoreError::Corrupt(format!("output contract evaluation failed: {error:?}")))
}

fn coverage_issue_gaps(issues: &[boreal_domain::deliverables::CoverageIssue]) -> Vec<String> {
    use boreal_domain::deliverables::CoverageIssue;
    issues
        .iter()
        .filter_map(|issue| match issue {
            CoverageIssue::MissingRequired(key) => Some(format!("output_missing:{key}")),
            CoverageIssue::OptionalMissing(_) => None,
            CoverageIssue::TooMany(key) => Some(format!("output_count_exceeded:{key}")),
            CoverageIssue::WrongProject(id) => Some(format!("output_wrong_project:{id}")),
            CoverageIssue::WrongSubmission(id) => Some(format!("output_wrong_submission:{id}")),
            CoverageIssue::WrongProducingWork(id) => {
                Some(format!("output_wrong_producer_work:{id}"))
            }
            CoverageIssue::UndeclaredRequirement(key) => {
                Some(format!("output_undeclared_requirement:{key}"))
            }
            CoverageIssue::WrongDeliverableType(id) => Some(format!("output_wrong_type:{id}")),
            CoverageIssue::WrongMediaType(id) => Some(format!("output_wrong_media_type:{id}")),
            CoverageIssue::ArtifactUnavailable(id) => Some(format!("output_unavailable:{id}")),
            CoverageIssue::MissingInspection(id) => Some(format!("output_inspection_missing:{id}")),
            CoverageIssue::FailedInspection(id) => Some(format!("output_inspection_failed:{id}")),
            CoverageIssue::StaleSubmission => Some("output_submission_stale".into()),
            CoverageIssue::StaleDecision => Some("output_review_stale".into()),
            CoverageIssue::DecisionRequired => Some("output_review_required".into()),
            CoverageIssue::DecisionRejected => Some("output_review_rejected".into()),
            CoverageIssue::ReviewerMustBeIndependent => {
                Some("output_review_not_independent".into())
            }
            CoverageIssue::DecisionProducerMismatch => {
                Some("output_review_producer_mismatch".into())
            }
        })
        .collect()
}

fn safe_next_work_operations(
    coverage: &boreal_domain::deliverables::OutputCoverage,
) -> Vec<String> {
    use boreal_domain::deliverables::CoverageIssue;
    let mut operations = std::collections::BTreeSet::new();
    for issue in &coverage.issues {
        match issue {
            CoverageIssue::MissingRequired(_)
            | CoverageIssue::OptionalMissing(_)
            | CoverageIssue::TooMany(_)
            | CoverageIssue::WrongSubmission(_)
            | CoverageIssue::WrongProducingWork(_)
            | CoverageIssue::UndeclaredRequirement(_)
            | CoverageIssue::WrongDeliverableType(_)
            | CoverageIssue::WrongMediaType(_)
            | CoverageIssue::WrongProject(_)
            | CoverageIssue::StaleSubmission => {
                operations.insert("work.outputs.submit/v1".to_owned());
            }
            CoverageIssue::MissingInspection(_)
            | CoverageIssue::FailedInspection(_)
            | CoverageIssue::ArtifactUnavailable(_) => {
                operations.insert("work.artifact.inspect/v1".to_owned());
            }
            CoverageIssue::StaleDecision
            | CoverageIssue::DecisionRequired
            | CoverageIssue::DecisionRejected
            | CoverageIssue::ReviewerMustBeIndependent
            | CoverageIssue::DecisionProducerMismatch => {
                operations.insert("work.artifact.decide/v1".to_owned());
            }
        }
    }
    operations.into_iter().collect()
}
fn validate_input_set(input: &AcceptedInputSetInput) -> Result<(), StoreError> {
    if input.work_id.trim().is_empty() || input.bindings.len() > 100 {
        return Err(StoreError::Invalid(
            "input set requires a work ID and at most 100 bindings".into(),
        ));
    }
    if input.expected_input_revision > 0
        && input
            .amendment_reason
            .as_deref()
            .is_none_or(|reason| reason.trim().is_empty() || reason.len() > 2000)
    {
        return Err(StoreError::Invalid(
            "an input amendment requires a bounded reason".into(),
        ));
    }
    for binding in &input.bindings {
        if binding.input_key.trim().is_empty()
            || binding.input_key.len() > 64
            || binding.role.trim().is_empty()
            || binding.role.len() > 128
            || binding.source_version_id.trim().is_empty()
        {
            return Err(StoreError::Invalid(
                "input key, role, and source version are required and bounded".into(),
            ));
        }
    }
    Ok(())
}
fn validate_output_submission(input: &OutputSubmissionInput) -> Result<(), StoreError> {
    if input.work_id.trim().is_empty()
        || input.submission_id.trim().is_empty()
        || input.attempt_id.trim().is_empty()
        || input.fence == 0
        || input.artifacts.len() > 6400
    {
        return Err(StoreError::Invalid(
            "output submission identity is incomplete or exceeds bounds".into(),
        ));
    }
    for artifact in &input.artifacts {
        if artifact.artifact_id.trim().is_empty()
            || artifact.artifact_id.len() > 255
            || artifact.requirement_key.trim().is_empty()
            || artifact.requirement_key.len() > 64
            || artifact.source_version_id.trim().is_empty()
        {
            return Err(StoreError::Invalid(
                "produced artifact identity is incomplete".into(),
            ));
        }
    }
    Ok(())
}
fn validate_inspection(input: &ArtifactInspectionInput) -> Result<(), StoreError> {
    if input.inspector_kind == "automatic" {
        return Err(StoreError::Invalid(
            "automatic inspections require trusted internal validator provenance; the public recording method accepts human inspections only".into(),
        ));
    }
    if input.work_id.trim().is_empty()
        || input.inspection_id.trim().is_empty()
        || input.submission_id.trim().is_empty()
        || input.artifact_id.trim().is_empty()
        || !input.artifact_digest.starts_with("sha256:")
        || input.inspector_kind != "human"
        || !matches!(input.outcome.as_str(), "passed" | "failed" | "unavailable")
        || input.criteria_json.len() > 65536
    {
        return Err(StoreError::Invalid(
            "artifact inspection fields are invalid or exceed bounds".into(),
        ));
    }
    let v: Value = serde_json::from_str(&input.criteria_json)
        .map_err(|_| StoreError::Invalid("inspection criteria must be JSON".into()))?;
    let Some(criteria) = v.as_array() else {
        return Err(StoreError::Invalid(
            "inspection criteria must be an array".into(),
        ));
    };
    if criteria.len() > boreal_domain::deliverables::MAX_CRITERIA_PER_REQUIREMENT {
        return Err(StoreError::Invalid(
            "inspection criteria exceed the 16 observation bound".into(),
        ));
    }
    for criterion in criteria {
        let name = criterion.get("criterion").and_then(Value::as_str);
        let outcome = criterion.get("outcome").and_then(Value::as_str);
        let detail = criterion
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if name.is_none_or(|name| name.trim().is_empty() || name.len() > 128)
            || outcome.is_none_or(|value| !matches!(value, "passed" | "failed" | "unavailable"))
            || detail.len() > 2000
        {
            return Err(StoreError::Invalid(
                "inspection observation is invalid or too large".into(),
            ));
        }
    }
    Ok(())
}
fn validate_decision(input: &ArtifactDecisionInput) -> Result<(), StoreError> {
    if input.work_id.trim().is_empty()
        || input.decision_id.trim().is_empty()
        || input.submission_id.trim().is_empty()
        || input.artifact_set_digest.trim().is_empty()
        || input.producer_actor_id.trim().is_empty()
        || !matches!(
            input.decision.as_str(),
            "approved" | "rejected" | "needs_revision"
        )
        || input.reason.trim().is_empty()
        || input.reason.len() > 2000
    {
        return Err(StoreError::Invalid(
            "artifact decision fields are invalid or exceed bounds".into(),
        ));
    }
    Ok(())
}
fn validate_wait(input: &ExternalWaitInput) -> Result<(), StoreError> {
    if input.work_id.trim().is_empty()
        || input.wait_id.trim().is_empty()
        || input.category.trim().is_empty()
        || input.category.len() > 64
        || input.reason.trim().is_empty()
        || input.reason.len() > 2000
        || !matches!(
            input.accountable_kind.as_str(),
            "person_or_role" | "external_service"
        )
        || input.accountable_ref.trim().is_empty()
        || input.accountable_ref.len() > 255
        || input.expected_decision_or_output.trim().is_empty()
        || input.expected_decision_or_output.len() > 2000
    {
        return Err(StoreError::Invalid(
            "external wait fields are invalid or exceed bounds".into(),
        ));
    }
    if let Some(value) = &input.follow_up_json {
        let parsed: Value = serde_json::from_str(value)
            .map_err(|_| StoreError::Invalid("wait follow-up must be typed JSON".into()))?;
        if !parsed.is_object() {
            return Err(StoreError::Invalid(
                "wait follow-up must be a typed object".into(),
            ));
        }
        match parsed.get("kind").and_then(Value::as_str) {
            Some("instant") if parsed.get("at_utc_ms").and_then(Value::as_u64).is_some() => {}
            Some("date_only") => {
                let date = parsed.get("date").and_then(Value::as_str).ok_or_else(|| {
                    StoreError::Invalid("date-only follow-up requires date".into())
                })?;
                let timezone = parsed
                    .get("timezone")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        StoreError::Invalid("date-only follow-up requires timezone".into())
                    })?;
                let date = boreal_domain::external_waits::CivilDate::parse(date).map_err(|_| {
                    StoreError::Invalid("date-only follow-up date is invalid".into())
                })?;
                boreal_domain::external_waits::BusinessDate::new(date, timezone.to_owned())
                    .map_err(|_| {
                        StoreError::Invalid("date-only follow-up timezone is invalid".into())
                    })?;
            }
            _ => {
                return Err(StoreError::Invalid(
                    "wait follow-up kind is unsupported or incomplete".into(),
                ))
            }
        }
    }
    Ok(())
}
fn canonical_json_and_digest(raw: &str) -> Result<(String, String), StoreError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| StoreError::Invalid("value is invalid JSON".into()))?;
    let canonical = value.to_string();
    let digest = checksum(canonical.as_bytes());
    Ok((canonical, digest))
}

fn parse_inspection_outcome(
    raw: &str,
) -> Result<boreal_domain::deliverables::InspectionOutcome, StoreError> {
    use boreal_domain::deliverables::InspectionOutcome;
    match raw {
        "passed" => Ok(InspectionOutcome::Passed),
        "failed" => Ok(InspectionOutcome::Failed),
        "unavailable" => Ok(InspectionOutcome::Unavailable),
        value => Err(StoreError::Corrupt(format!(
            "unknown artifact inspection outcome: {value}"
        ))),
    }
}

fn parse_artifact_availability(
    raw: &str,
) -> Result<boreal_domain::deliverables::ArtifactAvailability, StoreError> {
    use boreal_domain::deliverables::ArtifactAvailability;
    match raw {
        "available" => Ok(ArtifactAvailability::Available),
        "missing" => Ok(ArtifactAvailability::Missing),
        "quarantined" => Ok(ArtifactAvailability::Quarantined),
        value => Err(StoreError::Corrupt(format!(
            "unknown source availability for artifact: {value}"
        ))),
    }
}

fn parse_inspection_criteria(
    raw: &str,
) -> Result<Vec<boreal_domain::deliverables::CriterionObservation>, StoreError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| StoreError::Corrupt("stored inspection criteria are invalid JSON".into()))?;
    let rows = value
        .as_array()
        .ok_or_else(|| StoreError::Corrupt("stored inspection criteria are not an array".into()))?;
    rows.iter()
        .map(|row| {
            let criterion = row
                .get("criterion")
                .and_then(Value::as_str)
                .ok_or_else(|| StoreError::Corrupt("inspection criterion key is missing".into()))?;
            let outcome = row.get("outcome").and_then(Value::as_str).ok_or_else(|| {
                StoreError::Corrupt("inspection criterion result is missing".into())
            })?;
            let detail = row
                .get("detail")
                .and_then(Value::as_str)
                .unwrap_or_default();
            Ok(boreal_domain::deliverables::CriterionObservation {
                criterion: criterion.to_owned(),
                outcome: parse_inspection_outcome(outcome)?,
                detail: detail.to_owned(),
            })
        })
        .collect()
}

fn bind_optional_text(
    statement: &mut super::Statement<'_>,
    index: i32,
    value: Option<&str>,
) -> Result<(), StoreError> {
    match value {
        Some(value) => statement.bind_text(index, value),
        None => statement.bind_null(index),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inspection(kind: &str) -> ArtifactInspectionInput {
        ArtifactInspectionInput {
            work_id: "w1".into(),
            inspection_id: "inspect-1".into(),
            submission_id: "submission-1".into(),
            artifact_id: "artifact-1".into(),
            artifact_digest: format!("sha256:{}", "a".repeat(64)),
            inspector_kind: kind.into(),
            outcome: "passed".into(),
            criteria_json: "[]".into(),
        }
    }

    #[test]
    fn generic_inspection_write_rejects_caller_asserted_automatic_provenance() {
        assert!(matches!(
            validate_inspection(&inspection("automatic")),
            Err(StoreError::Invalid(message))
                if message.contains("trusted internal validator provenance")
        ));
        assert!(validate_inspection(&inspection("human")).is_ok());
    }
}

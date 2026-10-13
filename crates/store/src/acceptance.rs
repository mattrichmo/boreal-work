//! Canonical acceptance persistence and immutable submission binding.
//!
//! This module exposes the canonical gate and diagnostic reads required by
//! later acceptance work.  It keeps requirements/observations in the
//! application/domain boundary and does not make a SQL status decision.

use super::{
    check_expected_revision, checksum, finish_transaction, CloseIntentRequest, CloseIntentResult,
    GateDiagnostics, GateRecord, GateStateUpdateRequest, MutationResult, ReceiptInsertRequest,
    ReceiptInsertResult, ReceiptRecord, ReviewInsertRequest, ReviewRecord, SqliteStore, StoreError,
    SummaryInsertRequest, SummaryInsertResult, SummaryRecord,
};
use serde_json::{json, Value};

pub const TYPED_ACCEPTANCE_SCHEMA_VERSION: u64 = 1;
const TYPED_ACCEPTANCE_SCHEMA_SQL: &str = r#"
CREATE TABLE boreal_acceptance_result_v1 (
  result_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  fence INTEGER NOT NULL CHECK (fence > 0),
  entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  actor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL,
  config_identity TEXT NOT NULL CHECK (trim(config_identity) <> ''),
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  profile_digest TEXT NOT NULL,
  contract_revision INTEGER NOT NULL CHECK (contract_revision >= 0),
  result_digest TEXT NOT NULL,
  outputs_json TEXT NOT NULL,
  attestation_json TEXT,
  operation_id TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  project_revision INTEGER NOT NULL CHECK (project_revision > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (attempt_id) REFERENCES attempt(attempt_id),
  FOREIGN KEY (project_id, source_version_id) REFERENCES source_version(project_id, source_version_id),
  FOREIGN KEY (profile_id, profile_version) REFERENCES acceptance_profile(profile_id, version)
);
CREATE INDEX boreal_acceptance_result_attempt
  ON boreal_acceptance_result_v1(project_id, work_id, attempt_id, fence, proof_revision);
CREATE TRIGGER boreal_acceptance_result_immutable_update
  BEFORE UPDATE ON boreal_acceptance_result_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_acceptance_result_immutable'); END;
CREATE TRIGGER boreal_acceptance_result_immutable_delete
  BEFORE DELETE ON boreal_acceptance_result_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_acceptance_result_immutable'); END;
CREATE TABLE boreal_acceptance_event_v1 (
  event_id TEXT PRIMARY KEY,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('acceptance.result.bound','artifact.inspected')),
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  fence INTEGER NOT NULL CHECK (fence > 0),
  actor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  result_id TEXT NOT NULL REFERENCES boreal_acceptance_result_v1(result_id),
  result_digest TEXT NOT NULL,
  requirement_key TEXT,
  source_version_id TEXT,
  operation_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL CHECK (project_revision > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE INDEX boreal_acceptance_event_subject
  ON boreal_acceptance_event_v1(project_id, work_id, project_revision, event_kind);
CREATE TRIGGER boreal_acceptance_event_immutable_update
  BEFORE UPDATE ON boreal_acceptance_event_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_acceptance_event_immutable'); END;
CREATE TRIGGER boreal_acceptance_event_immutable_delete
  BEFORE DELETE ON boreal_acceptance_event_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_acceptance_event_immutable'); END;
CREATE TABLE boreal_submission_acceptance_v1 (
  submission_id TEXT PRIMARY KEY REFERENCES boreal_submission(submission_id),
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  result_id TEXT NOT NULL UNIQUE REFERENCES boreal_acceptance_result_v1(result_id),
  contract_revision INTEGER NOT NULL CHECK (contract_revision >= 0),
  result_digest TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE TRIGGER boreal_submission_acceptance_immutable_update
  BEFORE UPDATE ON boreal_submission_acceptance_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_submission_acceptance_immutable'); END;
CREATE TRIGGER boreal_submission_acceptance_immutable_delete
  BEFORE DELETE ON boreal_submission_acceptance_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_submission_acceptance_immutable'); END;
CREATE TABLE boreal_artifact_decision_v1 (
  decision_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES boreal_submission(submission_id),
  result_id TEXT NOT NULL REFERENCES boreal_acceptance_result_v1(result_id),
  result_digest TEXT NOT NULL,
  fact_schema TEXT NOT NULL CHECK (fact_schema = 'independent_artifact_decision/1'),
  reviewer_actor_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('approved','rejected','returned','revoked')),
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE INDEX boreal_artifact_decision_submission
  ON boreal_artifact_decision_v1(project_id, work_id, submission_id, created_at);
CREATE TRIGGER boreal_artifact_decision_immutable_update
  BEFORE UPDATE ON boreal_artifact_decision_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_artifact_decision_immutable'); END;
CREATE TRIGGER boreal_artifact_decision_immutable_delete
  BEFORE DELETE ON boreal_artifact_decision_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_artifact_decision_immutable'); END;
"#;

pub const MAX_ACCEPTANCE_RESULT_OUTPUTS: usize = 64;
const MAX_ACCEPTANCE_RESULT_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceBinding {
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
}

#[cfg(test)]
mod typed_acceptance_tests {
    use super::*;
    use crate::{
        completion::CompletionMutationRequest,
        identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
        principals::PrincipalGrantRequest,
        AttemptMutationKind, AttemptMutationRequest, SessionRegistrationRequest,
        SourceVersionRegistrationInput, SummaryInsertRequest,
    };
    use boreal_domain::{
        AcceptanceProfile, AttemptPhase, DispatchPolicy, GateId, GateKind, GateRequirement,
        PersistedLifecycle, ProfileId, WorkId, WorkItem, WorkKind,
    };

    fn required_contract() -> Vec<Value> {
        vec![json!({
            "key": "report",
            "purpose": "Provide a report",
            "required": true,
            "deliverable_type": "report",
            "min_count": 1,
            "max_count": 1,
            "allowed_media_types": ["text/plain"],
            "criteria": [{"kind":"min_bytes", "value":3}]
        })]
    }

    fn inspection(
        availability: ArtifactInspectionAvailability,
        passed: bool,
    ) -> AcceptanceArtifactInspection {
        AcceptanceArtifactInspection {
            requirement_key: "report".into(),
            relationship_id: "report-v1".into(),
            attribution: Some("producer".into()),
            rights_statement: Some("owned".into()),
            license: None,
            source_version_id: "artifact-1".into(),
            content_digest: format!("sha256:{}", "a".repeat(64)),
            media_type: "text/plain".into(),
            availability,
            media_type_allowed: true,
            byte_count: 3,
            criteria: vec![AcceptanceCriterionResult {
                criterion_id: "min_bytes".into(),
                passed,
                observed: "3".into(),
            }],
        }
    }

    fn acceptance_result() -> AcceptanceResultRecord {
        AcceptanceResultRecord {
            result_id: "result-1".into(),
            project_id: "p1".into(),
            work_id: "w1".into(),
            attempt_id: "attempt-1".into(),
            fence: 1,
            entity_revision: 1,
            proof_revision: 1,
            actor_id: "producer".into(),
            session_id: "session".into(),
            source_version_id: "source".into(),
            config_identity: "config".into(),
            profile_id: "reviewed-artifacts".into(),
            profile_version: 1,
            profile_digest: "sha256:profile".into(),
            contract_revision: 1,
            result_digest: "sha256:result".into(),
            outputs: Vec::new(),
            attestation: None,
            operation_id: "bind-result".into(),
            request_digest: "sha256:request".into(),
            project_revision: 2,
            created_at: "unix-ms:2".into(),
            replayed: false,
        }
    }

    fn decision(
        outcome: &str,
        result_id: &str,
        digest: &str,
        reviewer: &str,
    ) -> ArtifactDecisionRecord {
        ArtifactDecisionRecord {
            decision_id: "decision-1".into(),
            project_id: "p1".into(),
            work_id: "w1".into(),
            submission_id: "submission-1".into(),
            result_id: result_id.into(),
            result_digest: digest.into(),
            fact_schema: super::super::profiles::INDEPENDENT_ARTIFACT_DECISION_FACT_SCHEMA.into(),
            reviewer_actor_id: reviewer.into(),
            outcome: outcome.into(),
            reason: "checked exact artifacts".into(),
            operation_id: "review-op".into(),
            created_at: "unix-ms:3".into(),
        }
    }

    fn active_acceptance_work(profile_id: &str, with_contract: bool) -> (SqliteStore, String, u64) {
        let store = SqliteStore::open_in_memory(include_str!(
            "../../../project/spec/schema-production.sql"
        ))
        .expect("production schema opens");
        active_acceptance_work_in_store(store, profile_id, with_contract)
    }

    fn active_acceptance_work_in_store(
        store: SqliteStore,
        profile_id: &str,
        with_contract: bool,
    ) -> (SqliteStore, String, u64) {
        let identities = IdentityStore::new(&store);
        let database = match identities.database_identity() {
            Ok(database) => database,
            Err(_) => {
                let database = DatabaseIdentity::new("typed-acceptance-db", 1).unwrap();
                identities.install(&database, "unix-ms:0").unwrap();
                database
            }
        };
        let workspace = WorkspaceBinding::new(
            "/tmp/boreal-typed-acceptance",
            "/tmp/boreal-typed-acceptance",
            "sha256:typed-acceptance-binding",
        )
        .unwrap();
        store
            .initialize_project_with_workspace(
                "p1",
                "operator-1",
                "operator",
                "boreal-key-v1:sha256:typed-acceptance-credential",
                "Operator",
                "op-project-init",
                "sha256:op-project-init",
                &database,
                &workspace,
                "unix-ms:0",
            )
            .unwrap();
        let revision = store.project_revision("p1").unwrap().0;
        store
            .grant_principal(&PrincipalGrantRequest {
                project_id: "p1".into(),
                actor_id: "operator-1".into(),
                session_id: None,
                principal_actor_id: "agent-1".into(),
                role: boreal_domain::ActorRole::Agent,
                independent: false,
                credential: format!("bwrk1_{}", "b".repeat(64)),
                expires_at_ms: None,
                display_name: "Typed acceptance agent".into(),
                reason: "integration test enrolled execution principal".into(),
                expected_revision: revision,
                operation_id: "op-agent-grant".into(),
                at: "unix-ms:0".into(),
            })
            .unwrap();
        let revision = store.project_revision("p1").unwrap().0;
        store
            .register_session(SessionRegistrationRequest {
                project_id: "p1".into(),
                session_id: "operator-session".into(),
                actor_id: "operator-1".into(),
                harness_id: "test-harness".into(),
                operation_id: "op-session-register".into(),
                request_digest: "sha256:op-session-register".into(),
                expected_project_revision: Some(revision),
                started_at: "unix-ms:0".into(),
            })
            .unwrap();
        let revision = store.project_revision("p1").unwrap().0;
        store
            .register_session(SessionRegistrationRequest {
                project_id: "p1".into(),
                session_id: "session-1".into(),
                actor_id: "agent-1".into(),
                harness_id: "test-harness".into(),
                operation_id: "op-agent-session-register".into(),
                request_digest: "sha256:op-agent-session-register".into(),
                expected_project_revision: Some(revision),
                started_at: "unix-ms:0".into(),
            })
            .unwrap();
        store
            .register_source_version(&SourceVersionRegistrationInput {
                operation_id: "op-source-register".into(),
                project_id: "p1".into(),
                actor_id: "operator-1".into(),
                source_version_id: "source-1".into(),
                origin: "test-source".into(),
                access_scope: "project".into(),
                content_digest: format!("sha256:{}", "a".repeat(64)),
                media_type: "text/plain".into(),
                byte_count: 3,
                captured_at: "unix-ms:1".into(),
                parser_identity: "test-parser/1".into(),
                availability: "available".into(),
                citation_json: "[]".into(),
                request_digest: "sha256:op-source-register".into(),
            })
            .unwrap();
        let mut work = WorkItem::new(
            "p1".into(),
            WorkId::new("w1"),
            WorkKind::Task,
            None,
            "Typed acceptance integration",
        );
        work.lifecycle = PersistedLifecycle::Open;
        work.dispatch_policy = DispatchPolicy::Automatic;
        let mut gates = vec![GateRequirement::required(
            GateId::new("summary"),
            GateKind::Summary,
        )];
        if profile_id == "reviewed-artifacts" {
            gates.push(GateRequirement::required(
                GateId::new("artifact_review"),
                GateKind::Review,
            ));
        }
        work.acceptance_profile = AcceptanceProfile {
            id: ProfileId::new(profile_id),
            version: "1".into(),
            gates,
        };
        let revision = store.project_revision("p1").unwrap().0;
        store
            .create_work_operation_for_session(
                &work,
                "operator-1",
                Some("operator-session"),
                "op-work-create",
                "sha256:op-work-create",
                Some(revision),
                "unix-ms:2",
            )
            .unwrap();
        if with_contract {
            store.ensure_deliverables_schema().unwrap();
            store.execute_batch("BEGIN IMMEDIATE").unwrap();
            let result = store.insert_planning_contract_in_transaction(
                "p1",
                &crate::WorkPlanningContractWrite {
                    work_id: "w1".into(),
                    requirements_json: json!([{
                        "key":"report",
                        "purpose":"Provide a report",
                        "required":true,
                        "deliverable_type":"report",
                        "min_count":1,
                        "max_count":1,
                        "allowed_media_types":["text/plain"],
                        "criteria":[{"kind":"min_bytes","value":3}]
                    }])
                    .to_string(),
                    inputs_json: "[]".into(),
                },
                None,
                None,
                "operator-1",
                "operator-session",
                "op-planning-contract",
                "unix-ms:3",
            );
            finish_transaction(&store, result).unwrap();
        }
        let revision = store.project_revision("p1").unwrap().0;
        let claimed = store
            .claim_work_with_context(
                "p1",
                "w1",
                "agent-1",
                "test-harness",
                Some("session-1"),
                "attempt-1",
                "op-claim",
                "sha256:op-claim",
                Some(revision),
                "unix-ms:10",
                "unix-ms:5000",
                "unix-ms:9000",
                Some("source-1"),
                "config-1",
            )
            .unwrap();
        for (operation_id, at, expected_phase, mutation) in [
            (
                "op-attempt-accept",
                "unix-ms:20",
                AttemptPhase::Claimed,
                AttemptMutationKind::Accept,
            ),
            (
                "op-attempt-start",
                "unix-ms:30",
                AttemptPhase::Accepted,
                AttemptMutationKind::Start,
            ),
        ] {
            store
                .apply_attempt_mutation(AttemptMutationRequest {
                    project_id: "p1".into(),
                    work_id: "w1".into(),
                    attempt_id: claimed.attempt_id.clone(),
                    actor_id: "agent-1".into(),
                    harness_id: Some("test-harness".into()),
                    session_id: Some("session-1".into()),
                    fence: claimed.fence,
                    operation_id: operation_id.into(),
                    request_digest: format!("sha256:{operation_id}"),
                    at: at.into(),
                    expected_project_revision: None,
                    expected_work_revision: None,
                    expected_attempt_revision: Some(claimed.fence),
                    expected_phase: Some(expected_phase),
                    expected_lease_deadline: None,
                    expected_hard_deadline: None,
                    mutation,
                    reason: None,
                })
                .unwrap();
        }
        (store, claimed.attempt_id, claimed.fence)
    }

    fn bind_request(
        store: &SqliteStore,
        attempt_id: &str,
        fence: u64,
        operation_id: &str,
        passed: bool,
    ) -> AcceptanceResultBindRequest {
        let (entity, proof) = store.work_revisions("p1", "w1").unwrap();
        let contract_revision = store
            .work_planning_contract("p1", "w1")
            .unwrap()
            .map(|contract| contract.contract_revision)
            .unwrap_or(0);
        AcceptanceResultBindRequest {
            project_id: "p1".into(),
            work_id: "w1".into(),
            actor_id: "agent-1".into(),
            session_id: "session-1".into(),
            attempt_id: attempt_id.into(),
            fence,
            expected_project_revision: store.project_revision("p1").unwrap().0,
            expected_entity_revision: entity,
            expected_proof_revision: proof,
            result_id: format!("result-{operation_id}"),
            contract_revision,
            outputs: if contract_revision == 0 {
                Vec::new()
            } else {
                vec![AcceptanceArtifactInspection {
                    requirement_key: "report".into(),
                    relationship_id: "report-v1".into(),
                    attribution: Some("producer".into()),
                    rights_statement: Some("owned".into()),
                    license: None,
                    source_version_id: "source-1".into(),
                    content_digest: format!("sha256:{}", "a".repeat(64)),
                    media_type: "text/plain".into(),
                    availability: ArtifactInspectionAvailability::Available,
                    media_type_allowed: true,
                    byte_count: 3,
                    criteria: vec![AcceptanceCriterionResult {
                        criterion_id: "min_bytes".into(),
                        passed,
                        observed: "3".into(),
                    }],
                }]
            },
            attestation: (contract_revision == 0).then(|| CompletionAttestationInput {
                statement: "Completed bounded work with no required deliverables".into(),
            }),
            operation_id: operation_id.into(),
            at: "unix-ms:40".into(),
        }
    }

    fn bind_summary(store: &SqliteStore, attempt_id: &str, fence: u64) -> String {
        let summary_id = "summary-typed-acceptance";
        store
            .insert_summary(SummaryInsertRequest {
                project_id: "p1".into(),
                actor_id: "agent-1".into(),
                session_id: Some("session-1".into()),
                expected_project_revision: Some(store.project_revision("p1").unwrap().0),
                summary_id: summary_id.into(),
                work_id: "w1".into(),
                attempt_id: attempt_id.into(),
                fence,
                source_version_id: "source-1".into(),
                config_identity: "config-1".into(),
                profile_id: super::super::ProfileStore::new(store)
                    .current_pinned_requirements("p1", "w1")
                    .unwrap()
                    .profile
                    .profile_id,
                profile_version: 1,
                body_digest: format!("sha256:{}", "c".repeat(64)),
                body_size: 48,
                operation_id: "op-summary-typed-acceptance".into(),
                created_at: "unix-ms:40".into(),
            })
            .unwrap();
        summary_id.into()
    }

    fn close_request(
        store: &SqliteStore,
        attempt_id: &str,
        fence: u64,
        summary_id: &str,
        operation_id: &str,
        close_intent_id: &str,
        at: &str,
    ) -> CloseIntentRequest {
        CloseIntentRequest {
            project_id: "p1".into(),
            actor_id: "agent-1".into(),
            session_id: Some("session-1".into()),
            expected_project_revision: Some(store.project_revision("p1").unwrap().0),
            close_intent_id: close_intent_id.into(),
            work_id: "w1".into(),
            attempt_id: attempt_id.into(),
            fence,
            operation_id: operation_id.into(),
            source_version_id: Some("source-1".into()),
            config_identity: "config-1".into(),
            profile_id: super::super::ProfileStore::new(store)
                .current_pinned_requirements("p1", "w1")
                .unwrap()
                .profile
                .profile_id,
            profile_version: 1,
            summary_id: Some(summary_id.into()),
            at: at.into(),
            request_digest: format!("sha256:{}", operation_id),
        }
    }

    #[test]
    fn general_attestation_cannot_cover_required_artifacts() {
        let attestation = CompletionAttestationInput {
            statement: "I completed it".into(),
        };
        let error = validate_result_against_contract(
            super::super::profiles::RegisteredAcceptanceMode::GeneralAttestation,
            &required_contract(),
            &[],
            Some(&attestation),
            false,
        )
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("acceptance_profile_requires_validated_deliverables"));
    }

    #[test]
    fn registered_profile_gate_declarations_are_exact_and_structurally_valid() {
        let (store, _, _) = active_acceptance_work("reviewed-artifacts", true);
        let mut pin = super::super::ProfileStore::new(&store)
            .current_pinned_requirements("p1", "w1")
            .unwrap();
        let profile = super::super::profiles::registered_acceptance_profile(
            &pin.profile.profile_id,
            pin.profile.version,
        )
        .unwrap()
        .unwrap();
        assert!(validate_registered_profile_gates(&pin, profile).is_ok());

        let mut unexpected_required = pin.clone();
        unexpected_required
            .declarations
            .push(super::super::profiles::GateRequirementDeclaration {
                requirement_id: "extra@audit".into(),
                gate_id: "extra".into(),
                kind: "audit".into(),
                required: true,
                verifier_policy: "trusted_registered_verifier".into(),
                subject_rules: json!({}),
                observable_rules: Vec::new(),
                review_policy: json!({}),
                exception_policy: "operator_scoped_additional_decision".into(),
            });
        assert!(validate_registered_profile_gates(&unexpected_required, profile).is_err());

        pin.declarations[0].kind = "review".into();
        pin.declarations[0].requirement_id = "summary@review".into();
        assert!(validate_registered_profile_gates(&pin, profile).is_err());

        let mut malformed_optional = super::super::ProfileStore::new(&store)
            .current_pinned_requirements("p1", "w1")
            .unwrap();
        malformed_optional
            .declarations
            .push(super::super::profiles::GateRequirementDeclaration {
                requirement_id: "optional@audit".into(),
                gate_id: "optional".into(),
                kind: "audit".into(),
                required: false,
                verifier_policy: "trusted_registered_verifier".into(),
                subject_rules: json!([]),
                observable_rules: Vec::new(),
                review_policy: json!({}),
                exception_policy: "operator_scoped_additional_decision".into(),
            });
        assert!(validate_registered_profile_gates(&malformed_optional, profile).is_err());
    }

    #[test]
    fn typed_acceptance_bind_requires_valid_lineage_and_rights_identity() {
        let (store, attempt, fence) = active_acceptance_work("validated-deliverables", true);
        let mut request = bind_request(&store, &attempt, fence, "op-invalid-lineage", true);
        request.outputs[0].relationship_id = "../report".into();
        assert!(validate_acceptance_bind_request(&request).is_err());
        request.outputs[0].relationship_id = "report-v1".into();
        request.outputs[0].rights_statement = Some("x".repeat(4097));
        assert!(validate_acceptance_bind_request(&request).is_err());
    }

    #[test]
    fn failed_and_incomplete_inspections_bind_as_history_but_cannot_pass_close() {
        use super::super::profiles::RegisteredAcceptanceMode::ValidatedDeliverables;
        let requirements = required_contract();
        let failed = inspection(ArtifactInspectionAvailability::Available, false);
        assert!(validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            std::slice::from_ref(&failed),
            None,
            false,
        )
        .is_ok());
        assert!(validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            std::slice::from_ref(&failed),
            None,
            true,
        )
        .is_err());
        assert!(validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            &[],
            None,
            false,
        )
        .is_ok());
        assert!(validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            &[],
            None,
            true,
        )
        .is_err());
        let missing = inspection(ArtifactInspectionAvailability::Missing, true);
        assert!(validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            std::slice::from_ref(&missing),
            None,
            false,
        )
        .is_ok());
        assert!(validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            &[missing],
            None,
            true,
        )
        .is_err());
    }

    #[test]
    fn wildcard_media_type_is_checked_against_the_actual_type_during_close_validation() {
        use super::super::profiles::RegisteredAcceptanceMode::ValidatedDeliverables;

        let mut requirements = required_contract();
        requirements[0]["allowed_media_types"] = json!(["image/*"]);
        let mut matching = inspection(ArtifactInspectionAvailability::Available, true);
        matching.media_type = "image/png".into();
        assert!(validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            std::slice::from_ref(&matching),
            None,
            true,
        )
        .is_ok());

        let mut mismatch = matching.clone();
        mismatch.media_type = "application/pdf".into();
        mismatch.media_type_allowed = false;
        let error = validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            std::slice::from_ref(&mismatch),
            None,
            true,
        )
        .unwrap_err();
        assert!(error.to_string().contains("required artifact"));

        // The store independently checks the inspection outcome against the
        // pinned media contract, even if a caller claims a mismatch passed.
        mismatch.media_type_allowed = true;
        let error = validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            std::slice::from_ref(&mismatch),
            None,
            true,
        )
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("media-type inspection does not match"));

        requirements[0]["allowed_media_types"] = json!([]);
        mismatch.media_type = "application/pdf".into();
        mismatch.media_type_allowed = true;
        assert!(validate_result_against_contract(
            ValidatedDeliverables,
            &requirements,
            std::slice::from_ref(&mismatch),
            None,
            true,
        )
        .is_ok());
    }

    #[test]
    fn store_binds_and_reads_back_failed_then_passing_results_without_overwriting_history() {
        let (store, attempt, fence) = active_acceptance_work("validated-deliverables", true);
        let failed_request = bind_request(&store, &attempt, fence, "op-result-failed", false);
        let failed = store.bind_acceptance_result(&failed_request).unwrap();
        assert!(!failed.replayed);
        assert!(!failed.outputs[0].criteria[0].passed);
        assert_eq!(
            failed.outputs[0].fact_schema(),
            super::super::profiles::ARTIFACT_INSPECTION_FACT_SCHEMA
        );
        let replayed = store.bind_acceptance_result(&failed_request).unwrap();
        assert!(replayed.replayed);
        assert_eq!(replayed.result_id, failed.result_id);
        assert_eq!(replayed.project_revision, failed.project_revision);

        let passing_request = bind_request(&store, &attempt, fence, "op-result-passing", true);
        let passing = store.bind_acceptance_result(&passing_request).unwrap();
        assert!(!passing.replayed);
        assert!(passing.outputs[0].criteria[0].passed);
        assert_eq!(
            store
                .acceptance_result_for_operation("p1", "op-result-failed")
                .unwrap()
                .unwrap()
                .result_id,
            failed.result_id
        );
        assert_eq!(
            store
                .current_acceptance_result("p1", "w1", &attempt, fence)
                .unwrap()
                .unwrap()
                .result_id,
            passing.result_id
        );
    }

    #[test]
    fn failed_required_result_is_bound_to_submission_and_close_rejection_is_durable() {
        let (store, attempt, fence) = active_acceptance_work("validated-deliverables", true);
        let failed_request = bind_request(&store, &attempt, fence, "op-result-failed-close", false);
        let failed = store.bind_acceptance_result(&failed_request).unwrap();
        assert!(!failed.outputs[0].criteria[0].passed);

        store
            .apply_attempt_mutation(AttemptMutationRequest {
                project_id: "p1".into(),
                work_id: "w1".into(),
                attempt_id: attempt.clone(),
                actor_id: "agent-1".into(),
                harness_id: Some("test-harness".into()),
                session_id: Some("session-1".into()),
                fence,
                operation_id: "op-attempt-submit".into(),
                request_digest: "sha256:op-attempt-submit".into(),
                at: "unix-ms:45".into(),
                expected_project_revision: None,
                expected_work_revision: None,
                expected_attempt_revision: Some(fence),
                expected_phase: Some(AttemptPhase::Running),
                expected_lease_deadline: None,
                expected_hard_deadline: None,
                mutation: AttemptMutationKind::Submit,
                reason: None,
            })
            .unwrap();
        let summary_id = bind_summary(&store, &attempt, fence);
        let create_request = close_request(
            &store,
            &attempt,
            fence,
            &summary_id,
            "op-close-create-typed",
            "close-typed",
            "unix-ms:50",
        );
        store.create_close_intent(&create_request).unwrap();
        let proof_revision = store.work_revisions("p1", "w1").unwrap().1;
        let submission = store
            .current_submission("p1", "w1", proof_revision)
            .unwrap()
            .expect("close intent seals the exact submitted proof");
        assert_eq!(
            store
                .submission_acceptance_binding("p1", "w1", &submission.submission_id)
                .unwrap(),
            Some((failed.result_id.clone(), failed.result_digest.clone()))
        );

        let mut finalize = close_request(
            &store,
            &attempt,
            fence,
            &summary_id,
            "op-close-finalize-typed",
            "close-typed",
            "unix-ms:60",
        );
        finalize.expected_project_revision = Some(store.project_revision("p1").unwrap().0);
        let rejected = store.finalize_close_intent(&finalize).unwrap();
        let diagnostics = rejected
            .diagnostics
            .expect("failed typed result blocks close");
        assert!(diagnostics
            .missing
            .iter()
            .any(|reason| reason.contains("typed_acceptance:")
                && reason.contains("failed one or more deterministic criteria")));
        let operation = store
            .operation("op-close-finalize-typed")
            .unwrap()
            .expect("rejected close operation is durable");
        assert_eq!(operation.outcome, super::super::OperationOutcome::Rejected);
        assert!(operation.result_json.contains("required artifact"));
        assert!(operation.result_json.contains("typed_acceptance:"));
        assert_eq!(
            store
                .close_intent("p1", "close-typed")
                .unwrap()
                .unwrap()
                .state,
            super::super::CloseIntentState::Open
        );
    }

    #[test]
    fn reviewed_artifact_decision_is_independent_immutable_and_bound_to_exact_result() {
        let (store, attempt, fence) = active_acceptance_work("reviewed-artifacts", true);
        // The store receives a result already inspected by the application
        // boundary; this fixture marks the deterministic criterion passing
        // so the close diagnostic reaches the independent-review decision.
        let bind = bind_request(&store, &attempt, fence, "op-reviewed-result", true);
        let result = store.bind_acceptance_result(&bind).unwrap();
        store
            .apply_attempt_mutation(AttemptMutationRequest {
                project_id: "p1".into(),
                work_id: "w1".into(),
                attempt_id: attempt.clone(),
                actor_id: "agent-1".into(),
                harness_id: Some("test-harness".into()),
                session_id: Some("session-1".into()),
                fence,
                operation_id: "op-reviewed-submit".into(),
                request_digest: "sha256:op-reviewed-submit".into(),
                at: "unix-ms:45".into(),
                expected_project_revision: None,
                expected_work_revision: None,
                expected_attempt_revision: Some(fence),
                expected_phase: Some(AttemptPhase::Running),
                expected_lease_deadline: None,
                expected_hard_deadline: None,
                mutation: AttemptMutationKind::Submit,
                reason: None,
            })
            .unwrap();
        let summary_id = bind_summary(&store, &attempt, fence);
        let close_create = close_request(
            &store,
            &attempt,
            fence,
            &summary_id,
            "op-reviewed-close-create",
            "close-reviewed",
            "unix-ms:50",
        );
        store.create_close_intent(&close_create).unwrap();
        let proof_revision = store.work_revisions("p1", "w1").unwrap().1;
        let submission = store
            .current_submission("p1", "w1", proof_revision)
            .unwrap()
            .expect("review closeout seals a submission");
        assert_eq!(
            store
                .submission_acceptance_binding("p1", "w1", &submission.submission_id)
                .unwrap(),
            Some((result.result_id.clone(), result.result_digest.clone()))
        );

        let revision = store.project_revision("p1").unwrap().0;
        store
            .grant_principal(&PrincipalGrantRequest {
                project_id: "p1".into(),
                actor_id: "operator-1".into(),
                session_id: None,
                principal_actor_id: "reviewer-1".into(),
                role: boreal_domain::ActorRole::Reviewer,
                independent: true,
                credential: format!("bwrk1_{}", "d".repeat(64)),
                expires_at_ms: None,
                display_name: "Independent typed acceptance reviewer".into(),
                reason: "integration test independent review authority".into(),
                expected_revision: revision,
                operation_id: "op-reviewer-grant".into(),
                at: "unix-ms:55".into(),
            })
            .unwrap();
        let revision = store.project_revision("p1").unwrap().0;
        store
            .register_session(SessionRegistrationRequest {
                project_id: "p1".into(),
                session_id: "reviewer-session".into(),
                actor_id: "reviewer-1".into(),
                harness_id: "test-harness".into(),
                operation_id: "op-reviewer-session".into(),
                request_digest: "sha256:op-reviewer-session".into(),
                expected_project_revision: Some(revision),
                started_at: "unix-ms:55".into(),
            })
            .unwrap();
        let (entity_revision, proof_revision) = store.work_revisions("p1", "w1").unwrap();
        let review_request = CompletionMutationRequest {
            project_id: "p1".into(),
            work_id: "w1".into(),
            actor_id: "reviewer-1".into(),
            session_id: "reviewer-session".into(),
            operation_id: "op-review-reject".into(),
            kind: boreal_domain::completion::CompletionKind::Reject,
            expected_revision: store.project_revision("p1").unwrap().0,
            expected_entity_revision: entity_revision,
            expected_proof_revision: proof_revision,
            submission_id: Some(submission.submission_id.clone()),
            target_id: Some("artifact_review".into()),
            predecessor_revision: None,
            exception_reason: None,
            reason: "required report did not pass inspection".into(),
            expires_at_ms: None,
            confirmed: true,
            at: "unix-ms:60".into(),
        };
        let rejected = store.apply_completion_command(&review_request).unwrap();
        assert!(!rejected.replayed);
        let decision = store
            .current_artifact_decision("p1", &submission.submission_id)
            .unwrap()
            .expect("review decision is durable");
        assert_eq!(decision.outcome, "rejected");
        assert_eq!(
            decision.fact_schema,
            super::super::profiles::INDEPENDENT_ARTIFACT_DECISION_FACT_SCHEMA
        );
        assert_eq!(decision.result_id, result.result_id);
        assert_eq!(decision.result_digest, result.result_digest);
        assert_eq!(decision.reviewer_actor_id, "reviewer-1");

        let replay = store.apply_completion_command(&review_request).unwrap();
        assert!(replay.replayed);
        let approve_revision = store.project_revision("p1").unwrap().0;
        let approve = CompletionMutationRequest {
            operation_id: "op-review-approve-after-reject".into(),
            kind: boreal_domain::completion::CompletionKind::Approve,
            expected_revision: approve_revision,
            reason: "attempt to replace immutable decision".into(),
            ..review_request
        };
        assert!(matches!(
            store.apply_completion_command(&approve),
            Err(StoreError::Conflict(message)) if message.contains("immutable")
        ));
        assert_eq!(
            store
                .current_artifact_decision("p1", &submission.submission_id)
                .unwrap()
                .unwrap(),
            decision
        );
        assert!(store
            .typed_acceptance_close_blocker(&close_create)
            .unwrap()
            .is_some_and(
                |reason| reason.contains("rejected, stale, or bound to a different result")
            ));
    }

    #[test]
    fn general_attestation_schema_is_persisted_and_read_back() {
        let (store, attempt, fence) = active_acceptance_work("general-attestation", false);
        let request = bind_request(&store, &attempt, fence, "op-general-attestation", false);
        let result = store.bind_acceptance_result(&request).unwrap();
        assert_eq!(
            result.fact_schemas(),
            vec![super::super::profiles::COMPLETION_ATTESTATION_FACT_SCHEMA]
        );
        assert_eq!(
            result.attestation.as_ref().unwrap().fact_schema(),
            super::super::profiles::COMPLETION_ATTESTATION_FACT_SCHEMA
        );
        let readback = store
            .acceptance_result_for_operation("p1", "op-general-attestation")
            .unwrap()
            .unwrap();
        assert_eq!(readback.attestation, result.attestation);
        assert_eq!(readback.fact_schemas(), result.fact_schemas());
    }

    #[test]
    fn typed_result_fact_and_operation_replay_survive_store_reopen() {
        let path = std::env::temp_dir().join(format!(
            "boreal-typed-acceptance-reopen-{}.sqlite",
            std::process::id()
        ));
        let path_text = path.to_string_lossy().into_owned();
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path_text}{suffix}"));
        }
        let store = SqliteStore::open(
            &path,
            include_str!("../../../project/spec/schema-production.sql"),
        )
        .unwrap();
        let (store, attempt, fence) =
            active_acceptance_work_in_store(store, "validated-deliverables", true);
        let request = bind_request(&store, &attempt, fence, "op-reopen-result", false);
        let first = store.bind_acceptance_result(&request).unwrap();
        assert!(!first.replayed);
        drop(store);

        let reopened = SqliteStore::open(
            &path,
            include_str!("../../../project/spec/schema-production.sql"),
        )
        .unwrap();
        let readback = reopened
            .acceptance_result_for_operation("p1", "op-reopen-result")
            .unwrap()
            .expect("immutable result is visible after reopening the store");
        assert_eq!(readback.result_id, first.result_id);
        assert_eq!(readback.result_digest, first.result_digest);
        assert_eq!(readback.fact_schemas(), first.fact_schemas());
        assert_eq!(readback.outputs, first.outputs);
        let replay = reopened.bind_acceptance_result(&request).unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result_id, first.result_id);
        assert_eq!(replay.project_revision, first.project_revision);
        drop(reopened);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path_text}{suffix}"));
        }
    }

    #[test]
    fn reviewed_profile_requires_a_current_independent_approval() {
        let result = acceptance_result();
        assert!(validate_independent_artifact_decision(None, &result).is_err());
        assert!(validate_independent_artifact_decision(
            Some(decision(
                "rejected",
                "result-1",
                "sha256:result",
                "reviewer"
            )),
            &result,
        )
        .is_err());
        assert!(validate_independent_artifact_decision(
            Some(decision("approved", "result-old", "sha256:old", "reviewer")),
            &result,
        )
        .is_err());
        assert!(validate_independent_artifact_decision(
            Some(decision(
                "approved",
                "result-1",
                "sha256:result",
                "producer"
            )),
            &result,
        )
        .is_err());
        assert!(validate_independent_artifact_decision(
            Some(decision(
                "approved",
                "result-1",
                "sha256:result",
                "reviewer"
            )),
            &result,
        )
        .is_ok());
    }

    #[test]
    fn legacy_review_path_does_not_require_typed_sidecar() {
        let store = SqliteStore::open_in_memory(include_str!(
            "../../../project/spec/schema-production.sql"
        ))
        .expect("production schema opens");
        store
            .create_project("legacy-review-project", "unix-ms:0")
            .unwrap();
        let work = boreal_domain::WorkItem::new(
            "legacy-review-project".into(),
            boreal_domain::WorkId::new("legacy-review-work"),
            boreal_domain::WorkKind::Task,
            None,
            "Legacy review",
        )
        .open();
        store.create_work(&work, "unix-ms:1").unwrap();
        assert!(!store.table_exists("boreal_artifact_decision_v1").unwrap());
        store
            .record_artifact_decision_in_transaction(
                "legacy-review-project",
                "legacy-review-work",
                "legacy-submission",
                "review",
                "reviewer",
                "approved",
                "legacy review",
                "legacy-review-op",
                "unix-ms:2",
            )
            .unwrap();
        assert!(!store.table_exists("boreal_artifact_decision_v1").unwrap());
    }
}

impl AcceptanceBinding {
    pub fn matches(&self, other: &Self) -> bool {
        self == other
    }
}

pub struct AcceptanceStore<'a> {
    store: &'a SqliteStore,
}

/// Deterministic result of evaluating one contract criterion against an
/// exact immutable output version. `criterion_id` is the stable typed
/// criterion name (for example `min_bytes` or `text_contains:hero`).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceCriterionResult {
    pub criterion_id: String,
    pub passed: bool,
    pub observed: String,
}

/// Availability of this exact artifact at inspection time. `too_large`
/// means the identity is valid, but bytes exceeded the inspector's bound.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArtifactInspectionAvailability {
    Available,
    Missing,
    Corrupt,
    TooLarge,
}

impl ArtifactInspectionAvailability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::Missing => "missing",
            Self::Corrupt => "corrupt",
            Self::TooLarge => "too_large",
        }
    }

    fn parse(value: &str) -> Result<Self, StoreError> {
        match value {
            "available" => Ok(Self::Available),
            "missing" => Ok(Self::Missing),
            "corrupt" => Ok(Self::Corrupt),
            "too_large" => Ok(Self::TooLarge),
            _ => Err(StoreError::Corrupt(format!(
                "unknown artifact inspection availability: {value}"
            ))),
        }
    }
}

/// Typed inspection fact for one produced artifact. The source version and
/// media metadata are rechecked against the canonical source table when this
/// fact is persisted; bytes are verified by the application/source boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceArtifactInspection {
    pub requirement_key: String,
    pub relationship_id: String,
    pub attribution: Option<String>,
    pub rights_statement: Option<String>,
    pub license: Option<String>,
    pub source_version_id: String,
    pub content_digest: String,
    pub media_type: String,
    pub availability: ArtifactInspectionAvailability,
    pub media_type_allowed: bool,
    pub byte_count: u64,
    pub criteria: Vec<AcceptanceCriterionResult>,
}

impl AcceptanceArtifactInspection {
    pub const fn fact_schema(&self) -> &'static str {
        super::profiles::ARTIFACT_INSPECTION_FACT_SCHEMA
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompletionAttestationInput {
    pub statement: String,
}

impl CompletionAttestationInput {
    pub const fn fact_schema(&self) -> &'static str {
        super::profiles::COMPLETION_ATTESTATION_FACT_SCHEMA
    }
}

/// Input to the immutable typed-result binding. Caller-supplied identity is
/// cross-checked against the current attempt, session, source, pinned profile
/// and planning revision under a write transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceResultBindRequest {
    pub project_id: String,
    pub work_id: String,
    pub actor_id: String,
    pub session_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub expected_project_revision: u64,
    pub expected_entity_revision: u64,
    pub expected_proof_revision: u64,
    pub result_id: String,
    pub contract_revision: u64,
    pub outputs: Vec<AcceptanceArtifactInspection>,
    pub attestation: Option<CompletionAttestationInput>,
    pub operation_id: String,
    pub at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceResultRecord {
    pub result_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub entity_revision: u64,
    pub proof_revision: u64,
    pub actor_id: String,
    pub session_id: String,
    pub source_version_id: String,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub profile_digest: String,
    pub contract_revision: u64,
    pub result_digest: String,
    pub outputs: Vec<AcceptanceArtifactInspection>,
    pub attestation: Option<CompletionAttestationInput>,
    pub operation_id: String,
    pub request_digest: String,
    pub project_revision: u64,
    pub created_at: String,
    /// True only when this result was returned from an existing operation
    /// record with the same request digest and identity.
    pub replayed: bool,
}

impl AcceptanceResultRecord {
    /// Typed facts present in this immutable result, in stable schema order.
    pub fn fact_schemas(&self) -> Vec<&'static str> {
        let mut facts = Vec::with_capacity(2);
        if self.attestation.is_some() {
            facts.push(super::profiles::COMPLETION_ATTESTATION_FACT_SCHEMA);
        }
        if !self.outputs.is_empty() {
            facts.push(super::profiles::ARTIFACT_INSPECTION_FACT_SCHEMA);
        }
        facts
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactDecisionRecord {
    pub decision_id: String,
    pub project_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub result_id: String,
    pub result_digest: String,
    pub fact_schema: String,
    pub reviewer_actor_id: String,
    pub outcome: String,
    pub reason: String,
    pub operation_id: String,
    pub created_at: String,
}

impl<'a> AcceptanceStore<'a> {
    pub const fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    pub fn bind_result(
        &self,
        request: &AcceptanceResultBindRequest,
    ) -> Result<AcceptanceResultRecord, StoreError> {
        self.store.bind_acceptance_result(request)
    }

    pub fn result_for_attempt(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
    ) -> Result<Option<AcceptanceResultRecord>, StoreError> {
        self.store
            .current_acceptance_result(project_id, work_id, attempt_id, fence)
    }

    pub fn result_for_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<AcceptanceResultRecord>, StoreError> {
        self.store
            .acceptance_result_for_operation(project_id, operation_id)
    }

    pub fn artifact_decision(
        &self,
        project_id: &str,
        submission_id: &str,
    ) -> Result<Option<ArtifactDecisionRecord>, StoreError> {
        self.store
            .current_artifact_decision(project_id, submission_id)
    }

    pub fn gate(
        &self,
        project_id: &str,
        work_id: &str,
        gate_id: &str,
    ) -> Result<Option<GateRecord>, StoreError> {
        self.store.gate(project_id, work_id, gate_id)
    }

    pub fn diagnostics(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
    ) -> Result<GateDiagnostics, StoreError> {
        self.store
            .gate_diagnostics(project_id, work_id, attempt_id, fence)
    }

    pub fn record_receipt(
        &self,
        request: &ReceiptInsertRequest,
    ) -> Result<ReceiptInsertResult, StoreError> {
        self.store.insert_receipt(request)
    }

    pub fn receipt(&self, receipt_id: &str) -> Result<Option<ReceiptRecord>, StoreError> {
        self.store.receipt(receipt_id)
    }

    pub fn update_gate(
        &self,
        request: &GateStateUpdateRequest,
    ) -> Result<MutationResult, StoreError> {
        self.store.update_gate_state(request)
    }

    pub fn record_review(
        &self,
        request: &ReviewInsertRequest,
    ) -> Result<MutationResult, StoreError> {
        self.store.insert_review(request)
    }

    pub fn review(&self, review_id: &str) -> Result<Option<ReviewRecord>, StoreError> {
        self.store.review(review_id)
    }

    pub fn record_summary(
        &self,
        request: &SummaryInsertRequest,
    ) -> Result<SummaryInsertResult, StoreError> {
        self.store.insert_summary(request)
    }

    pub fn summary(
        &self,
        project_id: &str,
        summary_id: &str,
    ) -> Result<Option<SummaryRecord>, StoreError> {
        self.store.summary(project_id, summary_id)
    }

    pub fn open_close(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.create_close_intent(request)
    }

    pub fn finalize_close(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.finalize_close_intent(request)
    }

    pub fn reject_close(
        &self,
        request: &CloseIntentRequest,
        rejection_code: &str,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.reject_close_intent(request, rejection_code)
    }
}

/// An immutable result candidate. Execution ownership is deliberately not
/// represented by this record; reviews bind this exact source/configuration,
/// summary and ordered receipt set, not whichever attempt happens to be live.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubmissionRecord {
    pub submission_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub entity_revision: u64,
    pub proof_revision: u64,
    pub source_version_id: String,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub profile_digest: String,
    pub summary_id: String,
    pub summary_digest: String,
    pub receipt_ids: Vec<String>,
    pub sealed_at: String,
}

/// Exact current accepted-close binding for projections that must distinguish
/// a lifecycle label from an accepted result. The summary digest is the
/// immutable digest captured in the sealed submission.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedOutcomeRecord {
    pub outcome_id: String,
    pub project_id: String,
    pub work_id: String,
    pub entity_revision: u64,
    pub proof_revision: u64,
    pub summary_digest: String,
    pub accepted_at: String,
}

impl SubmissionRecord {
    pub fn proof_identity(&self) -> boreal_domain::decision_inputs::ProofIdentity {
        use boreal_domain::decision_inputs::*;
        ProofIdentity::new(
            EntityIdentity::new(
                self.project_id.clone().into(),
                self.work_id.clone().into(),
                EntityRevision::new(self.entity_revision),
            ),
            ProofRevision::new(self.proof_revision),
            Some(AttemptIdentity::new(
                self.attempt_id.clone().into(),
                AttemptFence::new(self.fence),
            )),
            self.source_version_id.clone().into(),
            self.config_identity.clone().into(),
            ProfileIdentity::new(
                self.profile_id.clone().into(),
                self.profile_version.to_string(),
                self.profile_digest.clone().into(),
            ),
            "boreal.acceptance/1",
        )
    }
}

impl SqliteStore {
    /// Installs the additive typed-acceptance sidecar. It intentionally does
    /// not alter legacy profile, receipt, submission, or review tables.
    pub fn ensure_typed_acceptance_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema(
            "typed_acceptance",
            TYPED_ACCEPTANCE_SCHEMA_VERSION,
            TYPED_ACCEPTANCE_SCHEMA_SQL,
        )?;
        for table in [
            "boreal_acceptance_result_v1",
            "boreal_acceptance_event_v1",
            "boreal_submission_acceptance_v1",
            "boreal_artifact_decision_v1",
        ] {
            if !self.table_exists(table)? {
                return Err(StoreError::Corrupt(format!(
                    "typed acceptance schema is missing table {table}"
                )));
            }
        }
        Ok(())
    }

    /// Bind a producer's exact outputs and optional completion attestation to
    /// the currently executing attempt before verification or submission.
    /// Replays are readbacks; a second result for the same operation is never
    /// silently merged into the first.
    pub fn bind_acceptance_result(
        &self,
        request: &AcceptanceResultBindRequest,
    ) -> Result<AcceptanceResultRecord, StoreError> {
        validate_acceptance_bind_request(request)?;
        self.ensure_deliverables_schema()?;
        self.ensure_typed_acceptance_schema()?;
        let request_digest = acceptance_bind_digest(request);
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(mut existing) =
                self.acceptance_result_for_operation(&request.project_id, &request.operation_id)?
            {
                if existing.request_digest != request_digest
                    || existing.actor_id != request.actor_id
                    || existing.session_id != request.session_id
                    || existing.work_id != request.work_id
                    || existing.attempt_id != request.attempt_id
                    || existing.fence != request.fence
                {
                    return Err(StoreError::Conflict(
                        "acceptance result operation id was reused with a different identity or payload".into(),
                    ));
                }
                existing.replayed = true;
                return Ok(existing);
            }
            if self.operation(&request.operation_id)?.is_some() {
                return Err(StoreError::Conflict(
                    "acceptance result operation id is already used by another operation".into(),
                ));
            }
            self.validate_project_session(
                &request.project_id,
                &request.actor_id,
                &request.session_id,
            )?;
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                Some(request.expected_project_revision),
            )?;
            let (entity_revision, proof_revision) =
                self.proof_cursor(&request.project_id, &request.work_id)?;
            if entity_revision != request.expected_entity_revision
                || proof_revision != request.expected_proof_revision
            {
                return Err(StoreError::Conflict(
                    "acceptance result subject revision changed before binding".into(),
                ));
            }
            let attempt = self
                .attempt_record(&request.attempt_id, false)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: request.attempt_id.clone(),
                })?;
            if !attempt.current
                || attempt.project_id != request.project_id
                || attempt.work_id != request.work_id
                || attempt.actor_id != request.actor_id
                || attempt.session_id.as_deref() != Some(request.session_id.as_str())
                || attempt.fence != request.fence
                || attempt.phase != boreal_domain::AttemptPhase::Running
                || super::timestamp_cmp(&request.at, &attempt.hard_deadline)
                    != std::cmp::Ordering::Less
                || super::timestamp_cmp(&request.at, &attempt.lease_deadline)
                    != std::cmp::Ordering::Less
            {
                return Err(StoreError::Conflict(
                    "acceptance result requires the current running actor/session attempt, fence, and live deadlines".into(),
                ));
            }
            let at = super::status_evaluation::canonical_status_timestamp(&request.at)?;
            self.authorize_work_action_in_transaction(
                &request.project_id,
                &request.work_id,
                &request.actor_id,
                Some(&request.session_id),
                at,
                boreal_domain::actions::ActionKind::AttachEvidence,
            )?;
            if attempt
                .source_version_id
                .as_deref()
                .is_none_or(str::is_empty)
                || attempt.config_identity.trim().is_empty()
            {
                return Err(StoreError::Conflict(
                    "acceptance result requires source and configuration identity".into(),
                ));
            }
            let pin = super::ProfileStore::new(self)
                .current_pinned_requirements(&request.project_id, &request.work_id)?;
            let profile = super::profiles::registered_acceptance_profile(
                &pin.profile.profile_id,
                pin.profile.version,
            )?
            .ok_or_else(|| {
                StoreError::Conflict(
                    "typed acceptance result binding is available only for an explicitly registered general-work profile".into(),
                )
            })?;
            validate_registered_profile_gates(&pin, profile)?;
            let (current_contract_revision, requirements) =
                acceptance_contract(self, &request.project_id, &request.work_id)?;
            if request.contract_revision != current_contract_revision {
                return Err(StoreError::Conflict(format!(
                    "planning contract revision is stale: expected {}, current {}",
                    request.contract_revision, current_contract_revision
                )));
            }
            validate_result_against_contract(
                profile.mode,
                &requirements,
                &request.outputs,
                request.attestation.as_ref(),
                false,
            )?;
            for output in &request.outputs {
                validate_output_source(self, &request.project_id, output)?;
            }
            if self
                .current_submission(&request.project_id, &request.work_id, proof_revision)?
                .is_some()
            {
                return Err(StoreError::Conflict(
                    "a result already sealed for this proof revision; reopen and execute a new attempt before rebinding outputs".into(),
                ));
            }

            let mut outputs = request.outputs.clone();
            outputs.sort_by(|left, right| {
                left.requirement_key
                    .cmp(&right.requirement_key)
                    .then_with(|| left.source_version_id.cmp(&right.source_version_id))
            });
            let outputs_json = acceptance_outputs_json(&outputs).to_string();
            let attestation_json = request.attestation.as_ref().map(|attestation| {
                json!({
                    "fact_schema": super::profiles::COMPLETION_ATTESTATION_FACT_SCHEMA,
                    "statement": attestation.statement,
                })
                .to_string()
            });
            let result_digest = acceptance_result_digest(
                &request.result_id,
                request.contract_revision,
                &outputs_json,
                attestation_json.as_deref(),
            );
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let mut insert = self.prepare(
                "INSERT INTO boreal_acceptance_result_v1
                 (result_id,project_id,work_id,attempt_id,fence,entity_revision,proof_revision,
                  actor_id,session_id,source_version_id,config_identity,profile_id,profile_version,
                  profile_digest,contract_revision,result_digest,outputs_json,attestation_json,
                  operation_id,request_digest,project_revision,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
            )?;
            insert.bind_text(1, &request.result_id)?;
            insert.bind_text(2, &request.project_id)?;
            insert.bind_text(3, &request.work_id)?;
            insert.bind_text(4, &request.attempt_id)?;
            insert.bind_i64(5, request.fence)?;
            insert.bind_i64(6, entity_revision)?;
            insert.bind_i64(7, proof_revision)?;
            insert.bind_text(8, &request.actor_id)?;
            insert.bind_text(9, &request.session_id)?;
            insert.bind_text(
                10,
                attempt
                    .source_version_id
                    .as_deref()
                    .expect("validated source"),
            )?;
            insert.bind_text(11, &attempt.config_identity)?;
            insert.bind_text(12, &pin.profile.profile_id)?;
            insert.bind_i64(13, pin.profile.version)?;
            insert.bind_text(14, &pin.profile.policy_digest)?;
            insert.bind_i64(15, request.contract_revision)?;
            insert.bind_text(16, &result_digest)?;
            insert.bind_text(17, &outputs_json)?;
            insert.bind_optional_text(18, attestation_json.as_deref())?;
            insert.bind_text(19, &request.operation_id)?;
            insert.bind_text(20, &request_digest)?;
            insert.bind_i64(21, revision.0)?;
            insert.bind_text(22, &request.at)?;
            insert.run()?;
            let result_json = json!({
                "result_id": request.result_id,
                "result_digest": result_digest,
                "profile_id": pin.profile.profile_id,
                "profile_version": pin.profile.version,
                "contract_revision": request.contract_revision,
                "output_count": outputs.len(),
                "attestation": request.attestation.is_some(),
            })
            .to_string();
            self.append_operation(&super::OperationRecord {
                operation_id: request.operation_id.clone(),
                project_id: request.project_id.clone(),
                command: "acceptance.result.bind".into(),
                actor_id: request.actor_id.clone(),
                session_id: Some(request.session_id.clone()),
                expected_revision: Some(request.expected_project_revision),
                attempt_id: Some(request.attempt_id.clone()),
                fence: Some(request.fence),
                request_digest: request_digest.clone(),
                outcome: super::OperationOutcome::Changed,
                result_json,
                revision: revision.0,
                created_at: request.at.clone(),
                completed_at: Some(request.at.clone()),
            })?;
            self.append_acceptance_events(request, &result_digest, revision.0, &outputs)?;
            self.acceptance_result_for_operation(&request.project_id, &request.operation_id)?
                .ok_or_else(|| StoreError::Corrupt("bound acceptance result disappeared".into()))
        })();
        finish_transaction(self, result)
    }

    fn append_acceptance_events(
        &self,
        request: &AcceptanceResultBindRequest,
        result_digest: &str,
        project_revision: u64,
        outputs: &[AcceptanceArtifactInspection],
    ) -> Result<(), StoreError> {
        let mut events = Vec::with_capacity(outputs.len() + 1);
        events.push((
            format!("{}:acceptance-result", request.operation_id),
            "acceptance.result.bound",
            None,
            None,
        ));
        events.extend(outputs.iter().enumerate().map(|(index, output)| {
            (
                format!("{}:artifact-inspected:{index}", request.operation_id),
                "artifact.inspected",
                Some(output.requirement_key.as_str()),
                Some(output.source_version_id.as_str()),
            )
        }));
        for (event_id, kind, requirement_key, source_version_id) in events {
            let mut row = self.prepare(
                "INSERT INTO boreal_acceptance_event_v1
                 (event_id,event_kind,project_id,work_id,attempt_id,fence,actor_id,session_id,
                  result_id,result_digest,requirement_key,source_version_id,operation_id,
                  project_revision,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            )?;
            row.bind_text(1, &event_id)?;
            row.bind_text(2, kind)?;
            row.bind_text(3, &request.project_id)?;
            row.bind_text(4, &request.work_id)?;
            row.bind_text(5, &request.attempt_id)?;
            row.bind_i64(6, request.fence)?;
            row.bind_text(7, &request.actor_id)?;
            row.bind_text(8, &request.session_id)?;
            row.bind_text(9, &request.result_id)?;
            row.bind_text(10, result_digest)?;
            row.bind_optional_text(11, requirement_key)?;
            row.bind_optional_text(12, source_version_id)?;
            row.bind_text(13, &request.operation_id)?;
            row.bind_i64(14, project_revision)?;
            row.bind_text(15, &request.at)?;
            row.run()?;
        }
        Ok(())
    }

    pub fn current_acceptance_result(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
    ) -> Result<Option<AcceptanceResultRecord>, StoreError> {
        if !self.table_exists("boreal_acceptance_result_v1")? {
            return Ok(None);
        }
        let mut row = self.prepare(
            "SELECT result_id,project_id,work_id,attempt_id,fence,entity_revision,proof_revision,
                    actor_id,session_id,source_version_id,config_identity,profile_id,profile_version,
                    profile_digest,contract_revision,result_digest,outputs_json,attestation_json,
                    operation_id,request_digest,project_revision,created_at
             FROM boreal_acceptance_result_v1
             WHERE project_id=?1 AND work_id=?2 AND attempt_id=?3 AND fence=?4
             ORDER BY rowid DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        row.bind_text(3, attempt_id)?;
        row.bind_i64(4, fence)?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        acceptance_result_from_row(&row).map(Some)
    }

    pub fn acceptance_result_for_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<AcceptanceResultRecord>, StoreError> {
        if !self.table_exists("boreal_acceptance_result_v1")? {
            return Ok(None);
        }
        let mut row = self.prepare(
            "SELECT result_id,project_id,work_id,attempt_id,fence,entity_revision,proof_revision,
                    actor_id,session_id,source_version_id,config_identity,profile_id,profile_version,
                    profile_digest,contract_revision,result_digest,outputs_json,attestation_json,
                    operation_id,request_digest,project_revision,created_at
             FROM boreal_acceptance_result_v1 WHERE project_id=?1 AND operation_id=?2",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, operation_id)?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        acceptance_result_from_row(&row).map(Some)
    }

    pub fn current_artifact_decision(
        &self,
        project_id: &str,
        submission_id: &str,
    ) -> Result<Option<ArtifactDecisionRecord>, StoreError> {
        if !self.table_exists("boreal_artifact_decision_v1")? {
            return Ok(None);
        }
        let mut row = self.prepare(
            "SELECT decision_id,project_id,work_id,submission_id,result_id,result_digest,
                    fact_schema,reviewer_actor_id,outcome,reason,operation_id,created_at
             FROM boreal_artifact_decision_v1
             WHERE project_id=?1 AND submission_id=?2
             ORDER BY rowid DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, submission_id)?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        let fact_schema = row.column_text(6)?;
        if fact_schema != super::profiles::INDEPENDENT_ARTIFACT_DECISION_FACT_SCHEMA {
            return Err(StoreError::Corrupt(
                "artifact decision fact schema is unknown or malformed".into(),
            ));
        }
        Ok(Some(ArtifactDecisionRecord {
            decision_id: row.column_text(0)?,
            project_id: row.column_text(1)?,
            work_id: row.column_text(2)?,
            submission_id: row.column_text(3)?,
            result_id: row.column_text(4)?,
            result_digest: row.column_text(5)?,
            fact_schema,
            reviewer_actor_id: row.column_text(7)?,
            outcome: row.column_text(8)?,
            reason: row.column_text(9)?,
            operation_id: row.column_text(10)?,
            created_at: row.column_text(11)?,
        }))
    }

    pub(crate) fn record_artifact_decision_in_transaction(
        &self,
        project_id: &str,
        work_id: &str,
        submission_id: &str,
        gate_id: &str,
        reviewer_actor_id: &str,
        outcome: &str,
        reason: &str,
        operation_id: &str,
        created_at: &str,
    ) -> Result<(), StoreError> {
        let pin =
            super::ProfileStore::new(self).current_pinned_requirements(project_id, work_id)?;
        let Some(profile) = super::profiles::registered_acceptance_profile(
            &pin.profile.profile_id,
            pin.profile.version,
        )?
        else {
            return Ok(());
        };
        if profile.mode != super::profiles::RegisteredAcceptanceMode::ReviewedArtifacts {
            return Ok(());
        }
        let required_gate = profile
            .review_gate_id
            .expect("reviewed profile has a review gate");
        if gate_id != required_gate && gate_id != format!("{work_id}:{required_gate}") {
            return Err(StoreError::Conflict(
                "reviewed-artifacts decisions must target the pinned artifact_review gate".into(),
            ));
        }
        let Some((result_id, result_digest)) =
            self.submission_acceptance_binding(project_id, work_id, submission_id)?
        else {
            return Ok(());
        };
        if !self.table_exists("boreal_artifact_decision_v1")? {
            return Err(StoreError::Corrupt(
                "typed acceptance schema is missing for a bound reviewed-artifacts result".into(),
            ));
        }
        if let Some(previous) = self.current_artifact_decision(project_id, submission_id)? {
            if !(previous.outcome == "approved" && outcome == "revoked") {
                return Err(StoreError::Conflict(
                    "an artifact decision is immutable for this submission; revise and resubmit before another decision".into(),
                ));
            }
        }
        let mut row = self.prepare(
            "INSERT INTO boreal_artifact_decision_v1
             (decision_id,project_id,work_id,submission_id,result_id,result_digest,fact_schema,
              reviewer_actor_id,outcome,reason,operation_id,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        )?;
        row.bind_text(1, &format!("artifact-decision:{operation_id}"))?;
        row.bind_text(2, project_id)?;
        row.bind_text(3, work_id)?;
        row.bind_text(4, submission_id)?;
        row.bind_text(5, &result_id)?;
        row.bind_text(6, &result_digest)?;
        row.bind_text(
            7,
            super::profiles::INDEPENDENT_ARTIFACT_DECISION_FACT_SCHEMA,
        )?;
        row.bind_text(8, reviewer_actor_id)?;
        row.bind_text(9, outcome)?;
        row.bind_text(10, reason)?;
        row.bind_text(11, operation_id)?;
        row.bind_text(12, created_at)?;
        row.run()
    }

    fn submission_acceptance_binding(
        &self,
        project_id: &str,
        work_id: &str,
        submission_id: &str,
    ) -> Result<Option<(String, String)>, StoreError> {
        if !self.table_exists("boreal_submission_acceptance_v1")? {
            return Ok(None);
        }
        let mut row = self.prepare(
            "SELECT result_id,result_digest FROM boreal_submission_acceptance_v1
             WHERE project_id=?1 AND work_id=?2 AND submission_id=?3",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        row.bind_text(3, submission_id)?;
        if row.step()? == super::SQLITE_ROW {
            Ok(Some((row.column_text(0)?, row.column_text(1)?)))
        } else {
            Ok(None)
        }
    }

    fn link_acceptance_result_to_submission_in_transaction(
        &self,
        submission: &SubmissionRecord,
    ) -> Result<(), StoreError> {
        let pin = super::ProfileStore::new(self)
            .current_pinned_requirements(&submission.project_id, &submission.work_id)?;
        let Some(profile) = super::profiles::registered_acceptance_profile(
            &pin.profile.profile_id,
            pin.profile.version,
        )?
        else {
            return Ok(());
        };
        validate_registered_profile_gates(&pin, profile)?;
        if !self.table_exists("boreal_acceptance_result_v1")? {
            return Ok(());
        }
        let result = self.current_acceptance_result(
            &submission.project_id,
            &submission.work_id,
            &submission.attempt_id,
            submission.fence,
        )?;
        let Some(result) = result else {
            return Ok(());
        };
        if result.entity_revision != submission.entity_revision
            || result.proof_revision != submission.proof_revision
            || result.source_version_id != submission.source_version_id
            || result.config_identity != submission.config_identity
            || result.profile_id != submission.profile_id
            || result.profile_version != submission.profile_version
            || result.profile_digest != submission.profile_digest
        {
            return Err(StoreError::Conflict(
                "acceptance result does not bind the exact submission source, configuration, profile, and revisions".into(),
            ));
        }
        if let Some(existing) = self.submission_acceptance_binding(
            &submission.project_id,
            &submission.work_id,
            &submission.submission_id,
        )? {
            if existing != (result.result_id, result.result_digest) {
                return Err(StoreError::Conflict(
                    "sealed submission is already bound to a different artifact result".into(),
                ));
            }
            return Ok(());
        }
        let mut row = self.prepare(
            "INSERT INTO boreal_submission_acceptance_v1
             (submission_id,project_id,work_id,result_id,contract_revision,result_digest,linked_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
        )?;
        row.bind_text(1, &submission.submission_id)?;
        row.bind_text(2, &submission.project_id)?;
        row.bind_text(3, &submission.work_id)?;
        row.bind_text(4, &result.result_id)?;
        row.bind_i64(5, result.contract_revision)?;
        row.bind_text(6, &result.result_digest)?;
        row.bind_text(7, &submission.sealed_at)?;
        row.run()
    }

    pub(crate) fn validate_typed_acceptance_for_close(
        &self,
        request: &CloseIntentRequest,
        submission: &SubmissionRecord,
    ) -> Result<(), StoreError> {
        let pin = super::ProfileStore::new(self)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        let Some(profile) = super::profiles::registered_acceptance_profile(
            &pin.profile.profile_id,
            pin.profile.version,
        )?
        else {
            return Ok(());
        };
        validate_registered_profile_gates(&pin, profile)?;
        let (result_id, result_digest) = self
            .submission_acceptance_binding(
                &request.project_id,
                &request.work_id,
                &submission.submission_id,
            )?
            .ok_or_else(|| {
                StoreError::Conflict(
                    "registered acceptance profile has no typed result bound to this submission"
                        .into(),
                )
            })?;
        let result = self
            .acceptance_result_by_id(&request.project_id, &result_id)?
            .ok_or_else(|| StoreError::Corrupt("submission result binding is missing".into()))?;
        if result.result_digest != result_digest
            || result.attempt_id != submission.attempt_id
            || result.fence != submission.fence
            || result.entity_revision != submission.entity_revision
            || result.proof_revision != submission.proof_revision
            || result.source_version_id != submission.source_version_id
            || result.config_identity != submission.config_identity
            || result.profile_id != submission.profile_id
            || result.profile_version != submission.profile_version
            || result.profile_digest != submission.profile_digest
        {
            return Err(StoreError::Conflict(
                "typed result no longer matches the exact submitted proof".into(),
            ));
        }
        let (contract_revision, requirements) =
            acceptance_contract(self, &request.project_id, &request.work_id)?;
        if contract_revision != result.contract_revision {
            return Err(StoreError::Conflict(
                "planning contract changed after result binding; rebind and resubmit before close"
                    .into(),
            ));
        }
        validate_result_against_contract(
            profile.mode,
            &requirements,
            &result.outputs,
            result.attestation.as_ref(),
            true,
        )?;
        for output in &result.outputs {
            validate_output_source(self, &request.project_id, output)?;
        }
        if profile.mode == super::profiles::RegisteredAcceptanceMode::ReviewedArtifacts {
            validate_independent_artifact_decision(
                self.current_artifact_decision(&request.project_id, &submission.submission_id)?,
                &result,
            )?;
        }
        Ok(())
    }

    pub(crate) fn typed_acceptance_close_blocker(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<Option<String>, StoreError> {
        let pin = super::ProfileStore::new(self)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        let Some(_) = super::profiles::registered_acceptance_profile(
            &pin.profile.profile_id,
            pin.profile.version,
        )?
        else {
            return Ok(None);
        };
        let (_, proof_revision) = self.proof_cursor(&request.project_id, &request.work_id)?;
        let Some(submission) =
            self.current_submission(&request.project_id, &request.work_id, proof_revision)?
        else {
            return Ok(Some(
                "typed_acceptance:registered profile has no immutable submission".into(),
            ));
        };
        match self.validate_typed_acceptance_for_close(request, &submission) {
            Ok(()) => Ok(None),
            Err(StoreError::Conflict(message)) => Ok(Some(format!("typed_acceptance:{message}"))),
            Err(error) => Err(error),
        }
    }

    fn acceptance_result_by_id(
        &self,
        project_id: &str,
        result_id: &str,
    ) -> Result<Option<AcceptanceResultRecord>, StoreError> {
        let mut row = self.prepare(
            "SELECT result_id,project_id,work_id,attempt_id,fence,entity_revision,proof_revision,
                    actor_id,session_id,source_version_id,config_identity,profile_id,profile_version,
                    profile_digest,contract_revision,result_digest,outputs_json,attestation_json,
                    operation_id,request_digest,project_revision,created_at
             FROM boreal_acceptance_result_v1 WHERE project_id=?1 AND result_id=?2",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, result_id)?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        acceptance_result_from_row(&row).map(Some)
    }

    pub fn current_submission(
        &self,
        project_id: &str,
        work_id: &str,
        proof_revision: u64,
    ) -> Result<Option<SubmissionRecord>, StoreError> {
        let mut row = self.prepare(
            "SELECT submission_id, project_id, work_id, attempt_id, fence,
                    entity_revision, proof_revision, source_version_id, config_identity,
                    profile_id, profile_version, profile_digest, summary_id,
                    summary_digest, receipt_ids_json, sealed_at
             FROM boreal_submission WHERE project_id = ?1 AND work_id = ?2 AND proof_revision = ?3
             ORDER BY rowid DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        row.bind_i64(3, proof_revision)?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        let receipt_ids: Vec<String> = serde_json::from_str(&row.column_text(14)?)
            .map_err(|error| StoreError::Corrupt(format!("invalid sealed receipts: {error}")))?;
        let mut unique = std::collections::BTreeSet::new();
        if receipt_ids
            .iter()
            .any(|id| id.is_empty() || !unique.insert(id))
        {
            return Err(StoreError::Corrupt(
                "duplicate/empty sealed receipt identity".into(),
            ));
        }
        Ok(Some(SubmissionRecord {
            submission_id: row.column_text(0)?,
            project_id: row.column_text(1)?,
            work_id: row.column_text(2)?,
            attempt_id: row.column_text(3)?,
            fence: row.column_u64(4)?,
            entity_revision: row.column_u64(5)?,
            proof_revision: row.column_u64(6)?,
            source_version_id: row.column_text(7)?,
            config_identity: row.column_text(8)?,
            profile_id: row.column_text(9)?,
            profile_version: row.column_u64(10)?,
            profile_digest: row.column_text(11)?,
            summary_id: row.column_text(12)?,
            summary_digest: row.column_text(13)?,
            receipt_ids,
            sealed_at: row.column_text(15)?,
        }))
    }

    pub(crate) fn proof_cursor(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<(u64, u64), StoreError> {
        let mut row = self.prepare("SELECT entity_revision, proof_revision FROM boreal_entity_revision WHERE project_id = ?1 AND work_id = ?2")?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        if row.step()? != super::SQLITE_ROW {
            return Err(StoreError::Corrupt("missing work revision cursor".into()));
        }
        Ok((row.column_u64(0)?, row.column_u64(1)?))
    }

    /// Records every submitted fact, including failed evidence, rather than
    /// selecting only successful receipts and erasing the unsuccessful ones.
    pub(crate) fn submission_receipts(
        &self,
        attempt: &super::AttemptRecord,
    ) -> Result<Vec<String>, StoreError> {
        let mut rows = self.prepare(
            "SELECT receipt_id FROM receipt WHERE work_id = ?1 AND attempt_id = ?2 AND fence = ?3
             AND source_version_id = ?4 AND config_identity = ?5 ORDER BY rowid",
        )?;
        rows.bind_text(1, &attempt.work_id)?;
        rows.bind_text(2, &attempt.attempt_id)?;
        rows.bind_i64(3, attempt.fence)?;
        rows.bind_optional_text(4, attempt.source_version_id.as_deref())?;
        rows.bind_text(5, &attempt.config_identity)?;
        let mut ids = Vec::new();
        while rows.step()? == super::SQLITE_ROW {
            ids.push(rows.column_text(0)?);
        }
        Ok(ids)
    }

    pub(crate) fn seal_submission_in_transaction(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
        summary_id: &str,
        at: &str,
    ) -> Result<SubmissionRecord, StoreError> {
        let attempt =
            self.attempt_record(attempt_id, false)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: attempt_id.into(),
                })?;
        if attempt.project_id != project_id || attempt.work_id != work_id || attempt.fence != fence
        {
            return Err(StoreError::Conflict(
                "submission attempt scope/fence mismatch".into(),
            ));
        }
        self.require_open_proof_subject(&attempt)?;
        if !matches!(
            attempt.phase,
            boreal_domain::AttemptPhase::Running | boreal_domain::AttemptPhase::Verifying
        ) && !self.attempt_has_current_submission(&attempt)?
        {
            return Err(StoreError::Conflict(
                "submission requires a running or verifying attempt".into(),
            ));
        }
        let source = attempt
            .source_version_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| {
                StoreError::Invalid("submission requires a genuine source snapshot".into())
            })?;
        if attempt.config_identity.trim().is_empty() {
            return Err(StoreError::Invalid(
                "submission configuration is unbound".into(),
            ));
        }
        let summary =
            self.summary(project_id, summary_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "summary",
                    id: summary_id.into(),
                })?;
        let pin =
            super::ProfileStore::new(self).current_pinned_requirements(project_id, work_id)?;
        let (entity_revision, proof_revision) = self.proof_cursor(project_id, work_id)?;
        if pin.proof_revision != proof_revision
            || !summary.current
            || summary.work_id != work_id
            || summary.attempt_id != attempt_id
            || summary.fence != fence
            || summary.source_version_id != source
            || summary.config_identity != attempt.config_identity
            || summary.profile_id != pin.profile.profile_id
            || summary.profile_version != pin.profile.version
            || !super::valid_sha256_digest(&summary.body_digest)
        {
            return Err(StoreError::Conflict(
                "summary does not bind the current exact proof context".into(),
            ));
        }
        let receipts = self.submission_receipts(&attempt)?;
        // Repeating sealing is a readback, not a new approval generation.
        if let Some(existing) = self.current_submission(project_id, work_id, proof_revision)? {
            if existing.summary_id == summary_id
                && existing.receipt_ids == receipts
                && existing.attempt_id == attempt_id
                && existing.fence == fence
            {
                self.link_acceptance_result_to_submission_in_transaction(&existing)?;
                return Ok(existing);
            }
        }
        let receipt_json = serde_json::to_string(&receipts)
            .map_err(|error| StoreError::Invalid(error.to_string()))?;
        let identity = serde_json::json!([
            project_id,
            work_id,
            attempt_id,
            fence,
            proof_revision,
            summary_id,
            &receipts
        ])
        .to_string();
        let id = format!("submission:{}", super::checksum(identity.as_bytes()));
        let mut insert = self.prepare(
            "INSERT INTO boreal_submission (submission_id, project_id, work_id, attempt_id, fence,
             entity_revision, proof_revision, source_version_id, config_identity, profile_id, profile_version,
             profile_digest, summary_id, summary_digest, receipt_ids_json, sealed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        )?;
        insert.bind_text(1, &id)?;
        insert.bind_text(2, project_id)?;
        insert.bind_text(3, work_id)?;
        insert.bind_text(4, attempt_id)?;
        insert.bind_i64(5, fence)?;
        insert.bind_i64(6, entity_revision)?;
        insert.bind_i64(7, proof_revision)?;
        insert.bind_text(8, source)?;
        insert.bind_text(9, &attempt.config_identity)?;
        insert.bind_text(10, &pin.profile.profile_id)?;
        insert.bind_i64(11, pin.profile.version)?;
        insert.bind_text(12, &pin.profile.policy_digest)?;
        insert.bind_text(13, summary_id)?;
        insert.bind_text(14, &summary.body_digest)?;
        insert.bind_text(15, &receipt_json)?;
        insert.bind_text(16, at)?;
        insert.run()?;
        let sealed = self
            .current_submission(project_id, work_id, proof_revision)?
            .ok_or_else(|| StoreError::Corrupt("sealed submission disappeared".into()))?;
        self.link_acceptance_result_to_submission_in_transaction(&sealed)?;
        Ok(sealed)
    }

    pub fn has_accepted_outcome(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<bool, StoreError> {
        let mut row = self.prepare(
            "SELECT 1 FROM boreal_accepted_outcome o
             JOIN work_item w ON w.project_id = o.project_id AND w.work_id = o.work_id
             JOIN boreal_entity_revision e ON e.project_id = o.project_id AND e.work_id = o.work_id
             JOIN boreal_submission s ON s.submission_id = o.submission_id AND s.project_id = o.project_id AND s.work_id = o.work_id
             JOIN close_intent c ON c.close_intent_id = o.close_intent_id AND c.work_id = o.work_id AND c.state = 'finalized'
             WHERE o.project_id = ?1 AND o.work_id = ?2 AND w.lifecycle = 'closed'
             AND e.proof_revision = o.proof_revision AND s.proof_revision = o.proof_revision
             AND NOT EXISTS (SELECT 1 FROM boreal_outcome_invalidation i WHERE i.outcome_id = o.outcome_id) LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        Ok(row.step()? == super::SQLITE_ROW)
    }

    pub fn current_accepted_outcome(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<AcceptedOutcomeRecord>, StoreError> {
        let mut row = self.prepare(
            "SELECT o.outcome_id,o.project_id,o.work_id,e.entity_revision,
                    o.proof_revision,s.summary_digest,o.accepted_at
             FROM boreal_accepted_outcome o
             JOIN work_item w ON w.project_id=o.project_id AND w.work_id=o.work_id
             JOIN boreal_entity_revision e ON e.project_id=o.project_id AND e.work_id=o.work_id
             JOIN boreal_submission s ON s.submission_id=o.submission_id
               AND s.project_id=o.project_id AND s.work_id=o.work_id
             JOIN close_intent c ON c.close_intent_id=o.close_intent_id
               AND c.work_id=o.work_id AND c.state='finalized'
             WHERE o.project_id=?1 AND o.work_id=?2 AND w.lifecycle='closed'
               AND e.proof_revision=o.proof_revision
               AND s.proof_revision=o.proof_revision
               AND NOT EXISTS (
                 SELECT 1 FROM boreal_outcome_invalidation i
                 WHERE i.outcome_id=o.outcome_id
               )
             ORDER BY o.accepted_at DESC,o.outcome_id DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(AcceptedOutcomeRecord {
            outcome_id: row.column_text(0)?,
            project_id: row.column_text(1)?,
            work_id: row.column_text(2)?,
            entity_revision: row.column_u64(3)?,
            proof_revision: row.column_u64(4)?,
            summary_digest: row.column_text(5)?,
            accepted_at: row.column_text(6)?,
        }))
    }

    pub(crate) fn record_accepted_outcome_in_transaction(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<(), StoreError> {
        let (_, proof_revision) = self.proof_cursor(&request.project_id, &request.work_id)?;
        let submission = self
            .current_submission(&request.project_id, &request.work_id, proof_revision)?
            .ok_or_else(|| StoreError::Conflict("close requires an immutable submission".into()))?;
        if submission.attempt_id != request.attempt_id || submission.fence != request.fence {
            return Err(StoreError::Conflict(
                "close submission attempt/fence mismatch".into(),
            ));
        }
        let mut row = self.prepare(
            "INSERT INTO boreal_accepted_outcome (outcome_id, project_id, work_id, submission_id,
             close_intent_id, proof_revision, operation_id, accepted_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        )?;
        row.bind_text(1, &format!("accepted:{}", request.close_intent_id))?;
        row.bind_text(2, &request.project_id)?;
        row.bind_text(3, &request.work_id)?;
        row.bind_text(4, &submission.submission_id)?;
        row.bind_text(5, &request.close_intent_id)?;
        row.bind_i64(6, proof_revision)?;
        row.bind_text(7, &request.operation_id)?;
        row.bind_text(8, &request.at)?;
        row.run()
    }

    // Keep the revision fence explicit at this crate-internal boundary: each
    // argument maps to a distinct persisted predicate consumed by
    // `status_facts`, which is outside this bounded lint-cleanup surface.
    #[expect(
        clippy::too_many_arguments,
        reason = "the dependency waiver lookup preserves its explicit subject and predecessor revision fences for the existing status-facts caller"
    )]
    pub(crate) fn active_dependency_waiver(
        &self,
        project_id: &str,
        work_id: &str,
        predecessor_id: &str,
        proof_revision: u64,
        entity_revision: u64,
        predecessor_revision: u64,
        as_of: boreal_domain::TimestampMs,
    ) -> Result<Option<String>, StoreError> {
        let mut row = self.prepare(
            "SELECT e.exception_id FROM boreal_policy_exception e
             WHERE e.project_id=?1 AND e.work_id=?2 AND e.kind='dependency' AND e.predecessor_id=?3
             AND e.proof_revision=?4 AND e.subject_revision=?5 AND e.predecessor_revision=?6
             AND e.target_id = e.predecessor_id || '->' || e.work_id
             AND (e.expires_at_ms IS NULL OR e.expires_at_ms>?7)
             AND NOT EXISTS (SELECT 1 FROM boreal_exception_revocation r WHERE r.exception_id=e.exception_id)
             ORDER BY e.rowid DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        row.bind_text(3, predecessor_id)?;
        row.bind_i64(4, proof_revision)?;
        row.bind_i64(5, entity_revision)?;
        row.bind_i64(6, predecessor_revision)?;
        row.bind_i64(7, as_of.0)?;
        if row.step()? == super::SQLITE_ROW {
            Ok(Some(row.column_text(0)?))
        } else {
            Ok(None)
        }
    }
}

fn validate_acceptance_bind_request(
    request: &AcceptanceResultBindRequest,
) -> Result<(), StoreError> {
    for (name, value, maximum) in [
        ("project_id", request.project_id.as_str(), 255),
        ("work_id", request.work_id.as_str(), 255),
        ("actor_id", request.actor_id.as_str(), 255),
        ("session_id", request.session_id.as_str(), 255),
        ("attempt_id", request.attempt_id.as_str(), 255),
        ("result_id", request.result_id.as_str(), 255),
        ("operation_id", request.operation_id.as_str(), 255),
        ("timestamp", request.at.as_str(), 255),
    ] {
        if value.trim().is_empty() || value.len() > maximum || value.contains('\0') {
            return Err(StoreError::Invalid(format!(
                "acceptance result {name} must contain 1..={maximum} valid bytes"
            )));
        }
    }
    if request.fence == 0
        || request.expected_project_revision == 0
        || request.expected_proof_revision == 0
        || request.outputs.len() > MAX_ACCEPTANCE_RESULT_OUTPUTS
    {
        return Err(StoreError::Invalid(
            "acceptance result revisions, fence, or output count are outside their bounds".into(),
        ));
    }
    if let Some(attestation) = &request.attestation {
        if attestation.statement.trim().is_empty()
            || attestation.statement.len() > 4096
            || attestation.statement.contains('\0')
        {
            return Err(StoreError::Invalid(
                "completion attestation statement must contain 1..=4096 valid bytes".into(),
            ));
        }
    }
    let mut sources = std::collections::BTreeSet::new();
    let mut relationships = std::collections::BTreeSet::new();
    for output in &request.outputs {
        if output.requirement_key.trim().is_empty()
            || output.requirement_key.len() > 128
            || output.relationship_id.trim().is_empty()
            || output.relationship_id.len() > 64
            || !output.relationship_id.as_bytes()[0].is_ascii_lowercase()
            || !output.relationship_id.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'_' | b'-' | b'.')
            })
            || !relationships.insert(output.relationship_id.as_str())
            || output.source_version_id.trim().is_empty()
            || output.source_version_id.len() > 255
            || !super::valid_sha256_digest(&output.content_digest)
            || output.media_type.trim().is_empty()
            || output.media_type.len() > 255
            || [
                &output.attribution,
                &output.rights_statement,
                &output.license,
            ]
            .into_iter()
            .flatten()
            .any(|value| value.len() > 4096 || value.contains('\0'))
            || output.byte_count > MAX_ACCEPTANCE_RESULT_BYTES
            || output.criteria.len() > 16
            || !sources.insert(output.source_version_id.as_str())
        {
            return Err(StoreError::Invalid(
                "acceptance artifact identity, media, size, or criteria are invalid or duplicated"
                    .into(),
            ));
        }
        let mut criterion_ids = std::collections::BTreeSet::new();
        for criterion in &output.criteria {
            if criterion.criterion_id.trim().is_empty()
                || criterion.criterion_id.len() > 300
                || criterion.observed.len() > 1024
                || criterion.observed.contains('\0')
                || !criterion_ids.insert(criterion.criterion_id.as_str())
            {
                return Err(StoreError::Invalid(
                    "acceptance criterion result is malformed or duplicated".into(),
                ));
            }
        }
    }
    Ok(())
}

fn acceptance_bind_digest(request: &AcceptanceResultBindRequest) -> String {
    let mut outputs = request.outputs.clone();
    outputs.sort_by(|left, right| {
        left.requirement_key
            .cmp(&right.requirement_key)
            .then_with(|| left.source_version_id.cmp(&right.source_version_id))
    });
    let payload = json!({
        "schema": "boreal.acceptance_result.bind/1",
        "project_id": request.project_id,
        "work_id": request.work_id,
        "actor_id": request.actor_id,
        "session_id": request.session_id,
        "attempt_id": request.attempt_id,
        "fence": request.fence,
        "expected_project_revision": request.expected_project_revision,
        "expected_entity_revision": request.expected_entity_revision,
        "expected_proof_revision": request.expected_proof_revision,
        "result_id": request.result_id,
        "contract_revision": request.contract_revision,
        "outputs": acceptance_outputs_json(&outputs),
        "attestation": request.attestation.as_ref().map(|attestation| json!({
            "fact_schema": super::profiles::COMPLETION_ATTESTATION_FACT_SCHEMA,
            "statement": attestation.statement,
        })),
    });
    checksum(payload.to_string().as_bytes())
}

fn acceptance_outputs_json(outputs: &[AcceptanceArtifactInspection]) -> Value {
    Value::Array(
        outputs
            .iter()
            .map(|output| {
                json!({
                    "fact_schema": super::profiles::ARTIFACT_INSPECTION_FACT_SCHEMA,
                    "requirement_key": output.requirement_key,
                    "relationship_id": output.relationship_id,
                    "attribution": output.attribution,
                    "rights_statement": output.rights_statement,
                    "license": output.license,
                    "source_version_id": output.source_version_id,
                    "content_digest": output.content_digest,
                    "media_type": output.media_type,
                    "availability": output.availability.as_str(),
                    "media_type_allowed": output.media_type_allowed,
                    "byte_count": output.byte_count,
                    "criteria": output.criteria.iter().map(|criterion| json!({
                        "criterion_id": criterion.criterion_id,
                        "passed": criterion.passed,
                        "observed": criterion.observed,
                    })).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}

fn parse_acceptance_outputs(value: &str) -> Result<Vec<AcceptanceArtifactInspection>, StoreError> {
    let rows: Value = serde_json::from_str(value).map_err(|error| {
        StoreError::Corrupt(format!("invalid typed acceptance outputs: {error}"))
    })?;
    let rows = rows
        .as_array()
        .ok_or_else(|| StoreError::Corrupt("typed acceptance outputs are not an array".into()))?;
    let mut outputs = Vec::with_capacity(rows.len());
    for output in rows {
        if acceptance_json_string(output, "fact_schema")?
            != super::profiles::ARTIFACT_INSPECTION_FACT_SCHEMA
        {
            return Err(StoreError::Corrupt(
                "typed output fact schema is unknown or malformed".into(),
            ));
        }
        let criteria = output
            .get("criteria")
            .and_then(Value::as_array)
            .ok_or_else(|| StoreError::Corrupt("typed output criteria are not an array".into()))?
            .iter()
            .map(|criterion| {
                Ok(AcceptanceCriterionResult {
                    criterion_id: acceptance_json_string(criterion, "criterion_id")?,
                    passed: criterion
                        .get("passed")
                        .and_then(Value::as_bool)
                        .ok_or_else(|| {
                            StoreError::Corrupt(
                                "typed criterion result has no boolean outcome".into(),
                            )
                        })?,
                    observed: acceptance_json_string(criterion, "observed")?,
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        outputs.push(AcceptanceArtifactInspection {
            requirement_key: acceptance_json_string(output, "requirement_key")?,
            relationship_id: acceptance_json_string(output, "relationship_id")?,
            attribution: acceptance_json_optional_string(output, "attribution")?,
            rights_statement: acceptance_json_optional_string(output, "rights_statement")?,
            license: acceptance_json_optional_string(output, "license")?,
            source_version_id: acceptance_json_string(output, "source_version_id")?,
            content_digest: acceptance_json_string(output, "content_digest")?,
            media_type: acceptance_json_string(output, "media_type")?,
            availability: ArtifactInspectionAvailability::parse(&acceptance_json_string(
                output,
                "availability",
            )?)?,
            media_type_allowed: output
                .get("media_type_allowed")
                .and_then(Value::as_bool)
                .ok_or_else(|| {
                    StoreError::Corrupt("typed output media outcome is invalid".into())
                })?,
            byte_count: output
                .get("byte_count")
                .and_then(Value::as_u64)
                .ok_or_else(|| StoreError::Corrupt("typed output byte count is invalid".into()))?,
            criteria,
        });
    }
    Ok(outputs)
}

fn acceptance_json_string(value: &Value, key: &str) -> Result<String, StoreError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| StoreError::Corrupt(format!("typed acceptance field {key} is invalid")))
}

fn acceptance_json_optional_string(value: &Value, key: &str) -> Result<Option<String>, StoreError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(StoreError::Corrupt(format!(
            "typed acceptance field {key} is invalid"
        ))),
    }
}

fn parse_attestation(
    value: Option<String>,
) -> Result<Option<CompletionAttestationInput>, StoreError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let document: Value = serde_json::from_str(&value)
        .map_err(|error| StoreError::Corrupt(format!("invalid completion attestation: {error}")))?;
    if acceptance_json_string(&document, "fact_schema")?
        != super::profiles::COMPLETION_ATTESTATION_FACT_SCHEMA
    {
        return Err(StoreError::Corrupt(
            "completion attestation fact schema is unknown or malformed".into(),
        ));
    }
    Ok(Some(CompletionAttestationInput {
        statement: acceptance_json_string(&document, "statement")?,
    }))
}

fn acceptance_result_from_row(
    row: &super::Statement<'_>,
) -> Result<AcceptanceResultRecord, StoreError> {
    let outputs_json = row.column_text(16)?;
    Ok(AcceptanceResultRecord {
        result_id: row.column_text(0)?,
        project_id: row.column_text(1)?,
        work_id: row.column_text(2)?,
        attempt_id: row.column_text(3)?,
        fence: row.column_u64(4)?,
        entity_revision: row.column_u64(5)?,
        proof_revision: row.column_u64(6)?,
        actor_id: row.column_text(7)?,
        session_id: row.column_text(8)?,
        source_version_id: row.column_text(9)?,
        config_identity: row.column_text(10)?,
        profile_id: row.column_text(11)?,
        profile_version: row.column_u64(12)?,
        profile_digest: row.column_text(13)?,
        contract_revision: row.column_u64(14)?,
        result_digest: row.column_text(15)?,
        outputs: parse_acceptance_outputs(&outputs_json)?,
        attestation: parse_attestation(row.column_optional_text(17)?)?,
        operation_id: row.column_text(18)?,
        request_digest: row.column_text(19)?,
        project_revision: row.column_u64(20)?,
        created_at: row.column_text(21)?,
        replayed: false,
    })
}

fn acceptance_result_digest(
    result_id: &str,
    contract_revision: u64,
    outputs_json: &str,
    attestation_json: Option<&str>,
) -> String {
    checksum(
        json!({
            "schema": "boreal.acceptance_result/1",
            "result_id": result_id,
            "contract_revision": contract_revision,
            "outputs": outputs_json,
            "attestation": attestation_json,
        })
        .to_string()
        .as_bytes(),
    )
}

fn acceptance_contract(
    store: &SqliteStore,
    project_id: &str,
    work_id: &str,
) -> Result<(u64, Vec<Value>), StoreError> {
    if !store.table_exists("work_planning_contract_v1")? {
        return Ok((0, Vec::new()));
    }
    let Some(contract) = store.work_planning_contract(project_id, work_id)? else {
        return Ok((0, Vec::new()));
    };
    let requirements: Value =
        serde_json::from_str(&contract.requirements_json).map_err(|error| {
            StoreError::Corrupt(format!(
                "work deliverable contract is invalid JSON: {error}"
            ))
        })?;
    let requirements = requirements.as_array().cloned().ok_or_else(|| {
        StoreError::Corrupt("work deliverable contract requirements are not an array".into())
    })?;
    Ok((contract.contract_revision, requirements))
}

fn validate_registered_profile_gates(
    requirements: &super::PinnedRequirements,
    profile: super::profiles::RegisteredAcceptanceProfile,
) -> Result<(), StoreError> {
    let mut expected = std::collections::BTreeMap::from([(profile.summary_gate_id, "summary")]);
    if let Some(gate_id) = profile.review_gate_id {
        expected.insert(gate_id, "review");
    }
    let known_kinds = [
        "checkpoint",
        "verification",
        "review",
        "operator_approval",
        "summary",
        "audit",
    ];
    let mut found = std::collections::BTreeSet::new();
    for declaration in &requirements.declarations {
        let kind_for_id = match declaration.gate_id.as_str() {
            "summary" => Some("summary"),
            "artifact_review" => Some("review"),
            _ => None,
        };
        if !valid_acceptance_gate_id(&declaration.gate_id)
            || declaration.kind.trim().is_empty()
            || !known_kinds.contains(&declaration.kind.as_str())
            || declaration.requirement_id != format!("{}@{}", declaration.gate_id, declaration.kind)
            || declaration.verifier_policy.trim().is_empty()
            || !declaration.subject_rules.is_object()
            || declaration
                .observable_rules
                .iter()
                .any(|rule| rule.trim().is_empty())
            || !declaration.review_policy.is_object()
            || declaration.exception_policy.trim().is_empty()
        {
            return Err(StoreError::Conflict(format!(
                "{} has a malformed pinned gate declaration {}",
                profile.profile_id, declaration.gate_id
            )));
        }
        if let Some(expected_kind) = kind_for_id {
            if declaration.kind != expected_kind {
                return Err(StoreError::Conflict(format!(
                    "{} gate {} must have kind {expected_kind}",
                    profile.profile_id, declaration.gate_id
                )));
            }
        }
        match expected.get(declaration.gate_id.as_str()) {
            Some(expected_kind) => {
                if declaration.kind != *expected_kind || !declaration.required {
                    return Err(StoreError::Conflict(format!(
                        "{} requires exactly the pinned {} {} gate",
                        profile.profile_id, declaration.gate_id, expected_kind
                    )));
                }
                found.insert(declaration.gate_id.as_str());
            }
            None if declaration.required => {
                return Err(StoreError::Conflict(format!(
                    "{} cannot add required gate {} ({}) beyond its registered contract",
                    profile.profile_id, declaration.gate_id, declaration.kind
                )));
            }
            None => {}
        }
    }
    if found.len() != expected.len() {
        let missing = expected
            .keys()
            .find(|gate_id| !found.contains(**gate_id))
            .copied()
            .unwrap_or(profile.summary_gate_id);
        return Err(StoreError::Conflict(format!(
            "{} requires its pinned {} gate",
            profile.profile_id, missing
        )));
    }
    Ok(())
}

fn valid_acceptance_gate_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-' | b'.')
        })
}

fn validate_result_against_contract(
    mode: super::profiles::RegisteredAcceptanceMode,
    requirements: &[Value],
    outputs: &[AcceptanceArtifactInspection],
    attestation: Option<&CompletionAttestationInput>,
    require_complete: bool,
) -> Result<(), StoreError> {
    let required_outputs = requirements
        .iter()
        .filter(|requirement| requirement.get("required").and_then(Value::as_bool) == Some(true))
        .count();
    if mode == super::profiles::RegisteredAcceptanceMode::GeneralAttestation {
        if required_outputs > 0 {
            return Err(StoreError::Conflict(
                "acceptance_profile_requires_validated_deliverables: general-attestation/1 cannot satisfy a required output".into(),
            ));
        }
        if require_complete && attestation.is_none() {
            return Err(StoreError::Conflict(
                "general-attestation/1 requires a producer completion_attestation/1".into(),
            ));
        }
    } else if required_outputs == 0 {
        return Err(StoreError::Conflict(
            "validated-deliverables/1 and reviewed-artifacts/1 require at least one required output".into(),
        ));
    }

    let mut requirement_map = std::collections::BTreeMap::new();
    for requirement in requirements {
        let key = requirement
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| StoreError::Corrupt("deliverable requirement has no key".into()))?;
        if requirement_map.insert(key, requirement).is_some() {
            return Err(StoreError::Corrupt(
                "deliverable contract contains duplicate requirement keys".into(),
            ));
        }
    }
    let mut counts = std::collections::BTreeMap::<&str, u64>::new();
    for output in outputs {
        let requirement = requirement_map
            .get(output.requirement_key.as_str())
            .copied()
            .ok_or_else(|| {
                StoreError::Conflict(format!(
                    "artifact output references undeclared requirement {}",
                    output.requirement_key
                ))
            })?;
        let count = counts.entry(output.requirement_key.as_str()).or_default();
        *count += 1;
        let max_count = requirement
            .get("max_count")
            .and_then(Value::as_u64)
            .ok_or_else(|| StoreError::Corrupt("deliverable max_count is invalid".into()))?;
        if require_complete && *count > max_count {
            return Err(StoreError::Conflict(format!(
                "artifact requirement {} exceeds its maximum cardinality {max_count}",
                output.requirement_key
            )));
        }
        let media_types = requirement
            .get("allowed_media_types")
            .and_then(Value::as_array)
            .ok_or_else(|| StoreError::Corrupt("deliverable media types are invalid".into()))?;
        let expected_media_outcome = media_types.is_empty()
            || media_types.iter().any(|media| {
                media.as_str().is_some_and(|declared| {
                    declared_media_type_matches(declared, &output.media_type)
                })
            });
        if output.media_type_allowed != expected_media_outcome {
            return Err(StoreError::Conflict(format!(
                "artifact {} media-type inspection does not match the pinned requirement",
                output.source_version_id
            )));
        }
        let expected: std::collections::BTreeSet<String> = requirement
            .get("criteria")
            .and_then(Value::as_array)
            .ok_or_else(|| StoreError::Corrupt("deliverable criteria are invalid".into()))?
            .iter()
            .map(
                |criterion| match criterion.get("kind").and_then(Value::as_str) {
                    Some("min_bytes" | "max_bytes" | "json_document") => criterion["kind"]
                        .as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| StoreError::Corrupt("criterion kind is invalid".into())),
                    Some("text_contains") => criterion["text"]
                        .as_str()
                        .map(|text| format!("text_contains:{text}"))
                        .ok_or_else(|| StoreError::Corrupt("text criterion is invalid".into())),
                    _ => Err(StoreError::Corrupt(
                        "unknown deliverable criterion kind".into(),
                    )),
                },
            )
            .collect::<Result<_, _>>()?;
        let actual: std::collections::BTreeSet<String> = output
            .criteria
            .iter()
            .map(|criterion| criterion.criterion_id.clone())
            .collect();
        if expected != actual {
            return Err(StoreError::Conflict(format!(
                "artifact {} inspection does not cover the exact typed criteria",
                output.source_version_id
            )));
        }
        if require_complete
            && requirement.get("required").and_then(Value::as_bool) == Some(true)
            && (output.availability != ArtifactInspectionAvailability::Available
                || !output.media_type_allowed
                || output.criteria.iter().any(|criterion| !criterion.passed))
        {
            return Err(StoreError::Conflict(format!(
                "required artifact {} is unavailable or failed one or more deterministic criteria",
                output.source_version_id,
            )));
        }
    }
    for requirement in requirements {
        let key = requirement["key"]
            .as_str()
            .ok_or_else(|| StoreError::Corrupt("deliverable requirement has no key".into()))?;
        let required = requirement["required"]
            .as_bool()
            .ok_or_else(|| StoreError::Corrupt("deliverable required flag is invalid".into()))?;
        let min_count = requirement["min_count"].as_u64().ok_or_else(|| {
            StoreError::Corrupt("deliverable minimum cardinality is invalid".into())
        })?;
        let count = counts.get(key).copied().unwrap_or(0);
        if require_complete && required && count < min_count {
            return Err(StoreError::Conflict(format!(
                "required artifact requirement {key} needs at least {min_count} output(s); found {count}"
            )));
        }
    }
    Ok(())
}

fn declared_media_type_matches(declared: &str, actual: &str) -> bool {
    if declared == actual {
        return true;
    }

    let Some(declared_type) = declared.strip_suffix("/*") else {
        return false;
    };
    if declared_type.is_empty() || declared_type.contains('/') {
        return false;
    }

    let Some((actual_type, actual_subtype)) = actual.split_once('/') else {
        return false;
    };
    actual_type == declared_type
        && !actual_subtype.is_empty()
        && actual_subtype != "*"
        && !actual_subtype.contains('/')
}

fn validate_output_source(
    store: &SqliteStore,
    project_id: &str,
    output: &AcceptanceArtifactInspection,
) -> Result<(), StoreError> {
    let mut row = store.prepare(
        "SELECT content_digest,media_type,byte_count,availability
         FROM source_version WHERE project_id=?1 AND source_version_id=?2",
    )?;
    row.bind_text(1, project_id)?;
    row.bind_text(2, &output.source_version_id)?;
    if row.step()? != super::SQLITE_ROW {
        return Err(StoreError::NotFound {
            entity: "source version",
            id: output.source_version_id.clone(),
        });
    }
    let digest = row.column_text(0)?;
    let media_type = row.column_text(1)?;
    let byte_count = row.column_u64(2)?;
    let availability = row.column_text(3)?;
    let availability_matches = match output.availability {
        ArtifactInspectionAvailability::Available => availability == "available",
        ArtifactInspectionAvailability::Missing => {
            matches!(availability.as_str(), "available" | "missing")
        }
        ArtifactInspectionAvailability::Corrupt => {
            matches!(availability.as_str(), "available" | "quarantined")
        }
        ArtifactInspectionAvailability::TooLarge => availability == "available",
    };
    if digest != output.content_digest
        || media_type != output.media_type
        || byte_count != output.byte_count
        || !availability_matches
    {
        return Err(StoreError::Conflict(format!(
            "artifact {} is stale, unavailable, or has mismatched source metadata",
            output.source_version_id
        )));
    }
    Ok(())
}

fn validate_independent_artifact_decision(
    decision: Option<ArtifactDecisionRecord>,
    result: &AcceptanceResultRecord,
) -> Result<(), StoreError> {
    let decision = decision.ok_or_else(|| {
        StoreError::Conflict(
            "reviewed-artifacts requires an independent decision for the exact artifact set".into(),
        )
    })?;
    if decision.reviewer_actor_id == result.actor_id {
        return Err(StoreError::Conflict(
            "artifact decision reviewer must be independent of the producer".into(),
        ));
    }
    if decision.fact_schema != super::profiles::INDEPENDENT_ARTIFACT_DECISION_FACT_SCHEMA
        || decision.result_id != result.result_id
        || decision.result_digest != result.result_digest
        || decision.outcome != "approved"
    {
        return Err(StoreError::Conflict(
            "artifact decision is rejected, stale, or bound to a different result".into(),
        ));
    }
    Ok(())
}

impl SqliteStore {
    /// Historical submitted proof is readable without reviving its execution
    /// lease. This is not an execution-ownership admission primitive.
    pub fn proof_attempt(
        &self,
        project_id: &str,
        attempt_id: &str,
    ) -> Result<super::AttemptRecord, StoreError> {
        let attempt =
            self.attempt_record(attempt_id, false)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: attempt_id.to_owned(),
                })?;
        if attempt.project_id != project_id {
            return Err(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: attempt.project_id,
            });
        }
        if !attempt.current && !self.attempt_has_current_submission(&attempt)? {
            return Err(StoreError::NotCurrent {
                attempt_id: attempt_id.to_owned(),
            });
        }
        Ok(attempt)
    }

    pub fn work_revisions(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<(u64, u64), StoreError> {
        self.proof_cursor(project_id, work_id)
    }

    pub(crate) fn require_open_proof_subject(
        &self,
        attempt: &super::AttemptRecord,
    ) -> Result<(), StoreError> {
        let mut row =
            self.prepare("SELECT lifecycle FROM work_item WHERE project_id=?1 AND work_id=?2")?;
        row.bind_text(1, &attempt.project_id)?;
        row.bind_text(2, &attempt.work_id)?;
        if row.step()? != super::SQLITE_ROW || row.column_text(0)? != "open" {
            return Err(StoreError::Conflict(
                "proof mutation requires an open work subject; reopen explicitly first".into(),
            ));
        }
        Ok(())
    }

    pub(crate) fn attempt_has_current_submission(
        &self,
        attempt: &super::AttemptRecord,
    ) -> Result<bool, StoreError> {
        if !self.is_canonical_production()
            || attempt.phase != boreal_domain::AttemptPhase::Completed
        {
            return Ok(false);
        }
        let (_, generation) = self.proof_cursor(&attempt.project_id, &attempt.work_id)?;
        Ok(self
            .current_submission(&attempt.project_id, &attempt.work_id, generation)?
            .is_some_and(|s| s.attempt_id == attempt.attempt_id && s.fence == attempt.fence))
    }

    /// Ends execution ownership atomically with submission, retaining an
    /// independent resource-release obligation. Review never consumes a lease.
    pub(crate) fn end_execution_for_submission_in_transaction(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<(), StoreError> {
        let attempt = self.proof_attempt(&request.project_id, &request.attempt_id)?;
        self.require_open_proof_subject(&attempt)?;
        if attempt.actor_id != request.actor_id
            || attempt.session_id != request.session_id
            || attempt.work_id != request.work_id
            || attempt.fence != request.fence
        {
            return Err(StoreError::Conflict(
                "submission ownership, session or fence changed".into(),
            ));
        }
        if self.attempt_has_current_submission(&attempt)? {
            return Ok(());
        }
        if !attempt.current
            || !matches!(
                attempt.phase,
                boreal_domain::AttemptPhase::Running | boreal_domain::AttemptPhase::Verifying
            )
        {
            return Err(StoreError::Conflict(
                "submission requires the current executing attempt".into(),
            ));
        }
        if super::timestamp_cmp(&request.at, &attempt.hard_deadline) != std::cmp::Ordering::Less {
            return Err(StoreError::HardDeadlineElapsed);
        }
        if super::timestamp_cmp(&request.at, &attempt.lease_deadline) != std::cmp::Ordering::Less {
            return Err(StoreError::LeaseExpired);
        }
        let mut row = self.prepare("UPDATE attempt SET current=0, state='completed', terminal_at=?1, terminal_reason='result.submitted' WHERE attempt_id=?2 AND current=1 AND fence=?3")?;
        row.bind_text(1, &request.at)?;
        row.bind_text(2, &request.attempt_id)?;
        row.bind_i64(3, request.fence)?;
        row.run()?;
        if row.changes()? != 1 {
            return Err(StoreError::Conflict(
                "submission execution fence changed".into(),
            ));
        }
        let mut row = self.prepare("UPDATE reservation SET state='released', released_at=?1 WHERE attempt_id=?2 AND state='active'")?;
        row.bind_text(1, &request.at)?;
        row.bind_text(2, &request.attempt_id)?;
        row.run()?;
        self.request_canonical_resource_release_in_transaction(
            &request.project_id,
            &request.attempt_id,
            request.fence,
            &request.operation_id,
            &request.actor_id,
            &request.at,
        )?;
        self.create_recovery_obligation_in_transaction(
            &super::recovery::RecoveryObligationInput {
                obligation_id: format!("{}:recovery:submission", request.operation_id),
                project_id: request.project_id.clone(),
                work_id: request.work_id.clone(),
                attempt_id: Some(request.attempt_id.clone()),
                fence: Some(request.fence),
                reason: "resource_unknown".into(),
                resource_state: "release_pending".into(),
                owner_actor_id: Some(request.actor_id.clone()),
                next_action: "acknowledge physical resource release before reuse".into(),
                created_at: request.at.clone(),
            },
        )?;
        Ok(())
    }

    pub(crate) fn record_review_event_in_transaction(
        &self,
        request: &ReviewInsertRequest,
        attempt: &super::AttemptRecord,
    ) -> Result<(), StoreError> {
        use boreal_domain::ActorRole;
        self.require_open_proof_subject(attempt)?;
        if request.actor_id != request.reviewer_actor_id
            || request.reviewer_actor_id == attempt.actor_id
            || request.reason.trim().is_empty()
            || !matches!(
                self.project_actor_context(&request.project_id, &request.actor_id)?
                    .role,
                ActorRole::Reviewer | ActorRole::Operator
            )
        {
            return Err(StoreError::Conflict(
                "review requires an independent reviewer principal and nonempty reason".into(),
            ));
        }
        if self
            .principal_authority(&request.project_id, &request.actor_id)?
            .1
            == self.recorded_principal_root(&request.project_id, &attempt.actor_id)?
        {
            return Err(StoreError::Conflict(
                "reviewer shares the submitting authority root".into(),
            ));
        }
        let (_, generation) = self.proof_cursor(&request.project_id, &request.work_id)?;
        let sealed = self
            .current_submission(&request.project_id, &request.work_id, generation)?
            .ok_or_else(|| {
                StoreError::Conflict("review requires an immutable submission".into())
            })?;
        if sealed.attempt_id != request.attempt_id
            || sealed.fence != request.fence
            || request.source_version_id.as_deref() != Some(sealed.source_version_id.as_str())
            || request.policy_digest != sealed.profile_digest
        {
            return Err(StoreError::Conflict(
                "review does not bind the exact submitted proof and profile digest".into(),
            ));
        }
        let gate_id = request.gate_id.as_deref().ok_or_else(|| {
            StoreError::Invalid("review requires an explicit pinned review gate".into())
        })?;
        let pin = super::ProfileStore::new(self)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        if !pin.declarations.iter().any(|g| {
            g.kind == "review"
                && (g.gate_id == gate_id || format!("{}:{}", request.work_id, g.gate_id) == gate_id)
        }) {
            return Err(StoreError::Conflict(
                "review gate is not in the pinned acceptance profile".into(),
            ));
        }
        let mut row = self.prepare("INSERT INTO boreal_review_event(review_event_id,project_id,work_id,submission_id,gate_id,reviewer_actor_id,outcome,reason,operation_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
        row.bind_text(1, &request.review_id)?;
        row.bind_text(2, &request.project_id)?;
        row.bind_text(3, &request.work_id)?;
        row.bind_text(4, &sealed.submission_id)?;
        row.bind_text(5, gate_id)?;
        row.bind_text(6, &request.actor_id)?;
        let outcome = if request.decision == super::ReviewDecision::Accepted {
            "approved"
        } else {
            "rejected"
        };
        row.bind_text(7, outcome)?;
        row.bind_text(8, &request.reason)?;
        row.bind_text(9, &request.operation_id)?;
        row.bind_text(10, &request.created_at)?;
        row.run()?;
        self.record_artifact_decision_in_transaction(
            &request.project_id,
            &request.work_id,
            &sealed.submission_id,
            gate_id,
            &request.actor_id,
            outcome,
            &request.reason,
            &request.operation_id,
            &request.created_at,
        )
    }

    pub(crate) fn validate_submission_for_close(
        &self,
        request: &CloseIntentRequest,
        attempt: &super::AttemptRecord,
    ) -> Result<(), StoreError> {
        let (_, generation) = self.proof_cursor(&request.project_id, &request.work_id)?;
        let sealed = self
            .current_submission(&request.project_id, &request.work_id, generation)?
            .ok_or_else(|| StoreError::Conflict("close requires an immutable submission".into()))?;
        if sealed.attempt_id != request.attempt_id
            || sealed.fence != request.fence
            || request.source_version_id.as_deref() != Some(sealed.source_version_id.as_str())
            || sealed.config_identity != request.config_identity
            || sealed.profile_id != request.profile_id
            || sealed.profile_version != request.profile_version
            || request.summary_id.as_deref() != Some(sealed.summary_id.as_str())
            || self.submission_receipts(attempt)? != sealed.receipt_ids
        {
            return Err(StoreError::Conflict(
                "submitted proof changed; seal a new candidate before closing".into(),
            ));
        }
        self.validate_typed_acceptance_for_close(request, &sealed)?;
        let pin = super::ProfileStore::new(self)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        for gate in pin
            .declarations
            .iter()
            .filter(|g| g.required && g.kind == "review")
        {
            let mut row = self.prepare("SELECT outcome FROM boreal_review_event WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 AND (gate_id=?4 OR gate_id=?5) ORDER BY rowid DESC LIMIT 1")?;
            row.bind_text(1, &request.project_id)?;
            row.bind_text(2, &request.work_id)?;
            row.bind_text(3, &sealed.submission_id)?;
            row.bind_text(4, &gate.gate_id)?;
            row.bind_text(5, &format!("{}:{}", request.work_id, gate.gate_id))?;
            let review_outcome = if row.step()? == super::SQLITE_ROW {
                Some(row.column_text(0)?)
            } else {
                None
            };
            if review_outcome.as_deref() != Some("approved") {
                let (entity, proof) = self.proof_cursor(&request.project_id, &request.work_id)?;
                let exception = self.current_gate_exception(
                    &request.project_id,
                    &request.work_id,
                    &format!("{}:{}", request.work_id, gate.gate_id),
                    proof,
                )?;
                let failed = matches!(
                    review_outcome.as_deref(),
                    Some("rejected" | "returned" | "revoked")
                );
                let now = super::status_evaluation::canonical_status_timestamp(&request.at)?;
                if !failed
                    || !exception.is_some_and(|exception| {
                        exception.applies(
                            super::GateState::Failed,
                            boreal_domain::decision_inputs::EntityRevision::new(entity),
                            boreal_domain::decision_inputs::ProofRevision::new(proof),
                            now,
                        )
                    })
                {
                    return Err(StoreError::Conflict("independent approval or an explicit disposition of the failed review is required".into()));
                }
            }
        }
        Ok(())
    }
}

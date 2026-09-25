//! Focused PF-S02-T04 contract coverage.
//!
//! These tests exercise the public profile/requirement module and its current
//! SQLite integration. Observed gate rows and immutable declaration rows are
//! deliberately mutated in isolated fixtures so deletion and drift are
//! proven as fail-closed readback outcomes.

use boreal_domain::{WorkItem, WorkKind};
use boreal_store::profiles::{
    audit_observations, classify_legacy_definition, GateObservation, LegacyDefinitionDisposition,
    PinnedRequirements, PinnedRequirementsOutcome, ProfileRegistry, ProfileStore, ProfileVersion,
    RegistrationOutcome, RequirementFinding, RequirementSubjectKind,
};
use boreal_store::{
    CloseIntentRequest, ReceiptAcceptanceExpectation, ReceiptAttestation, ReceiptInsertRequest,
    ReceiptOutcome, ReceiptSubmissionKind, SqliteStore, StoreError,
};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn temp_path(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-profile-requirements-{label}-{}-{stamp}.sqlite",
        std::process::id()
    ))
}

fn remove_sqlite_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

fn initialized_store() -> SqliteStore {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
    store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "cred-agent",
            "Agent",
            "op-init",
            "sha256:op-init",
            "t0",
        )
        .expect("project initializes");
    store
}

fn profile(id: &str, version: u64, definition: &str) -> ProfileVersion {
    let provisional = ProfileVersion::new(id, version, "sha256:placeholder", definition, "t0")
        .expect("definition shape is valid");
    let digest = provisional.computed_digest().expect("digest computes");
    ProfileVersion::from_canonical_definition(id, version, digest, definition, "t0")
        .expect("canonical profile is valid")
}

fn task_definition(gate: &str) -> String {
    format!(
        r#"{{"required_observables":["exit_status"],"gates":[{{"id":"{gate}","kind":"verification","required":true}},{{"id":"audit","kind":"audit","required":false}}],"review_policy":{{"required":false}},"subject_rules":{{"work_id":"exact"}}}}"#
    )
}

fn insert_work(store: &SqliteStore, work_id: &str, profile_id: &str, version: u64) {
    store
        .execute_batch(&format!(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES ('{work_id}', 'p1', 'task', 'open', 'automatic',
                     '{profile_id}', {version}, 'Profile test work', '', 't1', 't1');"
        ))
        .expect("work inserts");
}

fn remove_one_pinned_declaration(store: &SqliteStore, work_id: &str) {
    store
        .execute_batch(&format!(
            "DROP TRIGGER boreal_pinned_requirement_gate_immutable_delete;
             DELETE FROM boreal_pinned_requirement_gate
              WHERE project_id = 'p1' AND work_id = '{work_id}'
                AND requirement_id = 'verification@verification';
             CREATE TRIGGER boreal_pinned_requirement_gate_immutable_delete
               BEFORE DELETE ON boreal_pinned_requirement_gate
             BEGIN
               SELECT RAISE(ABORT, 'pinned_requirement_gate_immutable');
             END;"
        ))
        .expect("pinned declaration corruption fixture applies");
}

#[test]
fn immutable_registry_rejects_conflicting_same_version_content() {
    let first = profile("reviewed", 1, &task_definition("verification"));
    let same = profile("reviewed", 1, &task_definition("verification"));
    let conflicting = profile("reviewed", 1, &task_definition("different"));
    let mut registry = ProfileRegistry::default();

    assert_eq!(
        registry
            .register(first.clone())
            .expect("first version inserts"),
        RegistrationOutcome::Inserted
    );
    assert_eq!(
        registry
            .register(same)
            .expect("identical content is idempotent"),
        RegistrationOutcome::Unchanged
    );
    assert!(matches!(
        registry.register(conflicting),
        Err(StoreError::Conflict(message)) if message.contains("reviewed/1")
    ));
    assert_eq!(registry.get("reviewed", 1), Some(&first));
}

#[test]
fn pinned_requirements_are_subject_specific_and_profile_versioned() {
    let version_one = profile("reviewed", 1, &task_definition("verification"));
    let version_two = profile("reviewed", 2, &task_definition("verification-v2"));
    let mut registry = ProfileRegistry::default();
    registry
        .register(version_one.clone())
        .expect("v1 registers");
    registry
        .register(version_two.clone())
        .expect("v2 registers");

    let task = PinnedRequirements::resolve(
        &version_one,
        "project-a",
        "task-a",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("task requirements resolve");
    let container = PinnedRequirements::resolve(
        &version_two,
        "project-a",
        "milestone-a",
        1,
        RequirementSubjectKind::Container,
        "t2",
    )
    .expect("container requirements resolve");

    assert_eq!(task.subject_kind, RequirementSubjectKind::Task);
    assert_eq!(container.subject_kind, RequirementSubjectKind::Container);
    assert_eq!(task.profile.version, 1);
    assert_eq!(container.profile.version, 2);
    assert_ne!(task.resolved_digest, container.resolved_digest);
    assert_eq!(task.declarations.len(), 2);
    assert_eq!(task.required_ids().len(), 1);
    assert_eq!(container.required_ids().len(), 1);
    assert_eq!(
        task.profile.version, 1,
        "a later default cannot reprofile task-a"
    );
}

#[test]
fn deleting_an_observation_does_not_remove_required_declarations() {
    let profile = profile("focused", 1, &task_definition("verification"));
    let requirements = PinnedRequirements::resolve(
        &profile,
        "project-a",
        "task-a",
        7,
        RequirementSubjectKind::Task,
        "t7",
    )
    .expect("requirements resolve");

    let findings = audit_observations(&requirements, &[]);
    assert_eq!(requirements.required_ids().len(), 1);
    assert!(
        findings.contains(&RequirementFinding::MissingRequiredObservation {
            requirement_id: "verification@verification".to_owned(),
        })
    );

    let valid_observation = GateObservation {
        requirement_id: "verification@verification".to_owned(),
        profile_id: profile.profile_id.clone(),
        profile_version: profile.version,
        profile_digest: profile.policy_digest.clone(),
    };
    assert!(audit_observations(&requirements, &[valid_observation]).is_empty());
}

#[test]
fn profile_drift_is_detected_before_observation_recency_matters() {
    let profile = profile("focused", 1, &task_definition("verification"));
    let requirements = PinnedRequirements::resolve(
        &profile,
        "project-a",
        "task-a",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("requirements resolve");
    let observation = GateObservation {
        requirement_id: "verification@verification".to_owned(),
        profile_id: profile.profile_id.clone(),
        profile_version: profile.version,
        profile_digest: "sha256:stale-profile".to_owned(),
    };

    assert_eq!(
        audit_observations(&requirements, &[observation]),
        vec![RequirementFinding::ObservationProfileDrift {
            requirement_id: "verification@verification".to_owned(),
        }]
    );
}

#[test]
fn empty_legacy_definition_requires_authoritative_reconstruction_or_quarantine() {
    assert_eq!(
        classify_legacy_definition("{}", None).expect("legacy classification"),
        LegacyDefinitionDisposition::Quarantined {
            code: "legacy_profile_definition_missing",
        }
    );
    assert!(matches!(
        classify_legacy_definition("{}", Some(&task_definition("verification")))
            .expect("authoritative legacy reconstruction"),
        LegacyDefinitionDisposition::Reconstructed { canonical_digest }
            if canonical_digest.starts_with("sha256:")
    ));
    assert_eq!(
        classify_legacy_definition("{}", Some("{}")).expect("ambiguous legacy classification"),
        LegacyDefinitionDisposition::Quarantined {
            code: "legacy_profile_definition_ambiguous",
        }
    );

    let store = initialized_store();
    let provisional = ProfileVersion::new("legacy", 1, "sha256:placeholder", "{}", "t0")
        .expect("empty legacy shape is parseable");
    let legacy = ProfileVersion::from_canonical_definition(
        "legacy",
        1,
        provisional
            .computed_digest()
            .expect("legacy digest computes"),
        "{}",
        "t0",
    )
    .expect("legacy digest is internally consistent");
    assert!(matches!(
        ProfileStore::new(&store).register(&legacy),
        Err(StoreError::Conflict(message)) if message.contains("no authoritative definition")
    ));
}

#[test]
fn malformed_or_unverified_profile_content_is_rejected() {
    assert!(matches!(
        ProfileVersion::from_canonical_definition("bad", 1, "sha256:nope", "{}", "t0"),
        Err(StoreError::Conflict(message)) if message.contains("digest drift")
    ));
    assert!(matches!(
        ProfileVersion::new("bad", 1, "sha256:ok", "not-json", "t0"),
        Err(StoreError::Invalid(message)) if message.contains("not JSON")
    ));
    assert!(matches!(
        ProfileVersion::new("bad", 1, "sha256:wrong", "[]", "t0"),
        Err(StoreError::Invalid(message)) if message.contains("must be an object")
    ));
    let malformed_definition =
        r#"{"gates":[{"id":"verification","kind":"verification","required":"yes"}]}"#;
    let provisional =
        ProfileVersion::new("bad", 1, "sha256:placeholder", malformed_definition, "t0")
            .expect("malformed gate field is still JSON");
    let malformed = ProfileVersion::from_canonical_definition(
        "bad",
        1,
        provisional.computed_digest().expect("digest computes"),
        malformed_definition,
        "t0",
    )
    .expect("digest-bound malformed profile constructs");
    assert!(matches!(
        PinnedRequirements::resolve(&malformed, "p1", "bad-work", 1, RequirementSubjectKind::Task, "t0"),
        Err(StoreError::Invalid(message)) if message.contains("required flag is not boolean")
    ));

    let store = initialized_store();
    let unverified = ProfileVersion::new(
        "unverified",
        1,
        "sha256:wrong",
        task_definition("verification"),
        "t0",
    )
    .expect("shape-only construction is available for the rejection test");
    assert!(matches!(
        ProfileStore::new(&store).register(&unverified),
        Err(StoreError::Conflict(message)) if message.contains("digest drift")
    ));
}

#[test]
fn persisted_requirements_survive_observation_deletion() {
    let store = initialized_store();
    let pinned_profile = profile("pinned", 1, &task_definition("verification"));
    ProfileStore::new(&store)
        .register(&pinned_profile)
        .expect("profile registers");
    store
        .execute_batch(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES ('work-pinned', 'p1', 'task', 'open', 'automatic',
                     'pinned', 1, 'Pinned work', '', 't1', 't1');
             INSERT INTO gate
               (gate_id, work_id, profile_id, profile_version, kind, required,
                state, subject_ref, updated_at)
             VALUES ('verification', 'work-pinned', 'pinned', 1, 'verification',
                     1, 'open', '', 't1');",
        )
        .expect("work and observed gate insert");

    let requirements = PinnedRequirements::resolve(
        &pinned_profile,
        "p1",
        "work-pinned",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("requirements resolve");
    assert_eq!(
        ProfileStore::new(&store)
            .persist_pinned_requirements(&requirements)
            .expect("requirements persist"),
        PinnedRequirementsOutcome::Inserted
    );

    // The observed gate is disposable evidence. The pinned declaration is a
    // separate immutable snapshot and must remain readable after observation
    // cleanup.
    store
        .execute_batch("DELETE FROM gate WHERE gate_id = 'verification'")
        .expect("observation deletion");
    let restored = ProfileStore::new(&store)
        .read_pinned_requirements("p1", "work-pinned", 1)
        .expect("pinned requirements read")
        .expect("pinned requirements remain");
    assert_eq!(restored, requirements);
    assert!(audit_observations(&restored, &[]).contains(
        &RequirementFinding::MissingRequiredObservation {
            requirement_id: "verification@verification".to_owned(),
        }
    ));
}

#[test]
fn persistence_rejects_a_digest_valid_pin_that_disagrees_with_its_profile() {
    let store = initialized_store();
    let pinned_profile = profile(
        "pinned-source",
        1,
        r#"{"gates":[{"id":"verification","kind":"verification","required":true}]}"#,
    );
    let store_api = ProfileStore::new(&store);
    store_api
        .register(&pinned_profile)
        .expect("profile registers");
    insert_work(&store, "forged-pin", "pinned-source", 1);
    let mut forged = PinnedRequirements::resolve(
        &pinned_profile,
        "p1",
        "forged-pin",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("requirements resolve");

    // Model a caller that supplies a self-consistent but weaker declaration
    // set. Its own digest is valid; the immutable profile remains authoritative.
    forged.declarations.clear();
    forged.resolved_digest = forged.computed_digest().expect("forged digest computes");
    assert!(matches!(
        store_api.persist_pinned_requirements(&forged),
        Err(StoreError::Conflict(message))
            if message.contains("differ from immutable profile pinned-source/1")
    ));
    assert!(store_api
        .read_pinned_requirements("p1", "forged-pin", 1)
        .expect("no partial pin was committed")
        .is_none());
}

#[test]
fn readback_quarantines_a_recomputed_pin_that_omits_profile_requirements() {
    let store = initialized_store();
    let pinned_profile = profile(
        "tampered-pin",
        1,
        r#"{"gates":[{"id":"verification","kind":"verification","required":true}]}"#,
    );
    let store_api = ProfileStore::new(&store);
    store_api
        .register(&pinned_profile)
        .expect("profile registers");
    insert_work(&store, "tampered-pin-work", "tampered-pin", 1);
    let mut weakened = PinnedRequirements::resolve(
        &pinned_profile,
        "p1",
        "tampered-pin-work",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("requirements resolve");
    store_api
        .persist_pinned_requirements(&weakened)
        .expect("original requirements persist");

    // This fixture simulates coordinated on-disk corruption: the immutable
    // header and child are both altered and the snapshot digest is recomputed.
    // Readback must compare against the separately persisted profile content.
    weakened.declarations.clear();
    weakened.resolved_digest = weakened
        .computed_digest()
        .expect("tampered digest computes");
    store
        .execute_batch(&format!(
            "DROP TRIGGER boreal_pinned_requirement_immutable_update;
             DROP TRIGGER boreal_pinned_requirement_gate_immutable_delete;
             UPDATE boreal_pinned_requirement
                SET declarations_json = '[]', resolved_digest = '{}'
              WHERE project_id = 'p1' AND work_id = 'tampered-pin-work'
                AND proof_revision = 1;
             DELETE FROM boreal_pinned_requirement_gate
              WHERE project_id = 'p1' AND work_id = 'tampered-pin-work'
                AND proof_revision = 1;
             CREATE TRIGGER boreal_pinned_requirement_immutable_update
               BEFORE UPDATE ON boreal_pinned_requirement
             BEGIN
               SELECT RAISE(ABORT, 'pinned_requirement_immutable');
             END;
             CREATE TRIGGER boreal_pinned_requirement_gate_immutable_delete
               BEFORE DELETE ON boreal_pinned_requirement_gate
             BEGIN
               SELECT RAISE(ABORT, 'pinned_requirement_gate_immutable');
             END;",
            weakened.resolved_digest
        ))
        .expect("coordinated corruption fixture applies and restores guards");

    assert!(matches!(
        store_api.read_pinned_requirements("p1", "tampered-pin-work", 1),
        Err(StoreError::Corrupt(message))
            if message.contains("disagree with immutable profile definition")
    ));
}

#[test]
fn current_requirement_readback_remains_authoritative_after_gate_deletion() {
    let store = initialized_store();
    let pinned_profile = profile(
        "closeout",
        1,
        r#"{"gates":[{"id":"summary","kind":"summary","required":true},{"id":"audit","kind":"audit","required":false}]}"#,
    );
    let store_api = ProfileStore::new(&store);
    store_api
        .register(&pinned_profile)
        .expect("profile registers");
    insert_work(&store, "closeout-work", "closeout", 1);
    let requirements = PinnedRequirements::resolve(
        &pinned_profile,
        "p1",
        "closeout-work",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("requirements resolve");
    store_api
        .persist_pinned_requirements(&requirements)
        .expect("requirements persist");

    // The live gate projection is an observation and may disappear during
    // repair.  The current requirement API must still return the summary
    // declaration from the immutable snapshot.
    store
        .execute_batch(
            "INSERT INTO gate
               (gate_id, work_id, profile_id, profile_version, kind, required,
                state, subject_ref, updated_at)
             VALUES ('summary', 'closeout-work', 'closeout', 1, 'summary',
                     1, 'open', '', 't1');
             DELETE FROM gate WHERE gate_id = 'summary';",
        )
        .expect("observation deletion succeeds");
    let declarations = store_api
        .current_required_declarations("p1", "closeout-work")
        .expect("current requirements read");
    assert_eq!(declarations.len(), 1);
    assert_eq!(declarations[0].kind, "summary");
    assert!(store_api
        .current_pinned_requirements("p1", "closeout-work")
        .expect("current snapshot read")
        .requires_kind("summary"));
}

#[test]
fn missing_current_requirement_snapshot_is_corruption_not_empty_acceptance() {
    let store = initialized_store();
    let error = ProfileStore::new(&store)
        .current_required_declarations("p1", "never-pinned")
        .expect_err("missing requirement snapshot must fail closed");
    assert!(
        matches!(error, StoreError::Corrupt(message) if message.contains("missing pinned requirement revision"))
    );
}

#[test]
fn semantically_identical_profile_json_has_one_content_identity() {
    let compact = profile(
        "canonical",
        1,
        r#"{"gates":[{"id":"verification","kind":"verification","required":true}]}"#,
    );
    let formatted = ProfileVersion::new(
        "canonical",
        1,
        compact.policy_digest.clone(),
        r#"{ "gates": [ { "required": true, "kind": "verification", "id": "verification" } ] }"#,
        "t0",
    )
    .expect("formatted profile shape is valid");
    assert_eq!(formatted.definition_json, compact.definition_json);
    assert_eq!(
        formatted.computed_digest().expect("digest computes"),
        compact.policy_digest
    );
}

#[test]
fn conflicting_repin_is_rejected_and_identical_repin_is_idempotent() {
    let store = initialized_store();
    let pinned_profile = profile("pinned", 1, &task_definition("verification"));
    ProfileStore::new(&store)
        .register(&pinned_profile)
        .expect("profile registers");
    store
        .execute_batch(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES ('work-repin', 'p1', 'task', 'open', 'automatic',
                     'pinned', 1, 'Repin work', '', 't1', 't1');",
        )
        .expect("work inserts");
    let requirements = PinnedRequirements::resolve(
        &pinned_profile,
        "p1",
        "work-repin",
        3,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("requirements resolve");
    let store_api = ProfileStore::new(&store);
    assert_eq!(
        store_api
            .persist_pinned_requirements(&requirements)
            .expect("first pin"),
        PinnedRequirementsOutcome::Inserted
    );
    assert_eq!(
        store_api
            .persist_pinned_requirements(&requirements)
            .expect("identical pin is idempotent"),
        PinnedRequirementsOutcome::Unchanged
    );

    let changed_profile = profile("pinned", 1, &task_definition("different"));
    let conflicting = PinnedRequirements::resolve(
        &changed_profile,
        "p1",
        "work-repin",
        3,
        RequirementSubjectKind::Task,
        "t2",
    )
    .expect("conflicting requirements resolve in memory");
    assert!(matches!(
        store_api.persist_pinned_requirements(&conflicting),
        Err(StoreError::Conflict(message)) if message.contains("work-repin")
    ));
    assert_eq!(
        store_api
            .read_pinned_requirements("p1", "work-repin", 3)
            .expect("read original pin")
            .expect("original pin remains"),
        requirements
    );
}

#[test]
fn root_work_creation_pins_requirements_and_survives_gate_deletion() {
    let store = initialized_store();
    let work = WorkItem::new("p1".into(), "task-1".into(), WorkKind::Task, None, "Task").open();
    store
        .create_work_operation(&work, "agent-1", "op-work", "sha256:op-work", "unix-ms:1")
        .expect("root work creation pins the requirement set");

    let pinned = ProfileStore::new(&store)
        .read_pinned_requirements("p1", "task-1", 1)
        .expect("pinned declarations are readable")
        .expect("root pin exists");
    assert_eq!(pinned.declarations.len(), 3);

    let verification = store
        .gate_id_for_work("p1", "task-1", "verification")
        .expect("verification gate exists");
    store
        .execute_batch(&format!(
            "DELETE FROM gate WHERE gate_id = '{}';",
            verification.replace('\'', "''")
        ))
        .expect("observation deletion is allowed for this corruption fixture");
    let status = store
        .read_project_status("p1")
        .expect("status reads from pinned declarations");
    let row = status
        .works
        .iter()
        .find(|row| row.work.id.as_str() == "task-1")
        .expect("task remains visible");
    assert_eq!(row.gate_diagnostics.gates.len(), 3);
    assert!(row
        .gate_diagnostics
        .missing
        .iter()
        .any(|gate| gate.ends_with(":verification")));
}

#[test]
fn status_quarantines_corrupt_pinned_requirements_instead_of_using_gate_rows() {
    let store = initialized_store();
    let work = WorkItem::new(
        "p1".into(),
        "status-corrupt".into(),
        WorkKind::Task,
        None,
        "Status corrupt",
    )
    .open();
    store
        .create_work_operation(
            &work,
            "agent-1",
            "op-status-corrupt",
            "sha256:op-status-corrupt",
            "t1",
        )
        .expect("work creation pins immutable requirements");
    remove_one_pinned_declaration(&store, "status-corrupt");

    let snapshot = store
        .read_project_status("p1")
        .expect("status remains readable with one corrupt work row");
    let row = snapshot
        .works
        .iter()
        .find(|row| row.work.id.as_str() == "status-corrupt")
        .expect("corrupt work remains visible");
    assert!(snapshot.diagnostics.iter().any(|diagnostic| {
        diagnostic.work_id == "status-corrupt"
            && diagnostic.code == "acceptance_requirements_corrupt"
    }));
    assert!(row
        .gate_diagnostics
        .missing
        .contains(&"requirements_missing".to_owned()));
    assert!(row.work.hard_holds.iter().any(|reason| {
        matches!(reason, boreal_domain::ReasonCode::HardHold(code) if code == "integrity_quarantined")
    }));
    assert!(row.gate_diagnostics.gates.is_empty());
}

#[test]
fn closeout_rejects_corrupt_pinned_requirements_as_a_requirement_diagnostic() {
    let store = initialized_store();
    let work = WorkItem::new(
        "p1".into(),
        "close-corrupt".into(),
        WorkKind::Task,
        None,
        "Close corrupt",
    )
    .open();
    store
        .create_work_operation(
            &work,
            "agent-1",
            "op-close-corrupt-work",
            "sha256:op-close-corrupt-work",
            "t1",
        )
        .expect("work creation pins immutable requirements");
    store
        .execute_batch(
            "INSERT INTO attempt (
                attempt_id, work_id, actor_id, harness_id, session_id, fence,
                current, state, claimed_at, accepted_at, lease_deadline,
                max_attempt_deadline, review_required_after_expiry,
                config_identity, binary_identity, protocol_version, schema_version
             ) VALUES ('attempt-close-corrupt', 'close-corrupt', 'agent-1', 'luna',
                       NULL, 1, 1, 'verifying', 't1', 't2',
                       't3', 't4', 1, 'config', 'binary', '2', 2);",
        )
        .expect("verifying attempt inserts");
    remove_one_pinned_declaration(&store, "close-corrupt");

    let request = CloseIntentRequest {
        project_id: "p1".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        expected_project_revision: None,
        close_intent_id: "close-intent-corrupt".to_owned(),
        work_id: "close-corrupt".to_owned(),
        attempt_id: "attempt-close-corrupt".to_owned(),
        fence: 1,
        operation_id: "op-close-intent-corrupt".to_owned(),
        source_version_id: None,
        config_identity: "config".to_owned(),
        profile_id: "focused".to_owned(),
        profile_version: 1,
        summary_id: None,
        at: "t5".to_owned(),
        request_digest: "sha256:close-intent-corrupt".to_owned(),
    };
    store
        .create_close_intent(&request)
        .expect("close intent is durable before finalization");
    let result = store
        .finalize_close_intent(&CloseIntentRequest {
            operation_id: "op-close-finalize-corrupt".to_owned(),
            request_digest: "sha256:close-finalize-corrupt".to_owned(),
            at: "t6".to_owned(),
            ..request
        })
        .expect("corrupt requirements produce a rejected closeout result");
    let diagnostics = result
        .diagnostics
        .expect("closeout diagnostics are retained");
    assert!(diagnostics
        .missing
        .contains(&"requirements_missing".to_owned()));
    assert_eq!(
        result.close_intent.state,
        boreal_store::CloseIntentState::Open
    );
    assert_eq!(
        store
            .work("p1", "close-corrupt")
            .unwrap()
            .unwrap()
            .lifecycle,
        "open"
    );
}

#[test]
fn receipt_admission_fails_closed_when_pinned_gate_declaration_is_corrupt() {
    let store = initialized_store();
    let work = WorkItem::new(
        "p1".into(),
        "receipt-corrupt".into(),
        WorkKind::Task,
        None,
        "Receipt corrupt",
    )
    .open();
    store
        .create_work_operation(
            &work,
            "agent-1",
            "op-receipt-corrupt-work",
            "sha256:op-receipt-corrupt-work",
            "t1",
        )
        .expect("work creation pins immutable requirements");
    store
        .execute_batch(
            "INSERT INTO attempt (
                attempt_id, work_id, actor_id, harness_id, session_id, fence,
                current, state, claimed_at, accepted_at, lease_deadline,
                max_attempt_deadline, review_required_after_expiry,
                config_identity, binary_identity, protocol_version, schema_version
             ) VALUES ('attempt-receipt-corrupt', 'receipt-corrupt', 'agent-1', 'luna',
                       NULL, 1, 1, 'verifying', 't1', 't2', 't3', 't4', 1,
                       'config', 'binary', '2', 2);",
        )
        .expect("receipt attempt inserts");
    remove_one_pinned_declaration(&store, "receipt-corrupt");

    let gate_id = store
        .gate_id_for_work("p1", "receipt-corrupt", "verification")
        .expect("observed gate remains available");
    let request = ReceiptInsertRequest {
        project_id: "p1".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        expected_project_revision: None,
        request_digest: "sha256:receipt-corrupt".to_owned(),
        receipt_id: "receipt-corrupt".to_owned(),
        work_id: "receipt-corrupt".to_owned(),
        attempt_id: "attempt-receipt-corrupt".to_owned(),
        fence: 1,
        operation_id: "op-receipt-corrupt".to_owned(),
        gate_id: Some(gate_id.clone()),
        executable: "cargo".to_owned(),
        argv_json: "[\"cargo\",\"test\"]".to_owned(),
        cwd: ".".to_owned(),
        exit_code: 0,
        started_at: "t1".to_owned(),
        ended_at: "t2".to_owned(),
        source_version_id: None,
        config_identity: "config".to_owned(),
        environment_fingerprint: "env".to_owned(),
        output_digest: Some("sha256:output".to_owned()),
        output_ref: None,
        subject_json: "{\"work_id\":\"receipt-corrupt\"}".to_owned(),
        coverage_json: "{}".to_owned(),
        attestation: ReceiptAttestation::SelfReported,
        submission_kind: ReceiptSubmissionKind::ExternalImport,
        acceptance: Some(ReceiptAcceptanceExpectation {
            work_id: "receipt-corrupt".to_owned(),
            attempt_id: "attempt-receipt-corrupt".to_owned(),
            fence: 1,
            source_version_id: None,
            config_identity: "config".to_owned(),
            profile_id: "focused".to_owned(),
            profile_version: 1,
            gate_id,
            gate_kind: boreal_domain::GateKind::Verification,
            gate_required: true,
            requires_attestation: false,
        }),
        result: ReceiptOutcome::Passed,
        rejection_code: None,
        created_at: "t2".to_owned(),
    };
    assert!(matches!(
        store.insert_receipt(&request),
        Err(StoreError::Corrupt(message)) if message.contains("pinned requirement")
    ));
    assert!(store
        .receipt("receipt-corrupt")
        .expect("receipt lookup")
        .is_none());
}

#[test]
fn sibling_work_items_keep_distinct_pinned_versions_durably() {
    let store = initialized_store();
    let version_one = profile("sibling", 1, &task_definition("verification"));
    let version_two = profile("sibling", 2, &task_definition("verification-v2"));
    let store_api = ProfileStore::new(&store);
    store_api
        .register(&version_one)
        .expect("sibling v1 registers");
    store_api
        .register(&version_two)
        .expect("sibling v2 registers");
    insert_work(&store, "sibling-v1", "sibling", 1);
    insert_work(&store, "sibling-v2", "sibling", 2);

    let first = PinnedRequirements::resolve(
        &version_one,
        "p1",
        "sibling-v1",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("v1 requirements resolve");
    let second = PinnedRequirements::resolve(
        &version_two,
        "p1",
        "sibling-v2",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("v2 requirements resolve");
    store_api
        .persist_pinned_requirements(&first)
        .expect("v1 requirements persist");
    store_api
        .persist_pinned_requirements(&second)
        .expect("v2 requirements persist");

    let first_read = store_api
        .read_pinned_requirements("p1", "sibling-v1", 1)
        .expect("v1 readback")
        .expect("v1 pin exists");
    let second_read = store_api
        .read_pinned_requirements("p1", "sibling-v2", 1)
        .expect("v2 readback")
        .expect("v2 pin exists");
    assert_eq!(first_read.profile.version, 1);
    assert_eq!(second_read.profile.version, 2);
    assert_ne!(first_read.resolved_digest, second_read.resolved_digest);
}

#[test]
fn pinned_requirements_survive_canonical_database_restart() {
    let path = temp_path("restart");
    remove_sqlite_files(&path);
    let profile = profile("restart", 1, &task_definition("verification"));
    let requirements = PinnedRequirements::resolve(
        &profile,
        "p1",
        "restart-work",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("restart requirements resolve");
    {
        let store = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("production opens");
        store
            .create_project("p1", "t0")
            .expect("production project creates");
        let store_api = ProfileStore::new(&store);
        store_api.register(&profile).expect("profile registers");
        insert_work(&store, "restart-work", "restart", 1);
        store_api
            .persist_pinned_requirements(&requirements)
            .expect("requirements persist");
    }
    {
        let reopened = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("production reopens");
        let restored = ProfileStore::new(&reopened)
            .read_pinned_requirements("p1", "restart-work", 1)
            .expect("restart readback")
            .expect("pinned requirements survive restart");
        assert_eq!(restored, requirements);
    }
    remove_sqlite_files(&path);
}

#[test]
fn missing_pinned_child_is_detected_instead_of_reducing_requirements() {
    let store = initialized_store();
    let pinned_profile = profile("missing-child", 1, &task_definition("verification"));
    let store_api = ProfileStore::new(&store);
    store_api
        .register(&pinned_profile)
        .expect("profile registers");
    insert_work(&store, "missing-child-work", "missing-child", 1);
    let requirements = PinnedRequirements::resolve(
        &pinned_profile,
        "p1",
        "missing-child-work",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("requirements resolve");
    store_api
        .persist_pinned_requirements(&requirements)
        .expect("requirements persist");
    // Bypass the immutable trigger only to model an owned corruption event;
    // restore the schema guard before readback so the assertion exercises the
    // missing declaration diagnostic rather than the earlier schema check.
    store
        .execute_batch(
            "DROP TRIGGER boreal_pinned_requirement_gate_immutable_delete;
             DELETE FROM boreal_pinned_requirement_gate
              WHERE project_id = 'p1' AND work_id = 'missing-child-work'
                AND requirement_id = 'verification@verification';
             CREATE TRIGGER boreal_pinned_requirement_gate_immutable_delete
               BEFORE DELETE ON boreal_pinned_requirement_gate
             BEGIN
               SELECT RAISE(ABORT, 'pinned_requirement_gate_immutable');
             END;",
        )
        .expect("corruption fixture deletes one child");

    assert!(matches!(
        store_api.read_pinned_requirements("p1", "missing-child-work", 1),
        Err(StoreError::Corrupt(message))
            if message.contains("missing from the immutable declaration set")
    ));
}

#[test]
fn malformed_pinned_profile_and_child_content_is_quarantined_on_readback() {
    let store = initialized_store();
    let pinned_profile = profile("malformed", 1, &task_definition("verification"));
    let store_api = ProfileStore::new(&store);
    store_api
        .register(&pinned_profile)
        .expect("profile registers");
    insert_work(&store, "malformed-work", "malformed", 1);
    let requirements = PinnedRequirements::resolve(
        &pinned_profile,
        "p1",
        "malformed-work",
        1,
        RequirementSubjectKind::Task,
        "t1",
    )
    .expect("requirements resolve");
    store_api
        .persist_pinned_requirements(&requirements)
        .expect("requirements persist");

    // Bypass the immutable trigger only to model an owned corruption event;
    // restore the schema guard before readback so the assertion exercises the
    // malformed declaration diagnostic rather than the earlier schema check.
    store
        .execute_batch(
            "DROP TRIGGER boreal_pinned_requirement_gate_immutable_update;
             UPDATE boreal_pinned_requirement_gate
                SET declaration_json = 'not-json'
              WHERE project_id = 'p1' AND work_id = 'malformed-work'
                AND requirement_id = 'verification@verification';
             CREATE TRIGGER boreal_pinned_requirement_gate_immutable_update
               BEFORE UPDATE ON boreal_pinned_requirement_gate
             BEGIN
               SELECT RAISE(ABORT, 'pinned_requirement_gate_immutable');
             END;",
        )
        .expect("child corruption fixture updates declaration");
    assert!(matches!(
        store_api.read_pinned_requirements("p1", "malformed-work", 1),
        Err(StoreError::Corrupt(message)) if message.contains("declaration is malformed")
    ));

    // This disposable in-memory store is isolated to the corruption fixture;
    // remove the production update guards only here so readback can verify
    // quarantine of malformed historical profile content.
    store
        .execute_batch(
            "DROP TRIGGER boreal_profile_strict_immutable_update;
             DROP TRIGGER boreal_profile_immutable_update;
             UPDATE acceptance_profile
                SET definition_json = 'not-json'
              WHERE profile_id = 'malformed' AND version = 1;",
        )
        .expect("profile corruption fixture updates definition");
    assert!(matches!(
        store_api.read_pinned_requirements("p1", "malformed-work", 1),
        Err(StoreError::Corrupt(message)) if message.contains("acceptance profile is malformed")
    ));
}

//! Focused PF-S02-T04 contract coverage.
//!
//! These tests exercise the public profile/requirement module. Durable root
//! registration is intentionally not hidden behind a test-local module; its
//! shared `SqliteStore` integration request is recorded in the task handoff.

use boreal_domain::{WorkItem, WorkKind};
use boreal_store::profiles::{
    audit_observations, classify_legacy_definition, GateObservation, LegacyDefinitionDisposition,
    PinnedRequirements, PinnedRequirementsOutcome, ProfileRegistry, ProfileStore, ProfileVersion,
    RegistrationOutcome, RequirementFinding, RequirementSubjectKind,
};
use boreal_store::{SqliteStore, StoreError};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

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

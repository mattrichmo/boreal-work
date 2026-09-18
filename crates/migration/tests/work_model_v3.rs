use boreal_migration::work_model_v3::{
    plan_schema2_upgrade, ExecutionMode, ProjectLifecycle, V3WorkKind, WORK_MODEL_FORMAT,
    WORK_MODEL_VERSION,
};
use boreal_migration::{
    AttemptPhase, AttemptRecord, EvidenceKind, EvidenceReference, Lifecycle, MigrationDocument,
    ProjectRecord, SummaryReference, WorkKind, WorkRecord,
};

fn schema2_document(with_historical_proof: bool) -> MigrationDocument {
    let mut source = MigrationDocument::new(ProjectRecord {
        id: "project-legacy".into(),
        name: "Legacy project".into(),
        description: "A schema-2 compatibility fixture".into(),
    });
    source.work = vec![
        WorkRecord {
            id: "milestone-1".into(),
            project_id: "project-legacy".into(),
            kind: WorkKind::Milestone,
            parent_id: None,
            title: "M01".into(),
            description: "Release milestone".into(),
            lifecycle: Lifecycle::Open,
        },
        WorkRecord {
            id: "sprint-1".into(),
            project_id: "project-legacy".into(),
            kind: WorkKind::Sprint,
            // Keep the baseline fixture representable by the current bridge;
            // the nested legacy hierarchy is exercised separately below.
            parent_id: None,
            title: "S01".into(),
            description: "Historical sprint subject".into(),
            lifecycle: Lifecycle::Closed,
        },
        WorkRecord {
            id: "task-1".into(),
            project_id: "project-legacy".into(),
            kind: WorkKind::Task,
            parent_id: Some("sprint-1".into()),
            title: "Implement migration".into(),
            description: "A task that retains its old hierarchy".into(),
            lifecycle: Lifecycle::Closed,
        },
    ];

    if with_historical_proof {
        source.attempts.push(AttemptRecord {
            id: "attempt-old".into(),
            work_id: "task-1".into(),
            actor_id: "agent-old".into(),
            session_id: Some("session-old".into()),
            phase: AttemptPhase::Submitted,
            claimed_at_ms: 100,
            hard_deadline_ms: 7_200_100,
            lease_expires_at_ms: 1_800_100,
            fence: 3,
        });
        source.evidence.push(EvidenceReference {
            id: "evidence-old".into(),
            work_id: "task-1".into(),
            kind: EvidenceKind::Test,
            reference: "cargo test --workspace".into(),
            source_version: Some("source-old".into()),
            citation: Some("README.md:1".into()),
        });
        source.summaries.push(SummaryReference {
            id: "summary-old".into(),
            work_id: "task-1".into(),
            attempt_id: Some("attempt-old".into()),
            fence: Some(3),
            subject_ref: "closeout".into(),
            body_digest: "sha256:old-summary".into(),
            body_size: 64,
            source_version: Some("source-old".into()),
            config_identity: Some("config-old".into()),
            profile_id: Some("focused".into()),
            profile_version: Some(1),
            current: true,
        });
    }

    source
}

fn semantically_clean_schema2_document() -> MigrationDocument {
    let mut source = schema2_document(false);
    source.work.retain(|work| work.kind != WorkKind::Sprint);
    source
        .work
        .iter_mut()
        .find(|work| work.id == "task-1")
        .unwrap()
        .parent_id = None;
    source
}

#[test]
fn schema2_upgrade_is_a_versioned_compatibility_envelope() {
    let source = schema2_document(true);
    let plan = plan_schema2_upgrade(&source).expect("valid schema-2 fixture");
    let compatibility = plan
        .document
        .compatibility
        .as_ref()
        .expect("upgrade must retain its source envelope");

    assert_eq!(plan.document.format, WORK_MODEL_FORMAT);
    assert_eq!(plan.document.version, WORK_MODEL_VERSION);
    assert_eq!(plan.document.project.id, source.project.id);
    assert_eq!(plan.document.project.lifecycle, ProjectLifecycle::Active);
    assert_eq!(plan.document.project.timezone, "UTC");
    assert_eq!(compatibility.source, source);
    assert_eq!(compatibility.retained_sprint_work_ids, ["sprint-1"]);
    assert_eq!(compatibility.proof_subject_work_ids, ["task-1"]);
    assert!(compatibility
        .notes
        .iter()
        .any(|note| note.contains("dry-run")));

    let encoded = serde_json::to_string(&plan.document).unwrap();
    let decoded: boreal_migration::work_model_v3::WorkModelV3Document =
        serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded, plan.document);
    assert!(plan.materialize().is_ok());
}

#[test]
fn legacy_sprints_remain_compatibility_subjects_not_cycles_or_reparented_work() {
    let plan = plan_schema2_upgrade(&schema2_document(false)).unwrap();
    let sprint = plan
        .document
        .work
        .iter()
        .find(|work| work.id == "sprint-1")
        .unwrap();
    let task = plan
        .document
        .work
        .iter()
        .find(|work| work.id == "task-1")
        .unwrap();

    assert_eq!(sprint.kind, V3WorkKind::CompatibilitySprint);
    assert_eq!(sprint.execution_mode, ExecutionMode::Compatibility);
    assert_eq!(sprint.parent_id, None);
    assert_eq!(task.parent_id.as_deref(), Some("sprint-1"));
    assert!(plan.document.cycles.is_empty());
    assert!(plan.document.cycle_series.is_empty());
    assert!(plan.document.cycle_templates.is_empty());
    assert!(plan.document.assignments.is_empty());

    let mut without_bridge = plan.document.clone();
    without_bridge.compatibility = None;
    assert!(matches!(
        without_bridge.validate(),
        Err(boreal_migration::work_model_v3::V3ValidationError::CompatibilitySprintRequiresBridge(
            id
        )) if id == "sprint-1"
    ));
}

#[test]
fn nested_legacy_sprint_hierarchy_is_preserved_by_the_upgrade_contract() {
    let mut source = schema2_document(false);
    source.work[1].parent_id = Some("milestone-1".into());

    // This is the ordinary legacy shape and is deliberately an active
    // contract test. The current bridge rejects it with InvalidParent before
    // it can preserve the hierarchy, so this test remains a release blocker
    // until the v3 parent mapping accepts compatibility sprints below a
    // milestone/container.
    let plan = plan_schema2_upgrade(&source)
        .expect("schema-2 milestone -> sprint -> task hierarchy must remain representable in v3");
    let sprint = plan
        .document
        .work
        .iter()
        .find(|work| work.id == "sprint-1")
        .unwrap();
    assert_eq!(sprint.parent_id.as_deref(), Some("milestone-1"));
    assert_eq!(sprint.kind, V3WorkKind::CompatibilitySprint);
}

#[test]
fn historical_proof_is_preserved_in_source_but_never_transferred_to_v3_execution_state() {
    let source = schema2_document(true);
    let plan = plan_schema2_upgrade(&source).unwrap();
    let compatibility = plan.document.compatibility.as_ref().unwrap();

    assert_eq!(compatibility.source.attempts, source.attempts);
    assert_eq!(compatibility.source.evidence, source.evidence);
    assert_eq!(compatibility.source.summaries, source.summaries);
    assert_eq!(compatibility.proof_subject_work_ids, ["task-1"]);

    // v3's live projection intentionally contains no attempt, receipt, or
    // summary rows. A future adapter must bind those historical facts to an
    // explicit current proof context rather than relabeling them as witnessed.
    assert!(plan.document.cycles.is_empty());
    assert!(plan.document.assignments.is_empty());
    assert!(plan.document.intake.is_empty());
    assert!(plan.document.promotions.is_empty());
    assert!(plan.document.dispositions.is_empty());
}

#[test]
fn upgrade_reports_review_and_loss_accounting_for_semantic_conversions() {
    let plan = plan_schema2_upgrade(&schema2_document(true)).unwrap();

    assert!(plan.is_lossless(), "the complete source is retained");
    assert!(plan.review_required);
    assert_eq!(
        plan.reasons,
        [
            "legacy sprint subjects require reviewed cycle conversion",
            "historical proof remains on schema-2 subjects and is not rebound",
        ]
    );
    assert!(plan
        .document
        .compatibility
        .as_ref()
        .unwrap()
        .notes
        .iter()
        .any(|note| note.contains("no store writes")));
    let ledger = plan.loss_ledger();
    assert_eq!(ledger.len(), 2);
    assert!(ledger.iter().any(|entry| {
        entry.record_type == "work"
            && entry.record_id.as_deref() == Some("sprint-1")
            && entry.disposition == boreal_migration::LossDisposition::HistoricalOnly
    }));
    assert!(ledger.iter().any(|entry| {
        entry.record_type == "proof"
            && entry.record_id.as_deref() == Some("task-1")
            && entry.disposition == boreal_migration::LossDisposition::HistoricalOnly
    }));

    let clean_plan = plan_schema2_upgrade(&semantically_clean_schema2_document()).unwrap();
    assert!(!clean_plan.review_required);
    assert!(clean_plan.reasons.is_empty());
    assert!(clean_plan.is_lossless());
    assert!(clean_plan.loss_ledger().is_empty());
}

#[test]
fn schema2_upgrade_does_not_mutate_source_or_imply_store_actions() {
    let source = schema2_document(true);
    let before = source.clone();
    let plan = plan_schema2_upgrade(&source).unwrap();
    let materialized = plan.materialize().unwrap();

    assert_eq!(source, before);
    assert_eq!(materialized.compatibility.as_ref().unwrap().source, before);
    // The contract is a projection only. Its new v3 collections stay empty;
    // a store adapter must create explicit, reviewed operations before any
    // cycle, assignment, intake, or proof record can be materialized.
    assert!(materialized.cycles.is_empty());
    assert!(materialized.assignments.is_empty());
    assert!(materialized.intake_buckets.is_empty());
    assert!(materialized.intake.is_empty());
}

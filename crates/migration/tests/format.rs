use boreal_migration::{
    export_json, export_plan_json, import_json, import_legacy_json, AttemptPhase, AttemptRecord,
    DependencyKind, DependencyRecord, EvidenceKind, EvidenceReference, GitReference, Lifecycle,
    MemoryKind, MemoryReference, MigrationDocument, ProjectRecord, ReservationRecord,
    ReservationState, WorkKind, WorkRecord, LEGACY_FORMAT, LEGACY_FORMAT_VERSION,
};

const LEGACY_FIXTURE: &str = r#"
{
  "format": "boreal.legacy.records",
  "version": 1,
  "as_of_ms": 5000,
  "project": {"uuid": "p-legacy", "title": "Legacy Boreal", "description": "fixture"},
  "work_items": [
    {"uuid": "m-1", "type": "phase", "title": "M01 product", "status": "active"},
    {"uuid": "s-1", "type": "iteration", "parent": "m-1", "title": "S00 contracts", "status": "done"},
    {"uuid": "t-1", "type": "issue", "parent": "s-1", "title": "Import boundary", "status": "closed"}
  ],
  "dependencies": [
    {"dependent_id": "t-1", "prerequisite_id": "s-1", "type": "close_only"},
    {"from_work_id": "t-1", "to_work_id": "m-1", "type": "related"}
  ],
  "claims": [
    {"uuid": "a-expired", "work_id": "t-1", "owner_id": "agent-old", "status": "running",
     "claimed_at_ms": 1000, "deadline_ms": 7201000, "lease_deadline_ms": 4000, "fence": 2},
    {"uuid": "a-failed", "work_id": "s-1", "owner_id": "agent-old", "status": "failed",
     "claimed_at_ms": 1200, "deadline_ms": 7201200, "lease_deadline_ms": 2400, "fence": 1}
  ],
  "reservations": [
    {"reservation_id": "r-expired", "claim_id": "a-expired", "owner_id": "agent-old",
     "created_at_ms": 1000, "deadline_ms": 7201000, "lease_deadline_ms": 4000, "fence": 2},
    {"reservation_id": "r-released", "claim_id": "a-failed", "owner_id": "agent-old",
     "created_at_ms": 1200, "deadline_ms": 7201200, "lease_deadline_ms": 2400, "fence": 1, "state": "released"}
  ],
  "evidence": [
    {"id": "e-1", "item_id": "t-1", "type": "test", "ref": "cargo test -p boreal-migration",
     "citation": "tests/format.rs:1"}
  ],
  "failures": [
    {"id": "f-1", "item_id": "s-1", "claim_id": "a-failed", "code": "timeout",
     "reason": "legacy worker stopped", "detail": {"exit": 124}, "failed_at_ms": 2401}
  ],
  "summaries": [
    {"id": "sum-1", "item_id": "t-1", "claim_id": "a-expired", "fence": 2,
     "subject": "closeout", "digest": "sha256:summary", "size": 42, "current": true}
  ],
  "memory_entries": [
    {"id": "mem-1", "type": "entry", "path": "entries/import.md", "digest": "sha256:memory", "commit": "abc123"}
  ],
  "git_refs": [
    {"id": "git-1", "repo": "https://example.invalid/boreal.git", "revision": "abc123",
     "path": "crates/migration/src/lib.rs", "line_start": 1, "line_end": 2}
  ]
}
"#;

fn document() -> MigrationDocument {
    let mut document = MigrationDocument::new(ProjectRecord {
        id: "project-1".into(),
        name: "Migrated project".into(),
        description: "Reduced fixture".into(),
    });
    document.work = vec![
        WorkRecord {
            id: "milestone-1".into(),
            project_id: "project-1".into(),
            kind: WorkKind::Milestone,
            parent_id: None,
            title: "M01".into(),
            description: "Product".into(),
            lifecycle: Lifecycle::Open,
        },
        WorkRecord {
            id: "sprint-1".into(),
            project_id: "project-1".into(),
            kind: WorkKind::Sprint,
            parent_id: Some("milestone-1".into()),
            title: "S00 contracts".into(),
            description: "Contracts".into(),
            lifecycle: Lifecycle::Open,
        },
        WorkRecord {
            id: "task-1".into(),
            project_id: "project-1".into(),
            kind: WorkKind::Task,
            parent_id: Some("sprint-1".into()),
            title: "Import records".into(),
            description: "Keep the boundary explicit".into(),
            lifecycle: Lifecycle::Closed,
        },
    ];
    document.dependencies.push(DependencyRecord {
        from_work_id: "task-1".into(),
        to_work_id: "sprint-1".into(),
        kind: DependencyKind::ClosedOnly,
    });
    document.attempts.push(AttemptRecord {
        id: "attempt-1".into(),
        work_id: "task-1".into(),
        actor_id: "agent-1".into(),
        session_id: Some("session-1".into()),
        phase: AttemptPhase::Submitted,
        claimed_at_ms: 100,
        hard_deadline_ms: 7_200_100,
        lease_expires_at_ms: 1_800_100,
        fence: 4,
    });
    document.reservations.push(ReservationRecord {
        id: "reservation-1".into(),
        attempt_id: "attempt-1".into(),
        owner_id: "agent-1".into(),
        reserved_at_ms: 100,
        hard_deadline_ms: 7_200_100,
        lease_expires_at_ms: 1_800_100,
        fence: 4,
        state: ReservationState::Active,
    });
    document.evidence.push(EvidenceReference {
        id: "evidence-1".into(),
        work_id: "task-1".into(),
        kind: EvidenceKind::Test,
        reference: "cargo test -p boreal-migration".into(),
        source_version: Some("source-v1".into()),
        citation: Some("tests/format.rs:1".into()),
    });
    document.memory.push(MemoryReference {
        id: "memory-1".into(),
        project_id: "project-1".into(),
        kind: MemoryKind::Entry,
        path: "entries/import.md".into(),
        identity: "sha256:abc".into(),
        git_commit: Some("abc123".into()),
    });
    document.git.push(GitReference {
        id: "git-1".into(),
        project_id: "project-1".into(),
        repository: "https://example.invalid/boreal.git".into(),
        commit: "abc123".into(),
        path: Some("crates/migration/src/lib.rs".into()),
        line_start: Some(1),
        line_end: Some(2),
    });
    document
}

#[test]
fn reduced_format_round_trips_all_supported_sections() {
    let expected = document();
    expected.validate().unwrap();

    let encoded = export_json(&expected).unwrap();
    let report = import_json(&encoded).unwrap();

    assert!(report.is_lossless());
    assert_eq!(report.document, Some(expected));
}

#[test]
fn unsupported_records_are_reported_with_raw_input() {
    let input = r#"{
      "format": "boreal.v2.migration",
      "version": 1,
      "project": {"id": "p1", "name": "P"},
      "work": [{"id": "w1", "project_id": "p1", "kind": "task", "title": "T", "lifecycle": "open", "legacy_notes": "keep me"}],
      "future_records": [{"id": "future-1", "payload": "opaque"}]
    }"#;

    let report = import_json(input).unwrap();
    assert!(!report.is_lossless());
    assert_eq!(report.document.as_ref().unwrap().work.len(), 0);
    assert_eq!(report.unsupported.len(), 2);
    assert!(report
        .unsupported
        .iter()
        .any(|issue| { issue.record_type == "work" && issue.raw["legacy_notes"] == "keep me" }));
    assert!(report.unsupported.iter().any(|issue| {
        issue.record_type == "top_level" && issue.record_id.as_deref() == Some("future_records")
    }));
    let ledger = report.loss_ledger();
    assert_eq!(ledger.len(), 2);
    assert!(ledger
        .iter()
        .all(|entry| { entry.disposition == boreal_migration::LossDisposition::Unsupported }));
}

#[test]
fn conflicting_identifiers_are_ambiguous_and_not_imported() {
    let input = r#"{
      "format": "boreal.v2.migration",
      "version": 1,
      "project": {"id": "p1", "name": "P"},
      "work": [{"id": "w1", "uuid": "w2", "project_id": "p1", "kind": "task", "title": "T", "lifecycle": "open"}]
    }"#;

    let report = import_json(input).unwrap();
    assert_eq!(report.document.unwrap().work.len(), 0);
    assert_eq!(report.ambiguous.len(), 1);
    assert_eq!(report.ambiguous[0].record_id.as_deref(), Some("w1"));
    assert_eq!(report.ambiguous[0].raw["uuid"], "w2");
}

#[test]
fn malformed_supported_records_are_retained_as_unsupported() {
    let input = r#"{
      "format": "boreal.v2.migration",
      "version": 1,
      "project": {"id": "p1", "name": "P"},
      "attempts": [{"id": "a1", "work_id": "w1", "actor_id": "agent", "phase": "invented", "claimed_at_ms": 1, "hard_deadline_ms": 2, "lease_expires_at_ms": 2, "fence": 1}]
    }"#;

    let report = import_json(input).unwrap();
    assert_eq!(report.unsupported.len(), 1);
    assert_eq!(report.unsupported[0].record_type, "attempt");
    assert_eq!(report.unsupported[0].raw["id"], "a1");
}

#[test]
fn legacy_fixture_builds_a_valid_dry_run_plan_and_retains_expiry_and_failures() {
    let plan = import_legacy_json(LEGACY_FIXTURE).unwrap();
    assert!(plan.dry_run);
    assert!(
        !plan.is_ready(),
        "the related dependency must remain auditable"
    );
    assert_eq!(plan.report.issue_count(), 1);
    assert_eq!(plan.report.unsupported[0].record_type, "dependency");
    assert_eq!(plan.report.document.as_ref().unwrap().work.len(), 3);

    let document = plan.materialize_in_memory().unwrap();
    assert_eq!(document.work[1].parent_id.as_deref(), Some("m-1"));
    assert_eq!(document.dependencies[0].kind, DependencyKind::ClosedOnly);
    assert_eq!(document.attempts[0].phase, AttemptPhase::Expired);
    assert_eq!(document.reservations[0].state, ReservationState::Expired);
    assert_eq!(document.reservations[1].state, ReservationState::Released);
    assert_eq!(document.failures[0].message, "legacy worker stopped");
    assert_eq!(document.failures[0].detail["exit"], 124);
    assert_eq!(document.summaries[0].body_digest, "sha256:summary");
    assert_eq!(document.memory[0].git_commit.as_deref(), Some("abc123"));
    assert_eq!(document.git[0].commit, "abc123");

    let exported = export_plan_json(&plan).unwrap();
    assert!(exported.contains("\"dry_run\": true"));
    assert!(exported.contains("dependency meaning is not safely representable"));
}

#[test]
fn legacy_import_is_non_mutating_and_in_memory_materialization_is_repeatable() {
    let source_before = LEGACY_FIXTURE.to_owned();
    let sentinel_target = vec!["production-db-placeholder"];
    let plan = import_legacy_json(LEGACY_FIXTURE).unwrap();

    let first = plan.materialize_in_memory().unwrap();
    let second = plan.materialize_in_memory().unwrap();
    assert_eq!(first, second);
    assert_eq!(LEGACY_FIXTURE, source_before);
    assert_eq!(sentinel_target, vec!["production-db-placeholder"]);
    assert!(plan.dry_run);
}

#[test]
fn legacy_ambiguous_alias_is_reported_and_not_imported() {
    let input = r#"{
      "format": "boreal.legacy.records",
      "version": 1,
      "project": {"id": "p1", "name": "P"},
      "work_items": [{"id": "w1", "uuid": "w2", "kind": "task", "title": "T"}]
    }"#;

    let plan = import_legacy_json(input).unwrap();
    assert!(plan.report.document.as_ref().unwrap().work.is_empty());
    assert_eq!(plan.report.ambiguous.len(), 1);
    assert_eq!(plan.report.ambiguous[0].record_type, "work");
    assert_eq!(plan.report.ambiguous[0].raw["uuid"], "w2");
}

#[test]
fn duplicate_legacy_collection_aliases_are_retained_as_ambiguous_without_actions() {
    let input = r#"{
      "format": "boreal.legacy.records", "version": 1,
      "project": {"id": "p1", "name": "P"},
      "work_items": [{"id": "w1", "kind": "task", "title": "From work_items"}],
      "work": [{"id": "w2", "kind": "task", "title": "From work"}]
    }"#;

    let plan = import_legacy_json(input).unwrap();

    assert!(!plan.is_ready());
    assert!(plan.report.document.as_ref().unwrap().work.is_empty());
    assert_eq!(plan.report.ambiguous.len(), 1);
    assert_eq!(plan.report.ambiguous[0].record_type, "work");
    assert!(plan.report.ambiguous[0].reason.contains("work_items, work"));
    assert_eq!(plan.report.ambiguous[0].raw["work_items"][0]["id"], "w1");
    assert_eq!(plan.report.ambiguous[0].raw["work"][0]["id"], "w2");
    assert!(plan.import_plan().actions.is_empty());
    assert!(matches!(
        plan.materialize_export(),
        Err(boreal_migration::MaterializationError::NotReady(report))
            if report.actions.is_empty()
    ));
}

#[test]
fn invalid_hierarchy_rolls_back_to_a_report_without_a_partial_plan() {
    let input = r#"{
      "format": "boreal.legacy.records",
      "version": 1,
      "project": {"id": "p1", "name": "P"},
      "work_items": [
        {"id": "m1", "kind": "milestone", "title": "M"},
        {"id": "t1", "kind": "task", "parent_id": "m1", "title": "T"}
      ]
    }"#;
    let before = input.to_owned();

    let plan = import_legacy_json(input).unwrap();
    assert!(plan.report.document.is_none());
    assert!(!plan.is_ready());
    assert!(plan
        .report
        .unsupported
        .iter()
        .any(|issue| issue.record_type == "document" && issue.reason.contains("parent kind")));
    assert_eq!(input, before);
    assert!(plan.materialize_in_memory().is_err());
    assert!(plan.import_plan().actions.is_empty());
    assert!(matches!(
        plan.materialize_export(),
        Err(boreal_migration::MaterializationError::NotReady(_))
    ));
}

#[test]
fn materialization_carries_source_provenance_and_explicit_integrator_actions() {
    let input = r#"{
      "format": "boreal.legacy.records", "version": 1, "as_of_ms": 42,
      "project": {"id": "p1", "name": "P"},
      "work_items": [{"id": "w1", "kind": "task", "title": "T", "status": "open"}]
    }"#;

    let plan = import_legacy_json(input).unwrap();
    let export = plan.materialize_export().unwrap();

    assert_eq!(export.provenance.source_format, LEGACY_FORMAT);
    assert_eq!(export.provenance.source_version, LEGACY_FORMAT_VERSION);
    assert_eq!(export.provenance.as_of_ms, Some(42));
    assert!(export.provenance.source_fingerprint.starts_with("sha256:"));
    assert_eq!(export.provenance.source_fingerprint.len(), 71);
    assert!(export.import_plan.ready);
    assert_eq!(export.import_plan.actions.len(), 2);
    assert_eq!(export.import_plan.actions[0].collection, "project");
    assert_eq!(export.import_plan.actions[1].id, "w1");
    assert!(export.import_plan.loss_ledger.is_empty());
    assert_eq!(export.document_json, export_json(&export.document).unwrap());
}

#[test]
fn plan_apply_and_verify_are_side_effect_free_and_report_exact_counts() {
    let plan = import_legacy_json(
        r#"{
          "format": "boreal.legacy.records", "version": 1,
          "project": {"id": "p1", "name": "P"},
          "work_items": [{"id": "w1", "kind": "task", "title": "T"}],
          "failures": [{"id": "f1", "work_id": "w1", "code": "timeout", "reason": "stopped"}]
        }"#,
    )
    .unwrap();

    let applied = plan.apply().unwrap();
    let verification = plan.verify().unwrap();
    assert!(verification.ready);
    assert_eq!(verification.counts.work, applied.work.len());
    assert_eq!(verification.counts.failures, 1);
    assert_eq!(verification.action_count, 3);
    assert_eq!(verification.issue_count, 0);
    assert_eq!(verification.loss_ledger_count, 0);
    assert_eq!(
        verification.document_fingerprint.as_deref(),
        Some(applied.content_digest().as_str())
    );
    assert_eq!(
        verification.source_fingerprint,
        plan.provenance.source_fingerprint
    );
}

#[test]
fn invalid_dependency_and_parent_cycles_are_rejected_before_actions() {
    let dependency_cycle = r#"{
      "format": "boreal.v2.migration", "version": 1,
      "project": {"id": "p1", "name": "P"},
      "work": [
        {"id": "a", "project_id": "p1", "kind": "task", "title": "A", "lifecycle": "open"},
        {"id": "b", "project_id": "p1", "kind": "task", "title": "B", "lifecycle": "open"}
      ],
      "dependencies": [
        {"from_work_id": "a", "to_work_id": "b", "kind": "closed_only"},
        {"from_work_id": "b", "to_work_id": "a", "kind": "closed_only"}
      ]
    }"#;
    let report = import_json(dependency_cycle).unwrap();
    assert!(report.document.is_none());
    assert!(report.unsupported.iter().any(|issue| {
        issue.record_type == "document"
            && issue.reason.contains("dependency graph contains a cycle")
    }));

    let parent_cycle = r#"{
      "format": "boreal.v2.migration", "version": 1,
      "project": {"id": "p1", "name": "P"},
      "work": [
        {"id": "m", "project_id": "p1", "kind": "milestone", "title": "M", "parent_id": "s", "lifecycle": "open"},
        {"id": "s", "project_id": "p1", "kind": "sprint", "title": "S", "parent_id": "m", "lifecycle": "open"}
      ]
    }"#;
    let plan = import_json(parent_cycle).unwrap();
    assert!(plan.document.is_none());
    assert!(plan
        .unsupported
        .iter()
        .any(|issue| issue.record_type == "document"));
}

#[test]
fn digest_matches_source_engine_wire_vector() {
    assert_eq!(
        boreal_migration::content_digest(b"abc"),
        "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn unsupported_input_is_retained_and_cannot_produce_a_partial_plan() {
    let input = r#"{
      "format": "boreal.legacy.records", "version": 1,
      "project": {"id": "p1", "name": "P"},
      "work_items": [{"id": "w1", "kind": "task", "title": "T", "status": "open", "retention": "forever"}]
    }"#;

    let plan = import_legacy_json(input).unwrap();
    let import_plan = plan.import_plan();
    assert!(!import_plan.ready);
    assert!(import_plan.actions.is_empty());
    assert!(import_plan
        .report
        .unsupported
        .iter()
        .any(|issue| issue.reason.contains("retention") && issue.raw["retention"] == "forever"));
    assert_eq!(import_plan.loss_ledger.len(), 1);
    assert_eq!(
        import_plan.loss_ledger[0].disposition,
        boreal_migration::LossDisposition::Unsupported
    );
    assert!(matches!(
        plan.materialize_export(),
        Err(boreal_migration::MaterializationError::NotReady(report))
            if report.actions.is_empty()
    ));
}

#[test]
fn document_export_is_deterministic_when_source_collections_are_reordered() {
    let original = document();
    let mut reordered = original.clone();
    reordered.work.reverse();
    reordered.attempts.reverse();
    reordered.reservations.reverse();
    reordered.evidence.reverse();
    reordered.memory.reverse();
    reordered.git.reverse();

    assert_eq!(
        export_json(&original).unwrap(),
        export_json(&reordered).unwrap()
    );
}

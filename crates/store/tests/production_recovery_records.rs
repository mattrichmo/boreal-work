//! Focused real-SQLite tests for PF-S02-T06.
//!
//! This target is intentionally written against the coordinator-registered
//! `boreal_store::recovery` and `boreal_store::jobs` modules.  The worker does
//! not edit the protected store root, so registration and production opener
//! wiring remain an explicit integration request in the task handoff.

use boreal_store::{
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    jobs, recovery, SqliteStore,
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn store() -> SqliteStore {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
    store
        .initialize_project(
            "p1",
            "operator-1",
            "operator",
            "credential-1",
            "Operator",
            "op-init",
            "sha256:init",
            "unix-ms:0",
        )
        .expect("project initializes");
    store
        .execute_batch(
            "INSERT INTO work_item
             (work_id, project_id, kind, lifecycle, dispatch_policy,
              acceptance_profile_id, acceptance_profile_version, title,
              description, created_at, updated_at)
             VALUES ('w1', 'p1', 'task', 'open', 'automatic', 'focused', 1,
                     'Recovery work', '', 'unix-ms:0', 'unix-ms:0');
             INSERT INTO work_item
             (work_id, project_id, kind, lifecycle, dispatch_policy,
              acceptance_profile_id, acceptance_profile_version, title,
              description, created_at, updated_at)
             VALUES ('w2', 'p1', 'task', 'open', 'automatic', 'focused', 1,
                     'Second recovery work', '', 'unix-ms:0', 'unix-ms:0');
             INSERT INTO session
             (session_id, actor_id, harness_id, state, started_at, ended_at)
             VALUES ('session-1', 'operator-1', 'harness-1', 'active', 'unix-ms:0', NULL);
             INSERT INTO attempt
             (attempt_id, work_id, actor_id, harness_id, session_id, fence,
              current, state, claimed_at, accepted_at, lease_deadline,
              max_attempt_deadline, review_required_after_expiry,
              config_identity, binary_identity, protocol_version, schema_version)
             VALUES ('a1', 'w1', 'operator-1', 'harness-1', 'session-1', 1,
                     1, 'running', 'unix-ms:0', 'unix-ms:0', 'unix-ms:2000',
                     'unix-ms:4000', 1, 'config-1', 'binary-1',
                     'boreal.protocol/2', 2);",
        )
        .expect("fixture rows insert");
    recovery::ensure_recovery_schema(&store).expect("recovery schema installs");
    jobs::ensure_external_job_schema(&store).expect("job schema installs");
    store
}

fn obligation(id: &str) -> recovery::RecoveryObligationInput {
    recovery::RecoveryObligationInput {
        obligation_id: id.to_owned(),
        project_id: "p1".to_owned(),
        work_id: "w1".to_owned(),
        attempt_id: Some("a1".to_owned()),
        fence: Some(1),
        reason: "expired".to_owned(),
        resource_state: "unknown".to_owned(),
        owner_actor_id: Some("operator-1".to_owned()),
        next_action: "reconcile_stop".to_owned(),
        created_at: format!("unix-ms:{id}"),
    }
}

fn bound_context(store: &SqliteStore) -> boreal_store::identity::IdentityContext {
    let identities = IdentityStore::new(store);
    identities
        .install(
            &DatabaseIdentity::new("database-1", 1).expect("valid database identity"),
            "unix-ms:1",
        )
        .expect("identity schema installs");
    identities
        .bind_project(
            "p1",
            &WorkspaceBinding::new(
                "/tmp/boreal-recovery",
                "/tmp/boreal-recovery",
                "sha256:recovery-binding",
            )
            .expect("valid workspace binding"),
            "unix-ms:2",
        )
        .expect("project binds")
}

fn job(id: &str) -> jobs::ExternalJobInput {
    jobs::ExternalJobInput {
        job_id: id.to_owned(),
        operation_id: format!("op-{id}"),
        project_id: "p1".to_owned(),
        subject_type: "work".to_owned(),
        subject_id: "w1".to_owned(),
        kind: "verifier".to_owned(),
        request_digest: format!("sha256:{id}"),
        source_identity: Some("source-1".to_owned()),
        config_identity: Some("config-1".to_owned()),
        actor_id: "agent-1".to_owned(),
        session_id: Some("session-1".to_owned()),
        deadline: Some("unix-ms:5000".to_owned()),
        created_at: format!("unix-ms:{id}"),
    }
}

#[test]
fn cleared_current_attempt_retains_unresolved_recovery() {
    let store = store();
    store
        .execute_batch("UPDATE attempt SET current = 0, state = 'expired' WHERE attempt_id = 'a1';")
        .expect("clear current attempt");
    let record = store
        .create_recovery_obligation(&obligation("ob-1"))
        .expect("obligation persists after current pointer clears");
    assert!(!record.state.eq("resolved"));
    assert_eq!(
        store
            .list_unresolved_recovery_obligations("p1", None, 10)
            .unwrap()
            .iter()
            .map(|item| item.obligation_id.as_str())
            .collect::<Vec<_>>(),
        vec!["ob-1"]
    );
}

#[test]
fn duplicate_live_work_session_and_resource_ownership_is_rejected() {
    let store = store();
    let duplicate_work = store.execute_batch(
        "INSERT INTO attempt
         (attempt_id, work_id, actor_id, harness_id, session_id, fence, current,
          state, claimed_at, lease_deadline, max_attempt_deadline,
          review_required_after_expiry, config_identity, binary_identity,
          protocol_version, schema_version)
         VALUES ('a2', 'w1', 'operator-1', 'harness-2', 'session-2', 2, 1,
                 'claimed', 'unix-ms:1', 'unix-ms:2000', 'unix-ms:4000', 1,
                 'config-2', 'binary-2', 'boreal.protocol/2', 2);",
    );
    assert!(
        duplicate_work.is_err(),
        "one current attempt per work is database-enforced"
    );
    let duplicate_session = store.execute_batch(
        "INSERT INTO attempt
         (attempt_id, work_id, actor_id, harness_id, session_id, fence, current,
          state, claimed_at, lease_deadline, max_attempt_deadline,
          review_required_after_expiry, config_identity, binary_identity,
          protocol_version, schema_version)
         VALUES ('a3', 'w2', 'operator-1', 'harness-3', 'session-1', 1, 1,
                 'claimed', 'unix-ms:1', 'unix-ms:2000', 'unix-ms:4000', 1,
                 'config-3', 'binary-3', 'boreal.protocol/2', 2);",
    );
    assert!(
        duplicate_session.is_err(),
        "one current execution per session is database-enforced"
    );

    store
        .reserve_resource(&recovery::ResourceReservationInput {
            reservation_id: "res-1".to_owned(),
            project_id: "p1".to_owned(),
            work_id: "w1".to_owned(),
            attempt_id: "a1".to_owned(),
            fence: 1,
            resource_key: "worktree:/tmp/w1".to_owned(),
            resource_kind: "worktree".to_owned(),
            owner_actor_id: "agent-1".to_owned(),
            created_at: "unix-ms:1".to_owned(),
        })
        .expect("first resource reservation");
    let overlap = store.reserve_resource(&recovery::ResourceReservationInput {
        reservation_id: "res-2".to_owned(),
        project_id: "p1".to_owned(),
        work_id: "w1".to_owned(),
        attempt_id: "a1".to_owned(),
        fence: 1,
        resource_key: "worktree:/tmp/w1".to_owned(),
        resource_kind: "worktree".to_owned(),
        owner_actor_id: "agent-1".to_owned(),
        created_at: "unix-ms:2".to_owned(),
    });
    assert!(
        overlap.is_err(),
        "live resource overlap must not be reassigned"
    );
}

#[test]
fn crash_after_external_effect_requires_readback_and_replays_idempotently() {
    let store = store();
    let input = job("job-1");
    let first = store.register_external_job(&input).expect("register job");
    assert!(!first.replayed);
    store
        .advance_external_job(&jobs::ExternalJobTransitionInput {
            project_id: "p1".to_owned(),
            job_id: "job-1".to_owned(),
            expected_stage: "registered".to_owned(),
            next_stage: "admitted".to_owned(),
            at: "unix-ms:1".to_owned(),
            side_effect_ref: None,
            result_digest: None,
            error_message: None,
        })
        .unwrap();
    store
        .advance_external_job(&jobs::ExternalJobTransitionInput {
            project_id: "p1".to_owned(),
            job_id: "job-1".to_owned(),
            expected_stage: "admitted".to_owned(),
            next_stage: "running".to_owned(),
            at: "unix-ms:2".to_owned(),
            side_effect_ref: None,
            result_digest: None,
            error_message: None,
        })
        .unwrap();
    let pending = store
        .advance_external_job(&jobs::ExternalJobTransitionInput {
            project_id: "p1".to_owned(),
            job_id: "job-1".to_owned(),
            expected_stage: "running".to_owned(),
            next_stage: "side_effect_started".to_owned(),
            at: "unix-ms:3".to_owned(),
            side_effect_ref: Some("verifier-run-1".to_owned()),
            result_digest: None,
            error_message: None,
        })
        .unwrap();
    assert_eq!(pending.stage, "side_effect_started");
    let readback = store
        .mark_external_job_readback_required("p1", "job-1", "verifier-run-1", "unix-ms:4")
        .unwrap();
    assert_eq!(readback.stage, "readback_required");
    let replay = store
        .register_external_job(&input)
        .expect("same request replays");
    assert!(replay.replayed);
    assert_eq!(replay.job.stage, "readback_required");
    let conflict = store.register_external_job(&jobs::ExternalJobInput {
        request_digest: "sha256:changed".to_owned(),
        ..input
    });
    assert!(
        conflict.is_err(),
        "same operation with changed payload is a conflict"
    );
}

#[test]
fn terminal_attempt_and_recovery_decisions_are_retained() {
    let store = store();
    store
        .create_recovery_obligation(&obligation("ob-1"))
        .unwrap();
    let resolved = store
        .resolve_recovery_obligation(&recovery::RecoveryResolutionInput {
            project_id: "p1".to_owned(),
            obligation_id: "ob-1".to_owned(),
            resolution_id: "decision-1".to_owned(),
            actor_id: "operator-1".to_owned(),
            outcome: "stopped".to_owned(),
            reason: "process group confirmed stopped".to_owned(),
            resource_state: "released".to_owned(),
            at: "unix-ms:5".to_owned(),
        })
        .unwrap();
    assert_eq!(resolved.state, "resolved");
    assert_eq!(resolved.resolution_id.as_deref(), Some("decision-1"));
    let history = store.recovery_decisions("p1", "ob-1", 10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].reason, "process group confirmed stopped");
}

#[test]
fn identity_bound_recovery_resolution_is_revisioned_audited_and_idempotent() {
    let store = store();
    let context = bound_context(&store);
    store
        .create_recovery_obligation(&obligation("ob-bound"))
        .expect("obligation persists");
    let expected_revision = store.project_revision("p1").unwrap().0;
    let input = recovery::IdentityBoundRecoveryResolutionInput {
        context: context.clone(),
        operation_id: "op-recovery-resolve".to_owned(),
        request_digest: "sha256:recovery-resolution".to_owned(),
        expected_project_revision: Some(expected_revision),
        session_id: Some("session-1".to_owned()),
        resolution: recovery::RecoveryResolutionInput {
            project_id: "p1".to_owned(),
            obligation_id: "ob-bound".to_owned(),
            resolution_id: "decision-bound".to_owned(),
            actor_id: "operator-1".to_owned(),
            outcome: "stopped".to_owned(),
            reason: "process group confirmed stopped".to_owned(),
            resource_state: "released".to_owned(),
            at: "unix-ms:5".to_owned(),
        },
    };

    let first = store
        .resolve_recovery_obligation_with_identity(&input)
        .expect("identity-bound resolution commits");
    assert!(!first.replayed);
    assert_eq!(first.obligation.state, "resolved");
    assert_eq!(
        first.operation.operation.as_ref().unwrap().revision,
        expected_revision + 1
    );
    assert_eq!(
        store.project_revision("p1").unwrap().0,
        expected_revision + 1
    );
    assert_eq!(
        store
            .audit_event("op-recovery-resolve")
            .unwrap()
            .unwrap()
            .subject_id,
        "op-recovery-resolve"
    );

    let replay = store
        .resolve_recovery_obligation_with_identity(&input)
        .expect("exact operation replay is idempotent");
    assert!(replay.replayed);
    assert_eq!(replay.obligation, first.obligation);
    assert_eq!(
        store.project_revision("p1").unwrap().0,
        expected_revision + 1
    );
    assert_eq!(
        store
            .recovery_decisions("p1", "ob-bound", 10)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn identity_bound_recovery_resolution_rejects_stale_revision_and_fence() {
    let store = store();
    let context = bound_context(&store);
    store
        .create_recovery_obligation(&obligation("ob-stale"))
        .expect("obligation persists");
    let initial_revision = store.project_revision("p1").unwrap().0;
    let input = recovery::IdentityBoundRecoveryResolutionInput {
        context,
        operation_id: "op-recovery-stale".to_owned(),
        request_digest: "sha256:recovery-stale".to_owned(),
        expected_project_revision: Some(99),
        session_id: Some("session-1".to_owned()),
        resolution: recovery::RecoveryResolutionInput {
            project_id: "p1".to_owned(),
            obligation_id: "ob-stale".to_owned(),
            resolution_id: "decision-stale".to_owned(),
            actor_id: "operator-1".to_owned(),
            outcome: "stopped".to_owned(),
            reason: "stale revision must not resolve".to_owned(),
            resource_state: "released".to_owned(),
            at: "unix-ms:6".to_owned(),
        },
    };
    let stale_error = store.resolve_recovery_obligation_with_identity(&input);
    match stale_error {
        Err(boreal_store::StoreError::StaleRevision { expected, actual }) => {
            assert_eq!(expected, 99);
            assert_eq!(actual, initial_revision);
        }
        other => panic!("expected stale revision, got {other:?}"),
    }
    assert_eq!(store.project_revision("p1").unwrap().0, initial_revision);
    assert_eq!(
        store
            .recovery_obligation("p1", "ob-stale")
            .unwrap()
            .unwrap()
            .state,
        "unresolved"
    );

    store
        .execute_batch(
            "UPDATE boreal_recovery_obligation SET fence = 2
             WHERE obligation_id = 'ob-stale';",
        )
        .expect("test corrupts the persisted fence");
    let mut fence_input = input;
    fence_input.expected_project_revision = Some(initial_revision);
    assert!(matches!(
        store.resolve_recovery_obligation_with_identity(&fence_input),
        Err(boreal_store::StoreError::StaleFence {
            expected: 2,
            actual: 1
        })
    ));
    assert!(!store.operation_exists("op-recovery-stale").unwrap());
}

#[test]
fn unresolved_and_job_queries_are_bounded_and_cursorable() {
    let store = store();
    for id in ["ob-1", "ob-2", "ob-3"] {
        store.create_recovery_obligation(&obligation(id)).unwrap();
    }
    let first = store
        .list_unresolved_recovery_obligations("p1", None, 2)
        .unwrap();
    assert_eq!(first.len(), 2);
    let next = store
        .list_unresolved_recovery_obligations(
            "p1",
            first.last().map(|r| r.obligation_id.as_str()),
            2,
        )
        .unwrap();
    assert_eq!(next.len(), 1);

    for id in ["job-1", "job-2", "job-3"] {
        store.register_external_job(&job(id)).unwrap();
    }
    let jobs = store.list_external_jobs("p1", None, 2).unwrap();
    assert_eq!(jobs.len(), 2);
    assert!(store.list_external_jobs("p1", None, 501).is_err());
}

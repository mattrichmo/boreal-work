//! Focused real-SQLite tests for PF-S02-T06.
//!
//! This target is intentionally written against the coordinator-registered
//! `boreal_store::recovery` and `boreal_store::jobs` modules.  The worker does
//! not edit the protected store root, so registration and production opener
//! wiring remain an explicit integration request in the task handoff.

use boreal_store::{
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    jobs, recovery, AttemptMutationKind, AttemptMutationRequest, SqliteStore,
};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

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
            "INSERT OR IGNORE INTO acceptance_profile
             (profile_id, version, policy_digest, definition_json, created_at)
             VALUES ('focused', 1, 'sha256:focused', '{}', 'unix-ms:0');
             INSERT INTO work_item
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

fn production_file_store(path: &Path) -> SqliteStore {
    let store = SqliteStore::open(path, PRODUCTION_SCHEMA).expect("production database opens");
    store
        .create_project("p1", "unix-ms:0")
        .expect("project creates");
    store
        .ensure_actor(
            "operator-1",
            "operator",
            "credential-1",
            "Operator",
            "unix-ms:0",
        )
        .expect("actor creates");
    store
        .execute_batch(
            "INSERT INTO acceptance_profile
             (profile_id, version, policy_digest, definition_json, created_at)
             VALUES ('focused', 1, 'sha256:focused', '{}', 'unix-ms:0');
             INSERT INTO work_item
             (work_id, project_id, kind, lifecycle, dispatch_policy,
              acceptance_profile_id, acceptance_profile_version, title,
              description, created_at, updated_at)
             VALUES ('w1', 'p1', 'task', 'open', 'automatic', 'focused', 1,
                     'Restart recovery work', '', 'unix-ms:0', 'unix-ms:0');
             INSERT INTO session
             (session_id, actor_id, harness_id, state, started_at, ended_at)
             VALUES ('session-1', 'operator-1', 'harness-1', 'unknown', 'unix-ms:0', NULL);
             INSERT INTO attempt
             (attempt_id, work_id, actor_id, harness_id, session_id, fence,
              current, state, claimed_at, accepted_at, lease_deadline,
              max_attempt_deadline, review_required_after_expiry,
              config_identity, binary_identity, protocol_version, schema_version)
             VALUES ('a1', 'w1', 'operator-1', 'harness-1', 'session-1', 1,
                     0, 'expired', 'unix-ms:0', 'unix-ms:0', 'unix-ms:2000',
                     'unix-ms:4000', 1, 'config-1', 'binary-1',
                     'boreal.protocol/2', 2);",
        )
        .expect("restart fixture rows insert");
    store
}

#[test]
fn canonical_recovery_mutations_require_operation_identity() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "boreal-recovery-identity-guard-{}-{suffix}.sqlite",
        std::process::id()
    ));
    let store = production_file_store(&path);

    let create = store.create_recovery_obligation(&obligation("ob-guard"));
    assert!(matches!(
        create,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("authenticated operation identity")
    ));
    let resolve = store.resolve_recovery_obligation(&recovery::RecoveryResolutionInput {
        project_id: "p1".to_owned(),
        obligation_id: "ob-guard".to_owned(),
        resolution_id: "decision-guard".to_owned(),
        actor_id: "operator-1".to_owned(),
        outcome: "stopped".to_owned(),
        reason: "unbound resolution must be rejected".to_owned(),
        resource_state: "unknown".to_owned(),
        at: "unix-ms:2".to_owned(),
    });
    assert!(matches!(
        resolve,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("authenticated operation identity")
    ));
    let reserve = store.reserve_resource(&recovery::ResourceReservationInput {
        reservation_id: "res-guard".to_owned(),
        project_id: "p1".to_owned(),
        work_id: "w1".to_owned(),
        attempt_id: "a1".to_owned(),
        fence: 1,
        resource_key: "worktree:/tmp/guard".to_owned(),
        resource_kind: "worktree".to_owned(),
        owner_actor_id: "operator-1".to_owned(),
        created_at: "unix-ms:2".to_owned(),
    });
    assert!(matches!(
        reserve,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("authenticated operation identity")
    ));
    let request_release = store.request_resource_release(
        "p1",
        "resource:a1",
        "release-request-guard",
        "operator-1",
        "caller-supplied-evidence",
        "unix-ms:2",
    );
    assert!(matches!(
        request_release,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("authenticated operation identity")
    ));
    let acknowledge_release = store.acknowledge_resource_release(
        "p1",
        "resource:a1",
        "release-ack-guard",
        "operator-1",
        "caller-supplied-evidence",
        "unix-ms:2",
    );
    assert!(matches!(
        acknowledge_release,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("authenticated operation identity")
    ));
    assert!(store
        .list_unresolved_recovery_obligations("p1", None, 10)
        .unwrap()
        .is_empty());
    assert!(store
        .resource_reservation("p1", "res-guard")
        .unwrap()
        .is_none());

    drop(store);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
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
fn canonical_expiry_mutation_persists_recovery_before_clearing_current() {
    let store = store();
    let result = store
        .apply_attempt_mutation(&AttemptMutationRequest {
            project_id: "p1".to_owned(),
            work_id: "w1".to_owned(),
            attempt_id: "a1".to_owned(),
            actor_id: "operator-1".to_owned(),
            harness_id: Some("harness-1".to_owned()),
            session_id: Some("session-1".to_owned()),
            fence: 1,
            operation_id: "op-expire-recovery".to_owned(),
            request_digest: "sha256:op-expire-recovery".to_owned(),
            at: "unix-ms:4000".to_owned(),
            expected_project_revision: None,
            expected_work_revision: None,
            expected_attempt_revision: None,
            expected_phase: Some(boreal_domain::AttemptPhase::Running),
            expected_lease_deadline: None,
            expected_hard_deadline: None,
            mutation: AttemptMutationKind::Expire {
                stop_confirmed: true,
            },
            reason: Some("runtime stopped after hard deadline".to_owned()),
        })
        .expect("canonical expiry commits");
    assert_eq!(result.phase, boreal_domain::AttemptPhase::Expired);
    assert!(matches!(
        store.current_attempt("p1", "a1"),
        Err(boreal_store::StoreError::NotFound { .. })
    ));
    let obligations = store
        .list_unresolved_recovery_obligations("p1", None, 10)
        .expect("expiry recovery reads back");
    assert_eq!(obligations.len(), 1);
    assert_eq!(obligations[0].attempt_id.as_deref(), Some("a1"));
    assert_eq!(obligations[0].reason, "expired");
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
    let guessed_failure = store.advance_external_job(&jobs::ExternalJobTransitionInput {
        project_id: "p1".to_owned(),
        job_id: "job-1".to_owned(),
        expected_stage: "readback_required".to_owned(),
        next_stage: "failed".to_owned(),
        at: "unix-ms:4.5".to_owned(),
        side_effect_ref: Some("verifier-run-1".to_owned()),
        result_digest: None,
        error_message: Some("assumed failed after timeout".to_owned()),
    });
    assert!(matches!(
        guessed_failure,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("illegal external job transition")
    ));
    assert_eq!(
        store.external_job("p1", "job-1").unwrap().unwrap().stage,
        "readback_required",
        "an unknown external result must remain pending until attributable readback"
    );
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
fn readback_marker_is_retry_safe_after_finished_effect_and_preserves_identity() {
    let store = store();
    let input = job("job-finished");
    store.register_external_job(&input).expect("register job");
    for (from, to, side_effect_ref) in [
        ("registered", "admitted", None),
        ("admitted", "running", None),
        ("running", "side_effect_started", Some("verifier-run-2")),
        (
            "side_effect_started",
            "side_effect_finished",
            Some("verifier-run-2"),
        ),
    ] {
        store
            .advance_external_job(&jobs::ExternalJobTransitionInput {
                project_id: "p1".to_owned(),
                job_id: "job-finished".to_owned(),
                expected_stage: from.to_owned(),
                next_stage: to.to_owned(),
                at: format!("unix-ms:{to}"),
                side_effect_ref: side_effect_ref.map(str::to_owned),
                result_digest: None,
                error_message: None,
            })
            .expect("effect transition");
    }
    let first = store
        .mark_external_job_readback_required("p1", "job-finished", "verifier-run-2", "unix-ms:5")
        .expect("mark finished effect for readback");
    let replay = store
        .mark_external_job_readback_required("p1", "job-finished", "verifier-run-2", "unix-ms:6")
        .expect("repeat readback marker");
    assert_eq!(replay, first, "retry must read back the original marker");
    assert!(matches!(
        store.advance_external_job(&jobs::ExternalJobTransitionInput {
            project_id: "p1".to_owned(),
            job_id: "job-finished".to_owned(),
            expected_stage: "readback_required".to_owned(),
            next_stage: "reconciled".to_owned(),
            at: "unix-ms:7".to_owned(),
            side_effect_ref: Some("different-effect".to_owned()),
            result_digest: Some("sha256:result".to_owned()),
            error_message: None,
        }),
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("side-effect identity")
    ));
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
            resource_state: "unknown".to_owned(),
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
fn resource_release_requires_acknowledgement_and_is_retry_safe() {
    let store = store();
    store
        .reserve_resource(&recovery::ResourceReservationInput {
            reservation_id: "res-ack".to_owned(),
            project_id: "p1".to_owned(),
            work_id: "w1".to_owned(),
            attempt_id: "a1".to_owned(),
            fence: 1,
            resource_key: "worktree:/tmp/ack".to_owned(),
            resource_kind: "worktree".to_owned(),
            owner_actor_id: "agent-1".to_owned(),
            created_at: "unix-ms:1".to_owned(),
        })
        .expect("resource reserves");
    let pending = store
        .request_resource_release(
            "p1",
            "res-ack",
            "release-request-1",
            "operator-1",
            "stop-request-1",
            "unix-ms:2",
        )
        .expect("release request persists");
    assert_eq!(pending.state, "release_pending");
    assert_eq!(
        store.list_live_resources("p1", None, 10).unwrap().len(),
        1,
        "unacknowledged resources remain unavailable"
    );
    let pending_replay = store
        .request_resource_release(
            "p1",
            "res-ack",
            "release-request-1",
            "operator-1",
            "stop-request-1",
            "unix-ms:3",
        )
        .expect("duplicate release request reads back");
    assert_eq!(pending_replay, pending);
    let released = store
        .acknowledge_resource_release(
            "p1",
            "res-ack",
            "release-ack-1",
            "operator-1",
            "process-stopped-1",
            "unix-ms:4",
        )
        .expect("release acknowledgement persists");
    assert_eq!(released.state, "released");
    assert_eq!(released.release_ack_id.as_deref(), Some("release-ack-1"));
    let ack_replay = store
        .acknowledge_resource_release(
            "p1",
            "res-ack",
            "release-ack-1",
            "operator-1",
            "process-stopped-1",
            "unix-ms:5",
        )
        .expect("duplicate acknowledgement reads back");
    assert_eq!(ack_replay, released);
    assert!(store
        .list_live_resources("p1", None, 10)
        .unwrap()
        .is_empty());
}

#[test]
fn released_recovery_resolution_acknowledges_exact_bound_resource() {
    let store = store();
    store
        .reserve_resource(&recovery::ResourceReservationInput {
            reservation_id: "resource:a1".to_owned(),
            project_id: "p1".to_owned(),
            work_id: "w1".to_owned(),
            attempt_id: "a1".to_owned(),
            fence: 1,
            resource_key: "work:p1:w1".to_owned(),
            resource_kind: "execution_worktree".to_owned(),
            owner_actor_id: "operator-1".to_owned(),
            created_at: "unix-ms:1".to_owned(),
        })
        .expect("canonical resource reserves");
    store
        .request_resource_release(
            "p1",
            "resource:a1",
            "op-terminal:resource-release",
            "operator-1",
            "attempt-terminal:a1:1",
            "unix-ms:2",
        )
        .expect("terminal release request persists");
    store
        .create_recovery_obligation(&obligation("ob-release-bound"))
        .expect("bound recovery obligation persists");
    let context = bound_context(&store);

    let unbound_ack = store.acknowledge_resource_release(
        "p1",
        "resource:a1",
        "release-ack-unbound",
        "operator-1",
        "caller-supplied-evidence",
        "unix-ms:3",
    );
    assert!(matches!(
        unbound_ack,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("authenticated operation identity")
    ));
    assert_eq!(
        store
            .resource_reservation("p1", "resource:a1")
            .unwrap()
            .unwrap()
            .state,
        "release_pending"
    );

    let plain = store.resolve_recovery_obligation(&recovery::RecoveryResolutionInput {
        project_id: "p1".to_owned(),
        obligation_id: "ob-release-bound".to_owned(),
        resolution_id: "decision-plain-release".to_owned(),
        actor_id: "operator-1".to_owned(),
        outcome: "stopped".to_owned(),
        reason: "plain resolution must not acknowledge a resource".to_owned(),
        resource_state: "released".to_owned(),
        at: "unix-ms:3".to_owned(),
    });
    assert!(matches!(
        plain,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("identity-bound")
    ));
    assert_eq!(
        store
            .recovery_obligation("p1", "ob-release-bound")
            .unwrap()
            .unwrap()
            .state,
        "unresolved"
    );

    let input = recovery::IdentityBoundRecoveryResolutionInput {
        context: context.clone(),
        operation_id: "op-bound-resource-release".to_owned(),
        request_digest: "sha256:bound-resource-release".to_owned(),
        expected_project_revision: Some(store.project_revision("p1").unwrap().0),
        session_id: Some("session-1".to_owned()),
        resolution: recovery::RecoveryResolutionInput {
            project_id: "p1".to_owned(),
            obligation_id: "ob-release-bound".to_owned(),
            resolution_id: "decision-bound-resource-release".to_owned(),
            actor_id: "operator-1".to_owned(),
            outcome: "stopped".to_owned(),
            reason: "runtime stop was independently confirmed".to_owned(),
            resource_state: "released".to_owned(),
            at: "unix-ms:4".to_owned(),
        },
    };
    let first = store
        .resolve_recovery_obligation_with_identity(&input)
        .expect("authenticated release acknowledges the bound resource");
    assert!(!first.replayed);
    assert_eq!(first.obligation.state, "resolved");
    assert_eq!(first.obligation.resource_state, "released");
    let resource = store
        .resource_reservation("p1", "resource:a1")
        .unwrap()
        .unwrap();
    assert_eq!(resource.state, "released");
    assert_eq!(
        resource.release_ack_id.as_deref(),
        Some("resource:a1:release-ack:decision-bound-resource-release")
    );
    assert!(store
        .list_live_resources("p1", None, 10)
        .unwrap()
        .is_empty());

    let replay = store
        .resolve_recovery_obligation_with_identity(&input)
        .expect("exact authenticated resolution replays");
    assert!(replay.replayed);
    assert_eq!(replay.obligation, first.obligation);
    assert_eq!(
        store
            .recovery_decisions("p1", "ob-release-bound", 10)
            .unwrap()
            .len(),
        1
    );

    let mut foreign_reservation = input;
    foreign_reservation.operation_id = "op-bound-resource-release-foreign".to_owned();
    foreign_reservation.request_digest = "sha256:bound-resource-release-foreign".to_owned();
    foreign_reservation.resolution.resolution_id =
        "decision-bound-resource-release-foreign".to_owned();
    foreign_reservation.resolution.project_id = "foreign-project".to_owned();
    assert!(matches!(
        store.resolve_recovery_obligation_with_identity(&foreign_reservation),
        Err(boreal_store::StoreError::WrongSubject { .. })
    ));
}

#[test]
fn unresolved_recovery_survives_production_restart() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "boreal-production-recovery-{}-{suffix}.sqlite",
        std::process::id()
    ));
    {
        let store = production_file_store(&path);
        store
            .execute_batch(
                "INSERT INTO boreal_recovery_obligation
                 (obligation_id, project_id, work_id, attempt_id, fence, reason,
                  state, resource_state, owner_actor_id, next_action, created_at)
                 VALUES ('ob-restart', 'p1', 'w1', 'a1', 1, 'expired',
                         'unresolved', 'unknown', 'operator-1',
                         'reconcile_stop', 'unix-ms:1');",
            )
            .expect("fixture seeds an unresolved obligation before crash");
    }
    let reopened = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("production restarts");
    let obligations = reopened
        .list_unresolved_recovery_obligations("p1", None, 10)
        .expect("restart reads unresolved recovery");
    assert_eq!(obligations.len(), 1);
    assert_eq!(obligations[0].obligation_id, "ob-restart");
    assert_eq!(obligations[0].resource_state, "unknown");
    assert!(matches!(
        reopened.current_attempt("p1", "a1"),
        Err(boreal_store::StoreError::NotFound { .. })
    ));
    drop(reopened);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

#[test]
fn identity_bound_recovery_resolution_is_revisioned_audited_and_idempotent() {
    let store = store();
    store
        .create_recovery_obligation(&obligation("ob-bound"))
        .expect("obligation persists");
    let context = bound_context(&store);
    assert!(matches!(
        store.create_recovery_obligation(&obligation("ob-after-bind")),
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("authenticated operation identity")
    ));
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
            resource_state: "unknown".to_owned(),
            at: "unix-ms:5".to_owned(),
        },
    };

    let unbound = store.resolve_recovery_obligation(&input.resolution);
    assert!(matches!(
        unbound,
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("authenticated operation identity")
    ));
    assert_eq!(
        store
            .recovery_obligation("p1", "ob-bound")
            .unwrap()
            .unwrap()
            .state,
        "unresolved"
    );

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
    store
        .create_recovery_obligation(&obligation("ob-stale"))
        .expect("obligation persists");
    let context = bound_context(&store);
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

use boreal_application::{
    project_status, status_input, DependencyInput, GateReason, StatusWorkInput,
};
use boreal_domain::{
    ActorContext, ActorId, ActorRole, Attempt, DeadlineSource, Fence, GateId, GateRequirement,
    Revision, TimestampMs, WorkItem,
};
use boreal_store::{GateStateUpdateRequest, ProjectStatusRead, SqliteStore, StatusWorkRecord};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn actor() -> ActorContext {
    ActorContext {
        actor_id: ActorId::new("agent"),
        role: ActorRole::Agent,
    }
}

fn work(id: &str) -> WorkItem {
    WorkItem::new(
        "p".into(),
        id.into(),
        boreal_domain::WorkKind::Task,
        None,
        id,
    )
    .open()
}

fn timestamp(value: &str) -> TimestampMs {
    value
        .strip_prefix("unix-ms:")
        .expect("canonical test timestamp")
        .parse::<u64>()
        .map(TimestampMs)
        .expect("numeric test timestamp")
}

fn status_input_from_row(row: &StatusWorkRecord) -> StatusWorkInput {
    let mut input = status_input(row.work.clone());
    input.retry_not_before = row.retry_not_before.as_deref().map(timestamp);
    input.gates = row
        .gate_diagnostics
        .gates
        .iter()
        .map(|gate| GateRequirement {
            id: gate.gate_id.clone().into(),
            kind: gate.kind,
            required: gate.required,
            state: gate.state,
        })
        .collect();
    input.gate_reasons = row
        .gate_diagnostics
        .gates
        .iter()
        .filter(|gate| gate.receipt_id.is_some() || gate.reason.is_some())
        .map(|gate| GateReason {
            gate_id: gate.gate_id.clone().into(),
            receipt_id: gate.receipt_id.clone(),
            reason: gate.reason.clone(),
        })
        .collect();
    input.current_attempt = row.current_attempt.as_ref().map(|attempt| Attempt {
        work_id: attempt.work_id.clone().into(),
        attempt_id: attempt.attempt_id.clone().into(),
        actor_id: attempt.actor_id.clone().into(),
        harness_id: attempt.harness_id.clone().map(Into::into),
        session_id: attempt.session_id.clone().map(Into::into),
        fence: Fence::new(attempt.fence),
        phase: attempt.phase,
        claimed_at: timestamp(&attempt.claimed_at),
        accepted_at: attempt.accepted_at.as_deref().map(timestamp),
        lease_deadline: timestamp(&attempt.lease_deadline),
        max_attempt_deadline: timestamp(&attempt.hard_deadline),
        deadline_source: DeadlineSource::Explicit,
        last_heartbeat_at: attempt.last_heartbeat_at.as_deref().map(timestamp),
        last_checkpoint_at: attempt.last_checkpoint_at.as_deref().map(timestamp),
        review_required_after_expiry: attempt.review_required_after_expiry,
    });
    input
}

fn store_status_inputs(
    snapshot: &ProjectStatusRead,
) -> (Vec<StatusWorkInput>, Vec<DependencyInput>) {
    let inputs = snapshot.works.iter().map(status_input_from_row).collect();
    let dependencies = snapshot
        .dependencies
        .iter()
        .map(|edge| {
            DependencyInput::close_only(edge.prerequisite_id.clone(), edge.dependent_id.clone())
        })
        .collect();
    (inputs, dependencies)
}

#[test]
fn application_projection_is_revisioned_and_preserves_gate_reason() {
    let mut input = status_input(work("w1"));
    input.gate_reasons.push(GateReason {
        gate_id: GateId::new("checkpoint"),
        receipt_id: Some("r1".into()),
        reason: Some("rejected".into()),
    });
    let snapshot = project_status(
        &"p".into(),
        &actor(),
        TimestampMs(123),
        Revision(8),
        &[input],
        &[],
        10,
        0,
    )
    .unwrap();
    assert_eq!(snapshot.contract_version, "boreal.work-status/2");
    assert_eq!(snapshot.project_revision, Revision(8));
    assert_eq!(snapshot.as_of, TimestampMs(123));
    assert_eq!(
        snapshot.items[0].gates.gates[0].reason.as_deref(),
        Some("rejected")
    );
}

#[test]
fn pagination_does_not_change_rollup_counts() {
    let inputs = [status_input(work("a")), status_input(work("b"))];
    let snapshot = project_status(
        &"p".into(),
        &actor(),
        TimestampMs(1),
        Revision(2),
        &inputs,
        &[DependencyInput::close_only("a".into(), "b".into())],
        1,
        1,
    )
    .unwrap();
    assert_eq!(snapshot.total, 2);
    assert_eq!(snapshot.items.len(), 1);
    assert_eq!(snapshot.counts.total, 2);
    assert_eq!(snapshot.counts.queued, 1);
}

#[test]
fn persisted_store_rows_feed_revisioned_status_projection() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    store
        .initialize_project(
            "p",
            "agent",
            "agent",
            "credential",
            "Agent",
            "op-init",
            "sha256:op-init",
            "unix-ms:0",
        )
        .unwrap();
    for id in ["a", "b"] {
        store
            .create_work_operation(
                &work(id),
                "agent",
                &format!("op-{id}"),
                &format!("sha256:op-{id}"),
                "unix-ms:1",
            )
            .unwrap();
    }
    store
        .add_dependency_operation(
            "p",
            "a",
            "b",
            "agent",
            "op-edge",
            "sha256:op-edge",
            "unix-ms:2",
        )
        .unwrap();
    store
        .claim_work(
            "p",
            "a",
            "agent",
            "luna",
            None,
            "attempt-a",
            "op-claim",
            "sha256:op-claim",
            None,
            "unix-ms:0000000000000004",
            "unix-ms:0000000001800004",
            "unix-ms:0000000007200004",
        )
        .unwrap();
    let gate_id = store.gate_id_for_work("p", "b", "checkpoint").unwrap();
    store
        .update_gate_state(GateStateUpdateRequest {
            project_id: "p".into(),
            work_id: "b".into(),
            gate_id,
            state: boreal_domain::GateState::Failed,
            actor_id: "agent".into(),
            session_id: None,
            operation_id: "op-gate".into(),
            request_digest: "sha256:op-gate".into(),
            expected_project_revision: None,
            updated_at: "unix-ms:5".into(),
        })
        .unwrap();

    let persisted = store.read_project_status("p").unwrap();
    assert_eq!(persisted.total, 2);
    assert_eq!(persisted.works.len(), 2);
    assert!(persisted
        .works
        .iter()
        .any(|row| row.current_attempt.is_some()));
    assert!(persisted.works.iter().any(|row| {
        row.gate_diagnostics
            .gates
            .iter()
            .any(|gate| gate.state == boreal_domain::GateState::Failed)
    }));

    let (inputs, dependencies) = store_status_inputs(&persisted);
    let projected = project_status(
        &"p".into(),
        &actor(),
        TimestampMs(5),
        Revision(persisted.revision.0),
        &inputs,
        &dependencies,
        1,
        1,
    )
    .unwrap();
    assert_eq!(projected.project_revision.0, persisted.revision.0);
    assert_eq!(projected.total, persisted.total);
    assert_eq!(projected.items.len(), 1);
    assert_eq!(projected.counts.total, 2);
    assert_eq!(projected.items[0].work.id.as_str(), "b");
    assert_eq!(
        projected.items[0].dependency_blockers[0].work_id.as_str(),
        "a"
    );
}

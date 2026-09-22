//! Deterministic P2-09 guided-flow proof.
//!
//! This deliberately stays at the application/store boundary: every clock
//! value is supplied by the test harness, and every lifecycle transition is
//! made through `WorkApplication` and `SqliteAttemptAdapter`.

use boreal_application::{
    project_status_from_store, AttemptPolicy, AttemptRequest, ExpireAttemptRequest,
    SqliteAttemptAdapter, StopConfirmation, WorkApplication,
};
use boreal_domain::{
    AcceptanceProfile, ActorContext, ActorId, ActorRole, AttemptId, DispatchPolicy, Fence,
    HarnessId, OperationId, PersistedLifecycle, ProjectId, TimestampMs, WorkId, WorkItem, WorkKind,
};
#[cfg(unix)]
use boreal_service::{
    ApplicationCommandHandler, ApplicationRequest, ApplicationResponse, ApplicationRoute,
    JsonRequest,
};
use boreal_service::{BoundedWriter, OperationPhase, WriteFn};
use boreal_store::{recovery::RecoveryResolutionInput, SqliteStore};
use serde_json::{json, Value};
use std::sync::{Arc, Barrier};
use std::thread;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

#[derive(Clone, Copy)]
struct TestClock {
    now: u64,
}

impl TestClock {
    const fn new(now: u64) -> Self {
        Self { now }
    }

    const fn at(self) -> TimestampMs {
        TimestampMs(self.now)
    }

    fn stamp(self) -> String {
        format_timestamp(self.now)
    }

    const fn advance(self, delta: u64) -> Self {
        Self {
            now: self.now + delta,
        }
    }
}

fn format_timestamp(value: u64) -> String {
    // Kept as a function so all test timestamps use the store's canonical
    // representation. The returned string is constructed at each call.
    // `format!` is const-stable on the toolchain used by this package.
    format!("unix-ms:{value}")
}

fn work(project: &ProjectId, id: &str) -> WorkItem {
    WorkItem {
        id: WorkId::new(id),
        project_id: project.clone(),
        kind: WorkKind::Task,
        parent_id: None,
        title: format!("guided flow {id}"),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    }
}

#[allow(clippy::too_many_arguments)]
fn claim(
    app: &WorkApplication<'_>,
    project: &ProjectId,
    work_id: &str,
    actor: &str,
    harness: &str,
    attempt: &str,
    operation: &str,
    clock: TestClock,
    lease_ttl_ms: u64,
    hard_time_limit_ms: u64,
) -> boreal_application::OperationResult<boreal_store::ClaimResult> {
    let deadlines = AttemptPolicy::default()
        .deadlines(clock.at(), Some(lease_ttl_ms), Some(hard_time_limit_ms))
        .expect("fixture deadlines are valid");
    app.claim(
        project,
        work_id,
        actor,
        harness,
        None,
        attempt,
        operation,
        &format!("sha256:{operation}"),
        None,
        &clock.stamp(),
        &format_timestamp(deadlines.lease_deadline.as_millis()),
        &format_timestamp(deadlines.hard_deadline.as_millis()),
    )
    .expect("distinct work item is claimable")
}

#[allow(clippy::too_many_arguments)]
fn request(
    project: &ProjectId,
    work_id: &str,
    attempt_id: &str,
    actor: &str,
    harness: &str,
    fence: u64,
    operation: &str,
    clock: TestClock,
) -> AttemptRequest {
    AttemptRequest::new(
        project.clone(),
        WorkId::new(work_id),
        AttemptId::new(attempt_id),
        ActorId::new(actor),
        Some(HarnessId::new(harness)),
        None,
        Fence::new(fence),
        OperationId::new(operation),
        format!("sha256:{operation}"),
        clock.at(),
    )
}

fn status_value(store: &SqliteStore, project: &ProjectId, clock: TestClock) -> Value {
    let actor = ActorContext {
        actor_id: ActorId::new("status-reader"),
        role: ActorRole::Agent,
    };
    let snapshot = project_status_from_store(store, project, &actor, clock.at(), 100, 0)
        .expect("store-backed status projection succeeds");
    json!({
        "command": "status",
        "contract_version": snapshot.contract_version,
        "project_id": snapshot.project_id.as_str(),
        "project_revision": snapshot.project_revision.0,
        "as_of": snapshot.as_of.as_millis(),
        "total": snapshot.total,
        "items": snapshot.items.iter().map(|item| json!({
            "work_id": item.work.id.as_str(),
            "status": format!("{:?}", item.display_status()),
        })).collect::<Vec<_>>(),
    })
}

#[cfg(unix)]
struct ApplicationStatusHandler<'a> {
    store: &'a SqliteStore,
}

#[cfg(unix)]
impl ApplicationCommandHandler for ApplicationStatusHandler<'_> {
    fn handle(
        &mut self,
        request: ApplicationRequest,
    ) -> Result<ApplicationResponse, boreal_service::ProtocolError> {
        assert_eq!(request.command, "status");
        let data: Value = serde_json::from_str(&request.data).expect("route data is valid JSON");
        let project = ProjectId::new(
            data["project_id"]
                .as_str()
                .expect("status request includes project_id"),
        );
        let status = status_value(self.store, &project, TestClock::new(10));
        Ok(ApplicationResponse {
            api_version: "2".to_owned(),
            schema_version: "boreal.protocol.envelope.v1".to_owned(),
            operation_id: request.operation_id,
            data: status.to_string(),
        })
    }
}

#[test]
fn p2_guided_flow_claims_three_harnesses_and_fences_recovery() {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens in memory");
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p2-guided");
    let clock = TestClock::new(1_000);

    app.init_project(
        &project,
        "orchestrator",
        "agent",
        "cred-orchestrator",
        "P2 guided-flow test",
        &clock.stamp(),
        "op_init_guided",
    )
    .expect("project initialization succeeds");
    for actor in [
        "actor-red",
        "actor-blue",
        "actor-green",
        "actor-replacement",
        "status-reader",
    ] {
        store
            .ensure_actor(
                actor,
                "agent",
                &format!("cred-{actor}"),
                actor,
                &clock.stamp(),
            )
            .expect("test actor registration succeeds");
    }
    for (index, id) in ["w-red", "w-blue", "w-green"].iter().enumerate() {
        app.create_work_as(
            &work(&project, id),
            "orchestrator",
            &clock.stamp(),
            format!("op_create_{index}"),
        )
        .unwrap_or_else(|error| panic!("work creation {id} failed: {error}"));
    }

    // Three independent harness/actor pairs claim three distinct work items.
    let red = claim(
        &app,
        &project,
        "w-red",
        "actor-red",
        "harness-red",
        "attempt-red-1",
        "op_claim_red",
        clock,
        100,
        500,
    );
    let blue = claim(
        &app,
        &project,
        "w-blue",
        "actor-blue",
        "harness-blue",
        "attempt-blue-1",
        "op_claim_blue",
        clock,
        10,
        20,
    );
    let green = claim(
        &app,
        &project,
        "w-green",
        "actor-green",
        "harness-green",
        "attempt-green-1",
        "op_claim_green",
        clock,
        100,
        500,
    );
    assert_eq!(red.value.fence, 1);
    assert_eq!(blue.value.fence, 1);
    assert_eq!(green.value.fence, 1);

    let adapter = SqliteAttemptAdapter::new(&store);
    app.accept(
        &adapter,
        request(
            &project,
            "w-red",
            "attempt-red-1",
            "actor-red",
            "harness-red",
            1,
            "op_accept_red",
            clock.advance(1),
        ),
    )
    .expect("red attempt is accepted");
    app.start(
        &adapter,
        request(
            &project,
            "w-red",
            "attempt-red-1",
            "actor-red",
            "harness-red",
            1,
            "op_start_red",
            clock.advance(2),
        ),
    )
    .expect("red attempt starts");

    // Before expiry, a replacement claim is rejected because the active
    // reservation is still present.
    let premature_replacement = app.claim(
        &project,
        "w-blue",
        "actor-replacement",
        "harness-replacement",
        None,
        "attempt-blue-2",
        "op_claim_blue_2_premature",
        "sha256:op_claim_blue_2_premature",
        None,
        &clock.advance(5).stamp(),
        "unix-ms:1015",
        "unix-ms:1020",
    );
    assert!(
        premature_replacement.is_err(),
        "active attempts are not replaced blindly"
    );

    // An expired attempt must be explicitly stopped before its reservation
    // can be replaced, and the old fence must not mutate the replacement.
    let blue_expired = app
        .expire(
            &adapter,
            ExpireAttemptRequest {
                attempt: request(
                    &project,
                    "w-blue",
                    "attempt-blue-1",
                    "actor-blue",
                    "harness-blue",
                    1,
                    "op_expire_blue",
                    TestClock::new(1_021),
                ),
                confirmation: StopConfirmation::ReviewedSafeRecovery,
                reason: Some("test clock crossed hard deadline".to_owned()),
            },
        )
        .expect("expired attempt requires and accepts explicit recovery confirmation");
    assert_eq!(
        blue_expired.value.phase,
        boreal_domain::AttemptPhase::Expired
    );

    // The store retains the expiry obligation after fencing the old attempt;
    // replacement becomes eligible only after an explicit recovery decision.
    store
        .resolve_recovery_obligation(&RecoveryResolutionInput {
            project_id: project.as_str().to_owned(),
            obligation_id: "op_expire_blue:recovery:expired".to_owned(),
            resolution_id: "resolve_expire_blue".to_owned(),
            actor_id: "actor-blue".to_owned(),
            outcome: "runtime_stopped".to_owned(),
            reason: "the expired harness was observed stopped".to_owned(),
            resource_state: "released".to_owned(),
            at: TestClock::new(1_021).stamp(),
        })
        .expect("expiry recovery is explicitly resolved before replacement");

    let replacement = claim(
        &app,
        &project,
        "w-blue",
        "actor-replacement",
        "harness-replacement",
        "attempt-blue-2",
        "op_claim_blue_2",
        TestClock::new(1_022),
        100,
        500,
    );
    assert_eq!(replacement.value.fence, 2);
    let stale_old_attempt = app.heartbeat(
        &adapter,
        boreal_application::HeartbeatAttemptRequest {
            attempt: request(
                &project,
                "w-blue",
                "attempt-blue-1",
                "actor-blue",
                "harness-blue",
                1,
                "op_stale_blue_old_attempt",
                TestClock::new(1_023),
            ),
            liveness: boreal_application::LivenessMetadata::empty(),
        },
    );
    assert!(
        stale_old_attempt.is_err(),
        "historical expired attempts cannot be reused"
    );

    // The service recovery journal marks an in-flight dispatch unknown after
    // restart. The durable application operation is then read back by replay,
    // rather than being applied a second time.
    let green_accept = request(
        &project,
        "w-green",
        "attempt-green-1",
        "actor-green",
        "harness-green",
        1,
        "op_accept_green_recovery",
        clock.advance(3),
    );
    app.accept(&adapter, green_accept.clone())
        .expect("green acceptance is durably recorded before the simulated restart");
    let started = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let started_task = Arc::clone(&started);
    let release_task = Arc::clone(&release);
    let writer = Arc::new(BoundedWriter::new(1).expect("writer starts"));
    let writer_task = Arc::clone(&writer);
    let join = thread::spawn(move || {
        writer_task.execute(
            "op_accept_green_recovery",
            WriteFn(move || {
                started_task.wait();
                release_task.wait();
                Ok::<_, ()>(())
            }),
        )
    });
    started.wait();
    let recovery = writer.recovery();
    assert_eq!(
        recovery.get("op_accept_green_recovery").unwrap().phase(),
        OperationPhase::InFlight
    );
    let report = recovery.recover();
    assert_eq!(report.unknown, vec!["op_accept_green_recovery"]);

    let replay = app.accept(&adapter, green_accept);
    assert!(
        replay.is_ok(),
        "the durable operation is readable after restart"
    );
    let replay = replay.unwrap();
    assert!(!replay.changed);
    assert!(replay.value.replayed);
    release.wait();
    join.join().unwrap().unwrap();

    // The application-backed status projection remains deterministic and
    // revisioned after all claims and recovery fencing.
    let status = status_value(&store, &project, TestClock::new(1_023));
    assert_eq!(status["command"], "status");
    assert_eq!(status["contract_version"], "boreal.work-status/2");
    assert_eq!(status["total"], 3);
    assert_eq!(status["items"].as_array().unwrap().len(), 3);
    assert_eq!(green.value.attempt_id, "attempt-green-1");
}

#[cfg(unix)]
#[test]
fn versioned_status_request_is_served_by_application_backed_route() {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens in memory");
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p2-route");
    let clock = TestClock::new(0);
    app.init_project(
        &project,
        "route-actor",
        "agent",
        "cred-route",
        "Route test",
        &clock.stamp(),
        "op_route_init",
    )
    .expect("route project initialization succeeds");
    store
        .ensure_actor(
            "status-reader",
            "agent",
            "cred-status-reader",
            "Status reader",
            &clock.stamp(),
        )
        .expect("status reader registration succeeds");
    app.create_work_as(
        &work(&project, "w-route"),
        "route-actor",
        &clock.stamp(),
        "op_route_work",
    )
    .expect("route work creation succeeds");

    let mut route = ApplicationRoute::new(ApplicationStatusHandler { store: &store });
    let payload = json!({
        "api_version": "2",
        "schema_version": "boreal.protocol.envelope.v1",
        "operation_id": "op_route_status",
        "data": {"command": "status", "project_id": "p2-route"},
    })
    .to_string();
    let response = route
        .dispatch(JsonRequest::new("route-correlation-1", payload).unwrap())
        .expect("versioned status route succeeds");
    assert_eq!(response.request_id(), "route-correlation-1");
    let envelope: Value = serde_json::from_str(response.payload().unwrap()).unwrap();
    assert_eq!(envelope["api_version"], "2");
    assert_eq!(envelope["schema_version"], "boreal.protocol.envelope.v1");
    assert_eq!(envelope["operation_id"], "op_route_status");
    assert_eq!(envelope["data"]["contract_version"], "boreal.work-status/2");
    assert_eq!(envelope["data"]["project_id"], "p2-route");
    assert_eq!(envelope["data"]["total"], 1);
}

//! Store-boundary M02 regression candidates. No service E2E claim is made by
//! these unit/integration vectors. Every claim goes through the actual store.
use boreal_domain::{DispatchPolicy, ReasonCode, WorkItem, WorkKind};
use boreal_store::{ClaimResult, SqliteStore, StoreError, WorkHoldAddInput};
use std::sync::{Arc, Barrier};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn initialize(store: &SqliteStore) {
    store
        .initialize_project(
            "p",
            "agent",
            "agent",
            "cred-agent",
            "Agent",
            "init",
            "digest:init",
            "unix-ms:0",
        )
        .unwrap();
    for role in ["operator", "reviewer"] {
        store
            .ensure_actor(role, role, &format!("cred:{role}"), role, "unix-ms:0")
            .unwrap();
    }
}

fn setup() -> SqliteStore {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    initialize(&store);
    store
}

fn put(store: &SqliteStore, id: &str, policy: DispatchPolicy, held: bool) {
    let mut item = WorkItem::new("p".into(), id.into(), WorkKind::Task, None, id).open();
    item.dispatch_policy = policy;
    if held {
        item.hard_holds
            .push(ReasonCode::HardHold("security_hold".into()));
    }
    store
        .create_work_operation(
            &item,
            "agent",
            &format!("create:{id}"),
            &format!("digest:create:{id}"),
            "unix-ms:1",
        )
        .unwrap();
}

fn claim(
    store: &SqliteStore,
    work: &str,
    actor: &str,
    operation: &str,
    now: u64,
) -> Result<ClaimResult, StoreError> {
    store.claim_work(
        "p",
        work,
        actor,
        "harness",
        None,
        &format!("attempt:{operation}"),
        operation,
        &format!("digest:{operation}"),
        None,
        &format!("unix-ms:{now}"),
        &format!("unix-ms:{}", now + 100),
        &format!("unix-ms:{}", now + 200),
    )
}

#[test]
fn a_visible_hard_hold_cannot_be_bypassed_by_the_raw_claim_transaction() {
    let store = setup();
    put(&store, "held", DispatchPolicy::Automatic, true);
    let before = store.project_revision("p").unwrap();
    let error = claim(&store, "held", "agent", "claim-held", 10).unwrap_err();
    assert!(error.to_string().contains("security_hold"));
    assert!(store
        .current_attempt_for_work("p", "held")
        .unwrap()
        .is_none());
    assert!(store.operation("claim-held").unwrap().is_none());
    assert_eq!(store.project_revision("p").unwrap(), before);
    assert_eq!(store.work_holds("held").unwrap().len(), 1);
}

#[test]
fn paused_and_operator_dispatch_follow_the_same_durable_actor_policy() {
    let store = setup();
    put(&store, "paused", DispatchPolicy::Paused, false);
    put(&store, "operator-work", DispatchPolicy::OperatorOnly, false);
    put(&store, "automatic-work", DispatchPolicy::Automatic, false);
    assert!(claim(&store, "paused", "operator", "paused", 10).is_err());
    assert!(claim(&store, "operator-work", "agent", "agent-denied", 10).is_err());
    assert!(claim(&store, "operator-work", "reviewer", "reviewer-denied", 10).is_err());
    assert!(claim(
        &store,
        "automatic-work",
        "reviewer",
        "reviewer-auto-denied",
        10
    )
    .is_err());
    assert!(claim(&store, "operator-work", "operator", "operator-allowed", 10).is_ok());
}

#[test]
fn retries_compare_numeric_milliseconds_not_lexical_strings() {
    let store = setup();
    put(&store, "elapsed", DispatchPolicy::Automatic, false);
    put(&store, "future", DispatchPolicy::Automatic, false);
    store
        .execute_batch(
            "UPDATE work_item SET retry_not_before = 'unix-ms:9' WHERE work_id = 'elapsed';
        UPDATE work_item SET retry_not_before = 'unix-ms:100' WHERE work_id = 'future';",
        )
        .unwrap();
    assert!(claim(&store, "elapsed", "agent", "numeric-ready", 100).is_ok());
    let denied = claim(&store, "future", "agent", "numeric-wait", 9).unwrap_err();
    assert!(denied.to_string().contains("retry_not_before(100)"));
    assert!(claim(&store, "future", "agent", "numeric-boundary", 100).is_ok());
}

#[test]
fn canonical_time_errors_and_nonpositive_deadlines_leave_state_unchanged() {
    let store = setup();
    put(&store, "task", DispatchPolicy::Automatic, false);
    let before = store.project_revision("p").unwrap();
    for (now, lease) in [
        ("t3", "t4"),
        ("unix-ms:+3", "unix-ms:4"),
        ("unix-ms:3", "unix-ms:3"),
    ] {
        assert!(store
            .claim_work(
                "p",
                "task",
                "agent",
                "harness",
                None,
                "a",
                "invalid-time",
                "digest",
                None,
                now,
                lease,
                "unix-ms:10"
            )
            .is_err());
    }
    assert!(store
        .current_attempt_for_work("p", "task")
        .unwrap()
        .is_none());
    assert_eq!(store.project_revision("p").unwrap(), before);
}

#[test]
fn exact_replay_returns_the_original_claim_even_when_a_new_hold_blocks_progress() {
    let store = setup();
    put(&store, "task", DispatchPolicy::Automatic, false);
    let first = claim(&store, "task", "agent", "first", 10).unwrap();
    let revision = store.project_revision("p").unwrap().0;
    store
        .add_work_hold_operation(
            &WorkHoldAddInput {
                project_id: "p".into(),
                work_id: "task".into(),
                reason_code: "security_hold".into(),
            },
            "operator",
            "add-hold",
            "digest:add-hold",
            revision,
            "unix-ms:11",
        )
        .unwrap();
    let held_revision = store.project_revision("p").unwrap();
    let replay = claim(&store, "task", "agent", "first", 10).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.attempt_id, first.attempt_id);
    assert_eq!(replay.revision, first.revision);
    assert_eq!(store.project_revision("p").unwrap(), held_revision);
    assert!(store.audit_event("first").unwrap().is_some());
    assert!(claim(&store, "task", "agent", "second", 12).is_err());
}

#[test]
fn unreadable_prerequisite_does_not_disappear_from_eligibility() {
    let store = setup();
    for id in ["upstream", "dependent", "healthy"] {
        put(&store, id, DispatchPolicy::Automatic, false);
    }
    store
        .add_dependency_operation(
            "p",
            "upstream",
            "dependent",
            "agent",
            "edge",
            "digest:edge",
            "unix-ms:2",
        )
        .unwrap();
    // Deliberate damaged-row fixture, not a production mutation route.
    store
        .execute_batch(
            "PRAGMA ignore_check_constraints = ON;
        UPDATE work_item SET kind = 'broken-kind' WHERE work_id = 'upstream';
        PRAGMA ignore_check_constraints = OFF;",
        )
        .unwrap();
    let snapshot = store.read_project_status("p").unwrap();
    assert_eq!(snapshot.total, 3);
    assert_eq!(snapshot.works.len(), 2);
    assert!(snapshot
        .diagnostics
        .iter()
        .any(|item| item.code == "orphaned_dependency"));
    let denied = claim(&store, "dependent", "agent", "orphan-denied", 10).unwrap_err();
    assert!(denied.to_string().contains("orphaned_dependency"));
    assert!(claim(&store, "healthy", "agent", "healthy-allowed", 10).is_ok());
}

#[test]
fn malformed_retry_is_diagnostic_and_not_claimable() {
    let store = setup();
    put(&store, "task", DispatchPolicy::Automatic, false);
    store
        .execute_batch(
            "UPDATE work_item SET retry_not_before = 'not-a-clock' WHERE work_id = 'task'",
        )
        .unwrap();
    let snapshot = store.read_project_status("p").unwrap();
    assert!(snapshot.works.is_empty());
    assert_eq!(snapshot.diagnostics[0].code, "invalid_status_clock");
    assert!(claim(&store, "task", "agent", "bad-clock", 10).is_err());
}

#[test]
fn hold_resolution_requires_operator_and_exact_project_scope() {
    let store = setup();
    put(&store, "held", DispatchPolicy::Automatic, true);
    store.create_project("other", "unix-ms:1").unwrap();
    let hold = store.work_holds("held").unwrap().remove(0);
    let revision = store.project_revision("p").unwrap().0;
    let denied = store
        .resolve_work_hold_operation(
            "p",
            "held",
            &hold.hold_id,
            "agent",
            "reviewed",
            "agent-resolve",
            "digest:agent-resolve",
            revision,
            "unix-ms:10",
        )
        .unwrap_err();
    assert!(denied.to_string().contains("role_denied"));
    assert!(store
        .resolve_work_hold_operation(
            "other",
            "held",
            &hold.hold_id,
            "operator",
            "reviewed",
            "foreign-resolve",
            "digest:foreign-resolve",
            0,
            "unix-ms:10"
        )
        .is_err());
    assert!(store.work_holds("held").unwrap()[0].resolved_at.is_none());
    store
        .resolve_work_hold_operation(
            "p",
            "held",
            &hold.hold_id,
            "operator",
            "reviewed",
            "operator-resolve",
            "digest:operator-resolve",
            revision,
            "unix-ms:10",
        )
        .unwrap();
    assert!(store.work_holds("held").unwrap()[0].resolved_at.is_some());
    assert!(store.audit_event("operator-resolve").unwrap().is_some());
    assert!(claim(&store, "held", "agent", "after-resolution", 11).is_ok());
}

#[test]
fn stale_claim_and_foreign_subject_do_not_write_attempts() {
    let store = setup();
    put(&store, "task", DispatchPolicy::Automatic, false);
    let stale = store.claim_work(
        "p",
        "task",
        "agent",
        "harness",
        None,
        "a",
        "stale",
        "digest:stale",
        Some(0),
        "unix-ms:10",
        "unix-ms:20",
        "unix-ms:30",
    );
    assert!(matches!(stale, Err(StoreError::StaleRevision { .. })));
    store.create_project("other", "unix-ms:1").unwrap();
    let foreign = store.claim_work(
        "other",
        "task",
        "agent",
        "harness",
        None,
        "b",
        "foreign",
        "digest:foreign",
        None,
        "unix-ms:10",
        "unix-ms:20",
        "unix-ms:30",
    );
    assert!(foreign.is_err());
    assert!(store
        .current_attempt_for_work("p", "task")
        .unwrap()
        .is_none());
}

#[test]
fn competing_write_transactions_still_produce_one_winner() {
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory =
        std::env::temp_dir().join(format!("boreal-m02-{}-{suffix}", std::process::id()));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("work.sqlite");
    {
        let store = SqliteStore::open(&path, SCHEMA).unwrap();
        initialize(&store);
        put(&store, "task", DispatchPolicy::Automatic, false);
    }
    let barrier = Arc::new(Barrier::new(2));
    let handles = (0..2)
        .map(|index| {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let store = SqliteStore::open(path, SCHEMA).unwrap();
                barrier.wait();
                claim(&store, "task", "agent", &format!("race:{index}"), 10)
            })
        })
        .collect::<Vec<_>>();
    let outcomes = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        outcomes
            .iter()
            .filter(|result| matches!(result, Err(StoreError::Conflict(_))))
            .count(),
        1
    );
    {
        let store = SqliteStore::open(&path, SCHEMA).unwrap();
        assert!(store
            .current_attempt_for_work("p", "task")
            .unwrap()
            .is_some());
        let audit_count = ["race:0", "race:1"]
            .iter()
            .filter(|id| store.audit_event(id).unwrap().is_some())
            .count();
        assert_eq!(audit_count, 1);
    }
    std::fs::remove_dir_all(directory).unwrap();
}

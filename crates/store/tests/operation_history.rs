use boreal_store::SqliteStore;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn store_with_history() -> SqliteStore {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
    store
        .execute_batch(
            "INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO project VALUES ('p2', 2, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO actor VALUES ('operator-1', 'operator', 'cred-1', 'Operator', 't0');
             INSERT INTO session VALUES ('s1', 'operator-1', 'test', 'active', 't0', NULL);
             INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{}', 't0');
             INSERT INTO work_item (work_id, project_id, kind, lifecycle, dispatch_policy,
                                    acceptance_profile_id, acceptance_profile_version, title,
                                    description, created_at, updated_at)
             VALUES ('w1', 'p1', 'task', 'open', 'automatic', 'default', 1, 'Work 1', '', 't0', 't0');
             INSERT INTO work_item (work_id, project_id, kind, lifecycle, dispatch_policy,
                                    acceptance_profile_id, acceptance_profile_version, title,
                                    description, created_at, updated_at)
             VALUES ('w2', 'p1', 'task', 'open', 'automatic', 'default', 1, 'Work 2', '', 't0', 't0');
             INSERT INTO work_item (work_id, project_id, kind, lifecycle, dispatch_policy,
                                    acceptance_profile_id, acceptance_profile_version, title,
                                    description, created_at, updated_at)
             VALUES ('w3', 'p2', 'task', 'open', 'automatic', 'default', 1, 'Work 3', '', 't0', 't0');
             INSERT INTO attempt (attempt_id, work_id, actor_id, harness_id, session_id, fence,
                                  current, state, claimed_at, accepted_at, lease_deadline,
                                  max_attempt_deadline, config_identity, binary_identity,
                                  protocol_version, schema_version)
             VALUES ('a1', 'w1', 'operator-1', 'test', 's1', 1, 0, 'completed', 't0', 't0',
                     't1', 't2', 'config', 'binary', '2', 2);
             INSERT INTO operation VALUES
                 ('op-work-1', 'p1', 'work.update', 'operator-1', 's1', NULL, NULL, NULL,
                  'sha256:1', 'changed', '{}', 1, 't0', 't0');
             INSERT INTO audit_event (project_id, revision, operation_id, event_type,
                                      subject_type, subject_id, actor_id, session_id,
                                      fence, as_of, payload_json)
             VALUES ('p1', 1, 'op-work-1', 'work.created', 'work', 'w1', 'operator-1', 's1', NULL, 't0', '{}');
             INSERT INTO operation VALUES
                 ('op-attempt-1', 'p1', 'attempt.finish', 'operator-1', 's1', NULL, 'a1', 1,
                  'sha256:2', 'changed', '{}', 2, 't1', 't1');
             INSERT INTO operation VALUES
                 ('op-work-2', 'p1', 'work.update', 'operator-1', 's1', NULL, NULL, NULL,
                  'sha256:3', 'changed', '{}', 3, 't2', 't2');
             INSERT INTO audit_event (project_id, revision, operation_id, event_type,
                                      subject_type, subject_id, actor_id, session_id,
                                      fence, as_of, payload_json)
             VALUES ('p1', 3, 'op-work-2', 'work.paused', 'work', 'w2', 'operator-1', 's1', NULL, 't2', '{}');
             INSERT INTO operation VALUES
                 ('op-other-project', 'p2', 'work.update', 'operator-1', 's1', NULL, NULL, NULL,
                  'sha256:4', 'changed', '{}', 1, 't3', 't3');
             INSERT INTO audit_event (project_id, revision, operation_id, event_type,
                                      subject_type, subject_id, actor_id, session_id,
                                      fence, as_of, payload_json)
             VALUES ('p2', 1, 'op-other-project', 'work.paused', 'work', 'w3', 'operator-1', 's1', NULL, 't3', '{}');",
        )
        .expect("history fixture inserts");
    store
}

#[test]
fn work_operation_history_counts_and_pages_after_filtering() {
    let store = store_with_history();

    let first = store
        .operation_page_for_work("p1", "w1", 1, 0)
        .expect("first page queries filtered history");
    assert_eq!(first.total, 2);
    assert_eq!(first.items.len(), 1);
    assert_eq!(first.items[0].operation_id, "op-attempt-1");

    let second = store
        .operation_page_for_work("p1", "w1", 1, 1)
        .expect("second page queries filtered history");
    assert_eq!(second.total, 2);
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.items[0].operation_id, "op-work-1");

    let empty = store
        .operation_page_for_work("p1", "w1", 1, 2)
        .expect("past-end page queries filtered history");
    assert_eq!(empty.total, 2);
    assert!(empty.items.is_empty());

    let unrelated = store
        .operation_page_for_work("p1", "w2", 10, 0)
        .expect("different work history queries");
    assert_eq!(unrelated.total, 1);
    assert_eq!(unrelated.items[0].operation_id, "op-work-2");

    let other_project = store
        .operation_page_for_work("p2", "w3", 10, 0)
        .expect("different project history queries");
    assert_eq!(other_project.total, 1);
    assert_eq!(other_project.items[0].operation_id, "op-other-project");
}

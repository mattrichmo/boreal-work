use boreal_domain::work_model_v3::DispositionKind;
use boreal_store::cycle_commands::ContainerDispositionIntentV3;
use boreal_store::{SqliteStore, V3MutationContext};

const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");
const SCHEMA_V3: &str = include_str!("../../../project/spec/schema-v3.sql");
const COMPLETION_MIGRATIONS: &[&str] = &[
    include_str!("../../../project/spec/schema-completion-v1.sql"),
    include_str!("../../../project/spec/schema-completion-v2.sql"),
    include_str!("../../../project/spec/schema-completion-v3.sql"),
    include_str!("../../../project/spec/schema-completion-v4.sql"),
    include_str!("../../../project/spec/schema-completion-v5.sql"),
    include_str!("../../../project/spec/schema-completion-v6.sql"),
];

fn context(operation_id: &str, revision: u64) -> V3MutationContext {
    V3MutationContext {
        project_id: "p1".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        operation_id: operation_id.to_owned(),
        request_digest: format!("sha256:{operation_id}"),
        expected_revision: Some(revision),
        now: format!("unix-ms:{}", revision + 10),
    }
}

fn fixture() -> SqliteStore {
    let schema_v2_fixture = format!("{SCHEMA_V2}\n-- non-canonical test fixture");
    let store = SqliteStore::open_in_memory(&schema_v2_fixture).expect("schema-v2 opens");
    store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "credential-1",
            "Agent 1",
            "op-init",
            "sha256:op-init",
            "unix-ms:1",
        )
        .expect("project initializes");
    store
        .apply_schema(SCHEMA_V3)
        .expect("work-model v3 schema applies");
    for migration in COMPLETION_MIGRATIONS {
        store
            .execute_batch(migration)
            .expect("completion migration applies");
    }
    let existing_nodes = store.work_nodes_v3("p1").expect("initial nodes read");
    assert!(
        existing_nodes.is_empty(),
        "unexpected initial nodes: {existing_nodes:?}"
    );
    store
        .execute_batch(
            "INSERT INTO work_item (
                 work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
                 acceptance_profile_id, acceptance_profile_version, title,
                 description, created_at, updated_at
             ) VALUES
               ('milestone-1', 'p1', 'milestone', NULL, 'open', 'automatic',
                'focused', 1, 'Milestone', '', 'unix-ms:3', 'unix-ms:3'),
               ('task-a', 'p1', 'task', 'milestone-1', 'open', 'automatic',
                'focused', 1, 'Task A', '', 'unix-ms:3', 'unix-ms:3'),
               ('task-b', 'p1', 'task', 'milestone-1', 'open', 'automatic',
                'focused', 1, 'Task B', '', 'unix-ms:3', 'unix-ms:3');",
        )
        .expect("milestone and descendants seed");
    store
}

#[test]
fn dispositions_are_transactional_scope_facts_not_accepted_task_outcomes() {
    let store = fixture();
    let initial = store
        .container_scope_snapshot_v3("p1", "milestone-1")
        .expect("canonical container snapshot reads");
    let task_a = initial
        .facts
        .iter()
        .find(|fact| fact.work_id == "task-a")
        .unwrap();

    let forged_close = ContainerDispositionIntentV3 {
        disposition_id: "disp-forged-close".to_owned(),
        container_work_id: "milestone-1".to_owned(),
        descendant_work_id: "task-a".to_owned(),
        kind: DispositionKind::AcceptedClosed,
        replacement_work_id: None,
        reason: None,
        supersedes_id: None,
        expected_entity_revision: task_a.entity_revision,
    };
    assert!(store
        .record_container_disposition_v3(
            &context("op-forged-close", initial.project_revision),
            &forged_close,
        )
        .is_err());
    assert!(store
        .container_scope_snapshot_v3("p1", "milestone-1")
        .unwrap()
        .dispositions
        .is_empty());

    let replace_a = ContainerDispositionIntentV3 {
        disposition_id: "disp-replace-a".to_owned(),
        container_work_id: "milestone-1".to_owned(),
        descendant_work_id: "task-a".to_owned(),
        kind: DispositionKind::Replaced,
        replacement_work_id: Some("task-b".to_owned()),
        reason: Some("Scope moved to task B".to_owned()),
        supersedes_id: None,
        expected_entity_revision: task_a.entity_revision,
    };
    store
        .record_container_disposition_v3(
            &context("op-replace-a", initial.project_revision),
            &replace_a,
        )
        .expect("replacement is appended against canonical facts");

    let after_replace = store
        .container_scope_snapshot_v3("p1", "milestone-1")
        .expect("updated scope snapshot reads");
    let task_b = after_replace
        .facts
        .iter()
        .find(|fact| fact.work_id == "task-b")
        .unwrap();
    let defer_b = ContainerDispositionIntentV3 {
        disposition_id: "disp-defer-b".to_owned(),
        container_work_id: "milestone-1".to_owned(),
        descendant_work_id: "task-b".to_owned(),
        kind: DispositionKind::Deferred,
        replacement_work_id: None,
        reason: Some("Deferred beyond this milestone".to_owned()),
        supersedes_id: None,
        expected_entity_revision: task_b.entity_revision,
    };
    store
        .record_container_disposition_v3(
            &context("op-defer-b", after_replace.project_revision),
            &defer_b,
        )
        .expect("deferred scope is appended against canonical facts");

    let final_scope = store
        .container_scope_snapshot_v3("p1", "milestone-1")
        .expect("final scope snapshot reads");
    assert_eq!(final_scope.dispositions.len(), 2);
    assert!(!store.has_accepted_outcome("p1", "task-a").unwrap());
    assert!(!store.has_accepted_outcome("p1", "task-b").unwrap());
}

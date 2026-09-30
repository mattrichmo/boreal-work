//! Production bootstrap must keep each workspace database bound to one project.

use boreal_store::{
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    SqliteStore, StoreError,
};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn binding(root: &str, digest: &str) -> WorkspaceBinding {
    WorkspaceBinding::new(root, root, digest).expect("valid workspace binding")
}

#[test]
fn bootstrap_rejects_a_second_project_without_mutating_any_rows() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production schema opens");
    let database = DatabaseIdentity::new("project-local-database", 1).unwrap();
    IdentityStore::new(&store)
        .install(&database, "unix-ms:1")
        .expect("database identity installs");
    let first_binding = binding("/tmp/project-local-a", "sha256:workspace-a");
    store
        .initialize_project_with_workspace(
            "project-a",
            "actor-a",
            "agent",
            "credential-a",
            "Agent A",
            "init-a",
            "sha256:init-a",
            &database,
            &first_binding,
            "unix-ms:2",
        )
        .expect("first project initializes");

    let error = store
        .initialize_project_with_workspace(
            "project-b",
            "actor-b",
            "agent",
            "credential-b",
            "Agent B",
            "init-b",
            "sha256:init-b",
            &database,
            &binding("/tmp/project-local-b", "sha256:workspace-b"),
            "unix-ms:3",
        )
        .expect_err("second project must not enter project-local database");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("project-local database"))
    );
    assert_eq!(store.list_project_ids().unwrap(), vec!["project-a"]);
    assert!(!store.operation_exists("init-b").unwrap());
    assert!(IdentityStore::new(&store)
        .workspace_binding("project-b")
        .is_err());

    // A new operation ID may replay the complete existing bootstrap without
    // creating a second project or history row.
    let replay = store
        .initialize_project_with_workspace(
            "project-a",
            "actor-a",
            "agent",
            "credential-a",
            "Agent A",
            "init-a-retry",
            "sha256:init-a",
            &database,
            &first_binding,
            "unix-ms:4",
        )
        .expect("same project bootstrap remains repeatable");
    assert!(replay.replayed);
    assert_eq!(store.list_project_ids().unwrap(), vec!["project-a"]);
}

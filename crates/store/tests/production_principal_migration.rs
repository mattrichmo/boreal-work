//! Focused S3-T03 coverage for explicit migration of pre-credential projects.
//! Legacy actor rows remain historical identities until an operator grants a
//! project-bound key with the actor's unchanged role.

use boreal_domain::{ActorRole, TimestampMs};
use boreal_store::{
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    principals::PrincipalGrantRequest,
    SqliteStore, StoreError,
};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");
const PROJECT_ID: &str = "old-project";

fn legacy_project(actor_id: &str, role: &str) -> SqliteStore {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("schema opens");
    let database = DatabaseIdentity::new("db-principal-migration", 1).expect("identity valid");
    IdentityStore::new(&store)
        .install(&database, "unix-ms:1")
        .expect("database identity installs");
    let binding = WorkspaceBinding::new(
        "/tmp/boreal-principal-migration",
        "/tmp/boreal-principal-migration",
        "sha256:principal-migration-binding",
    )
    .expect("workspace binding is valid");
    store
        .initialize_project_with_workspace(
            PROJECT_ID,
            actor_id,
            role,
            &format!("historical-os-user:{actor_id}"),
            "Historical OS user",
            "op-legacy-init",
            "sha256:legacy-init",
            &database,
            &binding,
            "unix-ms:1",
        )
        .expect("legacy project initializes");
    store
}

fn key(byte: char) -> String {
    format!("bwrk1_{}", byte.to_string().repeat(64))
}

fn request(
    actor_id: &str,
    target_actor_id: &str,
    role: ActorRole,
    independent: bool,
    credential: String,
    operation_id: &str,
) -> PrincipalGrantRequest {
    PrincipalGrantRequest {
        project_id: PROJECT_ID.into(),
        actor_id: actor_id.into(),
        session_id: None,
        principal_actor_id: target_actor_id.into(),
        role,
        independent,
        credential,
        expires_at_ms: None,
        display_name: "Explicitly enrolled principal".into(),
        reason: "explicit pre-credential project migration".into(),
        expected_revision: 2,
        operation_id: operation_id.into(),
        at: "unix-ms:3".into(),
    }
}

fn bootstrap_request(actor_id: &str, credential: String) -> PrincipalGrantRequest {
    request(
        actor_id,
        actor_id,
        ActorRole::Operator,
        true,
        credential,
        "op-recovery-bootstrap",
    )
}

fn bootstrap_operator(store: &SqliteStore) -> String {
    let revision = store
        .project_revision(PROJECT_ID)
        .expect("revision reads")
        .0;
    let mut bootstrap = bootstrap_request("recovered-operator", key('a'));
    bootstrap.expected_revision = revision;
    bootstrap.at = "unix-ms:2".into();
    store
        .bootstrap_project_principal(&bootstrap)
        .expect("fresh operator bootstrap succeeds");
    bootstrap.credential
}

#[test]
fn bootstrap_refuses_to_promote_a_historical_os_user_and_accepts_a_new_operator_id() {
    let store = legacy_project("old-os-user", "agent");
    let revision = store
        .project_revision(PROJECT_ID)
        .expect("revision reads")
        .0;
    let mut unsafe_bootstrap = bootstrap_request("old-os-user", key('b'));
    unsafe_bootstrap.expected_revision = revision;

    let error = store
        .bootstrap_project_principal(&unsafe_bootstrap)
        .expect_err("bootstrap must never promote a historical actor identity");
    assert!(matches!(
        error,
        StoreError::Conflict(message) if message.contains("cannot promote a historical actor")
    ));
    assert!(!store
        .has_project_principals(PROJECT_ID)
        .expect("principal lookup succeeds"));
    assert!(store
        .authenticate_principal(PROJECT_ID, &unsafe_bootstrap.credential, TimestampMs(4))
        .is_err());

    store
        .ensure_actor(
            "old-os-user",
            "agent",
            "historical-os-user:old-os-user",
            "Historical OS user",
            "unix-ms:1",
        )
        .expect("historical actor role and attribution remain unchanged");

    let operator_key = bootstrap_operator(&store);
    let authenticated = store
        .authenticate_principal(PROJECT_ID, &operator_key, TimestampMs(4))
        .expect("new explicitly selected operator key authenticates");
    assert_eq!(authenticated.actor_id, "recovered-operator");
    assert_eq!(authenticated.role, ActorRole::Operator);
    assert!(store
        .principal_authority(PROJECT_ID, "old-os-user")
        .is_err());
}

#[test]
fn explicit_grant_migrates_legacy_actor_without_changing_role_or_identity() {
    let store = legacy_project("historical-agent", "agent");
    let operator_key = bootstrap_operator(&store);
    let migration_key = key('c');
    let revision = store
        .project_revision(PROJECT_ID)
        .expect("revision reads")
        .0;
    let mut migration = request(
        "recovered-operator",
        "historical-agent",
        ActorRole::Agent,
        false,
        migration_key.clone(),
        "op-migrate-agent",
    );
    migration.expected_revision = revision;

    let result = store
        .grant_principal(&migration)
        .expect("operator can explicitly enroll the unchanged legacy role");
    assert!(!result.replayed);

    let principal = store
        .authenticate_principal(PROJECT_ID, &migration_key, TimestampMs(4))
        .expect("enrolled legacy actor authenticates with its project key");
    assert_eq!(principal.actor_id, "historical-agent");
    assert_eq!(principal.role, ActorRole::Agent);
    assert_eq!(principal.authority_root, "recovered-operator");
    assert!(store
        .authenticate_principal(PROJECT_ID, &operator_key, TimestampMs(4))
        .is_ok());

    store
        .ensure_actor(
            "historical-agent",
            "agent",
            "historical-os-user:historical-agent",
            "Historical OS user",
            "unix-ms:1",
        )
        .expect("migration preserves the legacy actor row byte-for-byte by identity fields");
}

#[test]
fn explicit_legacy_migration_rejects_role_changes_and_independent_authority() {
    let store = legacy_project("historical-agent", "agent");
    bootstrap_operator(&store);
    let revision = store
        .project_revision(PROJECT_ID)
        .expect("revision reads")
        .0;

    let mut elevated = request(
        "recovered-operator",
        "historical-agent",
        ActorRole::Operator,
        false,
        key('d'),
        "op-reject-role-change",
    );
    elevated.expected_revision = revision;
    let error = store
        .grant_principal(&elevated)
        .expect_err("migration must not promote the stored agent role");
    assert!(matches!(
        error,
        StoreError::Conflict(message) if message.contains("legacy actor role is immutable")
    ));
    assert_eq!(
        store
            .project_revision(PROJECT_ID)
            .expect("revision reads")
            .0,
        revision,
        "rejected role migration must not mutate project revision"
    );

    let mut independent = request(
        "recovered-operator",
        "historical-agent",
        ActorRole::Agent,
        true,
        key('e'),
        "op-reject-independent",
    );
    independent.expected_revision = revision;
    let error = store
        .grant_principal(&independent)
        .expect_err("legacy identity cannot become an independent authority root");
    assert!(matches!(
        error,
        StoreError::Conflict(message) if message.contains("must remain delegated")
    ));
    assert_eq!(
        store
            .project_revision(PROJECT_ID)
            .expect("revision reads")
            .0,
        revision,
        "rejected independent migration must not mutate project revision"
    );
    assert!(store
        .principal_authority(PROJECT_ID, "historical-agent")
        .is_err());
}

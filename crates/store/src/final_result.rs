//! Immutable final-result source bindings.
//!
//! A claim's source is the input snapshot for an attempt. A final result may
//! be a different source version produced by that attempt, so it needs its
//! own proof-generation binding. This additive feature schema preserves the
//! distinction without rewriting the attempt's original source identity.

use super::{SqliteStore, StoreError};

pub const FINAL_RESULT_BINDING_SCHEMA_VERSION: u64 = 1;

const FINAL_RESULT_BINDING_SCHEMA_SQL: &str = r#"
CREATE TABLE boreal_final_result_binding_v1 (
  binding_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  source_version_id TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (trim(content_digest) <> ''),
  config_identity TEXT NOT NULL CHECK (trim(config_identity) <> ''),
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  profile_digest TEXT NOT NULL CHECK (trim(profile_digest) <> ''),
  entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
  prior_proof_revision INTEGER NOT NULL CHECK (prior_proof_revision >= 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  actor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL CHECK (trim(request_digest) <> ''),
  project_revision INTEGER NOT NULL CHECK (project_revision > 0),
  created_at TEXT NOT NULL CHECK (trim(created_at) <> ''),
  UNIQUE (project_id, work_id, proof_revision),
  UNIQUE (project_id, work_id, attempt_id, fence, proof_revision),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (project_id, source_version_id)
    REFERENCES source_version(project_id, source_version_id),
  FOREIGN KEY (profile_id, profile_version)
    REFERENCES acceptance_profile(profile_id, version),
  CHECK (proof_revision = prior_proof_revision + 1)
);
CREATE INDEX boreal_final_result_binding_attempt
  ON boreal_final_result_binding_v1
    (project_id, work_id, attempt_id, fence, proof_revision);
CREATE TRIGGER boreal_final_result_binding_immutable_update
  BEFORE UPDATE ON boreal_final_result_binding_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_final_result_binding_immutable'); END;
CREATE TRIGGER boreal_final_result_binding_immutable_delete
  BEFORE DELETE ON boreal_final_result_binding_v1
  BEGIN SELECT RAISE(ABORT, 'boreal_final_result_binding_immutable'); END;
"#;

impl SqliteStore {
    /// Installs or verifies the additive final-result binding feature schema.
    /// Call before opening the semantic write transaction because first-time
    /// feature installation owns its own SQLite transaction.
    pub fn ensure_final_result_binding_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema(
            "final_result_binding",
            FINAL_RESULT_BINDING_SCHEMA_VERSION,
            FINAL_RESULT_BINDING_SCHEMA_SQL,
        )?;
        if !self.table_exists("boreal_final_result_binding_v1")? {
            return Err(StoreError::Corrupt(
                "final-result binding schema is missing its canonical table".to_owned(),
            ));
        }
        for column in [
            "binding_id",
            "project_id",
            "work_id",
            "attempt_id",
            "fence",
            "source_version_id",
            "content_digest",
            "config_identity",
            "profile_id",
            "profile_version",
            "profile_digest",
            "entity_revision",
            "prior_proof_revision",
            "proof_revision",
            "actor_id",
            "session_id",
            "operation_id",
            "request_digest",
            "project_revision",
            "created_at",
        ] {
            if !self.table_has_column("boreal_final_result_binding_v1", column)? {
                return Err(StoreError::Corrupt(format!(
                    "final-result binding schema is missing column {column}"
                )));
            }
        }
        for (kind, name) in [
            ("index", "boreal_final_result_binding_attempt"),
            ("trigger", "boreal_final_result_binding_immutable_update"),
            ("trigger", "boreal_final_result_binding_immutable_delete"),
        ] {
            if !self.schema_object_exists(kind, name)? {
                return Err(StoreError::Corrupt(format!(
                    "final-result binding schema is missing {kind} {name}"
                )));
            }
        }
        Ok(())
    }
}

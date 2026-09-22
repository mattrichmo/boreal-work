//! Focused persistence adapters for knowledge provenance.
//!
//! Source bytes and catalog state remain owned by `boreal-source`.  This
//! module records the canonical SQLite `source_version` metadata and its
//! operation/readback identity so evidence can safely refer to a source after
//! a process restart.  It intentionally does not copy blobs into SQLite.

use super::{
    json_object, AuditEventRecord, MutationResult, OperationOutcome, OperationRecord, SqliteStore,
    StoreError, SQLITE_ROW,
};
use serde_json::json;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceVersionRegistrationInput {
    pub operation_id: String,
    pub project_id: String,
    pub actor_id: String,
    pub source_version_id: String,
    pub origin: String,
    pub access_scope: String,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub captured_at: String,
    pub parser_identity: String,
    pub availability: String,
    pub citation_json: String,
    pub request_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceVersionRecord {
    pub source_version_id: String,
    pub project_id: String,
    pub origin: String,
    pub access_scope: String,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub captured_at: String,
    pub parser_identity: String,
    pub availability: String,
    pub citation_json: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceVersionRegistrationResult {
    pub mutation: MutationResult,
    pub source: SourceVersionRecord,
}

impl SqliteStore {
    /// Registers immutable source metadata and records a replayable operation.
    ///
    /// The source catalog must have already verified and durably captured the
    /// bytes.  This transaction only creates the relational reference used by
    /// attempts, receipts, summaries, and citations.  Repeating the same
    /// operation returns the original row; a changed request digest conflicts.
    pub fn register_source_version(
        &self,
        input: &SourceVersionRegistrationInput,
    ) -> Result<SourceVersionRegistrationResult, StoreError> {
        validate_registration(input)?;
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            // Replay must be resolved against the authenticated project and
            // immutable request identity before the source row is read or
            // written. Canonical bound projects take the identity-aware
            // journal path; noncanonical schema-v2 fixtures retain the
            // compatibility subject check in this shared root helper.
            if let Some(existing) = self.preflight_operation_replay(
                &input.project_id,
                &input.operation_id,
                "source.register",
                &input.actor_id,
                None,
                None,
                None,
                None,
                &input.request_digest,
                "project",
                &input.project_id,
            )? {
                let source_id =
                    super::json_string_field(&existing.result_json, "source_version_id")?;
                let source = self
                    .source_version(&input.project_id, &source_id)?
                    .ok_or_else(|| {
                        StoreError::Corrupt(
                            "source registration operation refers to a missing row".to_owned(),
                        )
                    })?;
                return Ok(SourceVersionRegistrationResult {
                    mutation: MutationResult {
                        operation_id: existing.operation_id,
                        revision: existing.revision,
                        replayed: true,
                    },
                    source,
                });
            }

            let (source, inserted) = if let Some(existing) =
                self.source_version(&input.project_id, &input.source_version_id)?
            {
                ensure_same_source(&existing, input)?;
                (existing, false)
            } else {
                let mut statement = self.prepare(
                    "INSERT INTO source_version (
                        source_version_id, project_id, origin, access_scope,
                        content_digest, media_type, byte_count, captured_at,
                        parser_identity, availability, citation_json
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                )?;
                statement.bind_text(1, &input.source_version_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.origin)?;
                statement.bind_text(4, &input.access_scope)?;
                statement.bind_text(5, &input.content_digest)?;
                statement.bind_text(6, &input.media_type)?;
                statement.bind_i64(7, input.byte_count)?;
                statement.bind_text(8, &input.captured_at)?;
                statement.bind_text(9, &input.parser_identity)?;
                statement.bind_text(10, &input.availability)?;
                statement.bind_text(11, &input.citation_json)?;
                statement.run()?;
                (
                    self.source_version(&input.project_id, &input.source_version_id)?
                        .ok_or_else(|| {
                            StoreError::Corrupt("source row disappeared after insert".to_owned())
                        })?,
                    true,
                )
            };

            let revision = if inserted {
                self.bump_revision_in_transaction(&input.project_id)?.0
            } else {
                self.project_revision(&input.project_id)?.0
            };
            let payload = json_object(json!({
                "source_version_id": input.source_version_id,
                "content_digest": input.content_digest,
            }))?;
            let operation = OperationRecord {
                operation_id: input.operation_id.clone(),
                project_id: input.project_id.clone(),
                command: "source.register".to_owned(),
                actor_id: input.actor_id.clone(),
                session_id: None,
                expected_revision: None,
                attempt_id: None,
                fence: None,
                request_digest: input.request_digest.clone(),
                outcome: if inserted {
                    OperationOutcome::Changed
                } else {
                    OperationOutcome::Unchanged
                },
                result_json: payload.clone(),
                revision,
                created_at: input.captured_at.clone(),
                completed_at: Some(input.captured_at.clone()),
            };
            // The v2 audit vocabulary predates source registration. Keep the
            // attribution explicit and bounded under the registered generic
            // repair event until a versioned source-specific event is added
            // by the schema/protocol owner.
            self.append_operation_audit_in_transaction(
                operation,
                AuditEventRecord {
                    project_id: input.project_id.clone(),
                    revision,
                    operation_id: input.operation_id.clone(),
                    event_type: "repair.correction".to_owned(),
                    subject_type: "project".to_owned(),
                    subject_id: input.project_id.clone(),
                    actor_id: input.actor_id.clone(),
                    session_id: None,
                    fence: None,
                    as_of: input.captured_at.clone(),
                    payload_json: payload,
                },
            )?;
            Ok(SourceVersionRegistrationResult {
                mutation: MutationResult {
                    operation_id: input.operation_id.clone(),
                    revision,
                    replayed: false,
                },
                source,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn source_version(
        &self,
        project_id: &str,
        source_version_id: &str,
    ) -> Result<Option<SourceVersionRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT source_version_id, project_id, origin, access_scope,
                    content_digest, media_type, byte_count, captured_at,
                    parser_identity, availability, citation_json
             FROM source_version
             WHERE project_id = ?1 AND source_version_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, source_version_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(SourceVersionRecord {
            source_version_id: statement.column_text(0)?,
            project_id: statement.column_text(1)?,
            origin: statement.column_text(2)?,
            access_scope: statement.column_text(3)?,
            content_digest: statement.column_text(4)?,
            media_type: statement.column_text(5)?,
            byte_count: statement.column_u64(6)?,
            captured_at: statement.column_text(7)?,
            parser_identity: statement.column_text(8)?,
            availability: statement.column_text(9)?,
            citation_json: statement.column_text(10)?,
        }))
    }

    pub fn list_source_versions(
        &self,
        project_id: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<SourceVersionRecord>, StoreError> {
        if limit == 0 || limit > 1_000 {
            return Err(StoreError::Invalid(
                "source page limit must be 1..=1000".to_owned(),
            ));
        }
        let mut statement = self.prepare(
            "SELECT source_version_id, project_id, origin, access_scope,
                    content_digest, media_type, byte_count, captured_at,
                    parser_identity, availability, citation_json
             FROM source_version
             WHERE project_id = ?1
             ORDER BY source_version_id
             LIMIT ?2 OFFSET ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_i64(2, limit)?;
        statement.bind_i64(3, offset)?;
        let mut rows = Vec::new();
        while statement.step()? == SQLITE_ROW {
            rows.push(SourceVersionRecord {
                source_version_id: statement.column_text(0)?,
                project_id: statement.column_text(1)?,
                origin: statement.column_text(2)?,
                access_scope: statement.column_text(3)?,
                content_digest: statement.column_text(4)?,
                media_type: statement.column_text(5)?,
                byte_count: statement.column_u64(6)?,
                captured_at: statement.column_text(7)?,
                parser_identity: statement.column_text(8)?,
                availability: statement.column_text(9)?,
                citation_json: statement.column_text(10)?,
            });
        }
        Ok(rows)
    }
}

fn validate_registration(input: &SourceVersionRegistrationInput) -> Result<(), StoreError> {
    for (field, value) in [
        ("operation_id", input.operation_id.as_str()),
        ("project_id", input.project_id.as_str()),
        ("actor_id", input.actor_id.as_str()),
        ("source_version_id", input.source_version_id.as_str()),
        ("origin", input.origin.as_str()),
        ("content_digest", input.content_digest.as_str()),
        ("media_type", input.media_type.as_str()),
        ("captured_at", input.captured_at.as_str()),
        ("parser_identity", input.parser_identity.as_str()),
        ("request_digest", input.request_digest.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(StoreError::Invalid(format!(
                "source registration {field} is required"
            )));
        }
    }
    if !matches!(input.access_scope.as_str(), "project" | "private") {
        return Err(StoreError::Invalid(
            "source access_scope must be project or private".to_owned(),
        ));
    }
    if !matches!(
        input.availability.as_str(),
        "available" | "missing" | "quarantined"
    ) {
        return Err(StoreError::Invalid(
            "invalid source availability".to_owned(),
        ));
    }
    serde_json::from_str::<serde_json::Value>(&input.citation_json)
        .map_err(|error| StoreError::Invalid(format!("invalid source citation_json: {error}")))?;
    Ok(())
}

fn ensure_same_source(
    existing: &SourceVersionRecord,
    input: &SourceVersionRegistrationInput,
) -> Result<(), StoreError> {
    let same = existing.project_id == input.project_id
        && existing.origin == input.origin
        && existing.access_scope == input.access_scope
        && existing.content_digest == input.content_digest
        && existing.media_type == input.media_type
        && existing.byte_count == input.byte_count
        && existing.captured_at == input.captured_at
        && existing.parser_identity == input.parser_identity
        && existing.availability == input.availability
        && existing.citation_json == input.citation_json;
    if same {
        Ok(())
    } else {
        Err(StoreError::Conflict(format!(
            "source version {} has different immutable metadata",
            input.source_version_id
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::{SourceVersionRegistrationInput, SqliteStore};
    use crate::identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding};
    use crate::StoreError;

    const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

    fn bound_store() -> SqliteStore {
        let store =
            SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production schema opens");
        store
            .create_project("knowledge-project", "unix-ms:0")
            .expect("project creates");
        store
            .ensure_actor(
                "knowledge-agent",
                "agent",
                "credential-knowledge",
                "Knowledge Agent",
                "unix-ms:0",
            )
            .expect("actor creates");
        IdentityStore::new(&store)
            .install(
                &DatabaseIdentity::new("knowledge-database", 1).expect("database identity"),
                "unix-ms:1",
            )
            .expect("identity schema installs");
        IdentityStore::new(&store)
            .bind_project(
                "knowledge-project",
                &WorkspaceBinding::new(
                    "/tmp/boreal-knowledge",
                    "/tmp/boreal-knowledge",
                    "sha256:knowledge-binding",
                )
                .expect("workspace binding"),
                "unix-ms:1",
            )
            .expect("project binds");
        store
    }

    fn input(operation_id: &str, request_digest: &str) -> SourceVersionRegistrationInput {
        SourceVersionRegistrationInput {
            operation_id: operation_id.to_owned(),
            project_id: "knowledge-project".to_owned(),
            actor_id: "knowledge-agent".to_owned(),
            source_version_id: "source-knowledge-1".to_owned(),
            origin: "notes/knowledge.md".to_owned(),
            access_scope: "project".to_owned(),
            content_digest: "sha256:knowledge-content".to_owned(),
            media_type: "text/markdown".to_owned(),
            byte_count: 17,
            captured_at: "unix-ms:2".to_owned(),
            parser_identity: "parser/knowledge-1".to_owned(),
            availability: "available".to_owned(),
            citation_json: "[]".to_owned(),
            request_digest: request_digest.to_owned(),
        }
    }

    #[test]
    fn source_registration_uses_identity_bound_audit_replay_boundary() {
        let store = bound_store();
        let request = input("source-knowledge-op", "sha256:knowledge-request");

        let first = store
            .register_source_version(&request)
            .expect("source registration commits");
        assert!(!first.mutation.replayed);
        let audit = store
            .audit_event(&request.operation_id)
            .expect("audit readback succeeds")
            .expect("source registration has audit");
        assert_eq!(audit.project_id, request.project_id);
        assert_eq!(audit.operation_id, request.operation_id);
        assert_eq!(audit.actor_id, request.actor_id);
        assert_eq!(audit.event_type, "repair.correction");
        assert_eq!(audit.subject_type, "project");
        assert_eq!(audit.subject_id, request.project_id);
        assert!(audit.payload_json.contains("source-knowledge-1"));

        let replay = store
            .register_source_version(&request)
            .expect("exact retry replays");
        assert!(replay.mutation.replayed);
        assert_eq!(replay.mutation.revision, first.mutation.revision);
        assert_eq!(store.project_revision(&request.project_id).unwrap().0, 1);

        let mut changed = request.clone();
        changed.request_digest = "sha256:changed-request".to_owned();
        assert!(matches!(
            store.register_source_version(&changed),
            Err(StoreError::Conflict(message)) if message.contains("immutable identity")
        ));
        assert_eq!(
            store
                .list_source_versions(&request.project_id, 10, 0)
                .unwrap()
                .len(),
            1
        );
    }
}

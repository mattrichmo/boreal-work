//! Focused persistence adapters for knowledge provenance.
//!
//! Source bytes and catalog state remain owned by `boreal-source`.  This
//! module records the canonical SQLite `source_version` metadata and its
//! operation/readback identity so evidence can safely refer to a source after
//! a process restart.  It intentionally does not copy blobs into SQLite.

use super::{
    json_object, MutationResult, OperationOutcome, OperationRecord, SqliteStore, StoreError,
    SQLITE_ROW,
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
            if let Some(existing) = self.operation(&input.operation_id)? {
                if existing.command != "source.register"
                    || existing.project_id != input.project_id
                    || existing.actor_id != input.actor_id
                    || existing.request_digest != input.request_digest
                {
                    return Err(StoreError::Conflict(format!(
                        "operation {} was already used with another source registration",
                        input.operation_id
                    )));
                }
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
            self.append_operation(&OperationRecord {
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
            })?;
            // The v2 audit enum predates source registration.  The operation
            // row is the authoritative durable source-registration record;
            // do not mislabel it as a work or evidence event.
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

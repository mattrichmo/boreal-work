//! Bounded readback and body storage for durable summary artifacts.
use super::*;

pub const SUMMARY_BODY_SCHEMA_SQL: &str = "CREATE TABLE IF NOT EXISTS summary_body_v1 (summary_id TEXT PRIMARY KEY REFERENCES summary(summary_id) ON DELETE RESTRICT, body_text TEXT NOT NULL, body_digest TEXT NOT NULL, body_size INTEGER NOT NULL CHECK(body_size BETWEEN 1 AND 65536), created_at TEXT NOT NULL); CREATE TRIGGER IF NOT EXISTS summary_body_v1_no_update BEFORE UPDATE ON summary_body_v1 BEGIN SELECT RAISE(ABORT, 'summary bodies are immutable'); END; CREATE TRIGGER IF NOT EXISTS summary_body_v1_no_delete BEFORE DELETE ON summary_body_v1 BEGIN SELECT RAISE(ABORT, 'summary bodies are immutable'); END;";
pub const LEGACY_SUMMARY_SCHEMA_SQL: &str = "CREATE TABLE IF NOT EXISTS legacy_summary_backfill_v1 (import_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, legacy_id TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT NOT NULL, source_ref TEXT, record_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, legacy_id)); CREATE TRIGGER IF NOT EXISTS legacy_summary_backfill_v1_no_update BEFORE UPDATE ON legacy_summary_backfill_v1 BEGIN SELECT RAISE(ABORT, 'legacy summary imports are immutable'); END; CREATE TRIGGER IF NOT EXISTS legacy_summary_backfill_v1_no_delete BEFORE DELETE ON legacy_summary_backfill_v1 BEGIN SELECT RAISE(ABORT, 'legacy summary imports are immutable'); END;";

/// A summary row paired with its optional durable body. `body` is omitted when
/// reading legacy summaries that predate the body table.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SummaryArtifactRecord {
    pub summary: SummaryRecord,
    pub body: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SummaryArtifactPage {
    pub items: Vec<SummaryArtifactRecord>,
    pub limit: u64,
    pub offset: u64,
    pub has_more: bool,
}

impl SqliteStore {
    /// Additive schema for standalone and composed summary bodies. The summary
    /// metadata row remains canonical; the digest/size are checked against it
    /// on every read. Invoke at production schema initialization.
    pub fn ensure_summary_body_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema("summary_body", 1, SUMMARY_BODY_SCHEMA_SQL)
    }

    pub fn summary_artifact(
        &self,
        project_id: &str,
        summary_id: &str,
    ) -> Result<Option<SummaryArtifactRecord>, StoreError> {
        let Some(summary) = self.summary(project_id, summary_id)? else {
            return Ok(None);
        };
        let body = self.read_summary_body(&summary)?;
        Ok(Some(SummaryArtifactRecord { summary, body }))
    }

    /// Project-scoped bounded newest-first page, including superseded history.
    pub fn summary_artifact_list(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<SummaryArtifactPage, StoreError> {
        let limit = limit.clamp(1, 100);
        let offset = offset.min(1_000_000);
        let sql = if work_id.is_some() {
            "SELECT s.summary_id FROM summary s JOIN work_item wi ON wi.work_id=s.work_id WHERE wi.project_id=?1 AND s.work_id=?2 ORDER BY s.created_at DESC,s.summary_id DESC LIMIT ?3 OFFSET ?4"
        } else {
            "SELECT s.summary_id FROM summary s JOIN work_item wi ON wi.work_id=s.work_id WHERE wi.project_id=?1 ORDER BY s.created_at DESC,s.summary_id DESC LIMIT ?3 OFFSET ?4"
        };
        let mut statement = self.prepare(sql)?;
        statement.bind_text(1, project_id)?;
        if let Some(work_id) = work_id {
            statement.bind_text(2, work_id)?;
        }
        statement.bind_i64(3, limit + 1)?;
        statement.bind_i64(4, offset)?;
        let mut ids = Vec::new();
        while statement.step()? == SQLITE_ROW {
            ids.push(statement.column_text(0)?);
        }
        let has_more = ids.len() > limit as usize;
        ids.truncate(limit as usize);
        let mut items = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(item) = self.summary_artifact(project_id, &id)? {
                items.push(item);
            }
        }
        Ok(SummaryArtifactPage {
            items,
            limit,
            offset,
            has_more,
        })
    }

    fn read_summary_body(&self, summary: &SummaryRecord) -> Result<Option<String>, StoreError> {
        let mut statement = self.prepare(
            "SELECT body_text,body_digest,body_size FROM summary_body_v1 WHERE summary_id=?1",
        )?;
        statement.bind_text(1, &summary.summary_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let body = statement.column_text(0)?;
        let digest = statement.column_text(1)?;
        let size = statement.column_i64(2)? as u64;
        if digest != summary.body_digest || size != summary.body_size || body.len() as u64 != size {
            return Err(StoreError::Corrupt(format!(
                "summary body {} fails digest/size validation",
                summary.summary_id
            )));
        }
        Ok(Some(body))
    }
}

impl SqliteStore {
    /// Atomically stores the proof-bound summary metadata, immutable body, one
    /// project revision, operation readback, and audit event. The body digest
    /// is computed by the application adapter and must match the sealed row.
    pub fn insert_summary_with_body(
        &self,
        request: &SummaryInsertRequest,
        body: &str,
        body_digest: &str,
    ) -> Result<SummaryInsertResult, StoreError> {
        self.ensure_summary_body_schema()?;
        if body.is_empty()
            || body.len() as u64 != request.body_size
            || body.len() as u64 > MAX_SUMMARY_BODY_BYTES
            || body_digest != request.body_digest
        {
            return Err(StoreError::Invalid(
                "summary body does not match the declared digest and size".into(),
            ));
        }
        validate_summary_request(request)?;
        let replay_digest = canonical_summary_request(request)?;
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "summary.insert",
                &request.actor_id,
                request.session_id.as_deref(),
                request.expected_project_revision,
                Some(&request.attempt_id),
                Some(request.fence),
                &replay_digest,
                "summary",
                &request.summary_id,
            )? {
                let replay = self.replay_summary_operation(request, &replay_digest, &existing)?;
                self.insert_summary_body_in_transaction(
                    &request.summary_id,
                    body,
                    body_digest,
                    request.body_size,
                    &request.created_at,
                )?;
                return Ok(replay);
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                request.expected_project_revision,
            )?;
            self.validate_summary_context(request)?;
            let mut supersede =
                self.prepare("UPDATE summary SET current=0 WHERE work_id=?1 AND current=1")?;
            supersede.bind_text(1, &request.work_id)?;
            supersede.run()?;
            let subject_ref = summary_subject_ref(&request.attempt_id, request.fence);
            let mut statement = self.prepare("INSERT INTO summary(summary_id,work_id,attempt_id,fence,subject_ref,source_version_id,config_identity,profile_id,profile_version,body_digest,body_size,current,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12)")?;
            statement.bind_text(1, &request.summary_id)?;
            statement.bind_text(2, &request.work_id)?;
            statement.bind_text(3, &request.attempt_id)?;
            statement.bind_i64(4, request.fence)?;
            statement.bind_text(5, &subject_ref)?;
            statement.bind_text(6, &request.source_version_id)?;
            statement.bind_text(7, &request.config_identity)?;
            statement.bind_text(8, &request.profile_id)?;
            statement.bind_i64(9, request.profile_version)?;
            statement.bind_text(10, &request.body_digest)?;
            statement.bind_i64(11, request.body_size)?;
            statement.bind_text(12, &request.created_at)?;
            statement.run()?;
            self.insert_summary_body_in_transaction(
                &request.summary_id,
                body,
                body_digest,
                request.body_size,
                &request.created_at,
            )?;
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = summary_result_json(&request.summary_id)?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "summary.insert".into(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    expected_revision: request.expected_project_revision,
                    attempt_id: Some(request.attempt_id.clone()),
                    fence: Some(request.fence),
                    request_digest: replay_digest,
                    outcome: OperationOutcome::Changed,
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.created_at.clone(),
                    completed_at: Some(request.created_at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: "close.requested".into(),
                    subject_type: "summary".into(),
                    subject_id: request.summary_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    fence: Some(request.fence),
                    as_of: request.created_at.clone(),
                    payload_json: result_json,
                },
            )?;
            Ok(SummaryInsertResult {
                summary: self
                    .summary(&request.project_id, &request.summary_id)?
                    .ok_or_else(|| {
                        StoreError::Corrupt("summary disappeared after insert".into())
                    })?,
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    fn insert_summary_body_in_transaction(
        &self,
        summary_id: &str,
        body: &str,
        digest: &str,
        size: u64,
        created_at: &str,
    ) -> Result<(), StoreError> {
        let mut existing = self.prepare(
            "SELECT body_text,body_digest,body_size FROM summary_body_v1 WHERE summary_id=?1",
        )?;
        existing.bind_text(1, summary_id)?;
        if existing.step()? == SQLITE_ROW {
            if existing.column_text(0)? == body
                && existing.column_text(1)? == digest
                && existing.column_i64(2)? as u64 == size
            {
                return Ok(());
            }
            return Err(StoreError::Conflict(
                "summary body is immutable and already has different bytes".into(),
            ));
        }
        let mut insert = self.prepare("INSERT INTO summary_body_v1(summary_id,body_text,body_digest,body_size,created_at) VALUES(?1,?2,?3,?4,?5)")?;
        insert.bind_text(1, summary_id)?;
        insert.bind_text(2, body)?;
        insert.bind_text(3, digest)?;
        insert.bind_i64(4, size)?;
        insert.bind_text(5, created_at)?;
        insert.run()?;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacySummaryBackfillRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: String,
    pub expected_project_revision: u64,
    pub operation_id: String,
    pub legacy_id: String,
    pub reason: String,
    pub source_ref: Option<String>,
    pub record_json: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacySummaryBackfillRecord {
    pub import_id: String,
    pub project_id: String,
    pub legacy_id: String,
    pub actor_id: String,
    pub reason: String,
    pub source_ref: Option<String>,
    pub record_json: String,
    pub created_at: String,
}

impl SqliteStore {
    pub fn ensure_legacy_summary_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema("legacy_summary_backfill", 1, LEGACY_SUMMARY_SCHEMA_SQL)
    }

    /// Imports an immutable legacy summary as explicitly historical data. It
    /// is never inserted into `summary`, can never satisfy a gate, and keeps
    /// its complete original payload and disposition reason.
    pub fn backfill_legacy_summary(
        &self,
        request: &LegacySummaryBackfillRequest,
    ) -> Result<LegacySummaryBackfillRecord, StoreError> {
        self.ensure_legacy_summary_schema()?;
        if request.project_id.trim().is_empty()
            || request.actor_id.trim().is_empty()
            || request.legacy_id.trim().is_empty()
            || request.reason.trim().is_empty()
            || request.record_json.is_empty()
            || request.record_json.len() > MAX_SUMMARY_BODY_BYTES as usize
        {
            return Err(StoreError::Invalid("legacy summary backfill requires project, actor, legacy id, reason, and a bounded original record".into()));
        }
        let parsed: Value = serde_json::from_str(&request.record_json).map_err(|_| {
            StoreError::Invalid("legacy summary backfill input must be valid JSON".into())
        })?;
        if !parsed.is_object() {
            return Err(StoreError::Invalid(
                "legacy summary backfill input must be a JSON object".into(),
            ));
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if self.canonical_production {
                let (role, _) = self.principal_authority(&request.project_id, &request.actor_id)?;
                if role != boreal_domain::ActorRole::Operator {
                    return Err(StoreError::Invalid(
                        "legacy summary backfill requires operator authority".into(),
                    ));
                }
                self.validate_project_session(
                    &request.project_id,
                    &request.actor_id,
                    &request.session_id,
                )?;
            }
            let request_digest = serde_json::to_string(&json!({"record": request.record_json, "reason": request.reason, "source_ref": request.source_ref, "legacy_id": request.legacy_id})).map_err(|e| StoreError::Invalid(e.to_string()))?;
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "summary.backfill",
                &request.actor_id,
                Some(&request.session_id),
                Some(request.expected_project_revision),
                None,
                None,
                &request_digest,
                "legacy_summary",
                &request.legacy_id,
            )? {
                let readback: Value =
                    serde_json::from_str(&existing.result_json).map_err(|_| {
                        StoreError::Corrupt("summary backfill operation result is invalid".into())
                    })?;
                let import_id = readback
                    .get("import_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        StoreError::Corrupt("summary backfill readback has no import id".into())
                    })?;
                return self
                    .legacy_summary_backfill(&request.project_id, import_id)?
                    .ok_or_else(|| {
                        StoreError::Corrupt(
                            "summary backfill operation points to missing import".into(),
                        )
                    });
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                Some(request.expected_project_revision),
            )?;
            let import_id = format!(
                "legacy-summary-{}-{}",
                request.project_id, request.legacy_id
            );
            let mut insert = self.prepare("INSERT INTO legacy_summary_backfill_v1(import_id,project_id,legacy_id,actor_id,reason,source_ref,record_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)")?;
            insert.bind_text(1, &import_id)?;
            insert.bind_text(2, &request.project_id)?;
            insert.bind_text(3, &request.legacy_id)?;
            insert.bind_text(4, &request.actor_id)?;
            insert.bind_text(5, &request.reason)?;
            insert.bind_optional_text(6, request.source_ref.as_deref())?;
            insert.bind_text(7, &request.record_json)?;
            insert.bind_text(8, &request.created_at)?;
            insert.run()?;
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = serde_json::to_string(&json!({"import_id": import_id, "legacy_id": request.legacy_id, "proof_eligible": false})).map_err(|e| StoreError::Invalid(e.to_string()))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "summary.backfill".into(),
                    actor_id: request.actor_id.clone(),
                    session_id: Some(request.session_id.clone()),
                    expected_revision: Some(request.expected_project_revision),
                    attempt_id: None,
                    fence: None,
                    request_digest: request.record_json.clone(),
                    outcome: OperationOutcome::Changed,
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.created_at.clone(),
                    completed_at: Some(request.created_at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: "repair.correction".into(),
                    subject_type: "summary".into(),
                    subject_id: request.legacy_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: Some(request.session_id.clone()),
                    fence: None,
                    as_of: request.created_at.clone(),
                    payload_json: result_json,
                },
            )?;
            self.legacy_summary_backfill(&request.project_id, &import_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("legacy summary disappeared after import".into())
                })
        })();
        finish_transaction(self, result)
    }

    pub fn legacy_summary_backfill(
        &self,
        project_id: &str,
        import_id: &str,
    ) -> Result<Option<LegacySummaryBackfillRecord>, StoreError> {
        let mut row = self.prepare("SELECT import_id,project_id,legacy_id,actor_id,reason,source_ref,record_json,created_at FROM legacy_summary_backfill_v1 WHERE project_id=?1 AND import_id=?2")?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, import_id)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(LegacySummaryBackfillRecord {
            import_id: row.column_text(0)?,
            project_id: row.column_text(1)?,
            legacy_id: row.column_text(2)?,
            actor_id: row.column_text(3)?,
            reason: row.column_text(4)?,
            source_ref: row.column_optional_text(5)?,
            record_json: row.column_text(6)?,
            created_at: row.column_text(7)?,
        }))
    }
}

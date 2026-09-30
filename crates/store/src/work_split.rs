//! Atomic sibling-task decomposition with immutable proof lineage.

use super::*;
use crate::work_model_v3::V3MutationContext;

pub const WORK_SPLIT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_work_split_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1)
);
INSERT OR IGNORE INTO boreal_work_split_meta(singleton,version) VALUES(1,1);
CREATE TABLE IF NOT EXISTS boreal_work_split_v1 (
  split_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_work_id TEXT NOT NULL,
  child_work_id TEXT NOT NULL,
  parent_project_revision INTEGER NOT NULL,
  parent_source_version_id TEXT,
  child_source_version_id TEXT,
  proof_context_json TEXT NOT NULL,
  inherited_profile_id TEXT NOT NULL,
  inherited_profile_version INTEGER NOT NULL,
  child_profile_id TEXT NOT NULL,
  child_profile_version INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  project_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id,child_work_id),
  FOREIGN KEY(project_id,parent_work_id) REFERENCES work_item(project_id,work_id),
  FOREIGN KEY(project_id,child_work_id) REFERENCES work_item(project_id,work_id),
  FOREIGN KEY(project_id,parent_source_version_id) REFERENCES source_version(project_id,source_version_id),
  FOREIGN KEY(project_id,child_source_version_id) REFERENCES source_version(project_id,source_version_id)
);
CREATE INDEX IF NOT EXISTS boreal_work_split_parent ON boreal_work_split_v1(project_id,parent_work_id,project_revision DESC);
CREATE TRIGGER IF NOT EXISTS boreal_work_split_no_update BEFORE UPDATE ON boreal_work_split_v1
BEGIN SELECT RAISE(ABORT,'work_split_lineage_append_only'); END;
CREATE TRIGGER IF NOT EXISTS boreal_work_split_no_delete BEFORE DELETE ON boreal_work_split_v1
BEGIN SELECT RAISE(ABORT,'work_split_lineage_append_only'); END;
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkSplitMutationInput {
    pub project_id: String,
    pub split_id: String,
    pub parent_work_id: String,
    pub child_work_id: String,
    pub requested_labels: Vec<String>,
    pub acceptance_override: Option<String>,
    /// Caller-supplied override; `None` means inherit the source value.
    pub requested_priority: Option<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkSplitRecord {
    pub split_id: String,
    pub project_id: String,
    pub parent_work_id: String,
    pub child_work_id: String,
    pub parent_project_revision: u64,
    pub parent_source_version_id: Option<String>,
    pub child_source_version_id: Option<String>,
    pub proof_context_json: String,
    pub inherited_profile_id: String,
    pub inherited_profile_version: u64,
    pub child_profile_id: String,
    pub child_profile_version: u64,
    pub actor_id: String,
    pub session_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
}

impl SqliteStore {
    /// Create the sibling and its close-only blocker edge atomically. The child
    /// points to the same valid container parent as the source task; lineage
    /// is represented by this immutable record, not illegal task-to-task
    /// hierarchy or copied acceptance receipts.
    pub fn split_work_v1(
        &self,
        context: &V3MutationContext,
        input: &WorkSplitMutationInput,
        child: &WorkItem,
    ) -> Result<MutationResult, StoreError> {
        if context.project_id != input.project_id
            || child.project_id.as_str() != input.project_id
            || child.id.as_str() != input.child_work_id
            || input.parent_work_id == input.child_work_id
            || context.operation_id.trim().is_empty()
        {
            return Err(StoreError::Invalid(
                "work split identity is inconsistent".into(),
            ));
        }
        let bound = context.with_payload(json!({
            "split_id": input.split_id,
            "project_id": input.project_id,
            "parent_work_id": input.parent_work_id,
            "child_work_id": input.child_work_id,
            "requested_labels": input.requested_labels,
            "acceptance_override": input.acceptance_override,
            "title": child.title,
            "description": child.description,
            "requested_priority": input.requested_priority,
        }));
        let c = &bound;
        self.fact_mutation(
            c,
            "work.split",
            "work_split",
            &input.split_id,
            &[boreal_domain::ActorRole::Operator],
            || {
                if child.kind != WorkKind::Task
                    || child.lifecycle != PersistedLifecycle::Open
                    || child.title.trim().is_empty()
                    || child.title.len() > 512
                    || child.description.len() > 65_536
                    || !child.hard_holds.is_empty()
                    || child.acceptance_profile.gates.iter().any(|gate| gate.state != GateState::Open)
                {
                    return Err(StoreError::Invalid(
                        "split child must be a bounded, titled open task".into(),
                    ));
                }
                if self.work(&input.project_id, &input.child_work_id)?.is_some() {
                    return Err(StoreError::Conflict("split child ID already exists".into()));
                }

                let mut parent = self.prepare(
                    "SELECT kind,parent_id,lifecycle,source_version_id,acceptance_profile_id,acceptance_profile_version,priority,dispatch_policy
                     FROM work_item WHERE project_id=?1 AND work_id=?2",
                )?;
                parent.bind_text(1, &input.project_id)?;
                parent.bind_text(2, &input.parent_work_id)?;
                if parent.step()? != SQLITE_ROW {
                    return Err(StoreError::NotFound {
                        entity: "work",
                        id: input.parent_work_id.clone(),
                    });
                }
                let parent_kind = parent.column_text(0)?;
                let sibling_parent = parent.column_optional_text(1)?;
                let lifecycle = parent.column_text(2)?;
                let source_version_id = parent.column_optional_text(3)?;
                let profile_id = parent.column_text(4)?;
                let profile_version = parent.column_u64(5)?;
                let parent_priority = parent.column_u64(6)?;
                let parent_dispatch = parent.column_text(7)?;
                drop(parent);
                if parent_kind != "task" || lifecycle != "open" {
                    return Err(StoreError::Conflict(
                        "work split requires an open task as its source".into(),
                    ));
                }
                if child.parent_id.as_ref().map(WorkId::as_str) != sibling_parent.as_deref() {
                    return Err(StoreError::Invalid(
                        "split child must be a sibling under the source task's legal parent".into(),
                    ));
                }
                let expected_priority = input.requested_priority.map(u64::from).unwrap_or(parent_priority);
                if u64::from(child.priority) != expected_priority || dispatch_policy(child.dispatch_policy) != parent_dispatch {
                    return Err(StoreError::Invalid(
                        "split child must inherit source priority and dispatch, except for the requested priority override".into(),
                    ));
                }
                let mut active = self.prepare(
                    "SELECT 1 FROM attempt a JOIN work_item w ON w.project_id=?1 AND w.work_id=a.work_id
                     WHERE a.work_id=?2 AND a.current=1
                     AND a.state IN ('claimed','accepted','running','verifying','expiry_pending') LIMIT 1",
                )?;
                active.bind_text(1, &input.project_id)?;
                active.bind_text(2, &input.parent_work_id)?;
                if active.step()? == SQLITE_ROW {
                    return Err(StoreError::Conflict(
                        "work split is unavailable while the source task has an active attempt fence".into(),
                    ));
                }
                drop(active);

                match input.acceptance_override.as_deref() {
                    None if child.acceptance_profile.id.as_str() == profile_id
                        && child.acceptance_profile.version.parse::<u64>().ok() == Some(profile_version) => {}
                    Some("focused") if child.acceptance_profile == AcceptanceProfile::focused() => {}
                    Some("reviewed") if child.acceptance_profile == AcceptanceProfile::reviewed() => {}
                    _ => return Err(StoreError::Invalid(
                        "split child must inherit the source profile or use the canonical focused/reviewed profile".into(),
                    )),
                }
                let canonical_child_profile = profile_version_for_work(&child.acceptance_profile, &c.now)?;
                let mut pinned_profile = self.prepare(
                    "SELECT policy_digest,definition_json FROM acceptance_profile WHERE profile_id=?1 AND version=?2",
                )?;
                pinned_profile.bind_text(1, child.acceptance_profile.id.as_str())?;
                pinned_profile.bind_i64(2, profile_version_from_work(&child.acceptance_profile.version)?)?;
                if pinned_profile.step()? != SQLITE_ROW
                    || pinned_profile.column_text(0)? != canonical_child_profile.policy_digest
                    || pinned_profile.column_text(1)? != canonical_child_profile.definition_json
                {
                    return Err(StoreError::Conflict(
                        "split child profile does not exactly match its immutable canonical definition".into(),
                    ));
                }
                drop(pinned_profile);

                let mut inherited = self.work_labels(&input.project_id, &input.parent_work_id)?;
                let mut seen = inherited.iter().cloned().collect::<BTreeSet<_>>();
                for label in &input.requested_labels {
                    if label.is_empty()
                        || label.len() > 64
                        || !label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'_' | b'.' | b'/'))
                    {
                        return Err(StoreError::Invalid("split labels must be normalized lowercase ASCII tokens of 1..64 characters".into()));
                    }
                    if seen.insert(label.clone()) { inherited.push(label.clone()); }
                }
                if inherited.len() > 64 {
                    return Err(StoreError::Invalid("split child may have at most 64 inherited and requested labels".into()));
                }
                inherited.sort();

                // Capture every historical/current fence and receipt reference
                // for audit lineage. These remain attached to the parent and
                // never satisfy the child's acceptance gates.
                let mut attempts = self.prepare(
                    "SELECT a.attempt_id,a.fence,a.state,a.actor_id,a.session_id,a.source_version_id,a.config_identity,a.claimed_at,a.terminal_at
                     FROM attempt a JOIN work_item w ON w.project_id=?1 AND w.work_id=a.work_id
                     WHERE a.work_id=?2 ORDER BY a.fence,a.attempt_id",
                )?;
                attempts.bind_text(1, &input.project_id)?;
                attempts.bind_text(2, &input.parent_work_id)?;
                let mut attempt_rows = Vec::new();
                while attempts.step()? == SQLITE_ROW {
                    attempt_rows.push(json!({
                        "attempt_id": attempts.column_text(0)?,
                        "fence": attempts.column_u64(1)?,
                        "state": attempts.column_text(2)?,
                        "actor_id": attempts.column_text(3)?,
                        "session_id": attempts.column_optional_text(4)?,
                        "source_version_id": attempts.column_optional_text(5)?,
                        "config_identity": attempts.column_text(6)?,
                        "claimed_at": attempts.column_text(7)?,
                        "terminal_at": attempts.column_optional_text(8)?,
                    }));
                }
                drop(attempts);
                let mut receipts = self.prepare(
                    "SELECT r.receipt_id,r.operation_id,r.attempt_id,r.fence,r.gate_id,r.exit_code,
                            r.result,r.attestation,r.output_digest,r.source_version_id,r.config_identity,r.ended_at
                     FROM receipt r JOIN work_item w ON w.project_id=?1 AND w.work_id=r.work_id
                     WHERE r.work_id=?2 ORDER BY r.ended_at,r.receipt_id",
                )?;
                receipts.bind_text(1, &input.project_id)?;
                receipts.bind_text(2, &input.parent_work_id)?;
                let mut receipt_rows = Vec::new();
                while receipts.step()? == SQLITE_ROW {
                    receipt_rows.push(json!({
                        "receipt_id": receipts.column_text(0)?,
                        "operation_id": receipts.column_text(1)?,
                        "attempt_id": receipts.column_text(2)?,
                        "fence": receipts.column_u64(3)?,
                        "gate_id": receipts.column_optional_text(4)?,
                        "exit_code": receipts.column_i64(5)?,
                        "result": receipts.column_text(6)?,
                        "attestation": receipts.column_text(7)?,
                        "output_digest": receipts.column_optional_text(8)?,
                        "source_version_id": receipts.column_optional_text(9)?,
                        "config_identity": receipts.column_text(10)?,
                        "ended_at": receipts.column_text(11)?,
                    }));
                }
                drop(receipts);
                let proof_context = json!({
                    "schema": "boreal.work-split-proof-context.v1",
                    "parent_source_version_id": source_version_id,
                    "attempts": attempt_rows,
                    "receipts": receipt_rows,
                    "proofs_transferred_to_child": false,
                    "acceptance_profile_inherited_as_definition_only": true,
                });
                let proof_json = serde_json::to_string(&proof_context)
                    .map_err(|e| StoreError::Invalid(e.to_string()))?;

                self.create_work_in_transaction(child, &c.now)?;
                if let Some(source_id) = source_version_id.as_deref() {
                    let mut source = self.prepare(
                        "UPDATE work_item SET source_version_id=?3 WHERE project_id=?1 AND work_id=?2",
                    )?;
                    source.bind_text(1, &input.project_id)?;
                    source.bind_text(2, &input.child_work_id)?;
                    source.bind_text(3, source_id)?;
                    source.run()?;
                }
                for label in &inherited {
                    let mut insert = self.prepare(
                        "INSERT INTO work_label_v1(project_id,work_id,label) VALUES(?1,?2,?3)",
                    )?;
                    insert.bind_text(1, &input.project_id)?;
                    insert.bind_text(2, &input.child_work_id)?;
                    insert.bind_text(3, label)?;
                    insert.run()?;
                }
                self.add_dependency_in_transaction(
                    &input.project_id,
                    &input.child_work_id,
                    &input.parent_work_id,
                    &c.now,
                )?;
                let mut lineage = self.prepare(
                    "INSERT INTO boreal_work_split_v1
                    (split_id,project_id,parent_work_id,child_work_id,parent_project_revision,
                      parent_source_version_id,child_source_version_id,proof_context_json,
                      inherited_profile_id,inherited_profile_version,child_profile_id,
                      child_profile_version,actor_id,session_id,operation_id,project_revision,created_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
                )?;
                lineage.bind_text(1, &input.split_id)?;
                lineage.bind_text(2, &input.project_id)?;
                lineage.bind_text(3, &input.parent_work_id)?;
                lineage.bind_text(4, &input.child_work_id)?;
                lineage.bind_i64(5, c.expected_revision.ok_or_else(|| StoreError::Invalid("work split requires expected revision".into()))?)?;
                lineage.bind_optional_text(6, source_version_id.as_deref())?;
                lineage.bind_optional_text(7, source_version_id.as_deref())?;
                lineage.bind_text(8, &proof_json)?;
                lineage.bind_text(9, &profile_id)?;
                lineage.bind_i64(10, profile_version)?;
                lineage.bind_text(11, child.acceptance_profile.id.as_str())?;
                lineage.bind_i64(12, profile_version_from_work(&child.acceptance_profile.version)?)?;
                lineage.bind_text(13, &c.actor_id)?;
                lineage.bind_text(14, c.session_id.as_deref().ok_or_else(|| StoreError::Invalid("work split requires a project session".into()))?)?;
                lineage.bind_text(15, &c.operation_id)?;
                lineage.bind_i64(16, self.project_revision(&input.project_id)?.0 + 1)?;
                lineage.bind_text(17, &c.now)?;
                lineage.run()
            },
        )
    }

    pub fn work_split(
        &self,
        project: &str,
        split_id: &str,
    ) -> Result<Option<WorkSplitRecord>, StoreError> {
        let mut q = self.prepare(
            "SELECT split_id,project_id,parent_work_id,child_work_id,parent_project_revision,
                    parent_source_version_id,child_source_version_id,proof_context_json,
                    inherited_profile_id,inherited_profile_version,child_profile_id,child_profile_version,actor_id,session_id,
                    operation_id,project_revision,created_at
             FROM boreal_work_split_v1 WHERE project_id=?1 AND split_id=?2",
        )?;
        q.bind_text(1, project)?;
        q.bind_text(2, split_id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(WorkSplitRecord {
            split_id: q.column_text(0)?,
            project_id: q.column_text(1)?,
            parent_work_id: q.column_text(2)?,
            child_work_id: q.column_text(3)?,
            parent_project_revision: q.column_u64(4)?,
            parent_source_version_id: q.column_optional_text(5)?,
            child_source_version_id: q.column_optional_text(6)?,
            proof_context_json: q.column_text(7)?,
            inherited_profile_id: q.column_text(8)?,
            inherited_profile_version: q.column_u64(9)?,
            child_profile_id: q.column_text(10)?,
            child_profile_version: q.column_u64(11)?,
            actor_id: q.column_text(12)?,
            session_id: q.column_text(13)?,
            operation_id: q.column_text(14)?,
            project_revision: q.column_u64(15)?,
            created_at: q.column_text(16)?,
        }))
    }
}

fn profile_version_from_work(version: &str) -> Result<u64, StoreError> {
    version
        .parse::<u64>()
        .map_err(|_| StoreError::Invalid("acceptance profile version is not numeric".into()))
}

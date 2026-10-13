//! Additive immutable planning-contract snapshots for work requirements and
//! exact-version input references. Source bytes remain outside this module.

use super::*;

pub const DELIVERABLES_SCHEMA_VERSION: u64 = 1;
pub const DELIVERABLES_SCHEMA_SQL: &str = include_str!("../../../project/spec/deliverables-v1.sql");

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkPlanningContractWrite {
    pub work_id: String,
    pub requirements_json: String,
    pub inputs_json: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkPlanningContractRecord {
    pub project_id: String,
    pub work_id: String,
    pub contract_revision: u64,
    pub template_id: Option<String>,
    pub template_version: Option<u64>,
    pub requirements_json: String,
    pub inputs_json: String,
    pub actor_id: String,
    pub session_id: String,
    pub operation_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkPlanningContractSnapshot {
    pub project_revision: u64,
    pub contract: Option<WorkPlanningContractRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanningContractSourcePage {
    pub project_id: String,
    pub project_revision: u64,
    pub source_version_id: String,
    pub content_digest: String,
    pub limit: u64,
    pub offset: u64,
    pub total: u64,
    pub has_more: bool,
    pub next_offset: Option<u64>,
    pub contracts: Vec<WorkPlanningContractRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemplatePrefixRecord {
    pub project_id: String,
    pub id_prefix: String,
    pub template_id: String,
    pub template_version: u64,
    pub project_revision: u64,
    pub operation_id: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemplatePrefixItemRecord {
    pub project_id: String,
    pub id_prefix: String,
    pub item_key: String,
    pub work_id: String,
    pub state_json: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemplatePrefixItemWrite {
    pub item_key: String,
    pub work_id: String,
}

impl SqliteStore {
    /// Install or verify the additive planning-contract feature schema. The
    /// declaration and its SQL live together so every writer uses one version.
    pub fn ensure_deliverables_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema(
            "deliverables",
            DELIVERABLES_SCHEMA_VERSION,
            DELIVERABLES_SCHEMA_SQL,
        )?;
        for table in [
            "work_planning_contract_v1",
            "work_template_prefix_v1",
            "work_template_prefix_history_v1",
            "work_template_prefix_item_v1",
        ] {
            if !self.table_exists(table)? {
                return Err(StoreError::Corrupt(format!(
                    "deliverables feature schema is missing table {table}"
                )));
            }
        }
        Ok(())
    }

    /// Returns the current immutable contract snapshot, or `None` for legacy
    /// work that predates optional deliverable declarations.
    pub fn work_planning_contract(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<WorkPlanningContractRecord>, StoreError> {
        if !self.table_exists("work_planning_contract_v1")? {
            return Ok(None);
        }
        let mut row = self.prepare(
            "SELECT project_id,work_id,contract_revision,template_id,template_version,
                    requirements_json,inputs_json,actor_id,session_id,operation_id,created_at
             FROM work_planning_contract_v1
             WHERE project_id=?1 AND work_id=?2
             ORDER BY contract_revision DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(planning_contract_from_row(&row)?))
    }

    /// Read the project revision and current planning snapshot from one stable
    /// SQLite read transaction. Legacy work returns `contract: None`.
    pub fn work_planning_contract_snapshot(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<WorkPlanningContractSnapshot, StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project_id)?.0;
            if self.work(project_id, work_id)?.is_none() {
                return Err(StoreError::NotFound {
                    entity: "work",
                    id: work_id.to_owned(),
                });
            }
            Ok(WorkPlanningContractSnapshot {
                project_revision: revision,
                contract: self.work_planning_contract(project_id, work_id)?,
            })
        })();
        finish_transaction(self, result)
    }

    /// Find current planning snapshots that pin one exact immutable source
    /// identity. This read never changes the link and is bounded to 1..=1000
    /// work contracts for source replacement/reconciliation flows.
    pub fn planning_contracts_referencing_source(
        &self,
        project_id: &str,
        source_version_id: &str,
        content_digest: &str,
        expected_project_revision: Option<u64>,
        limit: u64,
        offset: u64,
    ) -> Result<PlanningContractSourcePage, StoreError> {
        if !(1..=1000).contains(&limit)
            || offset > i64::MAX as u64
            || source_version_id.trim().is_empty()
            || content_digest.trim().is_empty()
        {
            return Err(StoreError::Invalid(
                "planning source lookup requires a source identity, digest, limit 1..=1000, and bounded offset".into(),
            ));
        }
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project_id)?.0;
            if let Some(expected) = expected_project_revision {
                if expected != revision {
                    return Err(StoreError::StaleRevision {
                        expected,
                        actual: revision,
                    });
                }
            }
            if !self.table_exists("work_planning_contract_v1")? {
                return Ok(PlanningContractSourcePage {
                    project_id: project_id.to_owned(),
                    project_revision: revision,
                    source_version_id: source_version_id.to_owned(),
                    content_digest: content_digest.to_owned(),
                    limit,
                    offset,
                    total: 0,
                    has_more: false,
                    next_offset: None,
                    contracts: Vec::new(),
                });
            }
            let match_query = "WITH current_contract AS (
               SELECT project_id,work_id,MAX(contract_revision) AS contract_revision
               FROM work_planning_contract_v1 WHERE project_id=?1 GROUP BY project_id,work_id
             )
             SELECT COUNT(DISTINCT p.work_id)
             FROM current_contract c
             JOIN work_planning_contract_v1 p
               ON p.project_id=c.project_id AND p.work_id=c.work_id
              AND p.contract_revision=c.contract_revision
             JOIN json_each(p.inputs_json) input
             WHERE p.project_id=?1
               AND json_extract(input.value,'$.project_id')=?1
               AND json_extract(input.value,'$.source_version_id')=?2
               AND json_extract(input.value,'$.content_digest')=?3";
            let mut count = self.prepare(match_query)?;
            count.bind_text(1, project_id)?;
            count.bind_text(2, source_version_id)?;
            count.bind_text(3, content_digest)?;
            if count.step()? != SQLITE_ROW {
                return Err(StoreError::Corrupt(
                    "source-reference count query returned no row".into(),
                ));
            }
            let total = count.column_u64(0)?;
            drop(count);
            let mut rows = self.prepare(
            "WITH current_contract AS (
               SELECT project_id,work_id,MAX(contract_revision) AS contract_revision
               FROM work_planning_contract_v1 WHERE project_id=?1 GROUP BY project_id,work_id
             )
             SELECT p.project_id,p.work_id,p.contract_revision,p.template_id,p.template_version,
                    p.requirements_json,p.inputs_json,p.actor_id,p.session_id,p.operation_id,p.created_at
             FROM current_contract c
             JOIN work_planning_contract_v1 p
               ON p.project_id=c.project_id AND p.work_id=c.work_id
              AND p.contract_revision=c.contract_revision
             JOIN json_each(p.inputs_json) input
             WHERE p.project_id=?1
               AND json_extract(input.value,'$.project_id')=?1
               AND json_extract(input.value,'$.source_version_id')=?2
               AND json_extract(input.value,'$.content_digest')=?3
             GROUP BY p.project_id,p.work_id
             ORDER BY p.work_id LIMIT ?4 OFFSET ?5",
        )?;
            rows.bind_text(1, project_id)?;
            rows.bind_text(2, source_version_id)?;
            rows.bind_text(3, content_digest)?;
            rows.bind_i64(4, limit)?;
            rows.bind_i64(5, offset)?;
            let mut contracts = Vec::new();
            while rows.step()? == SQLITE_ROW {
                contracts.push(planning_contract_from_row(&rows)?);
            }
            let next_offset = offset
                .checked_add(contracts.len() as u64)
                .filter(|next| *next < total);
            Ok(PlanningContractSourcePage {
                project_id: project_id.to_owned(),
                project_revision: revision,
                source_version_id: source_version_id.to_owned(),
                content_digest: content_digest.to_owned(),
                limit,
                offset,
                total,
                has_more: next_offset.is_some(),
                next_offset,
                contracts,
            })
        })();
        finish_transaction(self, result)
    }

    pub fn work_template_prefix(
        &self,
        project_id: &str,
        id_prefix: &str,
    ) -> Result<Option<TemplatePrefixRecord>, StoreError> {
        if !self.table_exists("work_template_prefix_v1")? {
            return Ok(None);
        }
        let mut row = self.prepare(
            "SELECT project_id,id_prefix,template_id,template_version,project_revision,
                    operation_id,updated_at
             FROM work_template_prefix_v1 WHERE project_id=?1 AND id_prefix=?2",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, id_prefix)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(TemplatePrefixRecord {
            project_id: row.column_text(0)?,
            id_prefix: row.column_text(1)?,
            template_id: row.column_text(2)?,
            template_version: row.column_u64(3)?,
            project_revision: row.column_u64(4)?,
            operation_id: row.column_text(5)?,
            updated_at: row.column_text(6)?,
        }))
    }

    pub fn work_template_prefix_items(
        &self,
        project_id: &str,
        id_prefix: &str,
    ) -> Result<Vec<TemplatePrefixItemRecord>, StoreError> {
        if !self.table_exists("work_template_prefix_item_v1")? {
            return Ok(Vec::new());
        }
        let mut rows = self.prepare(
            "SELECT project_id,id_prefix,item_key,work_id,state_json,updated_at
             FROM work_template_prefix_item_v1
             WHERE project_id=?1 AND id_prefix=?2 ORDER BY item_key",
        )?;
        rows.bind_text(1, project_id)?;
        rows.bind_text(2, id_prefix)?;
        let mut items = Vec::new();
        while rows.step()? == SQLITE_ROW {
            items.push(TemplatePrefixItemRecord {
                project_id: rows.column_text(0)?,
                id_prefix: rows.column_text(1)?,
                item_key: rows.column_text(2)?,
                work_id: rows.column_text(3)?,
                state_json: rows.column_text(4)?,
                updated_at: rows.column_text(5)?,
            });
        }
        Ok(items)
    }

    pub(crate) fn insert_planning_contract_in_transaction(
        &self,
        project_id: &str,
        write: &WorkPlanningContractWrite,
        template_id: Option<&str>,
        template_version: Option<u64>,
        actor_id: &str,
        session_id: &str,
        operation_id: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        self.validate_planning_contract_json(
            project_id,
            &write.requirements_json,
            &write.inputs_json,
        )?;
        let mut insert = self.prepare(
            "INSERT INTO work_planning_contract_v1
             (project_id,work_id,contract_revision,template_id,template_version,
              requirements_json,inputs_json,actor_id,session_id,operation_id,created_at)
             VALUES (?1,?2,1,?3,?4,?5,?6,?7,?8,?9,?10)",
        )?;
        insert.bind_text(1, project_id)?;
        insert.bind_text(2, &write.work_id)?;
        insert.bind_optional_text(3, template_id)?;
        insert.bind_optional_i64(4, template_version)?;
        insert.bind_text(5, &write.requirements_json)?;
        insert.bind_text(6, &write.inputs_json)?;
        insert.bind_text(7, actor_id)?;
        insert.bind_text(8, session_id)?;
        insert.bind_text(9, operation_id)?;
        insert.bind_text(10, now)?;
        insert.run()
    }

    pub(crate) fn append_planning_contract_in_transaction(
        &self,
        project_id: &str,
        write: &WorkPlanningContractWrite,
        template_id: Option<&str>,
        template_version: Option<u64>,
        actor_id: &str,
        session_id: &str,
        operation_id: &str,
        now: &str,
    ) -> Result<u64, StoreError> {
        self.validate_planning_contract_json(
            project_id,
            &write.requirements_json,
            &write.inputs_json,
        )?;
        let current = self
            .work_planning_contract(project_id, &write.work_id)?
            .map(|record| record.contract_revision)
            .unwrap_or(0);
        let next = current
            .checked_add(1)
            .ok_or_else(|| StoreError::Invalid("planning contract revision overflow".into()))?;
        let mut insert = self.prepare(
            "INSERT INTO work_planning_contract_v1
             (project_id,work_id,contract_revision,template_id,template_version,
              requirements_json,inputs_json,actor_id,session_id,operation_id,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        )?;
        insert.bind_text(1, project_id)?;
        insert.bind_text(2, &write.work_id)?;
        insert.bind_i64(3, next)?;
        insert.bind_optional_text(4, template_id)?;
        insert.bind_optional_i64(5, template_version)?;
        insert.bind_text(6, &write.requirements_json)?;
        insert.bind_text(7, &write.inputs_json)?;
        insert.bind_text(8, actor_id)?;
        insert.bind_text(9, session_id)?;
        insert.bind_text(10, operation_id)?;
        insert.bind_text(11, now)?;
        insert.run()?;
        Ok(next)
    }

    pub(crate) fn validate_planning_contract_json(
        &self,
        project_id: &str,
        requirements_json: &str,
        inputs_json: &str,
    ) -> Result<(), StoreError> {
        let inputs = validate_planning_contract_json(project_id, requirements_json, inputs_json)?;
        for input in inputs {
            let source = self
                .source_version(project_id, &input.source_version_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "source version",
                    id: input.source_version_id.clone(),
                })?;
            if source.content_digest != input.content_digest || source.access_scope != input.scope {
                return Err(StoreError::Conflict(format!(
                    "input source {} no longer matches its pinned digest and scope",
                    input.source_version_id
                )));
            }
            if let Some((producer_work, producer_attempt, _producer_result)) = input.produced_by {
                let mut attempt = self.prepare(
                    "SELECT a.work_id FROM attempt a
                     JOIN work_item w ON w.work_id=a.work_id
                     WHERE w.project_id=?1 AND a.attempt_id=?2",
                )?;
                attempt.bind_text(1, project_id)?;
                attempt.bind_text(2, &producer_attempt)?;
                if attempt.step()? != SQLITE_ROW || attempt.column_text(0)? != producer_work {
                    return Err(StoreError::Conflict(
                        "input producer provenance does not match a same-project attempt".into(),
                    ));
                }
            }
        }
        Ok(())
    }

    pub(crate) fn insert_template_prefix_in_transaction(
        &self,
        project_id: &str,
        id_prefix: &str,
        template_id: &str,
        template_version: u64,
        project_revision: u64,
        operation_id: &str,
        actor_id: &str,
        session_id: &str,
        item_writes: &[TemplatePrefixItemWrite],
        now: &str,
    ) -> Result<(), StoreError> {
        let mut head = self.prepare(
            "INSERT INTO work_template_prefix_v1
             (project_id,id_prefix,template_id,template_version,project_revision,operation_id,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
        )?;
        head.bind_text(1, project_id)?;
        head.bind_text(2, id_prefix)?;
        head.bind_text(3, template_id)?;
        head.bind_i64(4, template_version)?;
        head.bind_i64(5, project_revision)?;
        head.bind_text(6, operation_id)?;
        head.bind_text(7, now)?;
        head.run()?;
        self.insert_template_prefix_history_in_transaction(
            project_id,
            id_prefix,
            template_id,
            template_version,
            project_revision,
            operation_id,
            actor_id,
            session_id,
            now,
        )?;
        for item in item_writes {
            let state_json = self.template_prefix_item_state_json(project_id, &item.work_id)?;
            let mut insert = self.prepare(
                "INSERT INTO work_template_prefix_item_v1
                 (project_id,id_prefix,item_key,work_id,state_json,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6)",
            )?;
            insert.bind_text(1, project_id)?;
            insert.bind_text(2, id_prefix)?;
            insert.bind_text(3, &item.item_key)?;
            insert.bind_text(4, &item.work_id)?;
            insert.bind_text(5, &state_json)?;
            insert.bind_text(6, now)?;
            insert.run()?;
        }
        Ok(())
    }

    pub(crate) fn insert_template_prefix_history_in_transaction(
        &self,
        project_id: &str,
        id_prefix: &str,
        template_id: &str,
        template_version: u64,
        project_revision: u64,
        operation_id: &str,
        actor_id: &str,
        session_id: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        let mut insert = self.prepare(
            "INSERT INTO work_template_prefix_history_v1
             (project_id,id_prefix,template_id,template_version,project_revision,
              operation_id,actor_id,session_id,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        )?;
        insert.bind_text(1, project_id)?;
        insert.bind_text(2, id_prefix)?;
        insert.bind_text(3, template_id)?;
        insert.bind_i64(4, template_version)?;
        insert.bind_i64(5, project_revision)?;
        insert.bind_text(6, operation_id)?;
        insert.bind_text(7, actor_id)?;
        insert.bind_text(8, session_id)?;
        insert.bind_text(9, now)?;
        insert.run()
    }

    pub(crate) fn update_template_prefix_head_in_transaction(
        &self,
        project_id: &str,
        id_prefix: &str,
        template_id: &str,
        template_version: u64,
        project_revision: u64,
        operation_id: &str,
        actor_id: &str,
        session_id: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        let mut update = self.prepare(
            "UPDATE work_template_prefix_v1
             SET template_id=?3,template_version=?4,project_revision=?5,operation_id=?6,updated_at=?7
             WHERE project_id=?1 AND id_prefix=?2",
        )?;
        update.bind_text(1, project_id)?;
        update.bind_text(2, id_prefix)?;
        update.bind_text(3, template_id)?;
        update.bind_i64(4, template_version)?;
        update.bind_i64(5, project_revision)?;
        update.bind_text(6, operation_id)?;
        update.bind_text(7, now)?;
        update.run()?;
        if update.changes()? != 1 {
            return Err(StoreError::Conflict(
                "template prefix changed while applying amendment".into(),
            ));
        }
        self.insert_template_prefix_history_in_transaction(
            project_id,
            id_prefix,
            template_id,
            template_version,
            project_revision,
            operation_id,
            actor_id,
            session_id,
            now,
        )
    }

    pub(crate) fn update_template_prefix_item_state_in_transaction(
        &self,
        project_id: &str,
        id_prefix: &str,
        item_key: &str,
        work_id: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        let state_json = self.template_prefix_item_state_json(project_id, work_id)?;
        let mut update = self.prepare(
            "UPDATE work_template_prefix_item_v1
             SET state_json=?5,updated_at=?6
             WHERE project_id=?1 AND id_prefix=?2 AND item_key=?3 AND work_id=?4",
        )?;
        update.bind_text(1, project_id)?;
        update.bind_text(2, id_prefix)?;
        update.bind_text(3, item_key)?;
        update.bind_text(4, work_id)?;
        update.bind_text(5, &state_json)?;
        update.bind_text(6, now)?;
        update.run()?;
        if update.changes()? != 1 {
            return Err(StoreError::Conflict(format!(
                "template prefix item {item_key} changed while applying amendment"
            )));
        }
        Ok(())
    }

    pub(crate) fn insert_template_prefix_item_in_transaction(
        &self,
        project_id: &str,
        id_prefix: &str,
        item_key: &str,
        work_id: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        let state_json = self.template_prefix_item_state_json(project_id, work_id)?;
        let mut insert = self.prepare(
            "INSERT INTO work_template_prefix_item_v1
             (project_id,id_prefix,item_key,work_id,state_json,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
        )?;
        insert.bind_text(1, project_id)?;
        insert.bind_text(2, id_prefix)?;
        insert.bind_text(3, item_key)?;
        insert.bind_text(4, work_id)?;
        insert.bind_text(5, &state_json)?;
        insert.bind_text(6, now)?;
        insert.run()
    }

    pub(crate) fn template_prefix_item_state_json(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<String, StoreError> {
        let mut work = self.prepare(
            "SELECT kind,parent_id,lifecycle,dispatch_policy,priority,title,description,
                    acceptance_profile_id,acceptance_profile_version
             FROM work_item WHERE project_id=?1 AND work_id=?2",
        )?;
        work.bind_text(1, project_id)?;
        work.bind_text(2, work_id)?;
        if work.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work",
                id: work_id.to_owned(),
            });
        }
        let work_value = json!({
            "kind": work.column_text(0)?,
            "parent_id": work.column_optional_text(1)?,
            "lifecycle": work.column_text(2)?,
            "dispatch_policy": work.column_text(3)?,
            "priority": work.column_u64(4)?,
            "title": work.column_text(5)?,
            "description": work.column_text(6)?,
            "acceptance_profile_id": work.column_text(7)?,
            "acceptance_profile_version": work.column_u64(8)?,
        });
        drop(work);
        let mut dependencies = self.prepare(
            "SELECT prerequisite_id,satisfaction_policy,policy_version
             FROM dependency WHERE project_id=?1 AND dependent_id=?2
             ORDER BY prerequisite_id",
        )?;
        dependencies.bind_text(1, project_id)?;
        dependencies.bind_text(2, work_id)?;
        let mut dependency_values = Vec::new();
        while dependencies.step()? == SQLITE_ROW {
            dependency_values.push(json!({
                "prerequisite_id": dependencies.column_text(0)?,
                "satisfaction_policy": dependencies.column_text(1)?,
                "policy_version": dependencies.column_text(2)?,
            }));
        }
        let mut labels = self.prepare(
            "SELECT label FROM work_label_v1
             WHERE project_id=?1 AND work_id=?2 ORDER BY label",
        )?;
        labels.bind_text(1, project_id)?;
        labels.bind_text(2, work_id)?;
        let mut label_values = Vec::new();
        while labels.step()? == SQLITE_ROW {
            label_values.push(labels.column_text(0)?);
        }
        let contract = self.work_planning_contract(project_id, work_id)?;
        let (contract_revision, requirements, inputs) = if let Some(record) = contract {
            let requirements = serde_json::from_str(&record.requirements_json).map_err(|_| {
                StoreError::Corrupt("template planning requirements are invalid JSON".into())
            })?;
            let inputs = serde_json::from_str(&record.inputs_json).map_err(|_| {
                StoreError::Corrupt("template planning inputs are invalid JSON".into())
            })?;
            (record.contract_revision, requirements, inputs)
        } else {
            (0, json!([]), json!([]))
        };
        serde_json::to_string(&json!({
            "work": work_value,
            "dependencies": dependency_values,
            "labels": label_values,
            "contract_revision": contract_revision,
            "deliverables": requirements,
            "inputs": inputs,
        }))
        .map_err(|error| StoreError::Invalid(format!("cannot encode template state: {error}")))
    }
}

fn planning_contract_from_row(
    row: &Statement<'_>,
) -> Result<WorkPlanningContractRecord, StoreError> {
    Ok(WorkPlanningContractRecord {
        project_id: row.column_text(0)?,
        work_id: row.column_text(1)?,
        contract_revision: row.column_u64(2)?,
        template_id: row.column_optional_text(3)?,
        template_version: row
            .column_optional_i64(4)?
            .map(u64::try_from)
            .transpose()
            .map_err(|_| StoreError::Corrupt("negative template version".into()))?,
        requirements_json: row.column_text(5)?,
        inputs_json: row.column_text(6)?,
        actor_id: row.column_text(7)?,
        session_id: row.column_text(8)?,
        operation_id: row.column_text(9)?,
        created_at: row.column_text(10)?,
    })
}

struct ValidatedPlanningInput {
    source_version_id: String,
    content_digest: String,
    scope: String,
    produced_by: Option<(String, String, String)>,
}

fn validate_planning_contract_json(
    project_id: &str,
    requirements_json: &str,
    inputs_json: &str,
) -> Result<Vec<ValidatedPlanningInput>, StoreError> {
    let requirements = serde_json::from_str::<Value>(requirements_json)
        .map_err(|error| StoreError::Invalid(format!("invalid requirements JSON: {error}")))?;
    let requirements = requirements.as_array().ok_or_else(|| {
        StoreError::Invalid("deliverable requirements must be a JSON array".into())
    })?;
    if requirements.len() > boreal_domain::MAX_DELIVERABLE_REQUIREMENTS {
        return Err(StoreError::Invalid(
            "too many deliverable requirements".into(),
        ));
    }
    let mut requirement_keys = BTreeSet::new();
    for requirement in requirements {
        validate_deliverable_requirement_json(requirement)?;
        let key = requirement["key"].as_str().expect("validated key");
        if !requirement_keys.insert(key) {
            return Err(StoreError::Invalid(
                "deliverable requirement keys must be unique".into(),
            ));
        }
    }
    let inputs = serde_json::from_str::<Value>(inputs_json)
        .map_err(|error| StoreError::Invalid(format!("invalid input references JSON: {error}")))?;
    let inputs = inputs
        .as_array()
        .ok_or_else(|| StoreError::Invalid("input references must be a JSON array".into()))?;
    if inputs.len() > 100 {
        return Err(StoreError::Invalid(
            "a work item may have at most 100 input references".into(),
        ));
    }
    let mut input_identities = BTreeSet::new();
    let mut validated_inputs = Vec::with_capacity(inputs.len());
    for input in inputs {
        if !has_exact_keys(
            input,
            &[
                "project_id",
                "source_version_id",
                "content_digest",
                "role",
                "scope",
                "produced_by",
            ],
        ) {
            return Err(StoreError::Invalid(
                "input references must contain only stable identity, role, scope, and producer fields".into(),
            ));
        }
        let source_project = input
            .get("project_id")
            .and_then(Value::as_str)
            .ok_or_else(|| StoreError::Invalid("input reference has no project id".into()))?;
        let source_version = input
            .get("source_version_id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                StoreError::Invalid("input reference has no source version id".into())
            })?;
        let content_digest = input
            .get("content_digest")
            .and_then(Value::as_str)
            .ok_or_else(|| StoreError::Invalid("input reference has no content digest".into()))?;
        let scope = input
            .get("scope")
            .and_then(Value::as_str)
            .ok_or_else(|| StoreError::Invalid("input reference has no access scope".into()))?;
        let role = input
            .get("role")
            .and_then(Value::as_str)
            .ok_or_else(|| StoreError::Invalid("input reference has no role".into()))?;
        if source_project != project_id
            || source_version.is_empty()
            || content_digest.trim().is_empty()
            || content_digest.len() > 255
            || !matches!(scope, "project" | "private")
            || !matches!(role, "context" | "accepted_input" | "reference")
            || !input_identities.insert((source_version, role))
        {
            return Err(StoreError::Invalid(
                "input references must be unique, typed, digest-pinned, and project-scoped".into(),
            ));
        }
        let produced_by = if let Some(producer) = input.get("produced_by").filter(|v| !v.is_null())
        {
            if !has_exact_keys(producer, &["work_id", "attempt_id", "result_id"]) {
                return Err(StoreError::Invalid(
                    "input producer provenance must contain work, attempt, and result ids".into(),
                ));
            }
            let producer_work = producer
                .get("work_id")
                .and_then(Value::as_str)
                .ok_or_else(|| StoreError::Invalid("input producer has no work id".into()))?;
            let producer_attempt = producer
                .get("attempt_id")
                .and_then(Value::as_str)
                .ok_or_else(|| StoreError::Invalid("input producer has no attempt id".into()))?;
            let producer_result = producer
                .get("result_id")
                .and_then(Value::as_str)
                .ok_or_else(|| StoreError::Invalid("input producer has no result id".into()))?;
            if producer_result.trim().is_empty() || producer_result.len() > 255 {
                return Err(StoreError::Invalid(
                    "input producer result id must contain 1..255 bytes".into(),
                ));
            }
            Some((
                producer_work.to_owned(),
                producer_attempt.to_owned(),
                producer_result.to_owned(),
            ))
        } else {
            None
        };
        validated_inputs.push(ValidatedPlanningInput {
            source_version_id: source_version.to_owned(),
            content_digest: content_digest.to_owned(),
            scope: scope.to_owned(),
            produced_by,
        });
    }
    Ok(validated_inputs)
}

fn validate_deliverable_requirement_json(requirement: &Value) -> Result<(), StoreError> {
    if !has_exact_keys(
        requirement,
        &[
            "key",
            "purpose",
            "required",
            "deliverable_type",
            "allowed_media_types",
            "min_count",
            "max_count",
            "criteria",
        ],
    ) {
        return Err(StoreError::Invalid(
            "deliverable requirement has an invalid shape".into(),
        ));
    }
    let key = requirement["key"]
        .as_str()
        .ok_or_else(|| StoreError::Invalid("deliverable requirement has no key".into()))?;
    let purpose = requirement["purpose"]
        .as_str()
        .ok_or_else(|| StoreError::Invalid("deliverable requirement has no purpose".into()))?;
    let required = requirement["required"].as_bool().ok_or_else(|| {
        StoreError::Invalid("deliverable requirement has no required flag".into())
    })?;
    if !valid_planning_key(key)
        || purpose.trim().is_empty()
        || purpose.len() > 4096
        || purpose.contains('\0')
        || !matches!(
            requirement["deliverable_type"].as_str(),
            Some("code" | "document" | "image" | "dataset" | "report" | "archive" | "other")
        )
    {
        return Err(StoreError::Invalid(
            "deliverable requirement identity, type, or purpose is invalid".into(),
        ));
    }
    let min_count = requirement["min_count"]
        .as_u64()
        .filter(|value| *value <= u64::from(boreal_domain::MAX_REQUIREMENT_CARDINALITY))
        .ok_or_else(|| StoreError::Invalid("deliverable minimum count is invalid".into()))?
        as u32;
    let max_count = requirement["max_count"]
        .as_u64()
        .filter(|value| *value <= u64::from(boreal_domain::MAX_REQUIREMENT_CARDINALITY))
        .ok_or_else(|| StoreError::Invalid("deliverable maximum count is invalid".into()))?
        as u32;
    if min_count > max_count || (required && min_count == 0) || (!required && min_count != 0) {
        return Err(StoreError::Invalid(
            "deliverable cardinality conflicts with its required flag".into(),
        ));
    }
    let media_types = requirement["allowed_media_types"]
        .as_array()
        .filter(|types| types.len() <= boreal_domain::MAX_REQUIREMENT_MEDIA_TYPES)
        .ok_or_else(|| StoreError::Invalid("deliverable media types are invalid".into()))?;
    let mut seen_media = BTreeSet::new();
    for media_type in media_types {
        let media_type = media_type
            .as_str()
            .ok_or_else(|| StoreError::Invalid("deliverable media type is not a string".into()))?;
        if !valid_planning_media_type(media_type) || !seen_media.insert(media_type) {
            return Err(StoreError::Invalid(
                "deliverable media types must be unique normalized MIME types".into(),
            ));
        }
    }
    let criteria = requirement["criteria"]
        .as_array()
        .filter(|criteria| criteria.len() <= boreal_domain::MAX_REQUIREMENT_CRITERIA)
        .ok_or_else(|| StoreError::Invalid("deliverable criteria are invalid".into()))?;
    let mut seen_criteria = BTreeSet::new();
    let mut minimum_bytes = None;
    let mut maximum_bytes = None;
    for criterion in criteria {
        let kind = criterion
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| StoreError::Invalid("deliverable criterion has no kind".into()))?;
        let identity = match kind {
            "min_bytes" | "max_bytes" => {
                if !has_exact_keys(criterion, &["kind", "value"]) {
                    return Err(StoreError::Invalid(
                        "byte criterion has an invalid shape".into(),
                    ));
                }
                let value = criterion["value"]
                    .as_u64()
                    .filter(|value| {
                        *value <= boreal_domain::MAX_CRITERION_BYTES
                            && (kind != "max_bytes" || *value > 0)
                    })
                    .ok_or_else(|| {
                        StoreError::Invalid("byte criterion is outside its bound".into())
                    })?;
                if kind == "min_bytes" {
                    minimum_bytes = Some(value);
                } else {
                    maximum_bytes = Some(value);
                }
                kind.to_owned()
            }
            "json_document" => {
                if !has_exact_keys(criterion, &["kind"]) {
                    return Err(StoreError::Invalid(
                        "JSON criterion has an invalid shape".into(),
                    ));
                }
                kind.to_owned()
            }
            "text_contains" => {
                if !has_exact_keys(criterion, &["kind", "text"]) {
                    return Err(StoreError::Invalid(
                        "text criterion has an invalid shape".into(),
                    ));
                }
                let text = criterion["text"]
                    .as_str()
                    .filter(|text| {
                        !text.trim().is_empty()
                            && text.len() <= 256
                            && !text.chars().any(char::is_control)
                    })
                    .ok_or_else(|| {
                        StoreError::Invalid("text criterion is outside its bound".into())
                    })?;
                format!("{kind}:{text}")
            }
            _ => {
                return Err(StoreError::Invalid(
                    "unknown deliverable criterion kind".into(),
                ))
            }
        };
        if !seen_criteria.insert(identity) {
            return Err(StoreError::Invalid(
                "deliverable criteria must be unique".into(),
            ));
        }
    }
    if minimum_bytes
        .zip(maximum_bytes)
        .is_some_and(|(minimum, maximum)| minimum > maximum)
    {
        return Err(StoreError::Invalid(
            "deliverable minimum byte criterion exceeds its maximum".into(),
        ));
    }
    Ok(())
}

fn has_exact_keys(value: &Value, expected: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
    })
}

fn valid_planning_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_' | b'.')
        })
}

fn valid_planning_media_type(value: &str) -> bool {
    if value.is_empty() || value.len() > 127 || value != value.to_ascii_lowercase() {
        return false;
    }
    let Some((kind, subtype)) = value.split_once('/') else {
        return false;
    };
    !kind.is_empty()
        && !subtype.is_empty()
        && kind.bytes().all(planning_media_token_byte)
        && (subtype == "*" || subtype.bytes().all(planning_media_token_byte))
}

fn planning_media_token_byte(byte: u8) -> bool {
    byte.is_ascii_lowercase()
        || byte.is_ascii_digit()
        || matches!(
            byte,
            b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::{ProjectId, WorkId, WorkItem, WorkKind};

    const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

    fn add_source(store: &SqliteStore, id: &str, digest: &str) {
        let mut insert = store
            .prepare(
                "INSERT INTO source_version
                 (source_version_id,project_id,origin,access_scope,content_digest,media_type,
                  byte_count,captured_at,parser_identity,availability,citation_json)
                 VALUES (?1,'planning-test','test','project',?2,'text/plain',0,'unix-ms:1',
                         'test-parser','available','{}')",
            )
            .unwrap();
        insert.bind_text(1, id).unwrap();
        insert.bind_text(2, digest).unwrap();
        insert.run().unwrap();
    }

    fn add_contract(store: &SqliteStore, work_id: &str, source_id: &str, digest: &str) {
        let inputs = json!([{
            "project_id": "planning-test",
            "source_version_id": source_id,
            "content_digest": digest,
            "role": "context",
            "scope": "project",
            "produced_by": null
        }]);
        store
            .insert_planning_contract_in_transaction(
                "planning-test",
                &WorkPlanningContractWrite {
                    work_id: work_id.to_owned(),
                    requirements_json: "[]".into(),
                    inputs_json: inputs.to_string(),
                },
                None,
                None,
                "planner",
                "planner-session",
                &format!("contract-{work_id}"),
                "unix-ms:2",
            )
            .unwrap();
    }

    #[test]
    fn source_reference_pages_are_exact_revisioned_and_deterministic() {
        let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
        store
            .install_feature_schema("agent_tools", 1, crate::AGENT_TOOLS_SCHEMA)
            .unwrap();
        store.create_project("planning-test", "unix-ms:1").unwrap();
        store.ensure_deliverables_schema().unwrap();
        add_source(&store, "source-one", "sha256:one");
        add_source(&store, "source-two", "sha256:two");
        for id in ["work-a", "work-b", "work-c"] {
            let work = WorkItem::new(
                ProjectId::new("planning-test"),
                WorkId::new(id),
                WorkKind::Task,
                None,
                id,
            );
            store.create_work(&work, "unix-ms:2").unwrap();
        }
        add_contract(&store, "work-a", "source-one", "sha256:one");
        add_contract(&store, "work-b", "source-one", "sha256:one");
        add_contract(&store, "work-c", "source-two", "sha256:two");

        let first = store
            .planning_contracts_referencing_source(
                "planning-test",
                "source-one",
                "sha256:one",
                Some(0),
                1,
                0,
            )
            .unwrap();
        assert_eq!(first.total, 2);
        assert_eq!(first.contracts[0].work_id, "work-a");
        assert!(first.has_more);
        assert_eq!(first.next_offset, Some(1));

        let second = store
            .planning_contracts_referencing_source(
                "planning-test",
                "source-one",
                "sha256:one",
                Some(first.project_revision),
                first.limit,
                first.next_offset.unwrap(),
            )
            .unwrap();
        assert_eq!(second.total, 2);
        assert_eq!(second.contracts[0].work_id, "work-b");
        assert!(!second.has_more);
        assert_eq!(second.next_offset, None);

        let snapshot = store
            .work_planning_contract_snapshot("planning-test", "work-a")
            .unwrap();
        assert_eq!(snapshot.project_revision, 0);
        assert_eq!(snapshot.contract.unwrap().contract_revision, 1);

        store.execute_batch("BEGIN IMMEDIATE").unwrap();
        store.bump_revision_in_transaction("planning-test").unwrap();
        finish_transaction(&store, Ok(())).unwrap();
        assert!(matches!(
            store.planning_contracts_referencing_source(
                "planning-test",
                "source-one",
                "sha256:one",
                Some(0),
                1,
                0,
            ),
            Err(StoreError::StaleRevision {
                expected: 0,
                actual: 1
            })
        ));
    }

    #[test]
    fn persisted_contract_validation_rejects_paths_and_invalid_requirement_shapes() {
        let requirement = json!([{
            "key": "report",
            "purpose": "Provide a report",
            "required": true,
            "deliverable_type": "report",
            "allowed_media_types": ["application/pdf"],
            "min_count": 1,
            "max_count": 1,
            "criteria": []
        }]);
        assert!(validate_planning_contract_json("p", &requirement.to_string(), "[]").is_ok());

        let mut invalid_requirement = requirement.clone();
        invalid_requirement[0]["required"] = json!(false);
        assert!(
            validate_planning_contract_json("p", &invalid_requirement.to_string(), "[]").is_err()
        );

        let path_reference = json!([{
            "project_id": "p",
            "source_version_id": "source-1",
            "content_digest": "sha256:abc",
            "role": "context",
            "scope": "project",
            "produced_by": null,
            "path": "/private/source"
        }]);
        assert!(validate_planning_contract_json("p", "[]", &path_reference.to_string()).is_err());
    }
}

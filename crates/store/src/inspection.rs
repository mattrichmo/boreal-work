//! Revision-consistent, project-scoped operational inspection.
use super::*;

impl SqliteStore {
    pub fn validate_contract_for_inspection(&self) -> Result<(), StoreError> {
        match self.schema_version()? {
            SCHEMA_VERSION => self.verify_schema_contract()?,
            WORK_MODEL_SCHEMA_VERSION => self.verify_work_model_v3_contract()?,
            found => return Err(StoreError::UnsupportedSchema { found }),
        }
        if self.canonical_production {
            self.verify_production_schema_current()?;
            for (name,version,sql) in [
                ("agent_tools",1,AGENT_TOOLS_SCHEMA),
                ("knowledge_parity",1,KNOWLEDGE_PARITY_SCHEMA),
                ("work_split",1,WORK_SPLIT_SCHEMA),
                ("knowledge_maintenance",1,knowledge_maintenance::KNOWLEDGE_MAINTENANCE_SCHEMA),
                ("orchestration",ORCHESTRATION_SCHEMA_VERSION as u64,ORCHESTRATION_SCHEMA_SQL),
                ("orchestration_runtime",orchestration_runtime::ORCHESTRATION_RUNTIME_SCHEMA_VERSION as u64,orchestration_runtime::ORCHESTRATION_RUNTIME_SCHEMA_SQL),
            ] {
                let mut row=self.prepare("SELECT version,sql FROM boreal_feature_schema WHERE feature=?1")?;
                row.bind_text(1,name)?;
                if row.step()?!=SQLITE_ROW || row.column_u64(0)?!=version || row.column_text(1)?!=sql {
                    return Err(StoreError::Corrupt(format!("feature {name} does not match this binary's installed schema contract; use an explicit migration")));
                }
                // Verify installed objects as well as their declaration ledger.
                // Tables/indices/triggers from these static feature contracts
                // all use the CREATE ... IF NOT EXISTS form.
                let tokens=sql.split_whitespace().collect::<Vec<_>>();
                for window in tokens.windows(7) {
                    let start=if window[0].eq_ignore_ascii_case("CREATE"){0}else{continue};
                    let (kind,next)=if window[start+1].eq_ignore_ascii_case("UNIQUE") {("index",2)}else{(window[start+1],1)};
                    if !["table","index","trigger"].iter().any(|k|kind.eq_ignore_ascii_case(k)) || !window[next+1].eq_ignore_ascii_case("IF") || !window[next+2].eq_ignore_ascii_case("NOT") || !window[next+3].eq_ignore_ascii_case("EXISTS") {continue;}
                    let object=window[next+4].split('(').next().unwrap_or("");
                    let mut check=self.prepare("SELECT 1 FROM sqlite_master WHERE lower(type)=lower(?1) AND name=?2")?;
                    check.bind_text(1,kind)?;check.bind_text(2,object)?;
                    if check.step()?!=SQLITE_ROW {return Err(StoreError::Corrupt(format!("feature {name} is missing {kind} {object}")));}
                }
            }
        }
        Ok(())
    }
    pub fn validate_snapshot_manifest_document(
        &self,
        project: &str,
        manifest: &Value,
    ) -> Result<(), StoreError> {
        validate_backup_manifest(manifest)?;
        if !manifest["projects"]
            .as_array()
            .is_some_and(|projects| projects.iter().any(|p| p["project_id"] == project))
        {
            return Err(StoreError::Conflict(
                "snapshot manifest belongs to a different project".into(),
            ));
        }
        Ok(())
    }

    pub fn admit_diagnostic_rotation(
        &self,
        context: &V3MutationContext,
        path: &str,
        archive: &str,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"path":path,"archive":archive}));
        self.fact_mutation(&bound,"storage.rotate-log","maintenance",&context.operation_id,&[boreal_domain::ActorRole::Operator],||{
            let mut q=self.prepare("INSERT INTO boreal_maintenance_job(operation_id,kind,database_path,package_path,request_digest,stage,created_at,updated_at) VALUES(?1,'diagnostic_rotation',?2,?3,?4,'registered',?5,?5)")?;
            q.bind_text(1,&context.operation_id)?;q.bind_text(2,&self.database_path().ok_or_else(||StoreError::Invalid("rotation requires a file database".into()))?.to_string_lossy())?;q.bind_text(3,archive)?;q.bind_text(4,&bound.request_digest)?;q.bind_text(5,&context.now)?;q.run()
        })
    }
    pub fn reservation_inspection(
        &self,
        project: &str,
        actor: Option<&str>,
        work: Option<&str>,
        state: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<Value, StoreError> {
        if !(1..=500).contains(&limit) {
            return Err(StoreError::Invalid(
                "reservation limit must be 1..500".into(),
            ));
        }
        if state.is_some_and(|s| {
            ![
                "active",
                "released",
                "expired",
                "release_pending",
                "unknown",
                "all",
            ]
            .contains(&s)
        }) {
            return Err(StoreError::Invalid("invalid reservation status".into()));
        }
        let revision = self.project_revision(project)?.0;
        let mut q = self.prepare("SELECT * FROM (
          SELECT 'attempt' AS kind,r.reservation_id,w.project_id,r.work_id,r.attempt_id,r.fence,r.state,a.actor_id AS owner,r.lease_deadline,NULL AS resource_key,r.released_at
          FROM reservation r JOIN work_item w ON w.work_id=r.work_id JOIN attempt a ON a.attempt_id=r.attempt_id WHERE w.project_id=?1
          UNION ALL
          SELECT 'resource',r.reservation_id,r.project_id,r.work_id,r.attempt_id,r.fence,r.state,r.owner_actor_id,NULL,r.resource_key,r.released_at
          FROM boreal_resource_reservation r WHERE r.project_id=?1)
          WHERE (?2 IS NULL OR owner=?2) AND (?3 IS NULL OR work_id=?3) AND (?4 IS NULL OR ?4='all' OR state=?4)
          ORDER BY kind,reservation_id LIMIT ?5 OFFSET ?6")?;
        q.bind_text(1, project)?;
        q.bind_optional_text(2, actor)?;
        q.bind_optional_text(3, work)?;
        q.bind_optional_text(4, state)?;
        q.bind_i64(5, limit + 1)?;
        q.bind_i64(6, offset)?;
        let mut items = Vec::new();
        while q.step()? == SQLITE_ROW {
            items.push(json!({"kind":q.column_text(0)?,"reservation_id":q.column_text(1)?,"project_id":q.column_text(2)?,"work_id":q.column_text(3)?,"attempt_id":q.column_text(4)?,"fence":q.column_u64(5)?,"state":q.column_text(6)?,"owner_actor_id":q.column_text(7)?,"lease_deadline":q.column_optional_text(8)?,"resource_key":q.column_optional_text(9)?,"released_at":q.column_optional_text(10)?}));
        }
        drop(q);
        let more = items.len() > limit as usize;
        items.truncate(limit as usize);
        if self.project_revision(project)?.0 != revision {
            return Err(StoreError::Conflict(
                "project changed during reservation inspection; retry".into(),
            ));
        }
        Ok(
            json!({"project_id":project,"revision":revision,"items":items,"offset":offset,"next_offset":if more{Some(offset+limit)}else{None},"as_of_is_lease_state":false}),
        )
    }

    pub fn backup_history(&self, limit: u64, offset: u64) -> Result<Value, StoreError> {
        if !(1..=500).contains(&limit) {
            return Err(StoreError::Invalid("snapshot limit must be 1..500".into()));
        }
        let mut q=self.prepare("SELECT operation_id,package_path,stage,created_at,updated_at,result_json FROM boreal_maintenance_job WHERE kind='backup' ORDER BY created_at DESC,operation_id LIMIT ?1 OFFSET ?2")?;
        q.bind_i64(1, limit + 1)?;
        q.bind_i64(2, offset)?;
        let mut items = Vec::new();
        while q.step()? == SQLITE_ROW {
            items.push(json!({"snapshot_id":q.column_text(0)?,"path":q.column_text(1)?,"state":q.column_text(2)?,"created_at":q.column_text(3)?,"updated_at":q.column_text(4)?,"result":q.column_optional_text(5)?.map(|s|serde_json::from_str::<Value>(&s)).transpose().map_err(|e|StoreError::Corrupt(e.to_string()))?}));
        }
        let more = items.len() > limit as usize;
        items.truncate(limit as usize);
        Ok(
            json!({"items":items,"offset":offset,"next_offset":if more{Some(offset+limit)}else{None},"source":"durable_backup_journal"}),
        )
    }
}

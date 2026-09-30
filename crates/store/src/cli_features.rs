//! Additive feature migrations, independent of the v3 work model migration ledger.
use super::*;
impl SqliteStore {
    pub fn install_feature_schema(
        &self,
        name: &str,
        version: u64,
        sql: &str,
    ) -> Result<(), StoreError> {
        // Established reads must not acquire the writer lock merely to verify
        // an already-applied additive feature migration.
        if self.table_exists("boreal_feature_schema")? {
            let mut installed =
                self.prepare("SELECT version,sql FROM boreal_feature_schema WHERE feature=?1")?;
            installed.bind_text(1, name)?;
            if installed.step()? == SQLITE_ROW {
                if installed.column_u64(0)? != version || installed.column_text(1)? != sql {
                    return Err(StoreError::Conflict(format!(
                        "feature schema {name} requires an explicit migration"
                    )));
                }
                return Ok(());
            }
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            self.execute_batch("CREATE TABLE IF NOT EXISTS boreal_feature_schema (feature TEXT PRIMARY KEY, version INTEGER NOT NULL, sql TEXT NOT NULL)")?;
            let mut query =
                self.prepare("SELECT version,sql FROM boreal_feature_schema WHERE feature=?1")?;
            query.bind_text(1, name)?;
            if query.step()? == SQLITE_ROW {
                if query.column_u64(0)? != version || query.column_text(1)? != sql {
                    return Err(StoreError::Conflict(format!(
                        "feature schema {name} requires an explicit migration"
                    )));
                }
                return Ok(());
            }
            drop(query);
            self.execute_batch(sql)?;
            let mut insert = self.prepare(
                "INSERT INTO boreal_feature_schema(feature,version,sql) VALUES(?1,?2,?3)",
            )?;
            insert.bind_text(1, name)?;
            insert.bind_i64(2, version)?;
            insert.bind_text(3, sql)?;
            insert.run()?;
            Ok(())
        })();
        finish_transaction(self, result)
    }
    pub fn operation_page(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<OperationRecord>, StoreError> {
        if !(1..=1000).contains(&limit) {
            return Err(StoreError::Invalid(
                "operation page limit must be 1..1000".into(),
            ));
        }
        let mut query=self.prepare("SELECT operation_id FROM operation WHERE project_id=?1 ORDER BY revision DESC,operation_id LIMIT ?2 OFFSET ?3")?;
        query.bind_text(1, project)?;
        query.bind_i64(2, limit)?;
        query.bind_i64(3, offset)?;
        let mut ids = Vec::new();
        while query.step()? == SQLITE_ROW {
            ids.push(query.column_text(0)?);
        }
        drop(query);
        ids.iter()
            .map(|id| {
                self.operation(id)?
                    .ok_or_else(|| StoreError::Corrupt("operation disappeared".into()))
            })
            .collect()
    }
    pub fn operation_statistics(&self, project: &str) -> Result<serde_json::Value, StoreError> {
        let mut q=self.prepare("SELECT command,outcome,count(*) FROM operation WHERE project_id=?1 GROUP BY command,outcome ORDER BY command,outcome")?;
        q.bind_text(1, project)?;
        let mut rows = Vec::new();
        while q.step()? == SQLITE_ROW {
            rows.push(serde_json::json!({"command":q.column_text(0)?,"outcome":q.column_text(1)?,"count":q.column_u64(2)?}));
        }
        Ok(serde_json::json!({"project_id":project,"groups":rows}))
    }
}

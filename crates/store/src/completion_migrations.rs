//! Durable completion-ledger migration integration.
//!
//! Kept separate from `migrations.rs` because the migration test suite includes
//! that file as a standalone module to exercise its backend-independent runner.
//! The `SqliteStore` adapter belongs to the store crate and is therefore wired
//! here, where `super` is the actual crate root.

const COMPLETION_MIGRATIONS: &[(u64, &str)] = &[
    (
        1,
        include_str!("../../../project/spec/schema-completion-v1.sql"),
    ),
    (
        2,
        include_str!("../../../project/spec/schema-completion-v2.sql"),
    ),
    (
        3,
        include_str!("../../../project/spec/schema-completion-v3.sql"),
    ),
    (
        4,
        include_str!("../../../project/spec/schema-completion-v4.sql"),
    ),
    (
        5,
        include_str!("../../../project/spec/schema-completion-v5.sql"),
    ),
    (
        6,
        include_str!("../../../project/spec/schema-completion-v6.sql"),
    ),
];

impl super::SqliteStore {
    pub(crate) fn install_completion_contract(&self) -> Result<(), super::StoreError> {
        use super::{finish_transaction, production_now, StoreError, SQLITE_ROW};
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            self.execute_batch(
                "CREATE TABLE IF NOT EXISTS boreal_completion_migration (
                   version INTEGER PRIMARY KEY CHECK (version > 0),
                   checksum TEXT NOT NULL, objects_json TEXT NOT NULL,
                   applied_at TEXT NOT NULL
                 );",
            )?;
            let current = self
                .scalar_i64("SELECT COALESCE(MAX(version), 0) FROM boreal_completion_migration")?;
            if current > COMPLETION_MIGRATIONS.len() as i64 {
                return Err(StoreError::UnsupportedSchema { found: current });
            }
            for &(version, sql) in COMPLETION_MIGRATIONS {
                let digest = super::migrations::checksum(sql.as_bytes());
                let mut row = self.prepare(
                    "SELECT checksum FROM boreal_completion_migration WHERE version = ?1",
                )?;
                row.bind_i64(1, version)?;
                if row.step()? == SQLITE_ROW {
                    if row.column_text(0)? != digest {
                        return Err(StoreError::Corrupt(format!(
                            "completion migration {version} checksum changed"
                        )));
                    }
                    continue;
                }
                if version != self.completion_contract_version()?.unwrap_or(0) + 1 {
                    return Err(StoreError::Corrupt(
                        "completion migration history has a gap".to_owned(),
                    ));
                }
                self.execute_batch(sql)?;
                let objects = self.completion_objects(sql)?;
                let mut insert = self.prepare(
                    "INSERT INTO boreal_completion_migration(version, checksum, objects_json, applied_at)
                     VALUES (?1, ?2, ?3, ?4)",
                )?;
                insert.bind_i64(1, version)?;
                insert.bind_text(2, &digest)?;
                insert.bind_text(3, &objects)?;
                insert.bind_text(4, &production_now())?;
                insert.run()?;
            }
            self.verify_completion_contract()
        })();
        finish_transaction(self, result)
    }

    pub fn completion_contract_version(&self) -> Result<Option<u64>, super::StoreError> {
        if !self.table_exists("boreal_completion_migration")? {
            return Ok(None);
        }
        let mut row = self.prepare("SELECT MAX(version) FROM boreal_completion_migration")?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        row.column_optional_i64(0)
    }

    /// Read-only verification; a dropped/redefined guard is corruption, not an
    /// invitation to re-create it during a dashboard or doctor read.
    pub fn verify_completion_contract(&self) -> Result<(), super::StoreError> {
        use super::{StoreError, SQLITE_ROW};
        for &(version, sql) in COMPLETION_MIGRATIONS {
            let mut row = self.prepare(
                "SELECT checksum, objects_json FROM boreal_completion_migration WHERE version = ?1",
            )?;
            row.bind_i64(1, version)?;
            if row.step()? != SQLITE_ROW
                || row.column_text(0)? != super::migrations::checksum(sql.as_bytes())
            {
                return Err(StoreError::Corrupt(format!(
                    "completion migration {version} is absent or changed"
                )));
            }
            if row.column_text(1)? != self.completion_objects(sql)? {
                return Err(StoreError::Corrupt(format!(
                    "completion migration {version} schema objects drifted"
                )));
            }
        }
        Ok(())
    }

    fn completion_objects(&self, sql: &str) -> Result<String, super::StoreError> {
        let mut objects = std::collections::BTreeMap::new();
        for line in sql.lines() {
            let tokens = line.split_whitespace().collect::<Vec<_>>();
            if tokens.len() < 3
                || tokens[0] != "CREATE"
                || !matches!(tokens[1], "TABLE" | "TRIGGER" | "INDEX")
            {
                continue;
            }
            let name = tokens[2].split('(').next().unwrap_or(tokens[2]);
            let mut row =
                self.prepare("SELECT sql FROM sqlite_master WHERE name = ?1 AND type = ?2")?;
            row.bind_text(1, name)?;
            row.bind_text(2, &tokens[1].to_ascii_lowercase())?;
            if row.step()? != super::SQLITE_ROW {
                return Err(super::StoreError::Corrupt(format!(
                    "completion schema object {name} is missing"
                )));
            }
            objects.insert(
                name.to_owned(),
                super::migrations::checksum(row.column_text(0)?.as_bytes()),
            );
        }
        serde_json::to_string(&objects)
            .map_err(|error| super::StoreError::Corrupt(error.to_string()))
    }
}

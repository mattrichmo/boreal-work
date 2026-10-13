//! Additive storage contract for immutable Intake delivery receipts.

use super::*;

pub const INTAKE_DELIVERY_SCHEMA_VERSION: u64 = 1;
pub const INTAKE_DELIVERY_SCHEMA_SQL: &str =
    include_str!("../../../project/spec/intake-delivery-v1.sql");

impl SqliteStore {
    /// Install or verify the additive Intake-delivery receipt feature schema.
    /// Mutable Intake content remains in `intake_item_v3`; this table records
    /// the immutable cross-store delivery identity and its original digests.
    pub fn ensure_intake_delivery_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema(
            "intake_delivery",
            INTAKE_DELIVERY_SCHEMA_VERSION,
            INTAKE_DELIVERY_SCHEMA_SQL,
        )?;
        for (object_type, name) in [
            ("table", "intake_delivery_v1"),
            ("trigger", "intake_delivery_v1_no_update"),
            ("trigger", "intake_delivery_v1_no_delete"),
        ] {
            if !self.schema_object_exists(object_type, name)? {
                return Err(StoreError::Corrupt(format!(
                    "intake_delivery feature schema is missing {object_type} {name}"
                )));
            }
        }
        Ok(())
    }
}

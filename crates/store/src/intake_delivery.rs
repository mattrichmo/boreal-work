//! Additive storage contract for immutable Intake delivery receipts.

use super::*;

pub const INTAKE_DELIVERY_SCHEMA_VERSION: u64 = 1;
pub const INTAKE_DELIVERY_SCHEMA_SQL: &str =
    include_str!("../../../project/spec/intake-delivery-v1.sql");

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeDeliveryInput {
    pub delivery_key: String,
    pub origin_kind: String,
    pub origin_item_id: String,
    pub origin_digest: String,
    pub payload_digest: String,
    pub created_at: String,
    pub intake: IntakeItemV3Input,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeDeliveryRecord {
    pub project_id: String,
    pub delivery_key: String,
    pub intake_id: String,
    pub origin_kind: String,
    pub origin_item_id: String,
    pub origin_digest: String,
    pub payload_digest: String,
    pub created_at: String,
}

/// Current project revision and an authenticated receipt lookup. By delivery
/// key, the Intake is present only when a receipt resolves; by Intake ID, the
/// current item may be present without a receipt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeDeliveryReadback {
    pub project_revision: u64,
    pub receipt: Option<IntakeDeliveryRecord>,
    pub intake: Option<IntakeItemV3Record>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeDeliveryMutationResult {
    pub readback: IntakeDeliveryReadback,
    /// None means an existing semantic receipt was resolved without writing
    /// an operation, audit event, or project revision.
    pub mutation: Option<MutationResult>,
}

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

    /// Receive one frozen external delivery. Receipt lookup precedes the
    /// operation/revision mutation path so a semantic retry can resolve an
    /// earlier receipt without creating another project mutation.
    pub fn receive_intake_delivery(
        &self,
        context: &V3MutationContext,
        input: &IntakeDeliveryInput,
    ) -> Result<IntakeDeliveryMutationResult, StoreError> {
        validate_delivery_input(context, input)?;

        let initial_readback = self.intake_delivery_readback(
            &context.project_id,
            &context.actor_id,
            context.session_id.as_deref(),
            &input.delivery_key,
        )?;
        if initial_readback.receipt.is_some() {
            return resolve_delivery_readback(initial_readback, input, None);
        }

        let bound = context.with_payload(serde_json::json!({
            "delivery_key": input.delivery_key,
            "origin_kind": input.origin_kind,
            "origin_item_id": input.origin_item_id,
            "origin_digest": input.origin_digest,
            "payload_digest": input.payload_digest,
            "intake": {
                "intake_id": input.intake.intake_id,
                "bucket_id": input.intake.bucket_id,
                "kind": input.intake.kind,
                "content": input.intake.content,
                "content_revision": input.intake.content_revision,
                "content_digest": input.intake.content_digest,
                "revisit_at_utc_ms": input.intake.revisit_at_utc_ms,
            },
        }));
        let mutation = self.v3_mutation(
            &bound,
            "intake.delivery.receive",
            "intake_delivery",
            &input.delivery_key,
            || {
                if self
                    .intake_delivery_by_key_raw(&input.intake.project_id, &input.delivery_key)?
                    .is_some()
                {
                    return Err(StoreError::Conflict(DELIVERY_RACE_CONFLICT.to_owned()));
                }
                self.validate_delivery_bucket(&input.intake.project_id, &input.intake.bucket_id)?;
                if self.intake_item_id_exists_raw(&input.intake.intake_id)? {
                    return Err(StoreError::Conflict(format!(
                        "intake ID {} already exists without this delivery receipt",
                        input.intake.intake_id
                    )));
                }
                self.insert_delivery_in_transaction(input)
            },
        );

        match mutation {
            Ok(mutation) => {
                let readback = self.authenticated_intake_delivery_snapshot(
                    &context.project_id,
                    &context.actor_id,
                    context.session_id.as_deref(),
                    DeliveryLookup::Key(&input.delivery_key),
                )?;
                resolve_delivery_readback(readback, input, Some(mutation))
            }
            Err(error) if is_delivery_resolution_race(&error) => {
                let readback = self.authenticated_intake_delivery_snapshot(
                    &context.project_id,
                    &context.actor_id,
                    context.session_id.as_deref(),
                    DeliveryLookup::Key(&input.delivery_key),
                )?;
                if readback.receipt.is_some() {
                    resolve_delivery_readback(readback, input, None)
                } else {
                    Err(error)
                }
            }
            Err(error) => Err(error),
        }
    }

    /// Authenticated readback by logical delivery identity. It deliberately
    /// returns the current Intake row paired with the immutable receipt.
    pub fn intake_delivery_readback(
        &self,
        project_id: &str,
        actor_id: &str,
        session_id: Option<&str>,
        delivery_key: &str,
    ) -> Result<IntakeDeliveryReadback, StoreError> {
        self.ensure_intake_delivery_schema()?;
        let readback = self.authenticated_intake_delivery_snapshot(
            project_id,
            actor_id,
            session_id,
            DeliveryLookup::Key(delivery_key),
        )?;
        Ok(readback)
    }

    /// Authenticated receipt lookup for an Intake show/readback response.
    pub fn intake_delivery_readback_for_intake(
        &self,
        project_id: &str,
        actor_id: &str,
        session_id: Option<&str>,
        intake_id: &str,
    ) -> Result<IntakeDeliveryReadback, StoreError> {
        self.ensure_intake_delivery_schema()?;
        let readback = self.authenticated_intake_delivery_snapshot(
            project_id,
            actor_id,
            session_id,
            DeliveryLookup::Intake(intake_id),
        )?;
        Ok(readback)
    }

    fn authenticated_intake_delivery_snapshot(
        &self,
        project_id: &str,
        actor_id: &str,
        session_id: Option<&str>,
        lookup: DeliveryLookup<'_>,
    ) -> Result<IntakeDeliveryReadback, StoreError> {
        if project_id.trim().is_empty() || actor_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "project and actor are required for Intake delivery readback".to_owned(),
            ));
        }
        let session_id = session_id
            .filter(|id| !id.trim().is_empty())
            .ok_or_else(|| {
                StoreError::Invalid(
                    "project session is required for Intake delivery readback".into(),
                )
            })?;
        let identity = match lookup {
            DeliveryLookup::Key(key) => key,
            DeliveryLookup::Intake(intake_id) => intake_id,
        };
        if identity.trim().is_empty() {
            return Err(StoreError::Invalid(
                "delivery key or Intake ID is required for receipt readback".to_owned(),
            ));
        }
        self.execute_batch("BEGIN")?;
        let result = (|| {
            self.authorize_intake_delivery_read(project_id, actor_id, session_id)?;
            let revision = self.project_revision(project_id)?.0;
            let receipt = match lookup {
                DeliveryLookup::Key(key) => self.intake_delivery_by_key_raw(project_id, key)?,
                DeliveryLookup::Intake(intake_id) => {
                    self.intake_delivery_by_intake_raw(project_id, intake_id)?
                }
            };
            let intake = match receipt.as_ref() {
                Some(receipt) => Some(
                    self.intake_item_v3(project_id, &receipt.intake_id)?
                        .ok_or_else(|| {
                            StoreError::Corrupt(format!(
                                "delivery receipt {} references a missing Intake item",
                                receipt.delivery_key
                            ))
                        })?,
                ),
                None => match lookup {
                    DeliveryLookup::Key(_) => None,
                    DeliveryLookup::Intake(intake_id) => {
                        self.intake_item_v3(project_id, intake_id)?
                    }
                },
            };
            Ok(IntakeDeliveryReadback {
                project_revision: revision,
                receipt,
                intake,
            })
        })();
        super::finish_transaction(self, result)
    }

    fn authorize_intake_delivery_read(
        &self,
        project_id: &str,
        actor_id: &str,
        session_id: &str,
    ) -> Result<(), StoreError> {
        if self.canonical_production {
            let (role, _) = self.principal_authority(project_id, actor_id)?;
            if !matches!(
                role,
                boreal_domain::ActorRole::Agent | boreal_domain::ActorRole::Operator
            ) {
                return Err(StoreError::Invalid(
                    "principal role does not permit Intake delivery readback".to_owned(),
                ));
            }
            self.validate_project_session_binding(project_id, actor_id, session_id)?;
        }
        Ok(())
    }

    fn validate_delivery_bucket(
        &self,
        project_id: &str,
        bucket_id: &str,
    ) -> Result<(), StoreError> {
        let mut bucket = self.prepare(
            "SELECT archived FROM intake_bucket_v3 WHERE project_id=?1 AND bucket_id=?2",
        )?;
        bucket.bind_text(1, project_id)?;
        bucket.bind_text(2, bucket_id)?;
        if bucket.step()? != SQLITE_ROW {
            return Err(StoreError::Invalid(
                "Intake delivery bucket does not exist in this project".to_owned(),
            ));
        }
        if bucket.column_i64(0)? != 0 {
            return Err(StoreError::Invalid(
                "cannot receive delivery into an archived Intake bucket".to_owned(),
            ));
        }
        Ok(())
    }

    fn intake_item_id_exists_raw(&self, intake_id: &str) -> Result<bool, StoreError> {
        let mut row = self.prepare("SELECT 1 FROM intake_item_v3 WHERE intake_id=?1 LIMIT 1")?;
        row.bind_text(1, intake_id)?;
        Ok(row.step()? == SQLITE_ROW)
    }

    fn insert_delivery_in_transaction(
        &self,
        input: &IntakeDeliveryInput,
    ) -> Result<(), StoreError> {
        let item = &input.intake;
        let mut intake = self.prepare(
            "INSERT INTO intake_item_v3
             (intake_id,project_id,bucket_id,kind,lifecycle,content,
              content_revision,content_digest,captured_at,updated_at,revisit_at_utc_ms)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        )?;
        intake.bind_text(1, &item.intake_id)?;
        intake.bind_text(2, &item.project_id)?;
        intake.bind_text(3, &item.bucket_id)?;
        intake.bind_text(4, &item.kind)?;
        intake.bind_text(5, &item.lifecycle)?;
        intake.bind_text(6, &item.content)?;
        intake.bind_i64(7, item.content_revision)?;
        intake.bind_text(8, &item.content_digest)?;
        intake.bind_text(9, &item.captured_at)?;
        intake.bind_text(10, &item.updated_at)?;
        match item.revisit_at_utc_ms {
            Some(value) => intake.bind_signed_i64(11, value)?,
            None => intake.bind_null(11)?,
        }
        intake.run()?;

        let mut receipt = self.prepare(
            "INSERT INTO intake_delivery_v1
             (project_id,delivery_key,intake_id,origin_kind,origin_item_id,
              origin_digest,payload_digest,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        )?;
        receipt.bind_text(1, &item.project_id)?;
        receipt.bind_text(2, &input.delivery_key)?;
        receipt.bind_text(3, &item.intake_id)?;
        receipt.bind_text(4, &input.origin_kind)?;
        receipt.bind_text(5, &input.origin_item_id)?;
        receipt.bind_text(6, &input.origin_digest)?;
        receipt.bind_text(7, &input.payload_digest)?;
        receipt.bind_text(8, &input.created_at)?;
        receipt.run()
    }

    fn intake_delivery_by_key_raw(
        &self,
        project_id: &str,
        delivery_key: &str,
    ) -> Result<Option<IntakeDeliveryRecord>, StoreError> {
        self.intake_delivery_query(
            "WHERE project_id=?1 AND delivery_key=?2",
            project_id,
            delivery_key,
        )
    }

    fn intake_delivery_by_intake_raw(
        &self,
        project_id: &str,
        intake_id: &str,
    ) -> Result<Option<IntakeDeliveryRecord>, StoreError> {
        self.intake_delivery_query(
            "WHERE project_id=?1 AND intake_id=?2",
            project_id,
            intake_id,
        )
    }

    fn intake_delivery_query(
        &self,
        predicate: &str,
        project_id: &str,
        identity: &str,
    ) -> Result<Option<IntakeDeliveryRecord>, StoreError> {
        let sql = format!(
            "SELECT project_id,delivery_key,intake_id,origin_kind,origin_item_id,
                    origin_digest,payload_digest,created_at
             FROM intake_delivery_v1 {predicate}"
        );
        let mut row = self.prepare(&sql)?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, identity)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(IntakeDeliveryRecord {
            project_id: row.column_text(0)?,
            delivery_key: row.column_text(1)?,
            intake_id: row.column_text(2)?,
            origin_kind: row.column_text(3)?,
            origin_item_id: row.column_text(4)?,
            origin_digest: row.column_text(5)?,
            payload_digest: row.column_text(6)?,
            created_at: row.column_text(7)?,
        }))
    }
}

#[derive(Clone, Copy)]
enum DeliveryLookup<'a> {
    Key(&'a str),
    Intake(&'a str),
}

const DELIVERY_RACE_CONFLICT: &str = "intake delivery receipt appeared during receive";

fn validate_delivery_input(
    context: &V3MutationContext,
    input: &IntakeDeliveryInput,
) -> Result<(), StoreError> {
    for (field, value) in [
        ("project_id", input.intake.project_id.as_str()),
        ("delivery_key", input.delivery_key.as_str()),
        ("origin_kind", input.origin_kind.as_str()),
        ("origin_item_id", input.origin_item_id.as_str()),
        ("origin_digest", input.origin_digest.as_str()),
        ("payload_digest", input.payload_digest.as_str()),
        ("intake_id", input.intake.intake_id.as_str()),
        ("bucket_id", input.intake.bucket_id.as_str()),
        ("intake content", input.intake.content.as_str()),
        (
            "intake content_digest",
            input.intake.content_digest.as_str(),
        ),
        ("captured_at", input.intake.captured_at.as_str()),
        ("updated_at", input.intake.updated_at.as_str()),
        ("receipt created_at", input.created_at.as_str()),
        ("actor_id", context.actor_id.as_str()),
        ("operation_id", context.operation_id.as_str()),
        ("request_digest", context.request_digest.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(StoreError::Invalid(format!("{field} is required")));
        }
    }
    if context.project_id != input.intake.project_id {
        return Err(StoreError::WrongSubject {
            expected: context.project_id.clone(),
            actual: input.intake.project_id.clone(),
        });
    }
    if super::checksum(input.intake.content.as_bytes()) != input.intake.content_digest {
        return Err(StoreError::Invalid(
            "Intake delivery content digest does not match its content".to_owned(),
        ));
    }
    if context
        .session_id
        .as_deref()
        .is_none_or(|session| session.trim().is_empty())
    {
        return Err(StoreError::Invalid(
            "project session is required for Intake delivery".to_owned(),
        ));
    }
    if context.expected_revision.is_none() {
        return Err(StoreError::Invalid(
            "expected project revision is required for Intake delivery".to_owned(),
        ));
    }
    if input.intake.content_revision != 1 || input.intake.lifecycle != "captured" {
        return Err(StoreError::Invalid(
            "new delivered Intake must begin at content revision 1 in captured lifecycle"
                .to_owned(),
        ));
    }
    if !matches!(
        input.intake.kind.as_str(),
        "note" | "discovery" | "question" | "revisit"
    ) {
        return Err(StoreError::Invalid("invalid Intake kind".to_owned()));
    }
    Ok(())
}

fn resolve_delivery_readback(
    readback: IntakeDeliveryReadback,
    input: &IntakeDeliveryInput,
    mutation: Option<MutationResult>,
) -> Result<IntakeDeliveryMutationResult, StoreError> {
    let receipt = readback.receipt.as_ref().ok_or_else(|| {
        StoreError::Corrupt("Intake delivery readback has no matching receipt".to_owned())
    })?;
    if receipt.origin_kind != input.origin_kind
        || receipt.origin_item_id != input.origin_item_id
        || receipt.origin_digest != input.origin_digest
        || receipt.payload_digest != input.payload_digest
    {
        return Err(StoreError::Conflict(
            "delivery key is already bound to another origin or payload".to_owned(),
        ));
    }
    if readback.intake.is_none() {
        return Err(StoreError::Corrupt(
            "Intake delivery receipt has no current Intake row".to_owned(),
        ));
    }
    Ok(IntakeDeliveryMutationResult { readback, mutation })
}

fn is_delivery_resolution_race(error: &StoreError) -> bool {
    match error {
        StoreError::StaleRevision { .. } => true,
        StoreError::Conflict(message) => message == DELIVERY_RACE_CONFLICT,
        _ => false,
    }
}

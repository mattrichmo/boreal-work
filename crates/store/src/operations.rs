//! Atomic operation/audit bundle and project-scoped readback seam.
//!
//! A caller enters this seam from an already-owned transaction.  The bundle
//! writes the durable operation and optional audit fact together; it never
//! chooses the lifecycle outcome or executes an external side effect.

#[path = "audit.rs"]
pub mod audit;

use super::{
    identity::{IdentityContext, IdentityStore},
    AuditEventRecord, OperationOutcome, OperationReadback, OperationRecord, SqliteStore,
    StoreError,
};

/// Immutable request fields used to decide whether an operation ID is an
/// exact replay or an unsafe reuse. Database lineage is checked separately by
/// `IdentityStore` through the supplied `IdentityContext`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationIdentity {
    pub operation_id: String,
    pub project_id: String,
    pub command: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub expected_revision: Option<u64>,
    pub attempt_id: Option<String>,
    pub fence: Option<u64>,
    pub request_digest: String,
    pub subject: Option<(String, String)>,
}

impl OperationIdentity {
    pub fn from_record(operation: &OperationRecord, subject: Option<(String, String)>) -> Self {
        Self {
            operation_id: operation.operation_id.clone(),
            project_id: operation.project_id.clone(),
            command: operation.command.clone(),
            actor_id: operation.actor_id.clone(),
            session_id: operation.session_id.clone(),
            expected_revision: operation.expected_revision,
            attempt_id: operation.attempt_id.clone(),
            fence: operation.fence,
            request_digest: operation.request_digest.clone(),
            subject,
        }
    }

    fn validate(&self) -> Result<(), StoreError> {
        for (field, value) in [
            ("operation_id", self.operation_id.as_str()),
            ("project_id", self.project_id.as_str()),
            ("command", self.command.as_str()),
            ("actor_id", self.actor_id.as_str()),
            ("request_digest", self.request_digest.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(StoreError::Invalid(format!(
                    "operation identity requires a non-empty {field}"
                )));
            }
        }
        for (field, value) in [
            ("session_id", self.session_id.as_deref()),
            ("attempt_id", self.attempt_id.as_deref()),
        ] {
            if let Some(value) = value {
                if value.trim().is_empty() {
                    return Err(StoreError::Invalid(format!(
                        "operation identity {field} must not be empty"
                    )));
                }
            }
        }
        if self.fence == Some(0) {
            return Err(StoreError::Invalid(
                "operation identity fence must be greater than zero".to_owned(),
            ));
        }
        if let Some((kind, id)) = &self.subject {
            if kind.trim().is_empty() || id.trim().is_empty() {
                return Err(StoreError::Invalid(
                    "operation identity subject must have a type and id".to_owned(),
                ));
            }
        }
        Ok(())
    }

    fn matches_record(&self, operation: &OperationRecord) -> bool {
        self.operation_id == operation.operation_id
            && self.project_id == operation.project_id
            && self.command == operation.command
            && self.actor_id == operation.actor_id
            && self.session_id == operation.session_id
            && self.expected_revision == operation.expected_revision
            && self.attempt_id == operation.attempt_id
            && self.fence == operation.fence
            && self.request_digest == operation.request_digest
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationBundle {
    pub operation: OperationRecord,
    pub audit: Option<AuditEventRecord>,
}

impl OperationBundle {
    pub fn new(operation: OperationRecord, audit: Option<AuditEventRecord>) -> Self {
        Self { operation, audit }
    }

    fn validate(&self) -> Result<(), StoreError> {
        OperationIdentity::from_record(&self.operation, None).validate()?;
        // Result metadata is part of the durable operation envelope.  Keep it
        // valid, bounded, and redacted before the operation row is written.
        audit::redacted_payload(&self.operation.result_json)?;
        let terminal = !matches!(
            self.operation.outcome,
            OperationOutcome::Busy | OperationOutcome::Unknown
        );
        if terminal != self.operation.completed_at.is_some() {
            return Err(StoreError::Invalid(
                "terminal operations require completed_at; pending/unknown operations must not set it"
                    .to_owned(),
            ));
        }
        if terminal && self.audit.is_none() {
            return Err(StoreError::Invalid(
                "terminal operation requires an audit event in the same transaction".to_owned(),
            ));
        }
        if let Some(audit) = &self.audit {
            validate_audit_identity_fields(audit)?;
            if audit.project_id != self.operation.project_id
                || audit.operation_id != self.operation.operation_id
            {
                return Err(StoreError::WrongSubject {
                    expected: format!(
                        "{}/{}",
                        self.operation.project_id, self.operation.operation_id
                    ),
                    actual: format!("{}/{}", audit.project_id, audit.operation_id),
                });
            }
            if audit.actor_id != self.operation.actor_id {
                return Err(StoreError::WrongOwner {
                    expected: self.operation.actor_id.clone(),
                    actual: audit.actor_id.clone(),
                });
            }
            if audit.revision != self.operation.revision {
                return Err(StoreError::Conflict(
                    "operation and audit revision identities disagree".to_owned(),
                ));
            }
        }
        Ok(())
    }

    fn validate_identity(&self) -> Result<(), StoreError> {
        self.validate()?;
        if let Some(audit) = &self.audit {
            if audit.session_id != self.operation.session_id {
                return Err(StoreError::Conflict(
                    "operation and audit session identities disagree".to_owned(),
                ));
            }
            if audit.fence != self.operation.fence {
                return Err(StoreError::Conflict(
                    "operation and audit fence identities disagree".to_owned(),
                ));
            }
        }
        Ok(())
    }
}

/// The caller-owned transaction either registers a new operation or returns
/// the already committed outcome.  A replay never writes a second operation
/// or audit row.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationRegistration {
    Committed,
    Replayed(Box<OperationReadback>),
}

pub struct OperationJournal<'a> {
    store: &'a SqliteStore,
}

impl<'a> OperationJournal<'a> {
    pub const fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    /// Appends a bundle without opening or committing a nested transaction.
    pub fn append_in_transaction(&self, bundle: &OperationBundle) -> Result<(), StoreError> {
        bundle.validate()?;
        let operation = bounded_operation(&bundle.operation)?;
        self.store.append_operation(&operation)?;
        if let Some(audit) = &bundle.audit {
            let audit = audit::redacted_event(audit)?;
            self.store.append_audit_event(&audit)?;
        }
        Ok(())
    }

    /// Appends an identity-bound operation inside the caller's transaction.
    /// Database lineage, operation, semantic mutation and audit failure all
    /// therefore share the caller's rollback boundary.
    pub fn append_in_transaction_with_identity(
        &self,
        context: &IdentityContext,
        bundle: &OperationBundle,
    ) -> Result<(), StoreError> {
        bundle.validate_identity()?;
        if bundle.audit.is_none() {
            return Err(StoreError::Invalid(
                "identity-bound operation requires an audit event".to_owned(),
            ));
        }
        let identity = IdentityStore::new(self.store);
        identity
            .validate_context(context)
            .map_err(|error| StoreError::Conflict(format!("operation identity: {error}")))?;
        if bundle.operation.project_id != context.project_id {
            return Err(StoreError::WrongSubject {
                expected: context.project_id.clone(),
                actual: bundle.operation.project_id.clone(),
            });
        }
        let operation = bounded_operation(&bundle.operation)?;
        self.store.append_operation(&operation)?;
        identity
            .record_operation_context(context, &operation.operation_id)
            .map_err(|error| StoreError::Conflict(format!("operation identity: {error}")))?;
        let audit = audit::redacted_event(bundle.audit.as_ref().expect("checked above"))?;
        self.store.append_audit_event(&audit)
    }

    /// Registers a new identity-bound operation, or returns the original
    /// readback when the operation ID is an exact replay.  This method must be
    /// called from a caller-owned write transaction; it deliberately does not
    /// open, commit, or retry a transaction of its own.
    pub fn register_or_replay_in_transaction_with_identity(
        &self,
        context: &IdentityContext,
        bundle: &OperationBundle,
    ) -> Result<OperationRegistration, StoreError> {
        bundle.validate_identity()?;
        if bundle.audit.is_none() {
            return Err(StoreError::Invalid(
                "identity-bound operation requires an audit event".to_owned(),
            ));
        }
        IdentityStore::new(self.store)
            .validate_context(context)
            .map_err(|error| StoreError::Conflict(format!("operation identity: {error}")))?;
        if bundle.operation.project_id != context.project_id {
            return Err(StoreError::WrongSubject {
                expected: context.project_id.clone(),
                actual: bundle.operation.project_id.clone(),
            });
        }

        let requested_audit = audit::redacted_event(bundle.audit.as_ref().expect("checked above"))?;
        let requested_identity = OperationIdentity::from_record(
            &bundle.operation,
            Some((
                requested_audit.subject_type.clone(),
                requested_audit.subject_id.clone(),
            )),
        );
        if self
            .store
            .operation(&bundle.operation.operation_id)?
            .is_some()
        {
            let readback = self.replay_in_context(context, &requested_identity)?;
            let readback = readback.ok_or_else(|| {
                StoreError::Corrupt(
                    "operation exists but identity-bound readback returned no result".to_owned(),
                )
            })?;
            let existing_audit = self
                .store
                .audit_event(&bundle.operation.operation_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("operation replay is missing its audit event".to_owned())
                })?;
            ensure_audit_replay_identity(&requested_audit, &existing_audit)?;
            return Ok(OperationRegistration::Replayed(Box::new(readback)));
        }

        self.append_in_transaction_with_identity(context, bundle)?;
        Ok(OperationRegistration::Committed)
    }

    /// Returns an exact replay and rejects reuse across immutable request
    /// fields. The identity context also rejects foreign projects and stale
    /// database instance/restore epochs before the row is exposed.
    pub fn replay_in_context(
        &self,
        context: &IdentityContext,
        identity: &OperationIdentity,
    ) -> Result<Option<OperationReadback>, StoreError> {
        identity.validate()?;
        let readback = IdentityStore::new(self.store)
            .operation(context, &identity.operation_id)
            .map_err(|error| StoreError::Conflict(format!("operation identity: {error}")))?;
        let Some(readback) = readback else {
            if self.store.operation(&identity.operation_id)?.is_some() {
                return Err(StoreError::Corrupt(
                    "operation exists without a durable database identity".to_owned(),
                ));
            }
            return Ok(None);
        };
        let operation = readback.operation.as_ref().ok_or_else(|| {
            StoreError::Corrupt("identity-bound operation has no operation outcome".to_owned())
        })?;
        if !identity.matches_record(operation) {
            return Err(StoreError::Conflict(
                "operation ID was reused with a different immutable identity".to_owned(),
            ));
        }
        let audit = self
            .store
            .audit_event(&identity.operation_id)?
            .ok_or_else(|| StoreError::Corrupt("operation audit event is missing".to_owned()))?;
        validate_operation_audit(operation, &audit)?;
        if let Some((expected_kind, expected_id)) = &identity.subject {
            if audit.subject_type != *expected_kind || audit.subject_id != *expected_id {
                return Err(StoreError::WrongSubject {
                    expected: format!("{expected_kind}/{expected_id}"),
                    actual: format!("{}/{}", audit.subject_type, audit.subject_id),
                });
            }
        }
        Ok(Some(bounded_readback(readback)?))
    }

    /// Reads an operation in the current project/database lineage.  An
    /// operation row without identity is corruption, while an execution-only
    /// sidecar is returned as a bounded project-scoped readback for later
    /// reconciliation.
    pub fn readback_in_context(
        &self,
        context: &IdentityContext,
        operation_id: &str,
    ) -> Result<Option<OperationReadback>, StoreError> {
        if operation_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "operation readback requires a non-empty operation ID".to_owned(),
            ));
        }
        let identity_readback = IdentityStore::new(self.store)
            .operation(context, operation_id)
            .map_err(|error| StoreError::Conflict(format!("operation identity: {error}")))?;
        if let Some(readback) = identity_readback {
            if let Some(operation) = &readback.operation {
                let audit = self.store.audit_event(operation_id)?.ok_or_else(|| {
                    StoreError::Corrupt("operation audit event is missing".to_owned())
                })?;
                validate_operation_audit(operation, &audit)?;
            }
            return Ok(Some(bounded_readback(readback)?));
        }
        let readback = self
            .store
            .operation_readback(&context.project_id, operation_id)?;
        if readback
            .as_ref()
            .is_some_and(|readback| readback.operation.is_some())
        {
            return Err(StoreError::Corrupt(
                "operation exists without a durable database identity".to_owned(),
            ));
        }
        Ok(readback)
    }

    pub fn readback(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<OperationReadback>, StoreError> {
        self.store
            .operation_readback(project_id, operation_id)?
            .map(bounded_readback)
            .transpose()
    }

    pub fn audit_event(
        &self,
        operation_id: &str,
    ) -> Result<Option<crate::AuditEventRecord>, StoreError> {
        self.store
            .audit_event(operation_id)?
            .map(|event| audit::redacted_event(&event))
            .transpose()
    }

    /// Reads an audit event only through the current project/database
    /// identity. The operation ID remains the indexed lookup key; the
    /// identity readback prevents a caller from using an unscoped audit
    /// lookup to observe another project's operation history.
    pub fn audit_event_in_context(
        &self,
        context: &IdentityContext,
        operation_id: &str,
    ) -> Result<Option<crate::AuditEventRecord>, StoreError> {
        let readback = self.readback_in_context(context, operation_id)?;
        if readback.is_none() {
            return Ok(None);
        }
        self.audit_event(operation_id)
    }
}

fn bounded_operation(operation: &OperationRecord) -> Result<OperationRecord, StoreError> {
    let mut bounded = operation.clone();
    bounded.result_json = audit::redacted_payload(&operation.result_json)?;
    Ok(bounded)
}

fn bounded_readback(mut readback: OperationReadback) -> Result<OperationReadback, StoreError> {
    if let Some(operation) = &mut readback.operation {
        *operation = bounded_operation(operation)?;
    }
    Ok(readback)
}

fn validate_audit_identity_fields(audit: &AuditEventRecord) -> Result<(), StoreError> {
    for (field, value) in [
        ("audit project_id", audit.project_id.as_str()),
        ("audit operation_id", audit.operation_id.as_str()),
        ("audit event_type", audit.event_type.as_str()),
        ("audit subject_type", audit.subject_type.as_str()),
        ("audit subject_id", audit.subject_id.as_str()),
        ("audit actor_id", audit.actor_id.as_str()),
        ("audit as_of", audit.as_of.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(StoreError::Invalid(format!("{field} must not be empty")));
        }
    }
    if audit
        .session_id
        .as_deref()
        .is_some_and(|value| value.trim().is_empty())
    {
        return Err(StoreError::Invalid(
            "audit session_id must not be empty".to_owned(),
        ));
    }
    if audit.fence == Some(0) {
        return Err(StoreError::Invalid(
            "audit fence must be greater than zero".to_owned(),
        ));
    }
    if audit.revision == 0 {
        return Err(StoreError::Invalid(
            "audit revision must be greater than zero".to_owned(),
        ));
    }
    audit::validate_event_identity(&audit.event_type, &audit.subject_type)?;
    audit::redacted_payload(&audit.payload_json).map(|_| ())
}

fn validate_operation_audit(
    operation: &OperationRecord,
    audit: &AuditEventRecord,
) -> Result<(), StoreError> {
    if audit.project_id != operation.project_id
        || audit.operation_id != operation.operation_id
        || audit.actor_id != operation.actor_id
        || audit.session_id != operation.session_id
        || audit.fence != operation.fence
        || audit.revision != operation.revision
    {
        return Err(StoreError::Corrupt(
            "operation and audit immutable identities disagree".to_owned(),
        ));
    }
    validate_audit_identity_fields(audit)
}

fn ensure_audit_replay_identity(
    requested: &AuditEventRecord,
    existing: &AuditEventRecord,
) -> Result<(), StoreError> {
    if requested.project_id != existing.project_id
        || requested.operation_id != existing.operation_id
        || requested.revision != existing.revision
        || requested.event_type != existing.event_type
        || requested.subject_type != existing.subject_type
        || requested.subject_id != existing.subject_id
        || requested.actor_id != existing.actor_id
        || requested.session_id != existing.session_id
        || requested.fence != existing.fence
    {
        return Err(StoreError::Conflict(
            "operation replay audit identity differs from the original request".to_owned(),
        ));
    }
    Ok(())
}

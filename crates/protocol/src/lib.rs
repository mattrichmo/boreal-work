//! Versioned, dependency-light JSON types for the Boreal v2 boundary.
//!
//! This crate owns wire vocabulary and validation only. It deliberately has
//! no dependency on the domain, store, application, service, or CLI crates.
//! Domain-specific payloads are represented by the `T` in [`Envelope<T>`].

use std::{fmt, str::FromStr};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

pub mod models;

/// The current API major version, as it appears on the wire.
pub const API_VERSION: &str = "2";
/// The checked-in fixture revision from `project/spec/protocol`.
pub const FIXTURE_VERSION: &str = "p0-03.v2";

/// Versioned schema names used by the protocol fixtures.
pub mod schema {
    pub const ENVELOPE: &str = "boreal.protocol.envelope.v1";
    pub const STATUS: &str = "boreal.status.v1";
    pub const LIST: &str = "boreal.list.v1";
    pub const GUIDANCE: &str = "boreal.agent_guidance.v1";
    pub const NEXT: &str = "boreal.agent_next.v1";
    pub const RECEIPT: &str = "boreal.receipt.v1";
    pub const GATE_DIAGNOSTICS: &str = "boreal.gate_diagnostics.v1";
    pub const ERROR_REGISTRY: &str = "boreal.errors.v1";
}

/// Compatibility aliases for consumers that use the manifest terminology.
pub const PROTOCOL_VERSION: &str = schema::ENVELOPE;
pub const SCHEMA_VERSION: &str = schema::ENVELOPE;
pub const ENVELOPE_SCHEMA_VERSION: &str = schema::ENVELOPE;

/// Protocol-wide bounds frozen by the protocol manifest.
pub mod bounds {
    pub const MAX_INLINE_ITEMS: usize = 100;
    pub const MAX_INLINE_REQUIREMENTS: usize = 32;
    pub const MAX_INLINE_REASON_CODES: usize = 32;
    pub const MAX_INLINE_ARGV_ITEMS: usize = 32;
    pub const MAX_INLINE_OUTPUT_BYTES: usize = 65_536;
    pub const DETAIL_REFERENCE_THRESHOLD_BYTES: usize = 65_536;
}

/// Whether the request reached the service and was decoded.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportOutcome {
    Ok,
    Error,
}

/// The application result, independent of transport success.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApplicationOutcome {
    Changed,
    Unchanged,
    Rejected,
    Conflict,
    Busy,
    Failed,
    Unknown,
}

impl ApplicationOutcome {
    pub const fn is_success(self) -> bool {
        matches!(self, Self::Changed | Self::Unchanged)
    }

    pub const fn requires_error(self) -> bool {
        !self.is_success()
    }
}

/// A reference to a bounded result body stored outside the inline envelope.
///
/// The fields are optional to allow the service to add reference metadata in
/// an additive way while retaining the typed reference itself.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DetailReference {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// An executable recovery hint owned by the protocol/application boundary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RecoveryAction {
    pub action: String,
    pub safe_argv: Vec<String>,
}

/// One machine-readable invalid argument diagnostic.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InvalidField {
    pub path: String,
    pub reason_code: String,
    pub expected: String,
    pub received: serde_json::Value,
}

/// The structured error carried by a non-success application outcome.
///
/// Fields that are not common to every error are optional. Unknown additive
/// fields are ignored by serde and are never treated as policy by this crate.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProtocolError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_depth: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_preserved: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<RecoveryAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<InvalidField>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline_mode_allowed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readback_required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provided_attempt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provided_fence: Option<u64>,
}

impl Default for ProtocolError {
    fn default() -> Self {
        Self {
            code: ErrorCode::ProtocolMismatch,
            message: String::new(),
            retryable: false,
            retry_after_ms: None,
            queue_depth: None,
            operation_preserved: None,
            recovery: None,
            fields: None,
            expected_revision: None,
            observed_revision: None,
            service_state: None,
            offline_mode_allowed: None,
            readback_required: None,
            operation_id: None,
            provided_attempt_id: None,
            provided_fence: None,
        }
    }
}

impl ProtocolError {
    pub fn new(code: ErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            ..Self::default()
        }
    }
}

/// Error codes registered by `project/spec/protocol/error-registry.json`.
///
/// There is intentionally no catch-all variant: deserializing an unknown code
/// fails closed, allowing a caller to report a protocol mismatch.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidArgument,
    IntegrityQuarantined,
    SourceSizeLimit,
    ReceiptSizeLimit,
    CleanupPending,
    CredentialRevoked,
    UnsupportedTarget,
    InvalidParent,
    DerivedStatusReadOnly,
    UnknownCommandNamespace,
    ProtocolMismatch,
    UnsupportedPlatform,
    NotFound,
    PermissionDenied,
    RevisionConflict,
    StaleContext,
    StaleRevision,
    StaleFence,
    StaleReceipt,
    AlreadyClaimed,
    ClaimConflict,
    StatusNotAssignable,
    WorkNotPublished,
    DependencyNotClosed,
    NotClaimable,
    AttemptConflict,
    AttemptUnaccepted,
    WriterQueueFull,
    ServiceBusy,
    ServiceUnavailable,
    UnknownOutcome,
    AttemptExpired,
    ExpiredReview,
    DependencyCycle,
    PrerequisiteOpen,
    DependencyOpen,
    BlockedWork,
    HardBlocked,
    OperatorRequired,
    Paused,
    RetryWait,
    VerificationRequired,
    ReviewRequired,
    CloseIntentMissing,
    ExpiryStopUnconfirmed,
    LeaseExpired,
    HardDeadlineImmutable,
    RoleDenied,
    ReviewerCannotReviewOwnAttempt,
    OperationConflict,
    OperationUnknown,
    ReceiptInvalid,
    ReceiptSubjectMismatch,
    ReceiptCommandMismatch,
    ReceiptSourceMismatch,
    ReceiptConfigMismatch,
    ReceiptPolicyMismatch,
    ReceiptAttestationMissing,
    ReceiptExitNonzero,
    ReceiptObservableMissing,
    ReceiptCommandNonzero,
    GateUnsatisfied,
    AuditScopeMissing,
    NotClosed,
    CloseIntentInvalidated,
    CloseIntentInvalid,
    AlreadyTerminal,
    GuidanceUnavailable,
    UnsafeCommand,
}

pub type ProtocolErrorCode = ErrorCode;

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArgument => "invalid_argument",
            Self::IntegrityQuarantined => "integrity_quarantined",
            Self::SourceSizeLimit => "source_size_limit",
            Self::ReceiptSizeLimit => "receipt_size_limit",
            Self::CleanupPending => "cleanup_pending",
            Self::CredentialRevoked => "credential_revoked",
            Self::UnsupportedTarget => "unsupported_target",
            Self::InvalidParent => "invalid_parent",
            Self::DerivedStatusReadOnly => "derived_status_read_only",
            Self::UnknownCommandNamespace => "unknown_command_namespace",
            Self::ProtocolMismatch => "protocol_mismatch",
            Self::UnsupportedPlatform => "unsupported_platform",
            Self::NotFound => "not_found",
            Self::PermissionDenied => "permission_denied",
            Self::RevisionConflict => "revision_conflict",
            Self::StaleContext => "stale_context",
            Self::StaleRevision => "stale_revision",
            Self::StaleFence => "stale_fence",
            Self::StaleReceipt => "stale_receipt",
            Self::AlreadyClaimed => "already_claimed",
            Self::ClaimConflict => "claim_conflict",
            Self::StatusNotAssignable => "status_not_assignable",
            Self::WorkNotPublished => "work_not_published",
            Self::DependencyNotClosed => "dependency_not_closed",
            Self::NotClaimable => "not_claimable",
            Self::AttemptConflict => "attempt_conflict",
            Self::AttemptUnaccepted => "attempt_unaccepted",
            Self::WriterQueueFull => "writer_queue_full",
            Self::ServiceBusy => "service_busy",
            Self::ServiceUnavailable => "service_unavailable",
            Self::UnknownOutcome => "unknown_outcome",
            Self::AttemptExpired => "attempt_expired",
            Self::ExpiredReview => "expired_review",
            Self::DependencyCycle => "dependency_cycle",
            Self::PrerequisiteOpen => "prerequisite_open",
            Self::DependencyOpen => "dependency_open",
            Self::BlockedWork => "blocked_work",
            Self::HardBlocked => "hard_blocked",
            Self::OperatorRequired => "operator_required",
            Self::Paused => "paused",
            Self::RetryWait => "retry_wait",
            Self::VerificationRequired => "verification_required",
            Self::ReviewRequired => "review_required",
            Self::CloseIntentMissing => "close_intent_missing",
            Self::ExpiryStopUnconfirmed => "expiry_stop_unconfirmed",
            Self::LeaseExpired => "lease_expired",
            Self::HardDeadlineImmutable => "hard_deadline_immutable",
            Self::RoleDenied => "role_denied",
            Self::ReviewerCannotReviewOwnAttempt => "reviewer_cannot_review_own_attempt",
            Self::OperationConflict => "operation_conflict",
            Self::OperationUnknown => "operation_unknown",
            Self::ReceiptInvalid => "receipt_invalid",
            Self::ReceiptSubjectMismatch => "receipt_subject_mismatch",
            Self::ReceiptCommandMismatch => "receipt_command_mismatch",
            Self::ReceiptSourceMismatch => "receipt_source_mismatch",
            Self::ReceiptConfigMismatch => "receipt_config_mismatch",
            Self::ReceiptPolicyMismatch => "receipt_policy_mismatch",
            Self::ReceiptAttestationMissing => "receipt_attestation_missing",
            Self::ReceiptExitNonzero => "receipt_exit_nonzero",
            Self::ReceiptObservableMissing => "receipt_observable_missing",
            Self::ReceiptCommandNonzero => "receipt_command_nonzero",
            Self::GateUnsatisfied => "gate_unsatisfied",
            Self::AuditScopeMissing => "audit_scope_missing",
            Self::NotClosed => "not_closed",
            Self::CloseIntentInvalidated => "close_intent_invalidated",
            Self::CloseIntentInvalid => "close_intent_invalid",
            Self::AlreadyTerminal => "already_terminal",
            Self::GuidanceUnavailable => "guidance_unavailable",
            Self::UnsafeCommand => "unsafe_command",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ErrorCode {
    type Err = ProtocolParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        serde_json::from_value(serde_json::Value::String(value.to_owned()))
            .map_err(|_| ProtocolParseError::UnknownErrorCode(value.to_owned()))
    }
}

/// A versioned response envelope shared by all commands and read models.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Envelope<T> {
    pub api_version: String,
    pub schema_version: String,
    pub operation_id: String,
    pub revision: Option<u64>,
    pub as_of: String,
    pub next_status_change_at: Option<String>,
    pub transport: TransportOutcome,
    pub outcome: ApplicationOutcome,
    pub data: Option<T>,
    pub detail_ref: Option<DetailReference>,
    pub error: Option<ProtocolError>,
}

impl<T> Envelope<T> {
    pub fn validate(&self) -> Result<(), ProtocolValidationError> {
        if self.api_version != API_VERSION {
            return Err(ProtocolValidationError::ApiVersionMismatch {
                expected: API_VERSION.to_owned(),
                found: self.api_version.clone(),
            });
        }
        if self.schema_version != schema::ENVELOPE {
            return Err(ProtocolValidationError::SchemaVersionMismatch {
                expected: schema::ENVELOPE.to_owned(),
                found: self.schema_version.clone(),
            });
        }
        validate_operation_id(&self.operation_id)?;
        if self.as_of.is_empty() {
            return Err(ProtocolValidationError::EmptyTimestamp { field: "as_of" });
        }
        if self
            .next_status_change_at
            .as_ref()
            .is_some_and(String::is_empty)
        {
            return Err(ProtocolValidationError::EmptyTimestamp {
                field: "next_status_change_at",
            });
        }
        if self.outcome.requires_error() && self.error.is_none() {
            return Err(ProtocolValidationError::MissingError {
                outcome: self.outcome,
            });
        }
        if self.outcome.is_success() && self.error.is_some() {
            return Err(ProtocolValidationError::UnexpectedError {
                outcome: self.outcome,
            });
        }
        if self.transport == TransportOutcome::Error
            && !matches!(
                self.outcome,
                ApplicationOutcome::Failed | ApplicationOutcome::Unknown
            )
        {
            return Err(ProtocolValidationError::TransportOutcomeMismatch {
                transport: self.transport,
                outcome: self.outcome,
            });
        }
        if self.data.is_some() && self.detail_ref.is_some() {
            return Err(ProtocolValidationError::InlineAndReferencedData);
        }
        Ok(())
    }

    pub fn from_json(json: &str) -> Result<Self, ProtocolParseError>
    where
        T: DeserializeOwned,
    {
        let envelope: Self = serde_json::from_str(json).map_err(ProtocolParseError::Json)?;
        envelope
            .validate()
            .map_err(ProtocolParseError::Validation)?;
        Ok(envelope)
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error>
    where
        T: Serialize,
    {
        serde_json::to_string(self)
    }
}

/// A versioned request envelope. `data` is intentionally generic so the
/// application can add command-specific request DTOs without changing the
/// transport contract.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RequestEnvelope<T> {
    pub api_version: String,
    pub schema_version: String,
    pub operation_id: String,
    pub expected_revision: Option<u64>,
    pub attempt_id: Option<String>,
    pub attempt_fence: Option<u64>,
    pub data: T,
}

impl<T> RequestEnvelope<T> {
    pub fn new(operation_id: impl Into<String>, data: T) -> Self {
        Self {
            api_version: API_VERSION.to_owned(),
            schema_version: schema::ENVELOPE.to_owned(),
            operation_id: operation_id.into(),
            expected_revision: None,
            attempt_id: None,
            attempt_fence: None,
            data,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolValidationError> {
        if self.api_version != API_VERSION {
            return Err(ProtocolValidationError::ApiVersionMismatch {
                expected: API_VERSION.to_owned(),
                found: self.api_version.clone(),
            });
        }
        if self.schema_version != schema::ENVELOPE {
            return Err(ProtocolValidationError::SchemaVersionMismatch {
                expected: schema::ENVELOPE.to_owned(),
                found: self.schema_version.clone(),
            });
        }
        validate_operation_id(&self.operation_id)
    }
}

fn validate_operation_id(value: &str) -> Result<(), ProtocolValidationError> {
    let valid_tail = value.strip_prefix("op_").is_some_and(|tail| {
        !tail.is_empty()
            && tail
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    });
    if valid_tail {
        Ok(())
    } else {
        Err(ProtocolValidationError::InvalidOperationId(
            value.to_owned(),
        ))
    }
}

/// A capability offer used during the version handshake.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct CapabilitySet {
    pub api_versions: Vec<String>,
    pub schema_versions: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

pub type Capabilities = CapabilitySet;

impl CapabilitySet {
    pub fn current() -> Self {
        Self {
            api_versions: vec![API_VERSION.to_owned()],
            schema_versions: vec![schema::ENVELOPE.to_owned()],
            capabilities: Vec::new(),
        }
    }

    pub fn supports_current(&self) -> bool {
        self.api_versions.iter().any(|v| v == API_VERSION)
            && self.schema_versions.iter().any(|v| v == schema::ENVELOPE)
    }

    /// Negotiate the first version pair offered by `self` that `peer` also
    /// supports. Ordering is caller-controlled and therefore deterministic.
    pub fn negotiate(
        &self,
        peer: &CapabilitySet,
    ) -> Result<NegotiatedCapabilities, NegotiationError> {
        let api_version = self
            .api_versions
            .iter()
            .find(|version| peer.api_versions.contains(version))
            .cloned()
            .ok_or(NegotiationError::NoCompatibleApiVersion)?;
        let schema_version = self
            .schema_versions
            .iter()
            .find(|version| peer.schema_versions.contains(version))
            .cloned()
            .ok_or(NegotiationError::NoCompatibleSchemaVersion)?;
        let capabilities = self
            .capabilities
            .iter()
            .filter(|capability| peer.capabilities.contains(capability))
            .cloned()
            .collect();
        Ok(NegotiatedCapabilities {
            api_version,
            schema_version,
            capabilities,
        })
    }
}

/// The result of a successful capability negotiation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NegotiatedCapabilities {
    pub api_version: String,
    pub schema_version: String,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NegotiationError {
    NoCompatibleApiVersion,
    NoCompatibleSchemaVersion,
}

impl fmt::Display for NegotiationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoCompatibleApiVersion => f.write_str("no compatible API version"),
            Self::NoCompatibleSchemaVersion => f.write_str("no compatible schema version"),
        }
    }
}

impl std::error::Error for NegotiationError {}

#[derive(Clone, Debug, PartialEq)]
pub enum ProtocolValidationError {
    ApiVersionMismatch {
        expected: String,
        found: String,
    },
    SchemaVersionMismatch {
        expected: String,
        found: String,
    },
    InvalidOperationId(String),
    EmptyTimestamp {
        field: &'static str,
    },
    MissingError {
        outcome: ApplicationOutcome,
    },
    UnexpectedError {
        outcome: ApplicationOutcome,
    },
    TransportOutcomeMismatch {
        transport: TransportOutcome,
        outcome: ApplicationOutcome,
    },
    InlineAndReferencedData,
}

impl fmt::Display for ProtocolValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ApiVersionMismatch { expected, found } => {
                write!(
                    f,
                    "API version mismatch: expected {expected}, found {found}"
                )
            }
            Self::SchemaVersionMismatch { expected, found } => {
                write!(
                    f,
                    "schema version mismatch: expected {expected}, found {found}"
                )
            }
            Self::InvalidOperationId(value) => write!(f, "invalid operation id: {value}"),
            Self::EmptyTimestamp { field } => write!(f, "{field} must not be empty"),
            Self::MissingError { outcome } => write!(f, "{outcome:?} outcome requires an error"),
            Self::UnexpectedError { outcome } => {
                write!(f, "{outcome:?} outcome must not carry an error")
            }
            Self::TransportOutcomeMismatch { transport, outcome } => {
                write!(
                    f,
                    "transport {transport:?} cannot carry outcome {outcome:?}"
                )
            }
            Self::InlineAndReferencedData => {
                f.write_str("data and detail_ref cannot both be present")
            }
        }
    }
}

impl std::error::Error for ProtocolValidationError {}

#[derive(Debug)]
pub enum ProtocolParseError {
    Json(serde_json::Error),
    Validation(ProtocolValidationError),
    UnknownErrorCode(String),
}

impl fmt::Display for ProtocolParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(error) => write!(f, "invalid protocol JSON: {error}"),
            Self::Validation(error) => error.fmt(f),
            Self::UnknownErrorCode(code) => write!(f, "unknown protocol error code: {code}"),
        }
    }
}

impl std::error::Error for ProtocolParseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(error) => Some(error),
            Self::Validation(error) => Some(error),
            Self::UnknownErrorCode(_) => None,
        }
    }
}

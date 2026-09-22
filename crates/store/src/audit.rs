//! Bounded, redaction-safe audit payload handling.
//!
//! Audit rows are durable history, not a receipt dump. This module removes
//! credential-bearing fields, bounds recursive detail, and rejects malformed
//! JSON before an event enters an operation-owned transaction.

use super::{AuditEventRecord, StoreError};
use serde_json::{Map, Value};

const MAX_AUDIT_BYTES: usize = 16 * 1024;
const MAX_STRING_BYTES: usize = 4096;
const MAX_ARRAY_ITEMS: usize = 256;
const MAX_NESTING_DEPTH: usize = 32;

const EVENT_TYPES: &[&str] = &[
    "work.created",
    "work.published",
    "work.closed",
    "work.blocked",
    "work.paused",
    "work.resumed",
    "work.cancelled",
    "work.reopened",
    "attempt.claimed",
    "attempt.accepted",
    "attempt.started",
    "attempt.submitted",
    "attempt.released",
    "attempt.failed",
    "attempt.expiry_pending",
    "attempt.expired",
    "evidence.verifier.admitted",
    "expiry.resolved",
    "lease.renewed",
    "receipt.recorded",
    "receipt.rejected",
    "review.accepted",
    "review.rejected",
    "close.requested",
    "close.completed",
    "gate.satisfied",
    "hold.resolved",
    "repair.correction",
    "repair.supersession",
];

const SUBJECT_TYPES: &[&str] = &[
    "work",
    "attempt",
    "receipt",
    "review",
    "gate",
    "hold",
    "dependency",
    "summary",
    "operation",
    "project",
];

/// Validates the schema-owned identity vocabulary before an operation row is
/// inserted. SQLite constraints remain authoritative, but prevalidation keeps
/// malformed audit metadata from creating a partial in-transaction bundle
/// for callers that forget to handle an error before their rollback boundary.
pub fn validate_event_identity(event_type: &str, subject_type: &str) -> Result<(), StoreError> {
    if !EVENT_TYPES.contains(&event_type) {
        return Err(StoreError::Invalid(format!(
            "audit event type is not registered: {event_type}"
        )));
    }
    if !SUBJECT_TYPES.contains(&subject_type) {
        return Err(StoreError::Invalid(format!(
            "audit subject type is not registered: {subject_type}"
        )));
    }
    Ok(())
}

/// Redacts likely credential and secret fields case-insensitively.
pub fn redact_value(value: &Value) -> Value {
    redact_value_at_depth(value, 0)
}

fn redact_value_at_depth(value: &Value, depth: usize) -> Value {
    if depth >= MAX_NESTING_DEPTH {
        return Value::String("[REDACTED:depth_limit]".to_owned());
    }
    match value {
        Value::Object(object) => {
            let mut redacted = Map::new();
            for (key, value) in object {
                if is_sensitive_key(key) {
                    redacted.insert(key.clone(), Value::String("[REDACTED]".to_owned()));
                } else {
                    redacted.insert(key.clone(), redact_value_at_depth(value, depth + 1));
                }
            }
            Value::Object(redacted)
        }
        Value::Array(values) => {
            let mut redacted = values
                .iter()
                .take(MAX_ARRAY_ITEMS)
                .map(|value| redact_value_at_depth(value, depth + 1))
                .collect::<Vec<_>>();
            if values.len() > MAX_ARRAY_ITEMS {
                redacted.push(Value::String("[TRUNCATED:array_items]".to_owned()));
            }
            Value::Array(redacted)
        }
        Value::String(value) => {
            if value.len() <= MAX_STRING_BYTES {
                Value::String(value.clone())
            } else {
                // The limit is byte based and can split a multi-byte UTF-8
                // sequence, so walk back to a valid boundary first.
                let mut end = MAX_STRING_BYTES;
                while end > 0 && !value.is_char_boundary(end) {
                    end -= 1;
                }
                Value::String(format!("{}…[truncated]", &value[..end]))
            }
        }
        other => other.clone(),
    }
}

/// Returns compact JSON safe for durable audit storage.
pub fn redacted_payload(payload_json: &str) -> Result<String, StoreError> {
    let value: Value = serde_json::from_str(payload_json).map_err(|error| {
        StoreError::Invalid(format!("audit payload must be valid JSON: {error}"))
    })?;
    let encoded = serde_json::to_vec(&redact_value(&value)).map_err(|error| {
        StoreError::Invalid(format!("audit payload cannot be encoded: {error}"))
    })?;
    if encoded.len() > MAX_AUDIT_BYTES {
        return Ok(r#"{"redacted":"payload_too_large"}"#.to_owned());
    }
    String::from_utf8(encoded)
        .map_err(|error| StoreError::Invalid(format!("audit payload is not UTF-8: {error}")))
}

/// Copies an event while replacing its payload with the bounded safe form.
pub fn redacted_event(event: &AuditEventRecord) -> Result<AuditEventRecord, StoreError> {
    let mut safe = event.clone();
    safe.payload_json = redacted_payload(&event.payload_json)?;
    Ok(safe)
}

fn is_sensitive_key(key: &str) -> bool {
    // Normalize separators so `api-key`, `api_key`, and `apiKey` are treated
    // consistently without logging the original credential-like value.
    let key = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    [
        "password",
        "passwd",
        "secret",
        "token",
        "credential",
        "authorization",
        "cookie",
        "private_key",
        "privatekey",
        "api_key",
        "apikey",
        "access_key",
        "accesskey",
    ]
    .iter()
    .map(|needle| needle.replace('_', ""))
    .any(|needle| key.contains(&needle))
}

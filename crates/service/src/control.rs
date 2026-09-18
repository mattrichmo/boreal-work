use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlRequestKind {
    Cancel,
    Stop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlPhase {
    Requested,
    Confirmed,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlRecord {
    pub operation_id: String,
    pub kind: ControlRequestKind,
    pub phase: ControlPhase,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ControlError {
    InvalidOperation,
    EmptyReason,
    AlreadyConfirmed(ControlRecord),
    ConflictingRequest(ControlRecord),
}

impl fmt::Display for ControlError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOperation => {
                formatter.write_str("operation ID must be non-empty and safe")
            }
            Self::EmptyReason => formatter.write_str("control reason must be non-empty"),
            Self::AlreadyConfirmed(record) => write!(
                formatter,
                "operation {:?} is already stop-confirmed",
                record.operation_id
            ),
            Self::ConflictingRequest(record) => write!(
                formatter,
                "operation {:?} already has a different control request",
                record.operation_id
            ),
        }
    }
}

impl std::error::Error for ControlError {}

/// Process-local cancellation/stop intent shared by the host and an
/// application-owned executor.
///
/// Requesting a stop never claims that a child process has stopped. The
/// executor must explicitly confirm it, or mark the result unknown. This is
/// intentionally separate from lifecycle policy and can therefore be shared
/// by CLI, TUI and a future process supervisor without creating another state
/// machine.
#[derive(Clone, Debug, Default)]
pub struct OperationControl {
    records: Arc<Mutex<BTreeMap<String, ControlRecord>>>,
}

impl OperationControl {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn request_cancel(
        &self,
        operation_id: impl Into<String>,
        reason: impl Into<String>,
    ) -> Result<ControlRecord, ControlError> {
        self.request(
            operation_id.into(),
            ControlRequestKind::Cancel,
            reason.into(),
        )
    }

    pub fn request_stop(
        &self,
        operation_id: impl Into<String>,
        reason: impl Into<String>,
    ) -> Result<ControlRecord, ControlError> {
        self.request(operation_id.into(), ControlRequestKind::Stop, reason.into())
    }

    fn request(
        &self,
        operation_id: String,
        kind: ControlRequestKind,
        reason: String,
    ) -> Result<ControlRecord, ControlError> {
        validate_operation_id(&operation_id)?;
        if reason.trim().is_empty() {
            return Err(ControlError::EmptyReason);
        }
        let mut records = self.records.lock().expect("control mutex poisoned");
        if let Some(existing) = records.get(&operation_id) {
            if existing.phase == ControlPhase::Confirmed {
                return Err(ControlError::AlreadyConfirmed(existing.clone()));
            }
            if existing.kind == kind && existing.reason == reason {
                return Ok(existing.clone());
            }
            return Err(ControlError::ConflictingRequest(existing.clone()));
        }
        let record = ControlRecord {
            operation_id: operation_id.clone(),
            kind,
            phase: ControlPhase::Requested,
            reason,
        };
        records.insert(operation_id, record.clone());
        Ok(record)
    }

    pub fn confirm_stopped(&self, operation_id: &str) -> Result<ControlRecord, ControlError> {
        validate_operation_id(operation_id)?;
        let mut records = self.records.lock().expect("control mutex poisoned");
        let Some(record) = records.get_mut(operation_id) else {
            return Err(ControlError::InvalidOperation);
        };
        record.phase = ControlPhase::Confirmed;
        Ok(record.clone())
    }

    pub fn mark_unknown(&self, operation_id: &str) -> Result<ControlRecord, ControlError> {
        validate_operation_id(operation_id)?;
        let mut records = self.records.lock().expect("control mutex poisoned");
        let Some(record) = records.get_mut(operation_id) else {
            return Err(ControlError::InvalidOperation);
        };
        record.phase = ControlPhase::Unknown;
        Ok(record.clone())
    }

    pub fn get(&self, operation_id: &str) -> Option<ControlRecord> {
        self.records
            .lock()
            .expect("control mutex poisoned")
            .get(operation_id)
            .cloned()
    }

    pub fn records(&self) -> Vec<ControlRecord> {
        self.records
            .lock()
            .expect("control mutex poisoned")
            .values()
            .cloned()
            .collect()
    }
}

fn validate_operation_id(operation_id: &str) -> Result<(), ControlError> {
    if operation_id.trim().is_empty() || operation_id.chars().any(char::is_control) {
        Err(ControlError::InvalidOperation)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_requires_explicit_stop_confirmation() {
        let control = OperationControl::new();
        let requested = control
            .request_cancel("op_run", "deadline elapsed")
            .unwrap();
        assert_eq!(requested.phase, ControlPhase::Requested);
        assert_eq!(
            control.get("op_run").unwrap().phase,
            ControlPhase::Requested
        );

        let confirmed = control.confirm_stopped("op_run").unwrap();
        assert_eq!(confirmed.phase, ControlPhase::Confirmed);
        assert!(matches!(
            control.request_cancel("op_run", "retry"),
            Err(ControlError::AlreadyConfirmed(_))
        ));
    }

    #[test]
    fn uncertain_stop_is_not_treated_as_confirmed() {
        let control = OperationControl::new();
        control
            .request_stop("op_run", "operator requested")
            .unwrap();
        let unknown = control.mark_unknown("op_run").unwrap();
        assert_eq!(unknown.phase, ControlPhase::Unknown);
        assert_ne!(unknown.phase, ControlPhase::Confirmed);
        let retry = control
            .request_stop("op_run", "operator requested")
            .unwrap();
        assert_eq!(retry.phase, ControlPhase::Unknown);
        assert!(matches!(
            control.request_cancel("op_run", "different action"),
            Err(ControlError::ConflictingRequest(_))
        ));
    }
}

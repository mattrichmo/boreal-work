use crate::QueueTicket;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex};

/// The durable boundary a service operation has reached.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationPhase {
    Queued,
    InFlight,
    Committed,
    Failed,
    /// The process restarted after dispatch, so the result must be read back
    /// by operation ID before a caller can decide whether to retry.
    Unknown,
}

/// Recoverable identity and state for one operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationRecord {
    operation_id: String,
    phase: OperationPhase,
    ticket: Option<QueueTicket>,
    revision: Option<u64>,
    recovered: bool,
}

impl OperationRecord {
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }

    pub const fn phase(&self) -> OperationPhase {
        self.phase
    }

    pub const fn ticket(&self) -> Option<QueueTicket> {
        self.ticket
    }

    pub const fn revision(&self) -> Option<u64> {
        self.revision
    }

    pub const fn was_recovered(&self) -> bool {
        self.recovered
    }
}

/// A bounded-process restart report. Queued work remains queued; in-flight
/// work is deliberately made unknown rather than replayed blindly.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryReport {
    pub queued: Vec<String>,
    pub unknown: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationError {
    InvalidId,
    Duplicate(OperationRecord),
}

impl fmt::Display for OperationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidId => formatter.write_str("operation ID must be non-empty and safe"),
            Self::Duplicate(record) => write!(
                formatter,
                "operation {:?} already exists in phase {:?}",
                record.operation_id, record.phase
            ),
        }
    }
}

impl std::error::Error for OperationError {}

/// In-memory operation journal used by the service boundary.
///
/// The application/store owns durable operation results. This journal owns
/// the process-side recovery state needed to hand those results back to the
/// application for readback after a service restart.
#[derive(Clone, Debug, Default)]
pub struct OperationRecovery {
    records: Arc<Mutex<BTreeMap<String, OperationRecord>>>,
}

impl OperationRecovery {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, operation_id: impl Into<String>) -> Result<(), OperationError> {
        let operation_id = operation_id.into();
        if operation_id.trim().is_empty() || operation_id.chars().any(char::is_control) {
            return Err(OperationError::InvalidId);
        }
        let mut records = self
            .records
            .lock()
            .expect("operation journal mutex poisoned");
        if let Some(record) = records.get(&operation_id) {
            return Err(OperationError::Duplicate(record.clone()));
        }
        records.insert(
            operation_id.clone(),
            OperationRecord {
                operation_id,
                phase: OperationPhase::Queued,
                ticket: None,
                revision: None,
                recovered: false,
            },
        );
        Ok(())
    }

    pub(crate) fn set_ticket(&self, operation_id: &str, ticket: QueueTicket) {
        if let Some(record) = self
            .records
            .lock()
            .expect("operation journal mutex poisoned")
            .get_mut(operation_id)
        {
            record.ticket = Some(ticket);
        }
    }

    pub(crate) fn mark_in_flight(&self, operation_id: &str) {
        if let Some(record) = self
            .records
            .lock()
            .expect("operation journal mutex poisoned")
            .get_mut(operation_id)
        {
            record.phase = OperationPhase::InFlight;
        }
    }

    pub(crate) fn mark_committed(&self, operation_id: &str, revision: Option<u64>) {
        if let Some(record) = self
            .records
            .lock()
            .expect("operation journal mutex poisoned")
            .get_mut(operation_id)
        {
            record.phase = OperationPhase::Committed;
            record.revision = revision;
        }
    }

    pub(crate) fn mark_failed(&self, operation_id: &str) {
        if let Some(record) = self
            .records
            .lock()
            .expect("operation journal mutex poisoned")
            .get_mut(operation_id)
        {
            record.phase = OperationPhase::Failed;
        }
    }

    pub(crate) fn remove(&self, operation_id: &str) {
        self.records
            .lock()
            .expect("operation journal mutex poisoned")
            .remove(operation_id);
    }

    pub fn get(&self, operation_id: &str) -> Option<OperationRecord> {
        self.records
            .lock()
            .expect("operation journal mutex poisoned")
            .get(operation_id)
            .cloned()
    }

    pub fn records(&self) -> Vec<OperationRecord> {
        self.records
            .lock()
            .expect("operation journal mutex poisoned")
            .values()
            .cloned()
            .collect()
    }

    /// Apply the process restart rule and return the states requiring action.
    pub fn recover(&self) -> RecoveryReport {
        let mut records = self
            .records
            .lock()
            .expect("operation journal mutex poisoned");
        let mut report = RecoveryReport {
            queued: Vec::new(),
            unknown: Vec::new(),
        };
        for record in records.values_mut() {
            match record.phase {
                OperationPhase::Queued => report.queued.push(record.operation_id.clone()),
                OperationPhase::InFlight => {
                    record.phase = OperationPhase::Unknown;
                    record.recovered = true;
                    report.unknown.push(record.operation_id.clone());
                }
                OperationPhase::Committed | OperationPhase::Failed | OperationPhase::Unknown => {}
            }
        }
        report
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_preserves_queued_and_fences_in_flight_work_for_readback() {
        let journal = OperationRecovery::new();
        journal.register("queued").unwrap();
        journal.register("running").unwrap();
        journal.mark_in_flight("running");

        let report = journal.recover();
        assert_eq!(report.queued, vec!["queued"]);
        assert_eq!(report.unknown, vec!["running"]);
        assert_eq!(
            journal.get("queued").unwrap().phase(),
            OperationPhase::Queued
        );
        let running = journal.get("running").unwrap();
        assert_eq!(running.phase(), OperationPhase::Unknown);
        assert!(running.was_recovered());
    }

    #[test]
    fn committed_operation_ids_are_not_admitted_twice() {
        let journal = OperationRecovery::new();
        journal.register("op-1").unwrap();
        journal.mark_committed("op-1", Some(42));
        assert!(matches!(
            journal.register("op-1"),
            Err(OperationError::Duplicate(record))
                if record.phase() == OperationPhase::Committed && record.revision() == Some(42)
        ));
    }
}

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
    pub reconciled: Vec<String>,
}

/// A reference to an external execution admitted by the application before a
/// service process stopped. The service carries this opaque identity across a
/// restart; it does not infer that a PID is still the same process.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionReference {
    pub run_id: String,
    pub process_id: Option<u32>,
    pub process_start_token: Option<String>,
    pub artifact_ref: Option<String>,
}

impl ExecutionReference {
    pub fn new(run_id: impl Into<String>) -> Self {
        Self {
            run_id: run_id.into(),
            process_id: None,
            process_start_token: None,
            artifact_ref: None,
        }
    }

    pub fn with_process(mut self, process_id: u32, start_token: impl Into<String>) -> Self {
        self.process_id = Some(process_id);
        self.process_start_token = Some(start_token.into());
        self
    }

    pub fn with_artifact(mut self, artifact_ref: impl Into<String>) -> Self {
        self.artifact_ref = Some(artifact_ref.into());
        self
    }
}

/// A storage-neutral snapshot of an operation that was durable before the
/// service process started.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryEntry {
    pub operation_id: String,
    pub phase: OperationPhase,
    pub revision: Option<u64>,
    pub execution: Option<ExecutionReference>,
}

impl RecoveryEntry {
    pub fn new(
        operation_id: impl Into<String>,
        phase: OperationPhase,
        revision: Option<u64>,
    ) -> Self {
        Self {
            operation_id: operation_id.into(),
            phase,
            revision,
            execution: None,
        }
    }

    pub fn with_execution(mut self, execution: ExecutionReference) -> Self {
        self.execution = Some(execution);
        self
    }
}

/// Result of asking the durable application adapter to reconcile an admitted
/// external execution. `Unknown` is the safe default and must not be retried
/// automatically. A known terminal result is valid only when the adapter has
/// observed and durably recorded that result.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecoveryDisposition {
    Unknown { reason: String },
    Committed { revision: Option<u64> },
    Failed { reason: String },
}

/// Error returned by an application/store recovery adapter.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryBackendError {
    message: String,
}

impl RecoveryBackendError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for RecoveryBackendError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RecoveryBackendError {}

/// Adapter boundary for durable operation recovery.
///
/// The service does not inspect a database or decide application policy. An
/// application adapter supplies incomplete durable operations and persists
/// the transition of an in-flight operation to `Unknown` before the host
/// accepts new work. Implementations should use a short transaction and must
/// never delete or force-complete a live owner's attempt.
pub trait RecoveryBackend: Send + Sync + 'static {
    fn load_incomplete(&self) -> Result<Vec<RecoveryEntry>, RecoveryBackendError>;

    fn mark_unknown(&self, operation_id: &str) -> Result<(), RecoveryBackendError>;

    /// Reconcile an admitted operation using application-owned durable facts
    /// and any external execution reference. The default is deliberately
    /// conservative: without an adapter-specific observation, the operation
    /// remains unknown and must be read back by operation ID.
    fn reconcile(
        &self,
        _entry: &RecoveryEntry,
    ) -> Result<RecoveryDisposition, RecoveryBackendError> {
        Ok(RecoveryDisposition::Unknown {
            reason: "no durable execution reconciliation was available".to_owned(),
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationError {
    InvalidId,
    Duplicate(OperationRecord),
    HydrationConflict { operation_id: String },
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
            Self::HydrationConflict { operation_id } => {
                write!(
                    formatter,
                    "durable recovery conflicts for operation {operation_id:?}"
                )
            }
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

    /// Hydrate process-side state from the application's durable operation
    /// projection before a host begins accepting requests.
    pub fn hydrate<I>(&self, entries: I) -> Result<(), OperationError>
    where
        I: IntoIterator<Item = RecoveryEntry>,
    {
        let mut records = self
            .records
            .lock()
            .expect("operation journal mutex poisoned");
        for entry in entries {
            validate_operation_id(&entry.operation_id)?;
            let hydrated = OperationRecord {
                operation_id: entry.operation_id.clone(),
                phase: entry.phase,
                ticket: None,
                revision: entry.revision,
                recovered: false,
            };
            if let Some(existing) = records.get(&entry.operation_id) {
                if existing.phase != hydrated.phase || existing.revision != hydrated.revision {
                    return Err(OperationError::HydrationConflict {
                        operation_id: entry.operation_id,
                    });
                }
                continue;
            }
            records.insert(entry.operation_id, hydrated);
        }
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

    pub(crate) fn mark_unknown(&self, operation_id: &str) {
        if let Some(record) = self
            .records
            .lock()
            .expect("operation journal mutex poisoned")
            .get_mut(operation_id)
        {
            record.phase = OperationPhase::Unknown;
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
            reconciled: Vec::new(),
        };
        for record in records.values_mut() {
            match record.phase {
                OperationPhase::Queued => report.queued.push(record.operation_id.clone()),
                OperationPhase::InFlight => {
                    record.phase = OperationPhase::Unknown;
                    record.recovered = true;
                    report.unknown.push(record.operation_id.clone());
                }
                OperationPhase::Committed | OperationPhase::Failed => {}
                OperationPhase::Unknown => report.unknown.push(record.operation_id.clone()),
            }
        }
        report
    }

    pub(crate) fn mark_reconciled(&self, operation_id: &str, disposition: &RecoveryDisposition) {
        match disposition {
            RecoveryDisposition::Committed { revision } => {
                self.mark_committed(operation_id, *revision)
            }
            RecoveryDisposition::Failed { .. } => self.mark_failed(operation_id),
            RecoveryDisposition::Unknown { .. } => self.mark_unknown(operation_id),
        }
    }
}

fn validate_operation_id(operation_id: &str) -> Result<(), OperationError> {
    if operation_id.trim().is_empty() || operation_id.chars().any(char::is_control) {
        Err(OperationError::InvalidId)
    } else {
        Ok(())
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

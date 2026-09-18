use crate::QueueTicket;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
    updated_at: Instant,
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

/// The result of process-side admission.
///
/// A terminal record is only a transient hint that an operation has already
/// reached the application. It is deliberately admitted again so the
/// application can perform its durable, request-digest-checked replay. The
/// service must reject only active or uncertain work here.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum OperationAdmission {
    New,
    TerminalReplay(OperationRecord),
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
#[derive(Clone, Debug)]
pub struct OperationRecovery {
    records: Arc<Mutex<BTreeMap<String, OperationRecord>>>,
    max_unknown_records: usize,
    max_terminal_records: usize,
    unknown_retention: Duration,
    terminal_retention: Duration,
}

impl Default for OperationRecovery {
    fn default() -> Self {
        Self::with_limits(1024, Duration::from_secs(5 * 60))
    }
}

impl OperationRecovery {
    pub fn new() -> Self {
        Self::default()
    }

    /// Configure the bounded process-side retention for uncertain operations.
    /// Durable operation facts remain owned by the application/store; this
    /// limit only controls the host's transient recovery hints.
    pub fn with_limits(max_unknown_records: usize, unknown_retention: Duration) -> Self {
        Self {
            records: Arc::new(Mutex::new(BTreeMap::new())),
            max_unknown_records: max_unknown_records.max(1),
            max_terminal_records: max_unknown_records.max(1),
            unknown_retention,
            terminal_retention: unknown_retention,
        }
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
        prune_transient(
            &mut records,
            self.max_unknown_records,
            self.max_terminal_records,
            self.unknown_retention,
            self.terminal_retention,
        );
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
                updated_at: Instant::now(),
            },
        );
        Ok(())
    }

    /// Admit a request while keeping active ownership separate from durable
    /// operation identity. Active/unknown records are rejected; terminal
    /// records are reset to an active transient state and dispatched so the
    /// application can return its durable replay or a digest conflict.
    pub(crate) fn admit(
        &self,
        operation_id: impl Into<String>,
    ) -> Result<OperationAdmission, OperationError> {
        let operation_id = operation_id.into();
        validate_operation_id(&operation_id)?;
        let mut records = self
            .records
            .lock()
            .expect("operation journal mutex poisoned");
        prune_transient(
            &mut records,
            self.max_unknown_records,
            self.max_terminal_records,
            self.unknown_retention,
            self.terminal_retention,
        );
        if let Some(record) = records.get_mut(&operation_id) {
            match record.phase {
                OperationPhase::Queued | OperationPhase::InFlight | OperationPhase::Unknown => {
                    return Err(OperationError::Duplicate(record.clone()))
                }
                OperationPhase::Committed | OperationPhase::Failed => {
                    let previous = record.clone();
                    record.phase = OperationPhase::Queued;
                    record.ticket = None;
                    record.revision = None;
                    record.recovered = false;
                    record.updated_at = Instant::now();
                    return Ok(OperationAdmission::TerminalReplay(previous));
                }
            }
        }
        records.insert(
            operation_id.clone(),
            OperationRecord {
                operation_id,
                phase: OperationPhase::Queued,
                ticket: None,
                revision: None,
                recovered: false,
                updated_at: Instant::now(),
            },
        );
        Ok(OperationAdmission::New)
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
                updated_at: Instant::now(),
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
            record.updated_at = Instant::now();
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
            record.updated_at = Instant::now();
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
            record.updated_at = Instant::now();
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
            record.updated_at = Instant::now();
        }
    }

    pub(crate) fn mark_unknown(&self, operation_id: &str) {
        let mut records = self
            .records
            .lock()
            .expect("operation journal mutex poisoned");
        if let Some(record) = records.get_mut(operation_id) {
            record.phase = OperationPhase::Unknown;
            record.updated_at = Instant::now();
        }
        prune_transient(
            &mut records,
            self.max_unknown_records,
            self.max_terminal_records,
            self.unknown_retention,
            self.terminal_retention,
        );
    }

    pub(crate) fn remove(&self, operation_id: &str) {
        self.records
            .lock()
            .expect("operation journal mutex poisoned")
            .remove(operation_id);
    }

    pub fn get(&self, operation_id: &str) -> Option<OperationRecord> {
        let mut records = self
            .records
            .lock()
            .expect("operation journal mutex poisoned");
        prune_transient(
            &mut records,
            self.max_unknown_records,
            self.max_terminal_records,
            self.unknown_retention,
            self.terminal_retention,
        );
        records.get(operation_id).cloned()
    }

    pub fn records(&self) -> Vec<OperationRecord> {
        let mut records = self
            .records
            .lock()
            .expect("operation journal mutex poisoned");
        prune_transient(
            &mut records,
            self.max_unknown_records,
            self.max_terminal_records,
            self.unknown_retention,
            self.terminal_retention,
        );
        records.values().cloned().collect()
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
                    record.updated_at = Instant::now();
                    report.unknown.push(record.operation_id.clone());
                }
                OperationPhase::Committed | OperationPhase::Failed => {}
                OperationPhase::Unknown => report.unknown.push(record.operation_id.clone()),
            }
        }
        prune_transient(
            &mut records,
            self.max_unknown_records,
            self.max_terminal_records,
            self.unknown_retention,
            self.terminal_retention,
        );
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

fn prune_transient(
    records: &mut BTreeMap<String, OperationRecord>,
    max_unknown_records: usize,
    max_terminal_records: usize,
    unknown_retention: Duration,
    terminal_retention: Duration,
) {
    let now = Instant::now();
    records.retain(|_, record| match record.phase {
        OperationPhase::Unknown => {
            now.saturating_duration_since(record.updated_at) <= unknown_retention
        }
        OperationPhase::Committed | OperationPhase::Failed => {
            now.saturating_duration_since(record.updated_at) <= terminal_retention
        }
        OperationPhase::Queued | OperationPhase::InFlight => true,
    });
    let mut unknown = records
        .values()
        .filter(|record| record.phase == OperationPhase::Unknown)
        .map(|record| (record.updated_at, record.operation_id.clone()))
        .collect::<Vec<_>>();
    unknown.sort_by_key(|(updated_at, _)| *updated_at);
    let remove_count = unknown.len().saturating_sub(max_unknown_records);
    for (_, operation_id) in unknown.into_iter().take(remove_count) {
        records.remove(&operation_id);
    }
    let mut terminal = records
        .values()
        .filter(|record| {
            matches!(
                record.phase,
                OperationPhase::Committed | OperationPhase::Failed
            )
        })
        .map(|record| (record.updated_at, record.operation_id.clone()))
        .collect::<Vec<_>>();
    terminal.sort_by_key(|(updated_at, _)| *updated_at);
    let remove_count = terminal.len().saturating_sub(max_terminal_records);
    for (_, operation_id) in terminal.into_iter().take(remove_count) {
        records.remove(&operation_id);
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

    #[test]
    fn terminal_admission_is_replayable_but_active_admission_is_rejected() {
        let journal = OperationRecovery::new();
        assert_eq!(journal.admit("op-replay").unwrap(), OperationAdmission::New);
        assert!(matches!(
            journal.admit("op-replay"),
            Err(OperationError::Duplicate(record))
                if record.phase() == OperationPhase::Queued
        ));

        journal.mark_committed("op-replay", Some(7));
        assert!(matches!(
            journal.admit("op-replay"),
            Ok(OperationAdmission::TerminalReplay(record))
                if record.phase() == OperationPhase::Committed
                    && record.revision() == Some(7)
        ));
        assert_eq!(
            journal.get("op-replay").unwrap().phase(),
            OperationPhase::Queued
        );
    }

    #[test]
    fn uncertain_transient_records_are_bounded_and_expire() {
        let journal = OperationRecovery::with_limits(2, Duration::from_millis(1));
        for index in 0..4 {
            journal.register(format!("op-unknown-{index}")).unwrap();
            journal.mark_unknown(&format!("op-unknown-{index}"));
        }
        assert!(journal.records().len() <= 2);

        std::thread::sleep(Duration::from_millis(3));
        assert!(journal.records().is_empty());
    }

    #[test]
    fn completed_transient_records_are_bounded_when_a_caller_keeps_the_journal() {
        let journal = OperationRecovery::with_limits(2, Duration::from_secs(60));
        for index in 0..4 {
            journal.register(format!("op-completed-{index}")).unwrap();
            journal.mark_committed(&format!("op-completed-{index}"), Some(index));
        }
        assert_eq!(journal.records().len(), 2);
    }
}

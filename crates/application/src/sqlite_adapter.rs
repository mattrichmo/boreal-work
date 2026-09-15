//! SQLite-backed implementation of the application attempt adapter.
//!
//! The adapter is intentionally a translation layer. Runtime policy is
//! checked by [`WorkApplication`] before this code, while the store repeats
//! subject, fence, deadline, and operation checks inside its write transaction.

use boreal_domain::{
    ActorId, AttemptId, Fence, HarnessId, OperationId, ProjectId, SessionId, TimestampMs, WorkId,
};
use boreal_store::{
    AttemptMutationKind as StoreMutationKind, AttemptMutationRequest as StoreMutationRequest,
    AttemptMutationResult as StoreMutationResult, AttemptRecord, SqliteStore,
};

use crate::runtime::{
    AttemptAdapterError, AttemptCommand, AttemptCommandKind, AttemptLifecycleAdapter,
    AttemptMutation, AttemptSnapshot,
};

pub struct SqliteAttemptAdapter<'a> {
    store: &'a SqliteStore,
}

impl<'a> SqliteAttemptAdapter<'a> {
    pub fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }
}

impl AttemptLifecycleAdapter for SqliteAttemptAdapter<'_> {
    fn current_attempt(
        &self,
        project_id: &ProjectId,
        attempt_id: &AttemptId,
    ) -> Result<AttemptSnapshot, AttemptAdapterError> {
        let record = self
            .store
            .current_attempt(project_id.as_str(), attempt_id.as_str())?;
        snapshot(record).map_err(AttemptAdapterError::Rejected)
    }

    fn transact_attempt(
        &self,
        command: AttemptCommand,
    ) -> Result<AttemptMutation, AttemptAdapterError> {
        let result = self.store.apply_attempt_mutation(&StoreMutationRequest {
            project_id: command.project_id.as_str().to_owned(),
            work_id: command.work_id.as_str().to_owned(),
            attempt_id: command.attempt_id.as_str().to_owned(),
            actor_id: command.actor_id.as_str().to_owned(),
            harness_id: command.harness_id.as_ref().map(|id| id.as_str().to_owned()),
            session_id: command.session_id.as_ref().map(|id| id.as_str().to_owned()),
            fence: command.fence.get(),
            operation_id: command.operation_id.as_str().to_owned(),
            request_digest: command.request_digest.clone(),
            at: stamp(command.at.as_millis()),
            expected_project_revision: None,
            expected_work_revision: None,
            expected_attempt_revision: Some(command.fence.get()),
            expected_phase: Some(command.expected_phase),
            expected_lease_deadline: Some(stamp(command.expected_lease_deadline.as_millis())),
            expected_hard_deadline: Some(stamp(command.expected_hard_deadline.as_millis())),
            mutation: store_mutation(&command.kind, command.at, command.liveness.as_ref())
                .map_err(AttemptAdapterError::Rejected)?,
            reason: command.reason,
        })?;
        mutation(result).map_err(AttemptAdapterError::Rejected)
    }

    fn read_attempt_operation(
        &self,
        project_id: &ProjectId,
        operation_id: &OperationId,
    ) -> Result<Option<AttemptMutation>, AttemptAdapterError> {
        let Some(result) = self
            .store
            .read_attempt_operation(project_id.as_str(), operation_id.as_str())?
        else {
            return Ok(None);
        };
        let mut result = mutation(result).map_err(AttemptAdapterError::Rejected)?;
        result.changed = false;
        result.replayed = true;
        Ok(Some(result))
    }
}

fn snapshot(record: AttemptRecord) -> Result<AttemptSnapshot, String> {
    Ok(AttemptSnapshot {
        project_id: ProjectId::new(record.project_id),
        work_id: WorkId::new(record.work_id),
        attempt_id: AttemptId::new(record.attempt_id),
        actor_id: ActorId::new(record.actor_id),
        harness_id: record.harness_id.map(HarnessId::new),
        session_id: record.session_id.map(SessionId::new),
        fence: Fence::new(record.fence),
        phase: record.phase,
        claimed_at: parse_stamp(&record.claimed_at)?,
        accepted_at: record.accepted_at.as_deref().map(parse_stamp).transpose()?,
        lease_deadline: parse_stamp(&record.lease_deadline)?,
        hard_deadline: parse_stamp(&record.hard_deadline)?,
        current: record.current,
    })
}

fn mutation(result: StoreMutationResult) -> Result<AttemptMutation, String> {
    Ok(AttemptMutation {
        operation_id: OperationId::new(result.operation_id),
        request_digest: result.request_digest,
        attempt_id: AttemptId::new(result.attempt_id),
        fence: Fence::new(result.fence),
        phase: result.phase,
        lease_deadline: parse_stamp(&result.lease_deadline)?,
        hard_deadline: parse_stamp(&result.hard_deadline)?,
        revision: result.revision,
        changed: result.changed,
        replayed: result.replayed,
    })
}

fn store_mutation(
    kind: &AttemptCommandKind,
    at: TimestampMs,
    liveness: Option<&crate::runtime::LivenessMetadata>,
) -> Result<StoreMutationKind, String> {
    match kind {
        AttemptCommandKind::Accept => Ok(StoreMutationKind::Accept),
        AttemptCommandKind::Start => Ok(StoreMutationKind::Start),
        AttemptCommandKind::Heartbeat => Ok(StoreMutationKind::Heartbeat {
            phase: liveness
                .and_then(|metadata| metadata.phase)
                .map(|phase| format!("{phase:?}")),
            tool: liveness.and_then(|metadata| metadata.tool.clone()),
            process: liveness.and_then(|metadata| metadata.process.clone()),
        }),
        AttemptCommandKind::RenewLease { lease_ttl_ms } => Ok(StoreMutationKind::RenewLease {
            lease_deadline: stamp(
                at.checked_add(*lease_ttl_ms)
                    .map_err(|_| "renewed lease timestamp overflow".to_owned())?
                    .as_millis(),
            ),
        }),
        AttemptCommandKind::Submit => Ok(StoreMutationKind::Submit),
        AttemptCommandKind::Release => Ok(StoreMutationKind::Release),
        AttemptCommandKind::Fail => Ok(StoreMutationKind::Fail),
        AttemptCommandKind::Expire { confirmation } => Ok(StoreMutationKind::Expire {
            stop_confirmed: matches!(
                confirmation,
                crate::runtime::StopConfirmation::AdapterAcknowledged
                    | crate::runtime::StopConfirmation::ReviewedSafeRecovery
            ),
        }),
        AttemptCommandKind::Cancel { confirmation } => Ok(StoreMutationKind::Cancel {
            stop_confirmed: confirmation.is_some(),
        }),
    }
}

fn parse_stamp(value: &str) -> Result<TimestampMs, String> {
    value
        .strip_prefix("unix-ms:")
        .ok_or_else(|| format!("unsupported timestamp format: {value}"))?
        .parse::<u64>()
        .map(TimestampMs)
        .map_err(|_| format!("invalid timestamp: {value}"))
}

fn stamp(value: u64) -> String {
    format!("unix-ms:{value}")
}

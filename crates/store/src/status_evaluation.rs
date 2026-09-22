//! Canonical snapshot decoding shared by status reads and claim authorization.
//! All status policy remains in boreal_domain::evaluate_status. No SQL WHERE
//! clause, adapter, or persisted display field decides eligibility here.
use super::*;
use boreal_domain::work_model_v3::WorkSchedule;
use boreal_domain::{
    evaluate_status, ActorContext, ActorId, ActorRole, Attempt, DeadlineSource, Fence, Revision,
    StatusContext, StatusDecision, TimestampMs,
};
use std::convert::TryFrom;

type PlanningFactsResult = Result<(Option<WorkSchedule>, Option<TimestampMs>), StoreError>;
type ProjectPlanningFacts = BTreeMap<String, PlanningFactsResult>;

pub(crate) fn canonical_status_timestamp(value: &str) -> Result<TimestampMs, StoreError> {
    let digits = value
        .strip_prefix("unix-ms:")
        .filter(|digits| !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()));
    digits
        .and_then(|digits| digits.parse::<u64>().ok())
        .map(TimestampMs)
        .ok_or_else(|| StoreError::Corrupt(format!("invalid canonical timestamp: {value}")))
}

impl StatusWorkRecord {
    pub fn status_retry_not_before(&self) -> Result<Option<TimestampMs>, StoreError> {
        self.retry_not_before
            .as_deref()
            .map(canonical_status_timestamp)
            .transpose()
    }

    /// Decode canonical attempt clocks once, identically for readers/writers.
    /// Historical tN/RFC3339 strings are not silently compared lexicographically.
    pub fn status_attempt(&self) -> Result<Option<Attempt>, StoreError> {
        self.current_attempt
            .as_ref()
            .map(|attempt| {
                Ok(Attempt {
                    work_id: attempt.work_id.clone().into(),
                    attempt_id: attempt.attempt_id.clone().into(),
                    actor_id: attempt.actor_id.clone().into(),
                    harness_id: attempt.harness_id.clone().map(Into::into),
                    session_id: attempt.session_id.clone().map(Into::into),
                    fence: Fence::new(attempt.fence),
                    phase: attempt.phase,
                    claimed_at: canonical_status_timestamp(&attempt.claimed_at)?,
                    accepted_at: attempt
                        .accepted_at
                        .as_deref()
                        .map(canonical_status_timestamp)
                        .transpose()?,
                    lease_deadline: canonical_status_timestamp(&attempt.lease_deadline)?,
                    max_attempt_deadline: canonical_status_timestamp(&attempt.hard_deadline)?,
                    deadline_source: DeadlineSource::Explicit,
                    last_heartbeat_at: attempt
                        .last_heartbeat_at
                        .as_deref()
                        .map(canonical_status_timestamp)
                        .transpose()?,
                    last_checkpoint_at: attempt
                        .last_checkpoint_at
                        .as_deref()
                        .map(canonical_status_timestamp)
                        .transpose()?,
                    review_required_after_expiry: attempt.review_required_after_expiry,
                })
            })
            .transpose()
    }
}

impl SqliteStore {
    /// Loads the planning facts that are shared by every row in a project
    /// status snapshot.  The value is a per-work result so a malformed
    /// activation timestamp is quarantined with its work row instead of
    /// aborting healthy siblings.  An empty map means the optional v3 planning
    /// tables are not installed, which preserves the legacy no-facts result.
    pub(crate) fn status_planning_facts_for_project(
        &self,
        project_id: &str,
    ) -> Result<ProjectPlanningFacts, StoreError> {
        if !self.table_exists("cycle_assignment_v3")? || !self.table_exists("cycle_v3")? {
            return Ok(BTreeMap::new());
        }

        let mut statement = self.prepare(
            "SELECT ca.work_id,
                    MIN(CASE ca.activation_policy
                          WHEN 'explicit_not_before' THEN ca.activation_at_utc_ms
                          WHEN 'at_cycle_start' THEN cycle.scheduled_start_utc_ms
                          ELSE NULL
                        END)
             FROM cycle_assignment_v3 ca
             JOIN cycle_v3 cycle
               ON cycle.project_id = ca.project_id
              AND cycle.cycle_id = ca.cycle_id
             WHERE ca.project_id = ?1
               AND ca.state IN ('planned', 'committed')
             GROUP BY ca.work_id
             ORDER BY ca.work_id",
        )?;
        statement.bind_text(1, project_id)?;

        let mut facts = BTreeMap::new();
        while statement.step()? == SQLITE_ROW {
            let work_id = statement.column_text(0)?;
            let activation = match statement.column_optional_signed_i64(1)? {
                Some(value) => u64::try_from(value)
                    .map(TimestampMs)
                    .map(Some)
                    .map_err(|_| {
                        StoreError::Corrupt(format!(
                            "negative planning activation timestamp for work {work_id}: {value}"
                        ))
                    }),
                None => Ok(None),
            };
            facts.insert(
                work_id,
                activation.map(|activation_at| (None, activation_at)),
            );
        }
        Ok(facts)
    }

    /// Reads only canonical v3 planning facts that can affect availability.
    /// Work-level schedule fields are not yet persisted in the store's v2
    /// projection, so they remain absent rather than being inferred from a
    /// retry timestamp. Live assignments contribute their earliest explicit
    /// activation or cycle-start instant.
    #[allow(dead_code)]
    pub(crate) fn status_planning_facts(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<(Option<WorkSchedule>, Option<TimestampMs>), StoreError> {
        if !self.table_exists("cycle_assignment_v3")? || !self.table_exists("cycle_v3")? {
            return Ok((None, None));
        }
        let mut statement = self.prepare(
            "SELECT MIN(CASE ca.activation_policy
                              WHEN 'explicit_not_before' THEN ca.activation_at_utc_ms
                              WHEN 'at_cycle_start' THEN cycle.scheduled_start_utc_ms
                              ELSE NULL
                         END)
             FROM cycle_assignment_v3 ca
             JOIN cycle_v3 cycle
               ON cycle.project_id = ca.project_id
              AND cycle.cycle_id = ca.cycle_id
             WHERE ca.project_id = ?1
               AND ca.work_id = ?2
               AND ca.state IN ('planned', 'committed')",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        if statement.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "planning activation query returned no aggregate row".to_owned(),
            ));
        }
        let activation_at = statement
            .column_optional_signed_i64(0)?
            .map(|value| {
                u64::try_from(value).map(TimestampMs).map_err(|_| {
                    StoreError::Corrupt(format!("negative planning activation timestamp: {value}"))
                })
            })
            .transpose()?;
        Ok((None, activation_at))
    }

    /// Role comes from durable authority, never from a caller-supplied role flag.
    pub fn actor_context(&self, actor_id: &str) -> Result<ActorContext, StoreError> {
        let mut row = self.prepare("SELECT role FROM actor WHERE actor_id = ?1")?;
        row.bind_text(1, actor_id)?;
        if row.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "actor",
                id: actor_id.to_owned(),
            });
        }
        let role = match row.column_text(0)?.as_str() {
            "agent" => ActorRole::Agent,
            "reviewer" => ActorRole::Reviewer,
            "operator" => ActorRole::Operator,
            "publisher" => ActorRole::Publisher,
            role => return Err(StoreError::Corrupt(format!("invalid actor role: {role}"))),
        };
        Ok(ActorContext {
            actor_id: ActorId::new(actor_id),
            role,
        })
    }

    /// Freeze work, graph, attempt, gate and actor policy in the same read.
    pub fn read_project_status_for_actor(
        &self,
        project_id: &str,
        actor_id: &str,
    ) -> Result<(ProjectStatusRead, ActorContext), StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let actor = self.actor_context(actor_id)?;
            let snapshot = self.read_project_status_in_transaction(project_id)?;
            Ok((snapshot, actor))
        })();
        finish_transaction(self, result)
    }

    /// Caller must hold the write transaction. This does not open a nested
    /// transaction or use a previously displayed (possibly stale) decision.
    pub(crate) fn status_decision_in_transaction(
        &self,
        project_id: &str,
        work_id: &str,
        actor_id: &str,
        as_of: TimestampMs,
    ) -> Result<StatusDecision, StoreError> {
        let actor = self.actor_context(actor_id)?;
        let snapshot = self.read_project_status_in_transaction(project_id)?;
        let row = snapshot
            .works
            .iter()
            .find(|row| row.work.id.as_str() == work_id)
            .ok_or_else(|| {
                StoreError::Conflict(format!(
                    "not_claimable: work {work_id} is absent, foreign, or corrupt"
                ))
            })?;
        let prerequisites = snapshot
            .dependencies
            .iter()
            .filter(|edge| edge.dependent_id == row.work.id)
            .filter_map(|edge| {
                snapshot
                    .works
                    .iter()
                    .find(|item| item.work.id == edge.prerequisite_id)
            })
            .map(|item| item.work.clone())
            .collect::<Vec<_>>();
        let dependents = snapshot
            .dependencies
            .iter()
            .filter(|edge| edge.prerequisite_id == row.work.id)
            .map(|edge| edge.dependent_id.clone())
            .collect::<Vec<_>>();
        let attempt = row.status_attempt()?;
        Ok(evaluate_status(StatusContext {
            work: &row.work,
            prerequisites: &prerequisites,
            current_attempt: attempt.as_ref(),
            gates: &row.work.acceptance_profile.gates,
            actor: &actor,
            as_of,
            project_revision: Revision(snapshot.revision.0),
            retry_not_before: row.status_retry_not_before()?,
            schedule: row.schedule,
            activation_at: row.activation_at,
            affected_dependents: &dependents,
        }))
    }
}

/// Quarantine corrupt canonical inputs without removing healthy siblings.
/// Broken endpoints are hard reasons on their dependent, never a dropped edge
/// that accidentally makes the dependent ready. This function never persists
/// a repair, a replacement record, or a display status.
pub(crate) fn diagnose_status_integrity(snapshot: &mut ProjectStatusRead) {
    let mut valid = Vec::with_capacity(snapshot.works.len());
    for mut row in std::mem::take(&mut snapshot.works) {
        let clocks = row
            .status_retry_not_before()
            .and_then(|_| row.status_attempt());
        match clocks {
            Err(error) => snapshot.diagnostics.push(StatusRecordDiagnostic {
                work_id: row.work.id.to_string(),
                title: Some(row.work.title.clone()),
                code: "invalid_status_clock".to_owned(),
                detail: error.to_string(),
            }),
            Ok(_) => {
                if row.current_attempt.as_ref().is_some_and(|attempt| {
                    matches!(
                        attempt.phase,
                        AttemptPhase::Failed | AttemptPhase::Released | AttemptPhase::Cancelled
                    )
                }) {
                    row.work
                        .hard_holds
                        .push(ReasonCode::HardHold("invalid_current_attempt".to_owned()));
                    snapshot.diagnostics.push(StatusRecordDiagnostic {
                        work_id: row.work.id.to_string(),
                        title: Some(row.work.title.clone()),
                        code: "invalid_current_attempt".to_owned(),
                        detail: "terminal historical attempt is still marked current; use an explicit repair".to_owned(),
                    });
                }
                valid.push(row);
            }
        }
    }
    let items = valid
        .iter()
        .map(|row| (row.work.id.clone(), row.work.clone()))
        .collect::<BTreeMap<_, _>>();
    for row in &mut valid {
        let parent = row.work.parent_id.as_ref().and_then(|id| items.get(id));
        let missing_parent = row.work.parent_id.is_some() && parent.is_none();
        if missing_parent || boreal_domain::validate_parent(&row.work, parent).is_err() {
            row.work
                .hard_holds
                .push(ReasonCode::HardHold("invalid_parent".to_owned()));
            snapshot.diagnostics.push(StatusRecordDiagnostic {
                work_id: row.work.id.to_string(),
                title: Some(row.work.title.clone()),
                code: "invalid_parent".to_owned(),
                detail: "parent is absent, foreign, corrupt, or has an incompatible kind"
                    .to_owned(),
            });
        }
        for edge in snapshot
            .dependencies
            .iter()
            .filter(|edge| edge.dependent_id == row.work.id)
        {
            if !items.contains_key(&edge.prerequisite_id) {
                row.work.hard_holds.push(ReasonCode::HardHold(format!(
                    "orphaned_dependency({})",
                    edge.prerequisite_id
                )));
                snapshot.diagnostics.push(StatusRecordDiagnostic {
                    work_id: row.work.id.to_string(),
                    title: Some(row.work.title.clone()),
                    code: "orphaned_dependency".to_owned(),
                    detail: format!(
                        "prerequisite {} is absent, foreign, or corrupt",
                        edge.prerequisite_id
                    ),
                });
            }
        }
    }
    snapshot.works = valid;
}

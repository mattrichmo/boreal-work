//! Store-owned decoding of the domain decision envelope. Every query runs in
//! the caller's read/write transaction; neither clients nor SQL derive status.
use super::*;
use boreal_domain::decision_inputs as facts;
use boreal_domain::{ActorContext, Revision, TimestampMs};

impl SqliteStore {
    pub(crate) fn canonical_decision_inputs(
        &self,
        project_id: &str,
        revision: Revision,
        row: &StatusWorkRecord,
        actor: &ActorContext,
        session_id: Option<&str>,
        as_of: TimestampMs,
    ) -> Result<facts::DecisionInputs, StoreError> {
        let work_id = row.work.id.as_str();
        let mut cursor = self.prepare(
            "SELECT entity_revision, proof_revision FROM boreal_entity_revision
             WHERE project_id = ?1 AND work_id = ?2",
        )?;
        cursor.bind_text(1, project_id)?;
        cursor.bind_text(2, work_id)?;
        if cursor.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "missing canonical revision cursor".to_owned(),
            ));
        }
        let entity_revision = cursor.column_u64(0)?;
        let proof_revision = cursor.column_u64(1)?;
        let subject = facts::EntityIdentity::new(
            project_id.into(),
            work_id.into(),
            facts::EntityRevision::new(entity_revision),
        );
        let fact_subject = facts::FactSubject::work(project_id.into(), work_id.into());
        let scope = facts::IntegrityScope::work(project_id.into(), work_id.into());
        let pin =
            profiles::ProfileStore::new(self).current_pinned_requirements(project_id, work_id)?;
        if pin.proof_revision != proof_revision {
            return Err(StoreError::Corrupt(
                "pinned requirement and proof cursor disagree".to_owned(),
            ));
        }
        let profile = facts::ProfileIdentity::new(
            pin.profile.profile_id.clone().into(),
            pin.profile.version.to_string(),
            pin.profile.policy_digest.clone().into(),
        );
        let mut proof = facts::ProofIdentity::planning(
            subject.clone(),
            facts::ProofRevision::new(proof_revision),
            profile,
            "boreal.acceptance/1",
        );
        let mut execution =
            facts::Fact::optional_absent(facts::FactKind::Execution, fact_subject.clone());
        if let Some(attempt) = row.status_attempt()? {
            let stored = row
                .current_attempt
                .as_ref()
                .ok_or_else(|| StoreError::Corrupt("attempt binding missing".into()))?;
            let identity = facts::AttemptIdentity::new(
                attempt.attempt_id.clone(),
                facts::AttemptFence::new(attempt.fence.get()),
            );
            proof.attempt = Some(identity.clone());
            proof.source_snapshot = stored.source_version_id.clone().map(Into::into);
            proof.configuration = Some(stored.config_identity.clone().into());
            // Expired executions are historical. Their independent recovery
            // obligation remains below and is not made a live lease again.
            if !attempt.phase.is_terminal() {
                execution = facts::Fact::present(facts::ExecutionInput {
                    attempt: identity,
                    actor_id: attempt.actor_id,
                    session_id: attempt.session_id,
                    phase: attempt.phase,
                    claimed_at: attempt.claimed_at,
                    lease_deadline: attempt.lease_deadline,
                    hard_deadline: attempt.max_attempt_deadline,
                    proof: proof.clone(),
                });
            }
        }
        let mut submission =
            facts::Fact::optional_absent(facts::FactKind::Submission, fact_subject.clone());
        let mut review =
            facts::Fact::optional_absent(facts::FactKind::Review, fact_subject.clone());
        if let Some(sealed) = self.current_submission(project_id, work_id, proof_revision)? {
            let sealed_proof = sealed.proof_identity();
            if row.current_attempt.is_none() {
                proof = sealed_proof.clone();
            }
            let mut owner = self.prepare("SELECT a.actor_id,a.session_id FROM attempt a JOIN work_item w ON w.work_id=a.work_id WHERE w.project_id=?1 AND a.work_id=?2 AND a.attempt_id=?3 AND a.fence=?4")?;
            owner.bind_text(1, project_id)?;
            owner.bind_text(2, work_id)?;
            owner.bind_text(3, &sealed.attempt_id)?;
            owner.bind_i64(4, sealed.fence)?;
            if owner.step()? != SQLITE_ROW {
                return Err(StoreError::Corrupt(
                    "sealed submission owner is missing".into(),
                ));
            }
            let owner_actor = owner.column_text(0)?;
            let owner_root = self.recorded_principal_root(project_id, &owner_actor)?;
            submission = facts::Fact::present(facts::SubmissionInput {
                actor_id: owner_actor.into(),
                session_id: owner.column_text(1)?.into(),
                authority_root: owner_root.into(),
                id: sealed.submission_id.clone().into(),
                proof: sealed_proof.clone(),
                summary_digest: sealed.summary_digest.clone().into(),
                state: facts::SubmissionState::Sealed,
            });
            let mut event = self.prepare(
                "SELECT r.review_event_id, r.reviewer_actor_id, a.actor_id, r.outcome
                 FROM boreal_review_event r JOIN boreal_submission s ON s.submission_id = r.submission_id
                 JOIN attempt a ON a.attempt_id = s.attempt_id AND a.work_id = s.work_id AND a.fence = s.fence
                 WHERE r.project_id = ?1 AND r.work_id = ?2 AND r.submission_id = ?3
                 ORDER BY r.rowid DESC LIMIT 1",
            )?;
            event.bind_text(1, project_id)?;
            event.bind_text(2, work_id)?;
            event.bind_text(3, &sealed.submission_id)?;
            if event.step()? == SQLITE_ROW {
                let outcome = match event.column_text(3)?.as_str() {
                    "approved" => facts::ReviewOutcome::Approved,
                    "rejected" => facts::ReviewOutcome::Rejected,
                    "returned" => facts::ReviewOutcome::Returned,
                    "revoked" => facts::ReviewOutcome::Revoked,
                    other => {
                        return Err(StoreError::Corrupt(format!(
                            "invalid review outcome: {other}"
                        )))
                    }
                };
                review = facts::Fact::present(facts::ReviewInput {
                    reviewer_authority_root: self
                        .recorded_principal_root(project_id, &event.column_text(1)?)?
                        .into(),
                    attempt_authority_root: self
                        .recorded_principal_root(project_id, &event.column_text(2)?)?
                        .into(),
                    id: event.column_text(0)?.into(),
                    submission_id: sealed.submission_id.into(),
                    proof: sealed_proof,
                    reviewer_id: event.column_text(1)?.into(),
                    attempt_actor_id: event.column_text(2)?.into(),
                    outcome,
                });
            }
        }
        let mut requirements = Vec::new();
        for declaration in &pin.declarations {
            let observed = row
                .gate_diagnostics
                .gates
                .iter()
                .find(|gate| {
                    gate.gate_id == declaration.gate_id
                        || gate.gate_id == format!("{work_id}:{}", declaration.gate_id)
                })
                .ok_or_else(|| {
                    StoreError::Corrupt(format!(
                        "requirement observation missing: {}",
                        declaration.gate_id
                    ))
                })?;
            requirements.push(facts::PinnedRequirement {
                exception: self.current_gate_exception(
                    project_id,
                    work_id,
                    &observed.gate_id,
                    proof_revision,
                )?,
                id: declaration.requirement_id.clone().into(),
                gate_id: observed.gate_id.clone().into(),
                kind: parse_gate_kind(&declaration.kind)?,
                required: declaration.required,
                state: observed.state,
                verifier_policy: facts::VerifierPolicy {
                    id: declaration.verifier_policy.clone().into(),
                    version: pin.profile.version.to_string(),
                },
            });
        }
        let review_policy = if requirements
            .iter()
            .any(|gate| gate.required && gate.kind == GateKind::Review)
        {
            facts::ReviewRequirementPolicy::Independent
        } else {
            facts::ReviewRequirementPolicy::NotRequired
        };
        let mut dependencies = Vec::new();
        let mut edges = self.prepare(
            "SELECT d.prerequisite_id, p.lifecycle, e.entity_revision
             FROM dependency d LEFT JOIN work_item p ON p.project_id = d.project_id AND p.work_id = d.prerequisite_id
             LEFT JOIN boreal_entity_revision e ON e.project_id = p.project_id AND e.work_id = p.work_id
             WHERE d.project_id = ?1 AND d.dependent_id = ?2 ORDER BY d.prerequisite_id",
        )?;
        edges.bind_text(1, project_id)?;
        edges.bind_text(2, work_id)?;
        while edges.step()? == SQLITE_ROW {
            let predecessor = edges.column_text(0)?;
            let predecessor_revision = edges.column_u64(2)?;
            let outcome = match edges.column_text(1)?.as_str() {
                "closed" if self.has_accepted_outcome(project_id, &predecessor)? => {
                    facts::DependencyOutcome::Closed
                }
                "closed" => facts::DependencyOutcome::Complete,
                "cancelled" => facts::DependencyOutcome::Cancelled,
                "open" | "draft" => facts::DependencyOutcome::Open,
                other => {
                    return Err(StoreError::Corrupt(format!(
                        "invalid predecessor lifecycle: {other}"
                    )))
                }
            };
            let edge_id = format!("{predecessor}->{work_id}");
            let waiver = self
                .active_dependency_waiver(
                    project_id,
                    work_id,
                    &predecessor,
                    proof_revision,
                    entity_revision,
                    predecessor_revision,
                    as_of,
                )?
                .map(|id| facts::DependencyWaiver {
                    decision_id: id.into(),
                    edge_revision: subject.revision,
                });
            dependencies.push(facts::DependencyOutcomeInput {
                id: edge_id.into(),
                predecessor: facts::EntityIdentity::new(
                    project_id.into(),
                    predecessor.into(),
                    facts::EntityRevision::new(predecessor_revision),
                ),
                successor: subject.clone(),
                policy: DependencyPolicy::ClosedOnly,
                outcome,
                outcome_revision: facts::EntityRevision::new(predecessor_revision),
                waiver,
            });
        }
        let holds = row
            .work
            .hard_holds
            .iter()
            .enumerate()
            .map(|(index, reason)| facts::HoldInput {
                id: format!("{work_id}:hold:{index}").into(),
                scope: scope.clone(),
                code: reason.stable_code().into(),
                entity_revision: subject.revision,
                active: true,
            })
            .collect();
        let mut recovery =
            facts::Fact::optional_absent(facts::FactKind::Recovery, fact_subject.clone());
        let mut obligation = self.prepare(
            "SELECT obligation_id, attempt_id, fence, reason, resource_state, owner_actor_id
             FROM boreal_recovery_obligation WHERE project_id = ?1 AND work_id = ?2 AND state = 'unresolved'
             ORDER BY CASE reason WHEN 'expired' THEN 0 ELSE 1 END, obligation_id LIMIT 1",
        )?;
        obligation.bind_text(1, project_id)?;
        obligation.bind_text(2, work_id)?;
        if obligation.step()? == SQLITE_ROW {
            let reason = match obligation.column_text(3)?.as_str() {
                "expired" => facts::RecoveryReason::Expired,
                "stop_unknown" => facts::RecoveryReason::StopUnknown,
                "resource_unknown" => facts::RecoveryReason::ResourceUnknown,
                "failed" => facts::RecoveryReason::Failed,
                "cancel_requested" => facts::RecoveryReason::CancelRequested,
                other => {
                    return Err(StoreError::Corrupt(format!(
                        "unknown recovery reason: {other}"
                    )))
                }
            };
            recovery = facts::Fact::present(facts::RecoveryInput {
                id: obligation.column_text(0)?.into(),
                attempt: facts::AttemptIdentity::new(
                    obligation.column_text(1)?.into(),
                    facts::AttemptFence::new(obligation.column_u64(2)?),
                ),
                reason,
                resource: match obligation.column_text(4)?.as_str() {
                    "released" => facts::ResourceDisposition::ConfirmedStopped,
                    "active" | "release_pending" | "unknown" => facts::ResourceDisposition::Unknown,
                    other => {
                        return Err(StoreError::Corrupt(format!(
                            "unknown recovery resource: {other}"
                        )))
                    }
                },
                unresolved: true,
                owner_id: obligation.column_optional_text(5)?.map(Into::into),
            });
        }
        let mut terminal = self
            .prepare("SELECT updated_at FROM work_item WHERE project_id = ?1 AND work_id = ?2")?;
        terminal.bind_text(1, project_id)?;
        terminal.bind_text(2, work_id)?;
        if terminal.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "work disappeared within status snapshot".into(),
            ));
        }
        let terminal_decision = match row.work.lifecycle {
            PersistedLifecycle::Closed => Some(facts::TerminalDecision::Closed {
                decided_at: status_evaluation::canonical_status_timestamp(
                    &terminal.column_text(0)?,
                )?,
            }),
            PersistedLifecycle::Cancelled => Some(facts::TerminalDecision::Cancelled {
                decided_at: status_evaluation::canonical_status_timestamp(
                    &terminal.column_text(0)?,
                )?,
            }),
            _ => None,
        };
        let integrity_level = match row.action_facts.integrity {
            StatusIntegrity::Valid => facts::IntegrityLevel::Valid,
            StatusIntegrity::Degraded => facts::IntegrityLevel::Degraded,
            StatusIntegrity::Quarantined => facts::IntegrityLevel::Quarantined,
        };
        // These are the installed command capabilities, not authorizations.
        // The domain applies role, ownership, status, revision and hold policy.
        use facts::PermittedAction::*;
        // Production snapshots must be rooted in an active, project-scoped
        // principal. The schema-v2 adapter remains a compatibility surface
        // for historical fixtures and has no principal table; there the
        // resolved actor identity is the authority root. Never apply this
        // fallback to a canonical production database.
        let authority_root = if self.is_canonical_production() {
            self.principal_authority(project_id, actor.actor_id.as_str())?
                .1
        } else {
            actor.actor_id.as_str().to_owned()
        };
        Ok(facts::DecisionInputs {
            subject: subject.clone(),
            snapshot_revision: revision,
            clock: facts::EvaluationClock::at(as_of).with_status_timing(facts::StatusTimingInput {
                schedule: row.schedule,
                cycle_activation_at: row.activation_at,
                retry_not_before: row.status_retry_not_before()?,
            }),
            availability: facts::Availability::Live,
            dispatch_policy: row.work.dispatch_policy,
            lifecycle: facts::Fact::present(facts::LifecycleInput {
                identity: subject,
                lifecycle: row.work.lifecycle,
                terminal_decision,
            }),
            authority: facts::Fact::present(facts::ActorAuthorityInput {
                authority_root: authority_root.into(),
                project_id: project_id.into(),
                role: actor.role,
                principal: facts::PrincipalBinding::Authenticated {
                    actor_id: actor.actor_id.clone(),
                },
                session_id: session_id.map(Into::into),
            }),
            requirements: facts::Fact::present(facts::PinnedRequirementsInput {
                proof,
                requirements,
                review_policy,
            }),
            dependencies: facts::Fact::present(facts::DependencyOutcomesInput {
                edges: dependencies,
            }),
            holds: facts::Fact::present(facts::HoldsInput { holds }),
            execution,
            submission,
            review,
            recovery,
            integrity: facts::IntegrityInput {
                scope: scope.clone(),
                level: integrity_level,
                diagnostics: if integrity_level == facts::IntegrityLevel::Valid {
                    Vec::new()
                } else {
                    vec![facts::IntegrityDiagnostic {
                        scope,
                        code: facts::IntegrityDiagnosticCode::Corrupt,
                    }]
                },
            },
            permitted_actions: facts::PermittedActionsInput::allowing([
                Inspect,
                Claim,
                AcceptAttempt,
                ResumeAttempt,
                AttachEvidence,
                Submit,
                Review,
                Finish,
                Release,
                Recover,
                ResolveHold,
                Repair,
            ]),
        })
    }
}

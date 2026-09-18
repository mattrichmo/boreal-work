//! Application façade for v3 hierarchy planning and schema capability.
//!
//! The mutation methods keep lifecycle and graph policy in this application
//! boundary.  Row-level adapters are used where the store exposes a v3 seam;
//! planning-only APIs remain explicit for edits and graph operations whose
//! transactional store methods are not available yet.

use boreal_domain::work_model_v3::{
    ActivationPolicy, CycleAssignment, CycleAssignmentState, CycleInstance, CycleLifecycle,
    CycleSeries, CycleSeriesLifecycle, CycleTemplate, DispositionKind, FoldPolicy, GapPolicy,
    IntakeBucket, IntakeItem, IntakeKind, IntakeLifecycle, IntakePromotion, PromotionTargetKind,
};
use boreal_domain::{ProjectId, SessionId};
use boreal_store::{
    AttemptRecord, ContainerDispositionV3Input, CycleAssignmentV3Input, CycleSeriesV3Input,
    CycleTemplateV3Input, CycleV3Input, IntakeBucketV3Input, IntakeItemV3Input, IntakeItemV3Record,
    IntakePromotionV3Input, MutationResult, SessionRecord, SessionState, V3MutationContext,
    WorkNodeV3Input,
};
use std::collections::{BTreeMap, BTreeSet};

use crate::planning_v3::{
    plan_cycle_activation, plan_cycle_create, plan_cycle_slot, plan_dependency_change,
    plan_work_edit, plan_work_policy,
};
use crate::{canonical_request_digest, ApplicationError, OperationResult, WorkApplication};

pub use crate::planning_v3::{
    CycleActivationRequest, CycleCreateRequest, CycleSlotRequest, DependencyChange,
    HierarchySnapshot, PlannedOperation, PlanningError, PlanningScope, SystemTimeZoneDatabase,
    WorkEditRequest, WorkPolicyPatch,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyGraphView {
    pub project_id: ProjectId,
    pub revision: u64,
    pub edges: Vec<DependencyEdgeView>,
    pub cycles: Vec<Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyEdgeView {
    pub prerequisite_id: String,
    pub dependent_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleBoardView {
    pub project_id: ProjectId,
    pub revision: u64,
    pub cycle: boreal_store::CycleV3Record,
    pub assignments: Vec<CycleBoardAssignment>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleBoardAssignment {
    pub assignment: boreal_store::CycleAssignmentV3Record,
    pub work_title: Option<String>,
    pub work_kind: Option<String>,
    pub work_lifecycle: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeItemsView {
    pub project_id: ProjectId,
    pub revision: u64,
    pub items: Vec<IntakeItemV3Record>,
}

impl WorkApplication<'_> {
    /// Return the canonical dependency graph and deterministic cycle
    /// diagnostics from one store snapshot. This read model is shared by
    /// CLI, service, and dashboard adapters.
    pub fn dependency_graph(
        &self,
        project_id: &ProjectId,
    ) -> Result<DependencyGraphView, ApplicationError> {
        let snapshot = self.store_ref().read_project_status(project_id.as_str())?;
        let mut edges = snapshot
            .dependencies
            .into_iter()
            .map(|edge| DependencyEdgeView {
                prerequisite_id: edge.prerequisite_id.to_string(),
                dependent_id: edge.dependent_id.to_string(),
            })
            .collect::<Vec<_>>();
        edges.sort_by(|left, right| {
            left.prerequisite_id
                .cmp(&right.prerequisite_id)
                .then_with(|| left.dependent_id.cmp(&right.dependent_id))
        });
        let cycles = find_dependency_cycles(&edges);
        Ok(DependencyGraphView {
            project_id: project_id.clone(),
            revision: snapshot.revision.0,
            edges,
            cycles,
        })
    }

    /// Build a cycle board from persisted v3 assignments and the canonical
    /// v2 work/status snapshot. The board is read-only; lifecycle mutations
    /// remain application/store operations.
    pub fn cycle_board_v3(
        &self,
        project_id: &ProjectId,
        cycle_id: &str,
    ) -> Result<CycleBoardView, ApplicationError> {
        if !self.store_ref().work_model_v3_enabled()? {
            return Err(ApplicationError::Invalid(
                "cycle board requires work-model/3 to be enabled".to_owned(),
            ));
        }
        let cycle = self
            .store_ref()
            .cycle_v3(project_id.as_str(), cycle_id)?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "cycle_v3",
                id: cycle_id.to_owned(),
            })?;
        let status = self.store_ref().read_project_status(project_id.as_str())?;
        let work = status
            .works
            .into_iter()
            .map(|row| (row.work.id.to_string(), row.work))
            .collect::<BTreeMap<_, _>>();
        let assignments = self
            .store_ref()
            .cycle_assignments_v3(project_id.as_str(), cycle_id)?
            .into_iter()
            .map(|assignment| {
                let item = work.get(&assignment.work_id);
                CycleBoardAssignment {
                    work_title: item.map(|value| value.title.clone()),
                    work_kind: item.map(|value| format!("{:?}", value.kind).to_ascii_lowercase()),
                    work_lifecycle: item
                        .map(|value| format!("{:?}", value.lifecycle).to_ascii_lowercase()),
                    assignment,
                }
            })
            .collect();
        Ok(CycleBoardView {
            project_id: project_id.clone(),
            revision: self.store_ref().project_revision(project_id.as_str())?.0,
            cycle,
            assignments,
        })
    }

    pub fn intake_items_v3(
        &self,
        project_id: &ProjectId,
    ) -> Result<IntakeItemsView, ApplicationError> {
        if !self.store_ref().work_model_v3_enabled()? {
            return Err(ApplicationError::Invalid(
                "intake requires work-model/3 to be enabled".to_owned(),
            ));
        }
        Ok(IntakeItemsView {
            project_id: project_id.clone(),
            revision: self.store_ref().project_revision(project_id.as_str())?.0,
            items: self.store_ref().intake_items_v3(project_id.as_str())?,
        })
    }

    /// Install and verify the additive v3 schema through the store-owned
    /// migration boundary.  Existing schema-2 tables remain untouched.
    pub fn ensure_work_model_v3(&self) -> Result<bool, ApplicationError> {
        if self.store_ref().work_model_v3_enabled()? {
            return Ok(false);
        }
        self.store_ref()
            .apply_work_model_v3(include_str!("../../../project/spec/schema-v3.sql"))?;
        Ok(true)
    }

    pub fn work_model_v3_enabled(&self) -> Result<bool, ApplicationError> {
        Ok(self.store_ref().work_model_v3_enabled()?)
    }

    pub fn create_work_node_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        node: &boreal_domain::work_model_v3::WorkNode,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if node.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: node.project_id.to_string(),
            }));
        }
        validate_nonempty("work_id", node.id.as_str())?;
        validate_nonempty("work title", &node.title)?;
        let operation_id = operation_id.into();
        let input = WorkNodeV3Input {
            project_id: node.project_id.to_string(),
            work_id: node.id.to_string(),
            decomposition_kind: match node.kind {
                boreal_domain::work_model_v3::DecompositionKind::Milestone => "milestone",
                boreal_domain::work_model_v3::DecompositionKind::Task => "task",
            }
            .to_owned(),
            execution_mode: match node.execution_mode {
                boreal_domain::work_model_v3::ExecutionMode::Direct => "direct",
                boreal_domain::work_model_v3::ExecutionMode::Container => "container",
            }
            .to_owned(),
            parent_id: node.parent_id.as_ref().map(ToString::to_string),
            created_at: now.to_owned(),
            updated_at: now.to_owned(),
        };
        let mutation = self.store_ref().create_work_node_v3(
            &v3_context(
                scope,
                &operation_id,
                "work.node.create/v3",
                node.id.as_str(),
                now,
            ),
            &input,
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_cycle_series_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        series: &CycleSeries,
        timezone: &str,
        tzdb_identity: &str,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if series.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: series.project_id.to_string(),
            }));
        }
        validate_nonempty("cycle series id", series.id.as_str())?;
        validate_nonempty("cycle series name", &series.name)?;
        validate_nonempty("cycle timezone", timezone)?;
        validate_nonempty("tzdb identity", tzdb_identity)?;
        let operation_id = operation_id.into();
        let mutation = self.store_ref().create_cycle_series_v3(
            &v3_context(
                scope,
                &operation_id,
                "cycle.series.create/v3",
                series.id.as_str(),
                now,
            ),
            &CycleSeriesV3Input {
                project_id: series.project_id.to_string(),
                series_id: series.id.to_string(),
                name: series.name.clone(),
                lifecycle: series_lifecycle(series.lifecycle),
                timezone: timezone.to_owned(),
                tzdb_identity: tzdb_identity.to_owned(),
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_cycle_template_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        template: &CycleTemplate,
        now: &str,
        tzdb_identity: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        template
            .validate()
            .map_err(PlanningError::from)
            .map_err(ApplicationError::from)?;
        if tzdb_identity.trim().is_empty() {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "cycle template requires a real tzdb identity".to_owned(),
            )));
        }
        let series_row = self
            .store_ref()
            .cycle_series_v3(scope.project_id.as_str(), template.series_id.as_str())?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "cycle_series_v3",
                id: template.series_id.to_string(),
            })?;
        if series_row.timezone != template.timezone {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "cycle template timezone must match its series".to_owned(),
            )));
        }
        if series_row.tzdb_identity != tzdb_identity {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "cycle template tzdb identity must match its series".to_owned(),
            )));
        }
        let operation_id = operation_id.into();
        let recurrence = &template.recurrence;
        let mutation = self.store_ref().create_cycle_template_v3(
            &v3_context(
                scope,
                &operation_id,
                "cycle.template.create/v3",
                template.id.as_str(),
                now,
            ),
            &CycleTemplateV3Input {
                project_id: scope.project_id.to_string(),
                template_version_id: template.id.to_string(),
                series_id: template.series_id.to_string(),
                version: u64::from(template.version),
                effective_from_slot_ordinal: template.effective_from_slot_ordinal,
                interval_weeks: u64::from(recurrence.interval_weeks),
                anchor_local_date: format_local_date(recurrence.anchor_local_start.date),
                anchor_local_time: format_local_time(recurrence.anchor_local_start.time),
                anchor_weekday: recurrence
                    .anchor_local_start
                    .weekday()
                    .map_err(PlanningError::from)
                    .map_err(ApplicationError::from)?,
                recurrence_end_kind: recurrence_end_kind(recurrence.end),
                recurrence_end_count: recurrence_end_count(recurrence.end),
                recurrence_end_local_date: recurrence_end_date(recurrence.end),
                name_pattern: template.name_pattern.clone(),
                goal_template: template.goal_template.clone(),
                timezone: template.timezone.clone(),
                tzdb_identity: tzdb_identity.to_owned(),
                gap_policy: gap_policy(recurrence.gap_policy),
                fold_policy: fold_policy(recurrence.fold_policy),
                weekdays: recurrence.weekdays.iter().copied().collect(),
                created_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_cycle_instance_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        cycle: &CycleInstance,
        goal: &str,
        lifecycle: CycleLifecycle,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        cycle
            .validate()
            .map_err(PlanningError::from)
            .map_err(ApplicationError::from)?;
        if cycle.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: cycle.project_id.to_string(),
            }));
        }
        validate_nonempty("cycle id", cycle.id.as_str())?;
        validate_nonempty("cycle name", &cycle.name)?;
        let operation_id = operation_id.into();
        let start = &cycle.scheduled_start;
        let mutation = self.store_ref().create_cycle_v3(
            &v3_context(
                scope,
                &operation_id,
                "cycle.create/v3",
                cycle.id.as_str(),
                now,
            ),
            &CycleV3Input {
                project_id: cycle.project_id.to_string(),
                cycle_id: cycle.id.to_string(),
                series_id: cycle.series_id.to_string(),
                template_version_id: cycle.template_version_id.to_string(),
                slot_ordinal: cycle.slot_ordinal,
                name: cycle.name.clone(),
                goal: goal.to_owned(),
                lifecycle: cycle_lifecycle(lifecycle),
                scheduled_start_utc_ms: i64::try_from(start.utc_instant.as_millis()).map_err(
                    |_| {
                        ApplicationError::Invalid("cycle timestamp exceeds SQLite range".to_owned())
                    },
                )?,
                scheduled_end_utc_ms: cycle
                    .scheduled_end
                    .as_ref()
                    .map(|end| i64::try_from(end.utc_instant.as_millis()))
                    .transpose()
                    .map_err(|_| {
                        ApplicationError::Invalid("cycle timestamp exceeds SQLite range".to_owned())
                    })?,
                scheduled_start_local: format_local_datetime(start.nominal_local),
                scheduled_start_utc_offset_minutes: i64::from(start.utc_offset_minutes),
                timezone: start.timezone.clone(),
                tzdb_identity: start.tzdb_identity.clone(),
                gap_policy: gap_policy(start.gap_policy),
                fold_policy: fold_policy(start.fold_policy),
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn assign_cycle_work_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        assignment: &CycleAssignment,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if assignment.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: assignment.project_id.to_string(),
            }));
        }
        let cycle = self
            .store_ref()
            .cycle_v3(scope.project_id.as_str(), assignment.cycle_id.as_str())?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "cycle_v3",
                id: assignment.cycle_id.to_string(),
            })?;
        let work = self
            .store_ref()
            .work_node_v3(scope.project_id.as_str(), assignment.work_id.as_str())?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "work_node_v3",
                id: assignment.work_id.to_string(),
            })?;
        if cycle.project_id.as_str() != assignment.project_id.as_str()
            || work.project_id.as_str() != assignment.project_id.as_str()
        {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: assignment.project_id.to_string(),
            }));
        }
        let operation_id = operation_id.into();
        let mutation = self.store_ref().assign_cycle_work_v3(
            &v3_context(
                scope,
                &operation_id,
                "cycle.assignment.create/v3",
                &assignment.id,
                now,
            ),
            &CycleAssignmentV3Input {
                project_id: assignment.project_id.to_string(),
                assignment_id: assignment.id.clone(),
                cycle_id: assignment.cycle_id.to_string(),
                work_id: assignment.work_id.to_string(),
                state: assignment_state(assignment.state),
                activation_policy: activation_policy(assignment.activation_policy),
                activation_at_utc_ms: assignment
                    .activation_at
                    .map(|at| i64::try_from(at.as_millis()))
                    .transpose()
                    .map_err(|_| {
                        ApplicationError::Invalid(
                            "activation timestamp exceeds SQLite range".to_owned(),
                        )
                    })?,
                predecessor_id: assignment.predecessor_id.clone(),
                successor_id: assignment.successor_id.clone(),
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_intake_bucket_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        bucket: &IntakeBucket,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if bucket.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: bucket.project_id.to_string(),
            }));
        }
        validate_nonempty("intake bucket id", bucket.id.as_str())?;
        validate_nonempty("intake bucket name", &bucket.name)?;
        let operation_id = operation_id.into();
        let mutation = self.store_ref().create_intake_bucket_v3(
            &v3_context(
                scope,
                &operation_id,
                "intake.bucket.create/v3",
                bucket.id.as_str(),
                now,
            ),
            &IntakeBucketV3Input {
                project_id: bucket.project_id.to_string(),
                bucket_id: bucket.id.to_string(),
                name: bucket.name.clone(),
                archived: bucket.archived,
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_intake_item_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        item: &IntakeItem,
        captured_at: &str,
        updated_at: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if item.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: item.project_id.to_string(),
            }));
        }
        validate_nonempty("intake id", item.id.as_str())?;
        if item.content.trim().is_empty() {
            return Err(ApplicationError::Invalid(
                "intake content is required".to_owned(),
            ));
        }
        if item.content_revision == 0 {
            return Err(ApplicationError::Invalid(
                "intake content_revision must be positive".to_owned(),
            ));
        }
        let expected_digest = crate::sha256_content_digest(item.content.as_bytes());
        if item.content_digest != expected_digest {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "intake content_digest does not match content".to_owned(),
            )));
        }
        let operation_id = operation_id.into();
        let mutation = self.store_ref().create_intake_item_v3(
            &v3_context(
                scope,
                &operation_id,
                "intake.item.create/v3",
                item.id.as_str(),
                updated_at,
            ),
            &IntakeItemV3Input {
                project_id: item.project_id.to_string(),
                intake_id: item.id.to_string(),
                bucket_id: item.bucket_id.to_string(),
                kind: intake_kind(item.kind),
                lifecycle: intake_lifecycle(item.lifecycle),
                content: item.content.clone(),
                content_revision: item.content_revision,
                content_digest: item.content_digest.clone(),
                captured_at: captured_at.to_owned(),
                updated_at: updated_at.to_owned(),
                revisit_at_utc_ms: item
                    .revisit_at
                    .map(|at| i64::try_from(at.as_millis()))
                    .transpose()
                    .map_err(|_| {
                        ApplicationError::Invalid(
                            "revisit timestamp exceeds SQLite range".to_owned(),
                        )
                    })?,
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn promote_intake_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        promotion: &IntakePromotion,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if promotion.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: promotion.project_id.to_string(),
            }));
        }
        validate_nonempty("promotion id", promotion.id.as_str())?;
        validate_nonempty("promotion target id", &promotion.target_id)?;
        // The store trigger checks the intake revision/digest in the same
        // transaction as the insert. Avoid a mutable pre-read here: a retry
        // must reach the store's replay-first path even if the intake changed
        // after the original promotion committed.
        let operation_id = operation_id.into();
        let mutation = self.store_ref().promote_intake_v3(
            &v3_context(
                scope,
                &operation_id,
                "intake.promote/v3",
                promotion.intake_id.as_str(),
                now,
            ),
            &IntakePromotionV3Input {
                project_id: promotion.project_id.to_string(),
                promotion_id: promotion.id.to_string(),
                intake_id: promotion.intake_id.to_string(),
                intake_revision: promotion.intake_revision,
                intake_digest: promotion.intake_digest.clone(),
                target_kind: promotion_target_kind(promotion.target_kind),
                target_id: promotion.target_id.clone(),
                actor_id: scope.actor_id.clone(),
                operation_id: operation_id.clone(),
                created_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn append_container_disposition_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        disposition: &boreal_domain::work_model_v3::ContainerDisposition,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if disposition.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: disposition.project_id.to_string(),
            }));
        }
        validate_disposition_shape(disposition)?;
        let operation_id = operation_id.into();
        let mutation = self.store_ref().append_container_disposition_v3(
            &v3_context(
                scope,
                &operation_id,
                "container.disposition.append/v3",
                disposition.container_id.as_str(),
                now,
            ),
            &ContainerDispositionV3Input {
                project_id: disposition.project_id.to_string(),
                disposition_id: disposition.id.to_string(),
                container_work_id: disposition.container_id.to_string(),
                descendant_work_id: disposition.descendant_id.to_string(),
                kind: disposition_kind(disposition.kind),
                descendant_revision: disposition.descendant_revision,
                descendant_outcome_digest: disposition.descendant_outcome_digest.clone(),
                replacement_work_id: disposition.replacement_id.as_ref().map(ToString::to_string),
                reason: disposition.reason.clone(),
                supersedes_id: disposition.supersedes_id.as_ref().map(ToString::to_string),
                created_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn plan_work_edit(
        &self,
        snapshot: &HierarchySnapshot,
        request: &WorkEditRequest,
    ) -> Result<PlannedOperation<boreal_domain::work_model_v3::WorkNode>, ApplicationError> {
        plan_work_edit(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_dependency_change(
        &self,
        snapshot: &HierarchySnapshot,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        change: DependencyChange,
    ) -> Result<
        PlannedOperation<Vec<boreal_domain::work_model_v3::DirectDependency>>,
        ApplicationError,
    > {
        plan_dependency_change(snapshot, scope, operation_id, change)
            .map_err(ApplicationError::from)
    }

    pub fn plan_work_policy(
        &self,
        scope: &PlanningScope,
        actual_revision: u64,
        operation_id: impl Into<String>,
        current: &boreal_domain::WorkItem,
        patch: &WorkPolicyPatch,
    ) -> Result<PlannedOperation<boreal_domain::WorkItem>, ApplicationError> {
        plan_work_policy(scope, actual_revision, operation_id, current, patch)
            .map_err(ApplicationError::from)
    }

    pub fn plan_cycle_create(
        &self,
        snapshot: &HierarchySnapshot,
        request: &CycleCreateRequest,
    ) -> Result<PlannedOperation<boreal_domain::work_model_v3::Cycle>, ApplicationError> {
        plan_cycle_create(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_cycle_activation(
        &self,
        snapshot: &HierarchySnapshot,
        request: &CycleActivationRequest,
    ) -> Result<PlannedOperation<boreal_domain::work_model_v3::Cycle>, ApplicationError> {
        plan_cycle_activation(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_cycle_slot(
        &self,
        request: &CycleSlotRequest,
        tzdb: &SystemTimeZoneDatabase,
    ) -> Result<PlannedOperation<boreal_domain::work_model_v3::CycleInstance>, ApplicationError>
    {
        plan_cycle_slot(request, tzdb).map_err(ApplicationError::from)
    }

    /// Prepare a session-end operation without silently releasing live work.
    /// The current store has no session-end transaction yet; the returned plan
    /// tells the service whether a fenced attempt release is required first.
    pub fn prepare_session_end(
        &self,
        request: &SessionEndRequest,
    ) -> Result<SessionEndPlan, ApplicationError> {
        if request.project_id.as_str().trim().is_empty()
            || request.actor_id.trim().is_empty()
            || request.session_id.as_str().trim().is_empty()
        {
            return Err(ApplicationError::Invalid(
                "session end scope is incomplete".to_owned(),
            ));
        }
        let session = self
            .store_ref()
            .session(request.project_id.as_str(), request.session_id.as_str())?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "session",
                id: request.session_id.to_string(),
            })?;
        if session.actor_id != request.actor_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: session.actor_id,
                actual: request.actor_id.clone(),
            }));
        }
        let current_attempt = self.store_ref().current_attempt_for_session(
            request.project_id.as_str(),
            request.session_id.as_str(),
        )?;
        if current_attempt.is_some() && !request.confirm_release {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "session has live work; confirm fenced release before ending".to_owned(),
            )));
        }
        let requires_release = current_attempt.is_some();
        Ok(SessionEndPlan {
            session,
            current_attempt,
            requires_release,
            operation_id: request.operation_id.clone(),
        })
    }

    /// Read-only restart assessment for operator recovery.  It intentionally
    /// does not mark unknown work safe or force-break a lock.
    pub fn assess_operator_recovery(
        &self,
        project_id: &ProjectId,
    ) -> Result<OperatorRecoveryAssessment, ApplicationError> {
        let incomplete = self
            .store_ref()
            .list_incomplete_evidence_executions()?
            .into_iter()
            .filter(|execution| execution.project_id == project_id.as_str())
            .collect();
        Ok(OperatorRecoveryAssessment {
            project_id: project_id.clone(),
            incomplete_evidence_executions: incomplete,
            requires_explicit_reconciliation: true,
        })
    }
}

fn find_dependency_cycles(edges: &[DependencyEdgeView]) -> Vec<Vec<String>> {
    let mut adjacency = BTreeMap::<String, Vec<String>>::new();
    let mut nodes = BTreeSet::new();
    for edge in edges {
        nodes.insert(edge.prerequisite_id.clone());
        nodes.insert(edge.dependent_id.clone());
        adjacency
            .entry(edge.prerequisite_id.clone())
            .or_default()
            .push(edge.dependent_id.clone());
    }
    for children in adjacency.values_mut() {
        children.sort();
        children.dedup();
    }
    let mut state = BTreeMap::<String, u8>::new();
    let mut stack = Vec::<String>::new();
    let mut found = BTreeSet::<Vec<String>>::new();
    for node in nodes {
        find_dependency_cycles_from(&node, &adjacency, &mut state, &mut stack, &mut found);
    }
    found.into_iter().collect()
}

fn find_dependency_cycles_from(
    node: &str,
    adjacency: &BTreeMap<String, Vec<String>>,
    state: &mut BTreeMap<String, u8>,
    stack: &mut Vec<String>,
    found: &mut BTreeSet<Vec<String>>,
) {
    if state.get(node).copied() == Some(2) {
        return;
    }
    if state.get(node).copied() == Some(1) {
        if let Some(index) = stack.iter().position(|value| value == node) {
            let body = &stack[index..];
            if let Some((offset, _)) = body.iter().enumerate().min_by_key(|(_, value)| *value) {
                let mut canonical = body[offset..].to_vec();
                canonical.extend_from_slice(&body[..offset]);
                canonical.push(canonical[0].clone());
                found.insert(canonical);
            }
        }
        return;
    }
    state.insert(node.to_owned(), 1);
    stack.push(node.to_owned());
    if let Some(children) = adjacency.get(node) {
        for child in children {
            find_dependency_cycles_from(child, adjacency, state, stack, found);
        }
    }
    stack.pop();
    state.insert(node.to_owned(), 2);
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionEndRequest {
    pub project_id: ProjectId,
    pub actor_id: String,
    pub session_id: SessionId,
    pub operation_id: String,
    pub confirm_release: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionEndPlan {
    pub session: SessionRecord,
    pub current_attempt: Option<AttemptRecord>,
    pub requires_release: bool,
    pub operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperatorRecoveryAssessment {
    pub project_id: ProjectId,
    pub incomplete_evidence_executions: Vec<boreal_store::EvidenceExecutionRecord>,
    pub requires_explicit_reconciliation: bool,
}

fn ensure_mutation_scope(
    store: &boreal_store::SqliteStore,
    scope: &PlanningScope,
) -> Result<(), ApplicationError> {
    scope.validate().map_err(ApplicationError::from)?;
    if let Some(session_id) = scope.session_id.as_deref() {
        let session = store
            .session(scope.project_id.as_str(), session_id)?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "session",
                id: session_id.to_owned(),
            })?;
        if session.actor_id != scope.actor_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: session.actor_id,
                actual: scope.actor_id.clone(),
            }));
        }
        if session.state != SessionState::Active {
            return Err(ApplicationError::Invalid(format!(
                "session {session_id} is not active"
            )));
        }
    }
    // The v3 store mutation owns the replay-first, transactional expected
    // revision check.  Do not perform a read-before-write revision check here:
    // a retry must be able to replay after the project revision has advanced.
    if scope.expected_revision.is_none() {
        return Err(ApplicationError::Planning(PlanningError::Invalid(
            "v3 mutations require expected_revision".to_owned(),
        )));
    }
    Ok(())
}

fn v3_context(
    scope: &PlanningScope,
    operation_id: &str,
    command: &str,
    subject_id: &str,
    now: &str,
) -> V3MutationContext {
    V3MutationContext {
        project_id: scope.project_id.to_string(),
        actor_id: scope.actor_id.clone(),
        operation_id: operation_id.to_owned(),
        request_digest: canonical_request_digest(
            command,
            serde_json::json!({
                "project_id": scope.project_id.as_str(),
                "actor_id": scope.actor_id,
                "session_id": scope.session_id,
                "subject_id": subject_id,
                "expected_revision": scope.expected_revision,
            }),
        ),
        expected_revision: scope.expected_revision,
        now: now.to_owned(),
    }
}

fn validate_nonempty(field: &'static str, value: &str) -> Result<(), ApplicationError> {
    if value.trim().is_empty() {
        return Err(ApplicationError::Invalid(format!("{field} is required")));
    }
    Ok(())
}

fn validate_disposition_shape(
    disposition: &boreal_domain::work_model_v3::ContainerDisposition,
) -> Result<(), ApplicationError> {
    use boreal_domain::work_model_v3::DispositionKind;

    if disposition.container_id == disposition.descendant_id {
        return Err(ApplicationError::Invalid(
            "container disposition cannot target its container".to_owned(),
        ));
    }
    validate_nonempty(
        "descendant outcome digest",
        &disposition.descendant_outcome_digest,
    )?;
    match disposition.kind {
        DispositionKind::AcceptedClosed | DispositionKind::AcceptedCancelled
            if disposition.replacement_id.is_some() =>
        {
            Err(ApplicationError::Invalid(
                "accepted disposition cannot name a replacement".to_owned(),
            ))
        }
        DispositionKind::Deferred
            if disposition
                .reason
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty() =>
        {
            Err(ApplicationError::Invalid(
                "deferred disposition requires a reason".to_owned(),
            ))
        }
        DispositionKind::Deferred if disposition.replacement_id.is_some() => Err(
            ApplicationError::Invalid("deferred disposition cannot name a replacement".to_owned()),
        ),
        DispositionKind::Replaced
            if disposition.replacement_id.is_none()
                || disposition
                    .reason
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty() =>
        {
            Err(ApplicationError::Invalid(
                "replacement disposition requires replacement and reason".to_owned(),
            ))
        }
        _ => Ok(()),
    }
}

fn operation_result(operation_id: String, mutation: MutationResult) -> OperationResult<()> {
    OperationResult {
        operation_id,
        snapshot_revision: mutation.revision,
        changed: !mutation.replayed,
        value: (),
    }
}

fn series_lifecycle(value: CycleSeriesLifecycle) -> String {
    match value {
        CycleSeriesLifecycle::Active => "active",
        CycleSeriesLifecycle::Paused => "paused",
        CycleSeriesLifecycle::Retired => "retired",
    }
    .to_owned()
}

fn cycle_lifecycle(value: CycleLifecycle) -> String {
    match value {
        CycleLifecycle::Planned => "planned",
        CycleLifecycle::Active => "active",
        CycleLifecycle::Completed => "completed",
        CycleLifecycle::Cancelled => "cancelled",
    }
    .to_owned()
}

fn assignment_state(value: CycleAssignmentState) -> String {
    match value {
        CycleAssignmentState::Planned => "planned",
        CycleAssignmentState::Committed => "committed",
        CycleAssignmentState::Removed => "removed",
        CycleAssignmentState::Completed => "completed",
        CycleAssignmentState::CarriedOver => "carried_over",
    }
    .to_owned()
}

fn activation_policy(value: ActivationPolicy) -> String {
    match value {
        ActivationPolicy::AtCycleStart => "at_cycle_start",
        ActivationPolicy::Immediate => "immediate",
        ActivationPolicy::ExplicitNotBefore => "explicit_not_before",
    }
    .to_owned()
}

fn gap_policy(value: GapPolicy) -> String {
    match value {
        GapPolicy::NextValid => "next_valid",
    }
    .to_owned()
}

fn fold_policy(value: FoldPolicy) -> String {
    match value {
        FoldPolicy::EarlierOffset => "earlier_offset",
        FoldPolicy::LaterOffset => "later_offset",
    }
    .to_owned()
}

fn recurrence_end_kind(value: boreal_domain::work_model_v3::RecurrenceEnd) -> String {
    match value {
        boreal_domain::work_model_v3::RecurrenceEnd::Never => "never",
        boreal_domain::work_model_v3::RecurrenceEnd::Count(_) => "count",
        boreal_domain::work_model_v3::RecurrenceEnd::UntilLocalDate(_) => "until_local_date",
    }
    .to_owned()
}

fn recurrence_end_count(value: boreal_domain::work_model_v3::RecurrenceEnd) -> Option<u64> {
    match value {
        boreal_domain::work_model_v3::RecurrenceEnd::Count(count) => Some(count),
        _ => None,
    }
}

fn recurrence_end_date(value: boreal_domain::work_model_v3::RecurrenceEnd) -> Option<String> {
    match value {
        boreal_domain::work_model_v3::RecurrenceEnd::UntilLocalDate(date) => {
            Some(format_local_date(date))
        }
        _ => None,
    }
}

fn format_local_date(date: boreal_domain::work_model_v3::LocalDate) -> String {
    format!("{:04}-{:02}-{:02}", date.year, date.month, date.day)
}

fn format_local_time(time: boreal_domain::work_model_v3::LocalTime) -> String {
    format!("{:02}:{:02}:{:02}", time.hour, time.minute, time.second)
}

fn format_local_datetime(value: boreal_domain::work_model_v3::LocalDateTime) -> String {
    format!(
        "{}T{}",
        format_local_date(value.date),
        format_local_time(value.time)
    )
}

fn intake_kind(value: IntakeKind) -> String {
    match value {
        IntakeKind::Note => "note",
        IntakeKind::Discovery => "discovery",
        IntakeKind::Question => "question",
        IntakeKind::Revisit => "revisit",
    }
    .to_owned()
}

fn intake_lifecycle(value: IntakeLifecycle) -> String {
    match value {
        IntakeLifecycle::Captured => "captured",
        IntakeLifecycle::Triaged => "triaged",
        IntakeLifecycle::Deferred => "deferred",
        IntakeLifecycle::Resolved => "resolved",
        IntakeLifecycle::Archived => "archived",
    }
    .to_owned()
}

fn promotion_target_kind(value: PromotionTargetKind) -> String {
    match value {
        PromotionTargetKind::DraftWork => "draft_work",
        PromotionTargetKind::SourceVersion => "source_version",
        PromotionTargetKind::MemoryDraft => "memory_draft",
    }
    .to_owned()
}

fn disposition_kind(value: DispositionKind) -> String {
    match value {
        DispositionKind::AcceptedClosed => "accepted_closed",
        DispositionKind::AcceptedCancelled => "accepted_cancelled",
        DispositionKind::Deferred => "deferred",
        DispositionKind::Replaced => "replaced",
    }
    .to_owned()
}

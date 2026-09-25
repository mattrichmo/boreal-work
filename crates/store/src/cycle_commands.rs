//! Cycle and commitment transactions. Work acceptance is never inferred from
//! historical lifecycle labels, assignment labels, or a calendar boundary.
use super::*;
use boreal_domain::work_model_v3::{Cycle, CycleId, CycleLifecycle};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct OneOffCycleInput {
    pub cycle: CycleV3Input,
    pub anchor_date: String,
    pub anchor_time: String,
    pub anchor_weekday: u8,
}

#[derive(Clone, Debug)]
pub struct CycleChangeRequest {
    pub cycle_id: String,
    pub change: String,
    pub assignment_id: Option<String>,
    pub work_id: Option<String>,
    pub successor_cycle_id: Option<String>,
    pub successor_assignment_id: Option<String>,
    pub reason: String,
    pub confirmed: bool,
}

/// One transactional planning/status view used by the application rollup.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleBoardSnapshotV3 {
    pub cycle: CycleV3Record,
    pub assignments: Vec<CycleAssignmentV3Record>,
    pub assignment_diagnostics: Vec<StatusRecordDiagnostic>,
    pub status: ProjectStatusRead,
    pub accepted_outcomes: BTreeMap<String, super::acceptance::AcceptedOutcomeRecord>,
    pub assignment_reasons: BTreeMap<String, String>,
    pub work_nodes: Vec<WorkNodeV3Record>,
    pub actor: boreal_domain::ActorContext,
}

/// Transaction-bound facts used to evaluate a container's complete descendant
/// scope. The status rows, accepted outcomes, dispositions, node graph, and
/// project revision all come from one SQLite read transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContainerRollupSnapshotV3 {
    pub container: WorkNodeV3Record,
    pub status: ProjectStatusRead,
    pub work_nodes: Vec<WorkNodeV3Record>,
    pub accepted_outcomes: BTreeMap<String, super::acceptance::AcceptedOutcomeRecord>,
    pub dispositions: BTreeMap<String, ContainerDispositionV3Input>,
    pub actor: boreal_domain::ActorContext,
}

impl SqliteStore {
    pub fn container_rollup_snapshot_v3(
        &self,
        project: &str,
        container_id: &str,
        actor_id: &str,
        session_id: Option<&str>,
        as_of: boreal_domain::TimestampMs,
    ) -> Result<ContainerRollupSnapshotV3, StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let work_nodes = self.work_nodes_v3(project)?;
            let container = work_nodes
                .iter()
                .find(|node| node.work_id == container_id)
                .cloned()
                .ok_or_else(|| StoreError::NotFound {
                    entity: "work container",
                    id: container_id.to_owned(),
                })?;
            if container.execution_mode != "container" {
                return Err(StoreError::Invalid(
                    "container rollup requires a non-claimable container work item".into(),
                ));
            }
            let mut status = self.read_project_status_in_transaction(project)?;
            let actor = self.project_actor_context(project, actor_id)?;
            self.populate_status_action_facts_for_session(
                &mut status,
                actor_id,
                session_id,
                as_of,
            )?;
            let mut descendants = BTreeSet::new();
            let mut frontier = BTreeSet::from([container_id.to_owned()]);
            while !frontier.is_empty() {
                let parents = frontier;
                frontier = BTreeSet::new();
                for node in &work_nodes {
                    if node.parent_id.as_ref().is_some_and(|parent| parents.contains(parent))
                        && descendants.insert(node.work_id.clone())
                    {
                        frontier.insert(node.work_id.clone());
                    }
                }
                for row in &status.works {
                    if row
                        .work
                        .parent_id
                        .as_ref()
                        .is_some_and(|parent| parents.contains(parent.as_str()))
                        && descendants.insert(row.work.id.to_string())
                    {
                        frontier.insert(row.work.id.to_string());
                    }
                }
            }
            let mut accepted_outcomes = BTreeMap::new();
            let mut dispositions = BTreeMap::new();
            for work_id in descendants {
                if let Some(outcome) = self.current_accepted_outcome(project, &work_id)? {
                    accepted_outcomes.insert(work_id.clone(), outcome);
                }
                if let Some(disposition) =
                    self.current_container_disposition_v3(project, container_id, &work_id)?
                {
                    dispositions.insert(work_id, disposition);
                }
            }
            Ok(ContainerRollupSnapshotV3 {
                container,
                status,
                work_nodes,
                accepted_outcomes,
                dispositions,
                actor,
            })
        })();
        finish_transaction(self, result)
    }

    pub fn create_oneoff_cycle(
        &self,
        context: &V3MutationContext,
        input: &OneOffCycleInput,
        reason: &str,
    ) -> Result<MutationResult, StoreError> {
        let c = &input.cycle;
        if c.project_id != context.project_id
            || c.lifecycle != "planned"
            || c.slot_ordinal != 0
            || c.name.trim().is_empty()
            || reason.trim().is_empty()
        {
            return Err(StoreError::Invalid(
                "a new cycle requires its project, name, reason and planned slot zero".into(),
            ));
        }
        let bound = context.with_payload(json!({"cycle": {
            "id":c.cycle_id,"name":c.name,"goal":c.goal,"start":c.scheduled_start_utc_ms,
            "end":c.scheduled_end_utc_ms,"local":c.scheduled_start_local,"offset":c.scheduled_start_utc_offset_minutes,
            "timezone":c.timezone,"tzdb":c.tzdb_identity,"fold":c.fold_policy,
            "series_id":c.series_id,"template_id":c.template_version_id,
            "anchor_date":input.anchor_date,"anchor_time":input.anchor_time,"weekday":input.anchor_weekday},"reason":reason}));
        self.v3_mutation(&bound,"cycle.create","cycle",&c.cycle_id,|| {
            let mut series = self.prepare("INSERT INTO cycle_series_v3
                (series_id,project_id,name,lifecycle,timezone,tzdb_identity,created_at,updated_at)
                VALUES(?1,?2,?3,'active',?4,?5,?6,?6)")?;
            series.bind_text(1,&c.series_id)?; series.bind_text(2,&c.project_id)?; series.bind_text(3,&c.name)?;
            series.bind_text(4,&c.timezone)?; series.bind_text(5,&c.tzdb_identity)?; series.bind_text(6,&context.now)?; series.run()?;
            let mut template = self.prepare("INSERT INTO cycle_template_v3
                (template_version_id,project_id,series_id,version,effective_from_slot_ordinal,interval_weeks,
                 anchor_local_date,anchor_local_time,anchor_weekday,recurrence_end_kind,recurrence_end_count,
                 name_pattern,goal_template,timezone,tzdb_identity,gap_policy,fold_policy,created_at)
                 VALUES(?1,?2,?3,1,0,1,?4,?5,?6,'count',1,?7,?8,?9,?10,'next_valid',?11,?12)")?;
            template.bind_text(1,&c.template_version_id)?; template.bind_text(2,&c.project_id)?;
            template.bind_text(3,&c.series_id)?; template.bind_text(4,&input.anchor_date)?;
            template.bind_text(5,&input.anchor_time)?; template.bind_i64(6,u64::from(input.anchor_weekday))?;
            template.bind_text(7,&c.name)?; template.bind_text(8,&c.goal)?; template.bind_text(9,&c.timezone)?;
            template.bind_text(10,&c.tzdb_identity)?; template.bind_text(11,&c.fold_policy)?;
            template.bind_text(12,&context.now)?; template.run()?;
            let mut day = self.prepare("INSERT INTO cycle_template_weekday_v3(project_id,template_version_id,weekday) VALUES(?1,?2,?3)")?;
            day.bind_text(1,&c.project_id)?; day.bind_text(2,&c.template_version_id)?;
            day.bind_i64(3,u64::from(input.anchor_weekday))?; day.run()?;
            let mut row = self.prepare("INSERT INTO cycle_v3
                (cycle_id,project_id,series_id,template_version_id,slot_ordinal,slot_key,name,goal,lifecycle,
                 scheduled_start_utc_ms,scheduled_end_utc_ms,scheduled_start_local,scheduled_start_utc_offset_minutes,
                 timezone,tzdb_identity,gap_policy,fold_policy,created_at,updated_at)
                VALUES(?1,?2,?3,?4,0,?5,?6,?7,'planned',?8,?9,?10,?11,?12,?13,'next_valid',?14,?15,?15)")?;
            row.bind_text(1,&c.cycle_id)?; row.bind_text(2,&c.project_id)?; row.bind_text(3,&c.series_id)?;
            row.bind_text(4,&c.template_version_id)?; row.bind_text(5,&format!("boreal.cycle-slot/1/{}/0",c.series_id))?;
            row.bind_text(6,&c.name)?; row.bind_text(7,&c.goal)?; row.bind_signed_i64(8,c.scheduled_start_utc_ms)?;
            match c.scheduled_end_utc_ms { Some(v)=>row.bind_signed_i64(9,v)?, None=>row.bind_null(9)? }
            row.bind_text(10,&c.scheduled_start_local)?; row.bind_signed_i64(11,c.scheduled_start_utc_offset_minutes)?;
            row.bind_text(12,&c.timezone)?; row.bind_text(13,&c.tzdb_identity)?; row.bind_text(14,&c.fold_policy)?;
            row.bind_text(15,&context.now)?; row.run()?;
            self.append_cycle_event(context,&c.cycle_id,"created",None,"planned",reason,json!({"timezone":c.timezone,"tzdb_identity":c.tzdb_identity}))
        })
    }

    pub fn change_cycle(
        &self,
        context: &V3MutationContext,
        request: &CycleChangeRequest,
    ) -> Result<MutationResult, StoreError> {
        if request.reason.trim().is_empty() || !request.confirmed {
            return Err(StoreError::Invalid(
                "cycle changes require a reason and explicit confirmation".into(),
            ));
        }
        let bound=context.with_payload(json!({"cycle_id":request.cycle_id,"change":request.change,
            "assignment_id":request.assignment_id,"work_id":request.work_id,"successor_cycle_id":request.successor_cycle_id,
            "successor_assignment_id":request.successor_assignment_id,"reason":request.reason,"confirmed":request.confirmed}));
        let command = format!("cycle.{}", request.change);
        self.v3_mutation(&bound,&command,"cycle",&request.cycle_id,|| {
            let stored=self.cycle_v3(&context.project_id,&request.cycle_id)?.ok_or_else(||StoreError::NotFound{entity:"cycle",id:request.cycle_id.clone()})?;
            let at=status_evaluation::canonical_status_timestamp(&context.now)?;
            let mut cycle=Cycle::new(context.project_id.clone().into(),CycleId::new(&stored.cycle_id),&stored.name);
            cycle.lifecycle=match stored.lifecycle.as_str(){"planned"=>CycleLifecycle::Planned,"active"=>CycleLifecycle::Active,
                "completed"=>CycleLifecycle::Completed,"cancelled"=>CycleLifecycle::Cancelled,_=>return Err(StoreError::Corrupt("invalid cycle lifecycle".into()))};
            let assignments=self.cycle_assignments_v3(&context.project_id,&request.cycle_id)?;
            match request.change.as_str() {
                "activate" | "close" | "cancel" => {
                    let mut unresolved=0;
                    for assignment in &assignments {
                        if !matches!(assignment.state.as_str(),"planned"|"committed"){continue;}
                        if request.change=="close" && self.has_accepted_outcome(&context.project_id,&assignment.work_id)? {
                            self.set_assignment_state(context,assignment,"completed",None,None,&request.reason)?;
                        } else {unresolved+=1;}
                    }
                    let next=match request.change.as_str(){
                        "activate"=>{cycle.start(at).map_err(|e|StoreError::Invalid(e.to_string()))?;"active"},
                        "close"=>{cycle.complete(at,unresolved).map_err(|e|StoreError::Invalid(e.to_string()))?;"completed"},
                        _=>{cycle.cancel(at,unresolved).map_err(|e|StoreError::Invalid(e.to_string()))?;"cancelled"}
                    };
                    let mut row=self.prepare("UPDATE cycle_v3 SET lifecycle=?3,updated_at=?4 WHERE project_id=?1 AND cycle_id=?2")?;
                    row.bind_text(1,&context.project_id)?;row.bind_text(2,&request.cycle_id)?;row.bind_text(3,next)?;row.bind_text(4,&context.now)?;row.run()?;
                    self.append_cycle_event(context,&request.cycle_id,&request.change,Some(&stored.lifecycle),next,&request.reason,
                        json!({"at":context.now,"live_assignments":unresolved}))?;
                }
                "assign" => {
                    if cycle.lifecycle.is_terminal(){return Err(StoreError::Invalid("terminal cycle cannot receive work".into()));}
                    let id=required(&request.assignment_id,"assignment_id")?;
                    let work=required(&request.work_id,"work_id")?;
                    let item=self.work(&context.project_id,work)?.ok_or_else(||StoreError::NotFound{entity:"work",id:work.into()})?;
                    if !matches!(item.lifecycle.as_str(),"draft"|"open"){return Err(StoreError::Invalid("only draft or open work can be assigned".into()));}
                    let assignment=CycleAssignmentV3Input{project_id:context.project_id.clone(),assignment_id:id.into(),cycle_id:request.cycle_id.clone(),
                        work_id:work.into(),state:"planned".into(),activation_policy:"at_cycle_start".into(),activation_at_utc_ms:None,
                        predecessor_id:None,successor_id:None,created_at:context.now.clone(),updated_at:context.now.clone()};
                    self.insert_assignment(context,&assignment,&request.reason)?;
                }
                "defer" => {
                    if cycle.lifecycle.is_terminal() {
                        return Err(StoreError::Invalid(
                            "terminal cycle scope is immutable".into(),
                        ));
                    }
                    let id = required(&request.assignment_id, "assignment_id")?;
                    let assignment = assignments
                        .iter()
                        .find(|assignment| assignment.assignment_id == id)
                        .ok_or_else(|| StoreError::NotFound {
                            entity: "cycle_assignment",
                            id: id.into(),
                        })?;
                    if !matches!(assignment.state.as_str(), "planned" | "committed")
                        || !boreal_domain::work_model_v3::assignment_transition_allowed(
                            &assignment.state,
                            "removed",
                        )
                    {
                        return Err(StoreError::Invalid(
                            "only a live assignment can be deferred".into(),
                        ));
                    }
                    self.set_assignment_state(
                        context,
                        assignment,
                        "removed",
                        assignment.predecessor_id.as_deref(),
                        assignment.successor_id.as_deref(),
                        &request.reason,
                    )?;
                    self.append_cycle_event(
                        context,
                        &request.cycle_id,
                        "assignment_deferred",
                        Some(&stored.lifecycle),
                        &stored.lifecycle,
                        &request.reason,
                        json!({
                            "disposition": "deferred",
                            "assignment_id": assignment.assignment_id,
                            "work_id": assignment.work_id,
                            "task_outcome_changed": false
                        }),
                    )?;
                }
                "commit" | "remove" | "carry_over" => {
                    let id=required(&request.assignment_id,"assignment_id")?;
                    let assignment=assignments.iter().find(|a|a.assignment_id==id).ok_or_else(||StoreError::NotFound{entity:"cycle_assignment",id:id.into()})?;
                    let next=match request.change.as_str(){"commit"=>"committed","remove"=>"removed",_=>"carried_over"};
                    if !boreal_domain::work_model_v3::assignment_transition_allowed(&assignment.state,next){
                        return Err(StoreError::Invalid("illegal commitment transition; history cannot be reset".into()));
                    }
                    if cycle.lifecycle.is_terminal(){return Err(StoreError::Invalid("terminal cycle scope is immutable".into()));}
                    if next=="committed" && cycle.lifecycle!=CycleLifecycle::Active {
                        return Err(StoreError::Invalid("activate the cycle before committing work".into()));
                    }
                    if next=="carried_over" {
                        let target=required(&request.successor_cycle_id,"successor_cycle_id")?;
                        let successor=required(&request.successor_assignment_id,"successor_assignment_id")?;
                        if target==request.cycle_id {return Err(StoreError::Invalid("carry-over requires another cycle".into()));}
                        let target_cycle=self.cycle_v3(&context.project_id,target)?.ok_or_else(||StoreError::NotFound{entity:"cycle",id:target.into()})?;
                        if !matches!(target_cycle.lifecycle.as_str(),"planned"|"active"){return Err(StoreError::Invalid("carry-over target is terminal".into()));}
                        let successor_row=CycleAssignmentV3Input{project_id:context.project_id.clone(),assignment_id:successor.into(),cycle_id:target.into(),
                            work_id:assignment.work_id.clone(),state:"planned".into(),activation_policy:"at_cycle_start".into(),activation_at_utc_ms:None,
                            predecessor_id:Some(id.into()),successor_id:None,created_at:context.now.clone(),updated_at:context.now.clone()};
                        self.insert_assignment(context,&successor_row,&request.reason)?;
                        self.set_assignment_state(context,assignment,next,assignment.predecessor_id.as_deref(),Some(successor),&request.reason)?;
                    }else{self.set_assignment_state(context,assignment,next,assignment.predecessor_id.as_deref(),assignment.successor_id.as_deref(),&request.reason)?;}
                    self.append_cycle_event(context,&request.cycle_id,&request.change,Some(&stored.lifecycle),&stored.lifecycle,&request.reason,
                        json!({"assignment_id":id,"next_state":next,"successor_cycle_id":request.successor_cycle_id}))?;
                }
                "map_legacy" => {
                    let legacy=required(&request.work_id,"work_id")?;
                    let item=self.work(&context.project_id,legacy)?.ok_or_else(||StoreError::NotFound{entity:"work",id:legacy.into()})?;
                    if item.kind!="sprint"{return Err(StoreError::Invalid("legacy mapping requires a sprint work row".into()));}
                    let mut row=self.prepare("INSERT INTO boreal_legacy_sprint_cycle(project_id,sprint_work_id,cycle_id,operation_id,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6)")?;
                    row.bind_text(1,&context.project_id)?;row.bind_text(2,legacy)?;row.bind_text(3,&request.cycle_id)?;
                    row.bind_text(4,&context.operation_id)?;row.bind_text(5,&request.reason)?;row.bind_text(6,&context.now)?;row.run()?;
                    self.append_cycle_event(context,&request.cycle_id,"map_legacy",Some(&stored.lifecycle),&stored.lifecycle,&request.reason,
                        json!({"legacy_sprint_id":legacy,"historical_work_preserved":true,"acceptance_created":false}))?;
                }
                _=>return Err(StoreError::Invalid("unknown cycle change".into())),
            }
            Ok(())
        })
    }

    fn insert_assignment(
        &self,
        context: &V3MutationContext,
        a: &CycleAssignmentV3Input,
        reason: &str,
    ) -> Result<(), StoreError> {
        let mut row=self.prepare("INSERT INTO cycle_assignment_v3(assignment_id,project_id,cycle_id,work_id,state,activation_policy,predecessor_id,created_at,updated_at)
            VALUES(?1,?2,?3,?4,'planned','at_cycle_start',?5,?6,?6)")?;
        row.bind_text(1, &a.assignment_id)?;
        row.bind_text(2, &context.project_id)?;
        row.bind_text(3, &a.cycle_id)?;
        row.bind_text(4, &a.work_id)?;
        row.bind_optional_text(5, a.predecessor_id.as_deref())?;
        row.bind_text(6, &context.now)?;
        row.run()?;
        self.append_assignment_event(
            context,
            a,
            None,
            "planned",
            a.predecessor_id.as_deref(),
            None,
            reason,
        )
    }

    fn set_assignment_state(
        &self,
        context: &V3MutationContext,
        a: &CycleAssignmentV3Input,
        next: &str,
        predecessor: Option<&str>,
        successor: Option<&str>,
        reason: &str,
    ) -> Result<(), StoreError> {
        let mut row=self.prepare("UPDATE cycle_assignment_v3 SET state=?3,predecessor_id=?4,successor_id=?5,updated_at=?6 WHERE project_id=?1 AND assignment_id=?2 AND state=?7")?;
        row.bind_text(1, &context.project_id)?;
        row.bind_text(2, &a.assignment_id)?;
        row.bind_text(3, next)?;
        row.bind_optional_text(4, predecessor)?;
        row.bind_optional_text(5, successor)?;
        row.bind_text(6, &context.now)?;
        row.bind_text(7, &a.state)?;
        row.run()?;
        if row.changes()? != 1 {
            return Err(StoreError::Conflict("assignment state changed".into()));
        }
        self.append_assignment_event(
            context,
            a,
            Some(&a.state),
            next,
            predecessor,
            successor,
            reason,
        )
    }
    fn append_assignment_event(
        &self,
        c: &V3MutationContext,
        a: &CycleAssignmentV3Input,
        prior: Option<&str>,
        next: &str,
        predecessor: Option<&str>,
        successor: Option<&str>,
        reason: &str,
    ) -> Result<(), StoreError> {
        let mut row=self.prepare("INSERT INTO boreal_assignment_event(event_id,operation_id,project_id,assignment_id,cycle_id,work_id,prior_state,next_state,predecessor_id,successor_id,actor_id,reason,created_at)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)")?;
        row.bind_text(
            1,
            &format!("{}:assignment:{}", c.operation_id, a.assignment_id),
        )?;
        row.bind_text(2, &c.operation_id)?;
        row.bind_text(3, &c.project_id)?;
        row.bind_text(4, &a.assignment_id)?;
        row.bind_text(5, &a.cycle_id)?;
        row.bind_text(6, &a.work_id)?;
        row.bind_optional_text(7, prior)?;
        row.bind_text(8, next)?;
        row.bind_optional_text(9, predecessor)?;
        row.bind_optional_text(10, successor)?;
        row.bind_text(11, &c.actor_id)?;
        row.bind_text(12, reason)?;
        row.bind_text(13, &c.now)?;
        row.run()
    }
    fn append_cycle_event(
        &self,
        c: &V3MutationContext,
        cycle: &str,
        kind: &str,
        prior: Option<&str>,
        next: &str,
        reason: &str,
        payload: Value,
    ) -> Result<(), StoreError> {
        let mut row=self.prepare("INSERT INTO boreal_cycle_event(event_id,operation_id,project_id,cycle_id,kind,prior_state,next_state,actor_id,reason,payload_json,created_at)
            VALUES(?1,?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
        row.bind_text(1, &c.operation_id)?;
        row.bind_text(2, &c.project_id)?;
        row.bind_text(3, cycle)?;
        row.bind_text(4, kind)?;
        row.bind_optional_text(5, prior)?;
        row.bind_text(6, next)?;
        row.bind_text(7, &c.actor_id)?;
        row.bind_text(8, reason)?;
        row.bind_text(9, &payload.to_string())?;
        row.bind_text(10, &c.now)?;
        row.run()
    }

    pub fn cycle_board_snapshot_v3(
        &self,
        project: &str,
        cycle: &str,
        actor_id: &str,
        session_id: Option<&str>,
        as_of: boreal_domain::TimestampMs,
    ) -> Result<CycleBoardSnapshotV3, StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let c = self
                .cycle_v3(project, cycle)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "cycle",
                    id: cycle.into(),
                })?;
            let (assignments, mut assignment_diagnostics) =
                self.cycle_assignments_v3_scoped(project, cycle)?;
            let mut linked_assignments: BTreeMap<String, CycleAssignmentV3Record> =
                BTreeMap::new();
            for assignment in &assignments {
                let mut details = Vec::new();
                if assignment.state == "carried_over" && assignment.successor_id.is_none() {
                    details.push("carried-over assignment has no successor link".to_owned());
                }
                if assignment.state != "carried_over" && assignment.successor_id.is_some() {
                    details.push("only a carried-over assignment may name a successor".to_owned());
                }
                for (link_kind, linked_id) in [
                    ("predecessor", assignment.predecessor_id.as_deref()),
                    ("successor", assignment.successor_id.as_deref()),
                ] {
                    let Some(linked_id) = linked_id else { continue };
                    let linked = if let Some(linked) = linked_assignments.get(linked_id) {
                        linked.clone()
                    } else {
                        let linked = self.cycle_assignment_v3_by_id(project, linked_id);
                        match linked {
                            Ok(Some(record)) => {
                                linked_assignments.insert(linked_id.to_owned(), record.clone());
                                record
                            }
                            Ok(None) => {
                                details.push(format!("{link_kind} assignment {linked_id} is missing"));
                                continue;
                            }
                            Err(error) => {
                                details.push(format!("{link_kind} assignment {linked_id} is unreadable: {error}"));
                                continue;
                            }
                        }
                    };
                    let coherent = linked.project_id == assignment.project_id
                        && linked.work_id == assignment.work_id
                        && linked.cycle_id != assignment.cycle_id
                        && match link_kind {
                            "predecessor" => linked.state == "carried_over"
                                && linked.successor_id.as_deref() == Some(assignment.assignment_id.as_str()),
                            _ => linked.predecessor_id.as_deref() == Some(assignment.assignment_id.as_str()),
                        };
                    if !coherent {
                        details.push(format!("{link_kind} assignment {linked_id} has inconsistent reciprocal or subject links"));
                    }
                }
                if !details.is_empty() {
                    assignment_diagnostics.push(StatusRecordDiagnostic {
                        work_id: assignment.work_id.clone(),
                        title: None,
                        code: "cycle_assignment_lineage_corrupt".to_owned(),
                        detail: details.join("; "),
                    });
                }
                let mut chain = BTreeSet::new();
                let mut cursor = assignment.assignment_id.clone();
                loop {
                    if !chain.insert(cursor.clone()) {
                        assignment_diagnostics.push(StatusRecordDiagnostic {
                            work_id: assignment.work_id.clone(),
                            title: None,
                            code: "cycle_assignment_lineage_cycle".to_owned(),
                            detail: "assignment successor links form a cycle".to_owned(),
                        });
                        break;
                    }
                    let current = if cursor == assignment.assignment_id {
                        Some(assignment.clone())
                    } else if let Some(record) = linked_assignments.get(&cursor) {
                        Some(record.clone())
                    } else {
                        match self.cycle_assignment_v3_by_id(project, &cursor) {
                            Ok(Some(record)) => {
                                linked_assignments.insert(cursor.clone(), record.clone());
                                Some(record)
                            }
                            Ok(None) => None,
                            Err(error) => {
                                assignment_diagnostics.push(StatusRecordDiagnostic {
                                    work_id: assignment.work_id.clone(),
                                    title: None,
                                    code: "cycle_assignment_lineage_corrupt".to_owned(),
                                    detail: format!("successor assignment {cursor} is unreadable: {error}"),
                                });
                                None
                            }
                        }
                    };
                    let Some(next_id) = current.and_then(|record| record.successor_id) else { break };
                    cursor = next_id;
                }
            }
            let mut status = self.read_project_status_in_transaction(project)?;
            let actor = self.project_actor_context(project, actor_id)?;
            self.populate_status_action_facts_for_session(
                &mut status,
                actor_id,
                session_id,
                as_of,
            )?;
            let mut accepted_outcomes = BTreeMap::new();
            let mut assignment_reasons = BTreeMap::new();
            for a in &assignments {
                if let Some(outcome) = self.current_accepted_outcome(project, &a.work_id)? {
                    accepted_outcomes.insert(a.work_id.clone(), outcome);
                }
                if self.table_exists("boreal_assignment_event")? {
                    let mut event = self.prepare(
                        "SELECT reason FROM boreal_assignment_event
                         WHERE project_id=?1 AND assignment_id=?2
                         ORDER BY created_at DESC,event_id DESC LIMIT 1",
                    )?;
                    event.bind_text(1, project)?;
                    event.bind_text(2, &a.assignment_id)?;
                    if event.step()? == SQLITE_ROW {
                        assignment_reasons.insert(a.assignment_id.clone(), event.column_text(0)?);
                    }
                }
            }
            let work_nodes = self.work_nodes_v3(project)?;
            Ok(CycleBoardSnapshotV3 {
                cycle: c,
                assignments,
                assignment_diagnostics,
                status,
                accepted_outcomes,
                assignment_reasons,
                work_nodes,
                actor,
            })
        })();
        finish_transaction(self, result)
    }
    pub fn intake_snapshot_v3(
        &self,
        project: &str,
    ) -> Result<(u64, Vec<IntakeItemV3Record>), StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            Ok((
                self.project_revision(project)?.0,
                self.intake_items_v3(project)?,
            ))
        })();
        finish_transaction(self, result)
    }
    pub fn cycle_list_snapshot_v3(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Value, StoreError> {
        if limit == 0 || limit > 100 {
            return Err(StoreError::Invalid(
                "cycle page limit must be 1..=100".into(),
            ));
        }
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project)?.0;
            let mut count = self.prepare("SELECT COUNT(*) FROM cycle_v3 WHERE project_id=?1")?;
            count.bind_text(1, project)?;
            count.step()?;
            let total = count.column_u64(0)?;
            let mut rows=self.prepare("SELECT cycle_id,name,goal,lifecycle,scheduled_start_utc_ms,scheduled_end_utc_ms,timezone FROM cycle_v3 WHERE project_id=?1 ORDER BY scheduled_start_utc_ms,cycle_id LIMIT ?2 OFFSET ?3")?;
            rows.bind_text(1, project)?;
            rows.bind_i64(2, limit)?;
            rows.bind_i64(3, offset)?;
            let mut items = Vec::new();
            while rows.step()? == SQLITE_ROW {
                items.push(json!({"cycle_id":rows.column_text(0)?,"name":rows.column_text(1)?,"goal":rows.column_text(2)?,"lifecycle":rows.column_text(3)?,
                    "scheduled_start_utc_ms":rows.column_i64(4)?,"scheduled_end_utc_ms":rows.column_optional_signed_i64(5)?,"timezone":rows.column_text(6)?}));
            }
            let returned = items.len() as u64;
            Ok(
                json!({"project_id":project,"revision":revision,"total":total,"items":items,"returned":returned,
                "next_offset":if offset+returned<total{Some(offset+returned)}else{None}}),
            )
        })();
        finish_transaction(self, result)
    }
}
fn required<'a>(value: &'a Option<String>, field: &str) -> Result<&'a str, StoreError> {
    value
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| StoreError::Invalid(format!("{field} is required")))
}

//! Application-side contracts for the additive `boreal.work-model/3` slice.
//!
//! This module is deliberately a policy boundary, not a second persistence
//! layer.  It validates a command against one canonical snapshot and returns
//! a typed planned result containing the operation identity and request
//! digest.  The store adapter must apply that plan in a short transaction,
//! re-read the same rows, and re-run the validators before committing.

use std::{collections::BTreeSet, fmt, fs, path::PathBuf};

use boreal_domain::work_model_v3::{
    validate_cycle_assignments, validate_decomposition, validate_direct_dependencies, Cycle,
    CycleAssignment, CycleId, CycleInstance, CycleSeries, CycleTemplate, DirectDependency,
    ExecutionMode, FoldPolicy, GapPolicy, LocalDateTime, ModelError, TimeResolution,
};
use boreal_domain::{DispatchPolicy, ProjectId, ReasonCode, TimestampMs, WorkId, WorkItem};
use serde_json::json;

use crate::canonical_request_digest;

/// Scope carried by every v3 planning mutation.  `expected_revision` is
/// mandatory for persisted adapters; the optional form is useful for read-only
/// planning and is rejected by [`PlanningScope::require_revision`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanningScope {
    pub project_id: ProjectId,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub expected_revision: Option<u64>,
}

impl PlanningScope {
    pub fn new(project_id: ProjectId, actor_id: impl Into<String>) -> Self {
        Self {
            project_id,
            actor_id: actor_id.into(),
            session_id: None,
            expected_revision: None,
        }
    }

    pub fn with_session(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }

    pub fn at_revision(mut self, revision: u64) -> Self {
        self.expected_revision = Some(revision);
        self
    }

    pub fn validate(&self) -> Result<(), PlanningError> {
        if self.project_id.as_str().trim().is_empty() {
            return Err(PlanningError::Invalid("project_id is required".to_owned()));
        }
        if self.actor_id.trim().is_empty() {
            return Err(PlanningError::Invalid("actor_id is required".to_owned()));
        }
        if self
            .session_id
            .as_deref()
            .is_some_and(|id| id.trim().is_empty())
        {
            return Err(PlanningError::Invalid(
                "session_id cannot be empty".to_owned(),
            ));
        }
        Ok(())
    }

    pub fn require_revision(&self, actual: u64) -> Result<(), PlanningError> {
        match self.expected_revision {
            Some(expected) if expected == actual => Ok(()),
            Some(expected) => Err(PlanningError::RevisionConflict { expected, actual }),
            None => Err(PlanningError::Invalid(
                "v3 mutations require expected_revision".to_owned(),
            )),
        }
    }
}

/// A mutation prepared by application policy and ready for a store adapter.
/// The adapter must preserve this operation ID/digest on replay.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannedOperation<T> {
    pub operation_id: String,
    pub request_digest: String,
    pub project_id: ProjectId,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub expected_revision: u64,
    pub value: T,
}

impl<T> PlannedOperation<T> {
    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> PlannedOperation<U> {
        PlannedOperation {
            operation_id: self.operation_id,
            request_digest: self.request_digest,
            project_id: self.project_id,
            actor_id: self.actor_id,
            session_id: self.session_id,
            expected_revision: self.expected_revision,
            value: f(self.value),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PlanningError {
    Domain(ModelError),
    Invalid(String),
    RevisionConflict {
        expected: u64,
        actual: u64,
    },
    ScopeConflict {
        expected: String,
        actual: String,
    },
    TimeZoneUnavailable {
        timezone: String,
        searched: Vec<PathBuf>,
    },
    TimeZoneParse(String),
    StoreSeam(&'static str),
}

impl fmt::Display for PlanningError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Domain(error) => error.fmt(f),
            Self::Invalid(message) => f.write_str(message),
            Self::RevisionConflict { expected, actual } => {
                write!(f, "stale v3 revision: expected {expected}, actual {actual}")
            }
            Self::ScopeConflict { expected, actual } => {
                write!(f, "v3 scope conflict: expected {expected}, actual {actual}")
            }
            Self::TimeZoneUnavailable { timezone, searched } => write!(
                f,
                "timezone {timezone:?} is unavailable in the system tz database (searched {})",
                searched
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Self::TimeZoneParse(message) => write!(f, "timezone database parse failed: {message}"),
            Self::StoreSeam(operation) => {
                write!(f, "store v3 mutation seam is not exposed: {operation}")
            }
        }
    }
}

impl std::error::Error for PlanningError {}

impl From<ModelError> for PlanningError {
    fn from(error: ModelError) -> Self {
        Self::Domain(error)
    }
}

/// The canonical v3 hierarchy read snapshot consumed by planning commands.
/// It is a materialized read model, not a writable cache.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HierarchySnapshot {
    pub project_id: ProjectId,
    pub revision: u64,
    pub nodes: Vec<boreal_domain::work_model_v3::WorkNode>,
    pub dependencies: Vec<DirectDependency>,
    pub cycles: Vec<Cycle>,
    pub assignments: Vec<CycleAssignment>,
}

impl HierarchySnapshot {
    pub fn validate(&self) -> Result<(), PlanningError> {
        validate_decomposition(&self.nodes)?;
        validate_direct_dependencies(&self.nodes, &self.dependencies)?;
        validate_cycle_assignments(&self.cycles, &self.nodes, &self.assignments)?;
        Ok(())
    }

    pub fn node(
        &self,
        work_id: &WorkId,
    ) -> Result<&boreal_domain::work_model_v3::WorkNode, PlanningError> {
        self.nodes
            .iter()
            .find(|node| &node.id == work_id)
            .ok_or_else(|| PlanningError::Invalid(format!("work node not found: {work_id}")))
    }

    pub fn cycle(&self, cycle_id: &CycleId) -> Result<&Cycle, PlanningError> {
        self.cycles
            .iter()
            .find(|cycle| &cycle.id == cycle_id)
            .ok_or_else(|| PlanningError::Invalid(format!("cycle not found: {cycle_id}")))
    }

    fn scope(&self, scope: &PlanningScope) -> Result<(), PlanningError> {
        scope.validate()?;
        if scope.project_id != self.project_id {
            return Err(PlanningError::ScopeConflict {
                expected: self.project_id.to_string(),
                actual: scope.project_id.to_string(),
            });
        }
        scope.require_revision(self.revision)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkEditRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub work_id: WorkId,
    /// `None` leaves the parent unchanged; `Some(None)` moves to the root.
    pub parent_id: Option<Option<WorkId>>,
    pub title: Option<String>,
    pub execution_mode: Option<ExecutionMode>,
}

pub fn plan_work_edit(
    snapshot: &HierarchySnapshot,
    request: &WorkEditRequest,
) -> Result<PlannedOperation<boreal_domain::work_model_v3::WorkNode>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let mut updated = snapshot.node(&request.work_id)?.clone();
    if let Some(parent_id) = &request.parent_id {
        updated.parent_id = parent_id.clone();
    }
    if let Some(title) = &request.title {
        if title.trim().is_empty() {
            return Err(PlanningError::Invalid(
                "work title cannot be empty".to_owned(),
            ));
        }
        updated.title = title.clone();
    }
    if let Some(mode) = request.execution_mode {
        updated.execution_mode = mode;
    }
    let mut nodes = snapshot.nodes.clone();
    let position = nodes
        .iter()
        .position(|node| node.id == request.work_id)
        .unwrap();
    nodes[position] = updated.clone();
    validate_decomposition(&nodes)?;
    let request_digest = canonical_request_digest(
        "work.edit/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "session_id": request.scope.session_id,
            "work_id": request.work_id.as_str(),
            "parent_id": request.parent_id.as_ref().map(|parent| parent.as_ref().map(WorkId::as_str)),
            "title": request.title,
            "execution_mode": request.execution_mode.map(|mode| format!("{mode:?}").to_ascii_lowercase()),
            "expected_revision": request.scope.expected_revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: updated,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DependencyChange {
    Add(DirectDependency),
    Remove(DirectDependency),
}

pub fn plan_dependency_change(
    snapshot: &HierarchySnapshot,
    scope: &PlanningScope,
    operation_id: impl Into<String>,
    change: DependencyChange,
) -> Result<PlannedOperation<Vec<DirectDependency>>, PlanningError> {
    snapshot.scope(scope)?;
    let mut dependencies = snapshot.dependencies.clone();
    match &change {
        DependencyChange::Add(edge) => dependencies.push(edge.clone()),
        DependencyChange::Remove(edge) => {
            let before = dependencies.len();
            dependencies.retain(|candidate| candidate != edge);
            if before == dependencies.len() {
                return Err(PlanningError::Invalid(
                    "dependency edge not found".to_owned(),
                ));
            }
        }
    }
    validate_direct_dependencies(&snapshot.nodes, &dependencies)?;
    let operation_id = operation_id.into();
    let request_digest = canonical_request_digest(
        "dependency.change/v3",
        json!({
            "project_id": scope.project_id.as_str(),
            "actor_id": scope.actor_id,
            "session_id": scope.session_id,
            "operation": match change { DependencyChange::Add(_) => "add", DependencyChange::Remove(_) => "remove" },
            "dependencies": dependencies.iter().map(|edge| json!({
                "blocker_id": edge.blocker_id.as_str(),
                "blocked_id": edge.blocked_id.as_str(),
            })).collect::<Vec<_>>(),
            "expected_revision": scope.expected_revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id,
        request_digest,
        project_id: scope.project_id.clone(),
        actor_id: scope.actor_id.clone(),
        session_id: scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: dependencies,
    })
}

/// Policy fields that are currently represented by the schema-2 work row and
/// can therefore be adapted immediately by the existing store transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkPolicyPatch {
    pub dispatch_policy: Option<DispatchPolicy>,
    pub hard_holds: Option<Vec<ReasonCode>>,
}

pub fn plan_work_policy(
    scope: &PlanningScope,
    actual_revision: u64,
    operation_id: impl Into<String>,
    current: &WorkItem,
    patch: &WorkPolicyPatch,
) -> Result<PlannedOperation<WorkItem>, PlanningError> {
    scope.validate()?;
    scope.require_revision(actual_revision)?;
    if current.project_id != scope.project_id {
        return Err(PlanningError::ScopeConflict {
            expected: scope.project_id.to_string(),
            actual: current.project_id.to_string(),
        });
    }
    let mut updated = current.clone();
    if let Some(policy) = patch.dispatch_policy {
        updated.dispatch_policy = policy;
    }
    if let Some(holds) = &patch.hard_holds {
        let mut seen = BTreeSet::new();
        for hold in holds {
            if !seen.insert(hold.stable_code()) {
                return Err(PlanningError::Invalid("duplicate hard hold".to_owned()));
            }
        }
        updated.hard_holds = holds.clone();
    }
    let operation_id = operation_id.into();
    let request_digest = canonical_request_digest(
        "work.policy.edit/v3",
        json!({
            "project_id": scope.project_id.as_str(),
            "actor_id": scope.actor_id,
            "session_id": scope.session_id,
            "work_id": current.id.as_str(),
            "dispatch_policy": patch.dispatch_policy.map(|policy| format!("{policy:?}").to_ascii_lowercase()),
            "hard_holds": patch.hard_holds.as_ref().map(|holds| holds.iter().map(ReasonCode::stable_code).collect::<Vec<_>>()),
            "expected_revision": actual_revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id,
        request_digest,
        project_id: scope.project_id.clone(),
        actor_id: scope.actor_id.clone(),
        session_id: scope.session_id.clone(),
        expected_revision: actual_revision,
        value: updated,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleCreateRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub cycle: Cycle,
}

pub fn plan_cycle_create(
    snapshot: &HierarchySnapshot,
    request: &CycleCreateRequest,
) -> Result<PlannedOperation<Cycle>, PlanningError> {
    snapshot.scope(&request.scope)?;
    if request.cycle.project_id != snapshot.project_id {
        return Err(PlanningError::ScopeConflict {
            expected: snapshot.project_id.to_string(),
            actual: request.cycle.project_id.to_string(),
        });
    }
    request.cycle.validate()?;
    if snapshot
        .cycles
        .iter()
        .any(|cycle| cycle.id == request.cycle.id)
    {
        return Err(PlanningError::Invalid("cycle ID already exists".to_owned()));
    }
    let digest = canonical_request_digest(
        "cycle.create/v3",
        json!({"project_id": request.scope.project_id.as_str(), "cycle_id": request.cycle.id.as_str(), "name": request.cycle.name, "expected_revision": snapshot.revision}),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: request.cycle.clone(),
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleActivationRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub cycle_id: CycleId,
    pub at: TimestampMs,
}

pub fn plan_cycle_activation(
    snapshot: &HierarchySnapshot,
    request: &CycleActivationRequest,
) -> Result<PlannedOperation<Cycle>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let mut cycle = snapshot.cycle(&request.cycle_id)?.clone();
    cycle.start(request.at)?;
    let digest = canonical_request_digest(
        "cycle.activate/v3",
        json!({"project_id": request.scope.project_id.as_str(), "cycle_id": request.cycle_id.as_str(), "at": request.at.as_millis(), "expected_revision": snapshot.revision}),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: cycle,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleSlotRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub cycle_id: CycleId,
    pub series: CycleSeries,
    pub template: CycleTemplate,
    pub slot_ordinal: u64,
}

/// Materialize one recurring cycle using the host's real TZif database.  The
/// resolved offset and database digest are persisted with the cycle, so a
/// later tzdb update cannot silently rewrite historical schedule facts.
pub fn plan_cycle_slot(
    request: &CycleSlotRequest,
    tzdb: &SystemTimeZoneDatabase,
) -> Result<PlannedOperation<CycleInstance>, PlanningError> {
    request.scope.validate()?;
    let expected_revision = request.scope.expected_revision.ok_or_else(|| {
        PlanningError::Invalid("cycle materialization requires expected_revision".to_owned())
    })?;
    if request.series.project_id != request.scope.project_id
        || request.template.series_id != request.series.id
    {
        return Err(PlanningError::ScopeConflict {
            expected: request.scope.project_id.to_string(),
            actual: request.series.project_id.to_string(),
        });
    }
    request.template.validate()?;
    let local = request
        .template
        .recurrence
        .local_slot(request.slot_ordinal)?;
    let start = tzdb.resolve(
        &request.template.timezone,
        local,
        request.template.recurrence.gap_policy,
        request.template.recurrence.fold_policy,
    )?;
    let cycle = CycleInstance {
        id: request.cycle_id.clone(),
        project_id: request.scope.project_id.clone(),
        series_id: request.series.id.clone(),
        template_version_id: request.template.id.clone(),
        slot_ordinal: request.slot_ordinal,
        slot_key: request.template.slot_key(request.slot_ordinal),
        name: request
            .template
            .name_pattern
            .replace("{slot}", &request.slot_ordinal.to_string()),
        scheduled_start: start,
        scheduled_end: None,
    };
    cycle.validate()?;
    let digest = canonical_request_digest(
        "cycle.materialize/v3",
        json!({"project_id": request.scope.project_id.as_str(), "cycle_id": request.cycle_id.as_str(), "series_id": request.series.id.as_str(), "series_revision": request.series.revision, "template_version_id": request.template.id.as_str(), "slot": request.slot_ordinal, "expected_revision": expected_revision}),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision,
        value: cycle,
    })
}

/// A small, dependency-free TZif reader.  It uses the host's installed IANA
/// database rather than a hand-written offset table or a fake test resolver.
#[derive(Clone, Debug)]
pub struct SystemTimeZoneDatabase {
    roots: Vec<PathBuf>,
}

impl Default for SystemTimeZoneDatabase {
    fn default() -> Self {
        Self::system()
    }
}

impl SystemTimeZoneDatabase {
    pub fn system() -> Self {
        Self::from_roots([
            "/usr/share/zoneinfo",
            "/usr/share/zoneinfo.default",
            "/var/db/timezone/zoneinfo",
        ])
    }

    pub fn from_root(root: impl Into<PathBuf>) -> Self {
        Self {
            roots: vec![root.into()],
        }
    }

    pub fn from_roots<I, P>(roots: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: Into<PathBuf>,
    {
        Self {
            roots: roots.into_iter().map(Into::into).collect(),
        }
    }

    fn read_zone(&self, timezone: &str) -> Result<(Vec<u8>, PathBuf), PlanningError> {
        if timezone.is_empty() || timezone.contains("..") || timezone.starts_with('/') {
            return Err(PlanningError::Invalid(
                "invalid IANA timezone name".to_owned(),
            ));
        }
        let mut searched = Vec::new();
        for root in &self.roots {
            let path = root.join(timezone);
            searched.push(path.clone());
            if path.is_file() {
                let bytes = fs::read(&path)
                    .map_err(|error| PlanningError::TimeZoneParse(error.to_string()))?;
                return Ok((bytes, path));
            }
        }
        Err(PlanningError::TimeZoneUnavailable {
            timezone: timezone.to_owned(),
            searched,
        })
    }

    pub fn resolve(
        &self,
        timezone: &str,
        local: LocalDateTime,
        gap_policy: GapPolicy,
        fold_policy: FoldPolicy,
    ) -> Result<TimeResolution, PlanningError> {
        local.validate()?;
        let (bytes, _path) = self.read_zone(timezone)?;
        let zone = TzifZone::parse(&bytes)?;
        let local_seconds = local_seconds(local)?;
        let mut candidates = zone
            .offsets()
            .into_iter()
            .filter_map(|offset| {
                let utc = local_seconds.checked_sub(offset as i64)?;
                (zone.offset_at(utc) == offset).then_some((utc, offset))
            })
            .collect::<Vec<_>>();
        candidates.sort_unstable();
        candidates.dedup();
        let (utc_seconds, offset) = match candidates.as_slice() {
            [candidate] => *candidate,
            [first, .., last] if first != last => match fold_policy {
                FoldPolicy::EarlierOffset => *first,
                FoldPolicy::LaterOffset => *last,
            },
            [] => {
                let (utc, offset) = zone.next_valid_after_gap(local_seconds)?;
                if gap_policy != GapPolicy::NextValid {
                    return Err(PlanningError::TimeZoneParse(
                        "unsupported gap policy".to_owned(),
                    ));
                }
                (utc, offset)
            }
            _ => {
                return Err(PlanningError::TimeZoneParse(
                    "ambiguous timezone resolution".to_owned(),
                ))
            }
        };
        let utc_millis = utc_seconds
            .checked_mul(1_000)
            .and_then(|value| u64::try_from(value).ok())
            .ok_or_else(|| {
                PlanningError::Invalid("resolved timestamp is outside supported range".to_owned())
            })?;
        let resolution = TimeResolution {
            nominal_local: local,
            utc_instant: TimestampMs::from_millis(utc_millis),
            utc_offset_minutes: offset / 60,
            timezone: timezone.to_owned(),
            tzdb_identity: crate::sha256_content_digest(&bytes),
            gap_policy,
            fold_policy,
        };
        resolution.validate()?;
        Ok(resolution)
    }
}

#[derive(Clone, Debug)]
struct TzifZone {
    transitions: Vec<(i64, i32)>,
    offsets: Vec<i32>,
}

impl TzifZone {
    fn parse(bytes: &[u8]) -> Result<Self, PlanningError> {
        if bytes.len() < 44 || &bytes[..4] != b"TZif" {
            return Err(PlanningError::TimeZoneParse(
                "missing TZif header".to_owned(),
            ));
        }
        let version = bytes[4];
        let first = parse_tzif_block(bytes, 0, 4)?;
        let block = if version == b'2' || version == b'3' || version == b'4' {
            let second_offset = first.end;
            parse_tzif_block(bytes, second_offset, 8)?
        } else {
            first
        };
        let offsets = block
            .types
            .iter()
            .map(|entry| entry.offset)
            .collect::<Vec<_>>();
        let transitions = block
            .transition_times
            .iter()
            .zip(block.transition_types.iter())
            .map(|(at, type_index)| {
                offsets
                    .get(*type_index as usize)
                    .copied()
                    .map(|offset| (*at, offset))
                    .ok_or_else(|| {
                        PlanningError::TimeZoneParse(
                            "transition type index out of range".to_owned(),
                        )
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if offsets.is_empty() {
            return Err(PlanningError::TimeZoneParse(
                "timezone has no local types".to_owned(),
            ));
        }
        Ok(Self {
            transitions,
            offsets,
        })
    }

    fn offsets(&self) -> Vec<i32> {
        let mut values = self.offsets.clone();
        values.sort_unstable();
        values.dedup();
        values
    }

    fn offset_at(&self, utc_seconds: i64) -> i32 {
        self.transitions
            .iter()
            .rev()
            .find(|(at, _)| *at <= utc_seconds)
            .map(|(_, offset)| *offset)
            .unwrap_or(self.offsets[0])
    }

    fn next_valid_after_gap(&self, local_seconds: i64) -> Result<(i64, i32), PlanningError> {
        let mut previous = self.offsets[0];
        for (at, new_offset) in &self.transitions {
            if *new_offset > previous {
                let local_start = at.saturating_add(previous as i64);
                let local_end = at.saturating_add(*new_offset as i64);
                if (local_start..local_end).contains(&local_seconds) {
                    return Ok((*at, *new_offset));
                }
            }
            previous = *new_offset;
        }
        Err(PlanningError::TimeZoneParse(
            "local time is not resolvable".to_owned(),
        ))
    }
}

struct ParsedTzifBlock {
    end: usize,
    transition_times: Vec<i64>,
    transition_types: Vec<u8>,
    types: Vec<TzifType>,
}

#[derive(Clone, Copy)]
struct TzifType {
    offset: i32,
}

fn parse_tzif_block(
    bytes: &[u8],
    start: usize,
    time_size: usize,
) -> Result<ParsedTzifBlock, PlanningError> {
    if bytes.len() < start + 44 || &bytes[start..start + 4] != b"TZif" {
        return Err(PlanningError::TimeZoneParse(
            "invalid TZif block".to_owned(),
        ));
    }
    let counts = (0..6)
        .map(|index| read_u32(bytes, start + 20 + index * 4))
        .collect::<Result<Vec<_>, _>>()?;
    let [gmt_count, standard_count, leap_count, time_count, type_count, char_count] = [
        counts[0], counts[1], counts[2], counts[3], counts[4], counts[5],
    ];
    let mut cursor = start + 44;
    let mut transition_times = Vec::with_capacity(time_count as usize);
    for _ in 0..time_count {
        let value = if time_size == 8 {
            read_i64(bytes, cursor)?
        } else {
            read_i32(bytes, cursor)? as i64
        };
        transition_times.push(value);
        cursor += time_size;
    }
    let transition_types = bytes
        .get(cursor..cursor + time_count as usize)
        .ok_or_else(|| PlanningError::TimeZoneParse("truncated transition index table".to_owned()))?
        .to_vec();
    cursor += time_count as usize;
    let mut types = Vec::with_capacity(type_count as usize);
    for _ in 0..type_count {
        let offset = read_i32(bytes, cursor)?;
        types.push(TzifType { offset });
        cursor += 6;
    }
    cursor = cursor
        .checked_add(char_count as usize)
        .and_then(|value| value.checked_add(leap_count as usize * (time_size + 4)))
        .and_then(|value| value.checked_add(standard_count as usize))
        .and_then(|value| value.checked_add(gmt_count as usize))
        .ok_or_else(|| PlanningError::TimeZoneParse("TZif block size overflow".to_owned()))?;
    if cursor > bytes.len() {
        return Err(PlanningError::TimeZoneParse(
            "truncated TZif data".to_owned(),
        ));
    }
    Ok(ParsedTzifBlock {
        end: cursor,
        transition_times,
        transition_types,
        types,
    })
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, PlanningError> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| PlanningError::TimeZoneParse("truncated TZif integer".to_owned()))?;
    Ok(u32::from_be_bytes(value.try_into().unwrap()))
}

fn read_i32(bytes: &[u8], offset: usize) -> Result<i32, PlanningError> {
    Ok(read_u32(bytes, offset)? as i32)
}

fn read_i64(bytes: &[u8], offset: usize) -> Result<i64, PlanningError> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| PlanningError::TimeZoneParse("truncated TZif integer".to_owned()))?;
    Ok(i64::from_be_bytes(value.try_into().unwrap()))
}

fn local_seconds(local: LocalDateTime) -> Result<i64, PlanningError> {
    // Howard Hinnant's civil-date conversion, kept here as an adapter detail;
    // the domain still owns LocalDate/LocalTime validation and recurrence.
    let year = i64::from(local.date.year) - i64::from(local.date.month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = i64::from(local.date.month);
    let day = i64::from(local.date.day);
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146097 + day_of_era - 719468;
    days.checked_mul(86_400)
        .and_then(|value| value.checked_add(i64::from(local.time.hour) * 3_600))
        .and_then(|value| value.checked_add(i64::from(local.time.minute) * 60))
        .and_then(|value| value.checked_add(i64::from(local.time.second)))
        .ok_or_else(|| PlanningError::Invalid("local timestamp overflow".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::work_model_v3::{
        CycleLifecycle, LocalDate, LocalTime, RecurrenceEnd, WeeklyRecurrence, WorkNode,
    };

    fn scope(revision: u64) -> PlanningScope {
        PlanningScope::new(ProjectId::new("p1"), "operator-1").at_revision(revision)
    }

    fn hierarchy() -> HierarchySnapshot {
        let milestone = WorkNode::milestone(ProjectId::new("p1"), WorkId::new("m1"), "M");
        let task = WorkNode::task(
            ProjectId::new("p1"),
            WorkId::new("t1"),
            ExecutionMode::Direct,
            Some(WorkId::new("m1")),
            "T",
        );
        HierarchySnapshot {
            project_id: ProjectId::new("p1"),
            revision: 7,
            nodes: vec![milestone, task],
            dependencies: Vec::new(),
            cycles: Vec::new(),
            assignments: Vec::new(),
        }
    }

    #[test]
    fn work_edit_rejects_stale_revision_and_invalid_parent() {
        let snapshot = hierarchy();
        let stale = WorkEditRequest {
            scope: scope(6),
            operation_id: "op-stale".into(),
            work_id: WorkId::new("t1"),
            parent_id: None,
            title: Some("new".into()),
            execution_mode: None,
        };
        assert!(matches!(
            plan_work_edit(&snapshot, &stale),
            Err(PlanningError::RevisionConflict { .. })
        ));
        let invalid = WorkEditRequest {
            scope: scope(7),
            operation_id: "op-invalid".into(),
            work_id: WorkId::new("t1"),
            parent_id: Some(Some(WorkId::new("t1"))),
            title: None,
            execution_mode: None,
        };
        assert!(plan_work_edit(&snapshot, &invalid).is_err());
    }

    #[test]
    fn dependency_changes_reject_cycles_and_policy_rejects_duplicate_holds() {
        let milestone = WorkNode::milestone(ProjectId::new("p1"), WorkId::new("m1"), "M");
        let first = WorkNode::task(
            ProjectId::new("p1"),
            WorkId::new("t1"),
            ExecutionMode::Direct,
            Some(WorkId::new("m1")),
            "T1",
        );
        let second = WorkNode::task(
            ProjectId::new("p1"),
            WorkId::new("t2"),
            ExecutionMode::Direct,
            Some(WorkId::new("m1")),
            "T2",
        );
        let mut snapshot = HierarchySnapshot {
            project_id: ProjectId::new("p1"),
            revision: 8,
            nodes: vec![milestone, first, second],
            dependencies: vec![DirectDependency {
                blocker_id: WorkId::new("t1"),
                blocked_id: WorkId::new("t2"),
            }],
            cycles: Vec::new(),
            assignments: Vec::new(),
        };
        let reverse = DependencyChange::Add(DirectDependency {
            blocker_id: WorkId::new("t2"),
            blocked_id: WorkId::new("t1"),
        });
        assert!(plan_dependency_change(&snapshot, &scope(8), "op-cycle", reverse).is_err());

        let current = WorkItem {
            id: WorkId::new("t1"),
            project_id: ProjectId::new("p1"),
            kind: boreal_domain::WorkKind::Task,
            parent_id: None,
            title: "T1".into(),
            description: String::new(),
            lifecycle: boreal_domain::PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: boreal_domain::AcceptanceProfile::focused(),
        };
        let duplicate_holds = WorkPolicyPatch {
            dispatch_policy: Some(DispatchPolicy::Paused),
            hard_holds: Some(vec![
                ReasonCode::HardHold("operator-review".into()),
                ReasonCode::HardHold("operator-review".into()),
            ]),
        };
        assert!(plan_work_policy(&scope(8), 8, "op-policy", &current, &duplicate_holds).is_err());

        snapshot.dependencies.clear();
        let valid = plan_dependency_change(
            &snapshot,
            &scope(8),
            "op-dependency",
            DependencyChange::Add(DirectDependency {
                blocker_id: WorkId::new("t1"),
                blocked_id: WorkId::new("t2"),
            }),
        )
        .unwrap();
        assert_eq!(valid.value.len(), 1);
    }

    #[test]
    fn cycle_activation_is_legal_once_and_assignments_remain_separate() {
        let mut snapshot = hierarchy();
        snapshot
            .cycles
            .push(Cycle::new(ProjectId::new("p1"), CycleId::new("c1"), "C"));
        let request = CycleActivationRequest {
            scope: scope(7),
            operation_id: "op-cycle".into(),
            cycle_id: CycleId::new("c1"),
            at: TimestampMs::from_millis(10),
        };
        let result = plan_cycle_activation(&snapshot, &request).unwrap();
        assert_eq!(result.value.lifecycle, CycleLifecycle::Active);
        snapshot.cycles[0] = result.value;
        assert!(plan_cycle_activation(&snapshot, &request).is_err());
    }

    #[test]
    fn recurrence_uses_real_tzif_for_gap_and_fold() {
        let tzdb = SystemTimeZoneDatabase::system();
        let gap = tzdb
            .resolve(
                "America/New_York",
                LocalDateTime::new(LocalDate::new(2024, 3, 10), LocalTime::new(2, 30, 0)),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .expect("the supported host must provide America/New_York TZif data");
        assert_eq!(gap.utc_offset_minutes, -240);
        assert_eq!(gap.utc_instant.as_millis(), 1_710_054_000_000);
        let early = tzdb
            .resolve(
                "America/New_York",
                LocalDateTime::new(LocalDate::new(2024, 11, 3), LocalTime::new(1, 30, 0)),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap();
        let late = tzdb
            .resolve(
                "America/New_York",
                LocalDateTime::new(LocalDate::new(2024, 11, 3), LocalTime::new(1, 30, 0)),
                GapPolicy::NextValid,
                FoldPolicy::LaterOffset,
            )
            .unwrap();
        assert_eq!(early.utc_offset_minutes, -240);
        assert_eq!(late.utc_offset_minutes, -300);
        assert!(early.utc_instant < late.utc_instant);
    }

    #[test]
    fn cycle_slot_uses_project_revision_and_resolves_template() {
        let recurrence = WeeklyRecurrence {
            anchor_local_start: LocalDateTime::new(
                LocalDate::new(2024, 1, 1),
                LocalTime::new(9, 0, 0),
            ),
            interval_weeks: 1,
            weekdays: [1].into_iter().collect(),
            end: RecurrenceEnd::Count(2),
            gap_policy: GapPolicy::NextValid,
            fold_policy: FoldPolicy::EarlierOffset,
        };
        let series = CycleSeries {
            id: "series".into(),
            project_id: ProjectId::new("p1"),
            name: "S".into(),
            lifecycle: boreal_domain::work_model_v3::CycleSeriesLifecycle::Active,
            revision: 99,
        };
        let template = CycleTemplate {
            id: "template".into(),
            series_id: "series".into(),
            version: 1,
            effective_from_slot_ordinal: 0,
            name_pattern: "Cycle {slot}".into(),
            goal_template: String::new(),
            timezone: "UTC".into(),
            recurrence,
        };
        let request = CycleSlotRequest {
            scope: scope(4),
            operation_id: "op-slot".into(),
            cycle_id: CycleId::new("cycle"),
            series,
            template,
            slot_ordinal: 1,
        };
        let result = plan_cycle_slot(&request, &SystemTimeZoneDatabase::system()).unwrap();
        assert_eq!(result.value.name, "Cycle 1");
        assert_eq!(result.value.slot_key, "boreal.cycle-slot/1/series/1");
    }
}

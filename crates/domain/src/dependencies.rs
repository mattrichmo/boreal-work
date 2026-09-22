//! Pure dependency graph, satisfaction, waiver, and impact policy.
//!
//! This module is deliberately independent of persistence and transport.  An
//! application/store adapter supplies the project-scoped work snapshot and
//! consumes the deterministic decisions returned here.  In particular, a
//! historical label such as `complete` or `closed` is not enough to satisfy a
//! default edge: the closed outcome must carry the exact current work identity
//! and proof generation.

use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, VecDeque},
    fmt,
};

use super::{
    decision_inputs::{
        DecisionId, DependencyId, EntityIdentity, EntityRevision, ProofRevision, UnreadableReason,
    },
    DependencyPolicy, PersistedLifecycle, ProjectId, WorkId,
};

/// The only endpoint kind accepted by the executable dependency graph.
///
/// The other variants are represented so callers can return a typed rejection
/// instead of silently treating a container or compatibility sprint as a
/// direct task.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum DependencyEndpointKind {
    DirectTask,
    Milestone,
    ContainerTask,
    CompatibilitySprint,
}

/// A project-scoped work endpoint used by graph validation.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DependencyEndpoint {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub kind: DependencyEndpointKind,
}

impl DependencyEndpoint {
    pub fn direct_task(project_id: ProjectId, work_id: WorkId) -> Self {
        Self {
            project_id,
            work_id,
            kind: DependencyEndpointKind::DirectTask,
        }
    }

    pub fn new(project_id: ProjectId, work_id: WorkId, kind: DependencyEndpointKind) -> Self {
        Self {
            project_id,
            work_id,
            kind,
        }
    }
}

/// One immutable project-local dependency edge.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyEdge {
    pub id: DependencyId,
    pub project_id: ProjectId,
    pub predecessor: WorkId,
    pub successor: WorkId,
    pub policy: DependencyPolicy,
    pub revision: EntityRevision,
}

impl DependencyEdge {
    pub fn closed_only(
        id: DependencyId,
        project_id: ProjectId,
        predecessor: WorkId,
        successor: WorkId,
        revision: EntityRevision,
    ) -> Self {
        Self {
            id,
            project_id,
            predecessor,
            successor,
            policy: DependencyPolicy::ClosedOnly,
            revision,
        }
    }
}

/// A canonical, sorted, validated dependency graph.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyGraph {
    project_id: ProjectId,
    nodes: Vec<DependencyEndpoint>,
    edges: Vec<DependencyEdge>,
}

impl DependencyGraph {
    pub fn project_id(&self) -> &ProjectId {
        &self.project_id
    }

    pub fn nodes(&self) -> &[DependencyEndpoint] {
        &self.nodes
    }

    pub fn edges(&self) -> &[DependencyEdge] {
        &self.edges
    }

    pub fn edge(&self, id: &DependencyId) -> Option<&DependencyEdge> {
        self.edges.iter().find(|edge| &edge.id == id)
    }

    pub fn has_work(&self, id: &WorkId) -> bool {
        self.nodes.iter().any(|node| &node.work_id == id)
    }

    fn outgoing(&self, predecessor: &WorkId) -> Vec<&DependencyEdge> {
        self.edges
            .iter()
            .filter(move |edge| &edge.predecessor == predecessor)
            .collect()
    }
}

/// Deterministic rejection of a proposed dependency graph.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DependencyGraphError {
    DuplicateNode {
        work_id: WorkId,
    },
    NodeProjectScopeMismatch {
        work_id: WorkId,
        expected: ProjectId,
        observed: ProjectId,
    },
    EdgeProjectScopeMismatch {
        edge_id: DependencyId,
        expected: ProjectId,
        observed: ProjectId,
    },
    DuplicateEdge {
        edge_id: DependencyId,
    },
    MissingEndpoint {
        edge_id: DependencyId,
        endpoint: WorkId,
    },
    EndpointNotDirect {
        edge_id: DependencyId,
        endpoint: WorkId,
        kind: DependencyEndpointKind,
    },
    DuplicateEndpoints {
        predecessor: WorkId,
        successor: WorkId,
        first_edge: DependencyId,
        second_edge: DependencyId,
    },
    SelfDependency {
        edge_id: DependencyId,
        work_id: WorkId,
    },
    DependencyCycle {
        work_ids: Vec<WorkId>,
        edge_ids: Vec<DependencyId>,
    },
}

impl DependencyGraphError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::DuplicateNode { .. } => "duplicate_dependency_node",
            Self::NodeProjectScopeMismatch { .. } | Self::EdgeProjectScopeMismatch { .. } => {
                "cross_project_dependency"
            }
            Self::DuplicateEdge { .. } | Self::DuplicateEndpoints { .. } => "duplicate_dependency",
            Self::MissingEndpoint { .. } => "missing_dependency_endpoint",
            Self::EndpointNotDirect { .. } => "dependency_endpoint_not_direct",
            Self::SelfDependency { .. } => "dependency_self_edge",
            Self::DependencyCycle { .. } => "dependency_cycle",
        }
    }
}

impl fmt::Display for DependencyGraphError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateNode { work_id } => write!(formatter, "duplicate dependency node: {work_id}"),
            Self::NodeProjectScopeMismatch { work_id, expected, observed } => write!(
                formatter,
                "dependency node {work_id} belongs to project {observed}, expected {expected}"
            ),
            Self::EdgeProjectScopeMismatch { edge_id, expected, observed } => write!(
                formatter,
                "dependency edge {edge_id} belongs to project {observed}, expected {expected}"
            ),
            Self::DuplicateEdge { edge_id } => write!(formatter, "duplicate dependency edge: {edge_id}"),
            Self::MissingEndpoint { edge_id, endpoint } => {
                write!(formatter, "dependency edge {edge_id} references missing endpoint {endpoint}")
            }
            Self::EndpointNotDirect { edge_id, endpoint, kind } => write!(
                formatter,
                "dependency edge {edge_id} endpoint {endpoint} has unsupported kind {kind:?}"
            ),
            Self::DuplicateEndpoints { predecessor, successor, first_edge, second_edge } => write!(
                formatter,
                "duplicate dependency endpoints {predecessor} -> {successor}: {first_edge}, {second_edge}"
            ),
            Self::SelfDependency { edge_id, work_id } => {
                write!(formatter, "dependency edge {edge_id} is a self-edge on {work_id}")
            }
            Self::DependencyCycle { work_ids, edge_ids } => write!(
                formatter,
                "dependency cycle through {:?} using {:?}",
                work_ids,
                edge_ids
            ),
        }
    }
}

impl std::error::Error for DependencyGraphError {}

/// Validate and canonicalize a graph.  Nodes and edges are sorted before any
/// rejection, so the selected typed error and the resulting graph do not
/// depend on insertion order.
pub fn validate_dependency_graph(
    project_id: ProjectId,
    nodes: &[DependencyEndpoint],
    edges: &[DependencyEdge],
) -> Result<DependencyGraph, DependencyGraphError> {
    let mut canonical_nodes = nodes.to_vec();
    canonical_nodes.sort();
    let mut node_by_id = BTreeMap::new();
    for node in &canonical_nodes {
        if node.project_id != project_id {
            return Err(DependencyGraphError::NodeProjectScopeMismatch {
                work_id: node.work_id.clone(),
                expected: project_id,
                observed: node.project_id.clone(),
            });
        }
        if node_by_id.insert(node.work_id.clone(), node).is_some() {
            return Err(DependencyGraphError::DuplicateNode {
                work_id: node.work_id.clone(),
            });
        }
    }

    let mut canonical_edges = edges.to_vec();
    canonical_edges.sort_by(edge_order);
    let mut edge_ids = BTreeSet::new();
    let mut endpoint_pairs = BTreeMap::<(WorkId, WorkId), DependencyId>::new();
    for edge in &canonical_edges {
        if edge.project_id != project_id {
            return Err(DependencyGraphError::EdgeProjectScopeMismatch {
                edge_id: edge.id.clone(),
                expected: project_id,
                observed: edge.project_id.clone(),
            });
        }
        if !edge_ids.insert(edge.id.clone()) {
            return Err(DependencyGraphError::DuplicateEdge {
                edge_id: edge.id.clone(),
            });
        }
        if edge.predecessor == edge.successor {
            return Err(DependencyGraphError::SelfDependency {
                edge_id: edge.id.clone(),
                work_id: edge.predecessor.clone(),
            });
        }
        let Some(predecessor) = node_by_id.get(&edge.predecessor) else {
            return Err(DependencyGraphError::MissingEndpoint {
                edge_id: edge.id.clone(),
                endpoint: edge.predecessor.clone(),
            });
        };
        let Some(successor) = node_by_id.get(&edge.successor) else {
            return Err(DependencyGraphError::MissingEndpoint {
                edge_id: edge.id.clone(),
                endpoint: edge.successor.clone(),
            });
        };
        for endpoint in [predecessor, successor] {
            if endpoint.kind != DependencyEndpointKind::DirectTask {
                return Err(DependencyGraphError::EndpointNotDirect {
                    edge_id: edge.id.clone(),
                    endpoint: endpoint.work_id.clone(),
                    kind: endpoint.kind,
                });
            }
        }
        if let Some(first_edge) = endpoint_pairs.insert(
            (edge.predecessor.clone(), edge.successor.clone()),
            edge.id.clone(),
        ) {
            return Err(DependencyGraphError::DuplicateEndpoints {
                predecessor: edge.predecessor.clone(),
                successor: edge.successor.clone(),
                first_edge,
                second_edge: edge.id.clone(),
            });
        }
    }

    if let Some((work_ids, edge_ids)) = find_cycle(&node_by_id, &canonical_edges) {
        return Err(DependencyGraphError::DependencyCycle { work_ids, edge_ids });
    }

    Ok(DependencyGraph {
        project_id,
        nodes: canonical_nodes,
        edges: canonical_edges,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VisitState {
    Visiting,
    Done,
}

fn find_cycle(
    nodes: &BTreeMap<WorkId, &DependencyEndpoint>,
    edges: &[DependencyEdge],
) -> Option<(Vec<WorkId>, Vec<DependencyId>)> {
    let mut adjacency = BTreeMap::<WorkId, Vec<DependencyEdge>>::new();
    for edge in edges {
        adjacency
            .entry(edge.predecessor.clone())
            .or_default()
            .push(edge.clone());
    }
    for outgoing in adjacency.values_mut() {
        outgoing.sort_by(edge_order);
    }

    let mut states = BTreeMap::<WorkId, VisitState>::new();
    let mut path_nodes = Vec::new();
    let mut path_edges = Vec::new();
    for work_id in nodes.keys() {
        if states.contains_key(work_id) {
            continue;
        }
        if let Some(cycle) = visit_cycle(
            work_id,
            &adjacency,
            &mut states,
            &mut path_nodes,
            &mut path_edges,
        ) {
            return Some(cycle);
        }
    }
    None
}

fn edge_order(left: &DependencyEdge, right: &DependencyEdge) -> Ordering {
    left.id
        .cmp(&right.id)
        .then_with(|| left.predecessor.cmp(&right.predecessor))
        .then_with(|| left.successor.cmp(&right.successor))
        .then_with(|| left.project_id.cmp(&right.project_id))
        .then_with(|| left.revision.cmp(&right.revision))
}

fn visit_cycle(
    current: &WorkId,
    adjacency: &BTreeMap<WorkId, Vec<DependencyEdge>>,
    states: &mut BTreeMap<WorkId, VisitState>,
    path_nodes: &mut Vec<WorkId>,
    path_edges: &mut Vec<DependencyId>,
) -> Option<(Vec<WorkId>, Vec<DependencyId>)> {
    states.insert(current.clone(), VisitState::Visiting);
    path_nodes.push(current.clone());
    let outgoing = adjacency.get(current).cloned().unwrap_or_default();
    for edge in outgoing {
        match states.get(&edge.successor) {
            Some(VisitState::Visiting) => {
                let start = path_nodes
                    .iter()
                    .position(|work_id| work_id == &edge.successor)
                    .expect("visiting node must be in the DFS path");
                let mut cycle_nodes = path_nodes[start..].to_vec();
                cycle_nodes.push(edge.successor.clone());
                let mut cycle_edges = path_edges[start..].to_vec();
                cycle_edges.push(edge.id);
                return Some((cycle_nodes, cycle_edges));
            }
            Some(VisitState::Done) => {}
            None => {
                path_edges.push(edge.id.clone());
                if let Some(cycle) =
                    visit_cycle(&edge.successor, adjacency, states, path_nodes, path_edges)
                {
                    return Some(cycle);
                }
                path_edges.pop();
            }
        }
    }
    path_nodes.pop();
    states.insert(current.clone(), VisitState::Done);
    None
}

/// A durable waiver that can satisfy only one exact edge revision and one
/// successor scope.  `revoked_at` is an effective project-revision boundary;
/// the waiver is active for `valid_from <= revision < revoked_at`.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct EdgeWaiver {
    pub decision_id: DecisionId,
    pub edge_id: DependencyId,
    pub edge_revision: EntityRevision,
    pub project_id: ProjectId,
    pub successor: WorkId,
    pub valid_from: EntityRevision,
    pub revoked_at: Option<EntityRevision>,
}

impl EdgeWaiver {
    pub fn applies_to(&self, edge: &DependencyEdge, at_revision: EntityRevision) -> bool {
        self.edge_id == edge.id
            && self.edge_revision == edge.revision
            && self.project_id == edge.project_id
            && self.successor == edge.successor
            && self.valid_from <= at_revision
            && self
                .revoked_at
                .is_none_or(|revoked_at| at_revision < revoked_at)
    }

    fn scope_matches(&self, edge: &DependencyEdge) -> bool {
        self.edge_id == edge.id
            && self.edge_revision == edge.revision
            && self.project_id == edge.project_id
            && self.successor == edge.successor
    }

    fn validity_error(&self) -> Option<DependencyEvaluationError> {
        self.revoked_at
            .filter(|revoked_at| *revoked_at <= self.valid_from)
            .map(|_| DependencyEvaluationError::InvalidWaiverWindow {
                edge_id: self.edge_id.clone(),
            })
    }
}

/// The only upstream state that may satisfy the default close-only policy is
/// `Closed(Accepted { ... })` with an exact, non-revoked identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UpstreamOutcome {
    Open,
    Complete,
    Verified,
    Cancelled,
    Failed,
    Closed(ClosedOutcome),
    Unreadable(UnreadablePrerequisite),
    Corrupt(CorruptPrerequisite),
    Stale(StalePrerequisite),
}

/// Raw context retained with an integrity diagnostic.  The dependency
/// observation remains the complete raw record; this smaller context makes
/// the diagnostic independently useful to read/report callers.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RawPrerequisiteContext {
    pub edge_id: DependencyId,
    pub edge_revision: EntityRevision,
    pub predecessor: EntityIdentity,
    pub payload: String,
}

impl RawPrerequisiteContext {
    pub fn new(
        edge_id: DependencyId,
        edge_revision: EntityRevision,
        predecessor: EntityIdentity,
        payload: impl Into<String>,
    ) -> Self {
        Self {
            edge_id,
            edge_revision,
            predecessor,
            payload: payload.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnreadablePrerequisite {
    pub reason: UnreadableReason,
    pub raw: RawPrerequisiteContext,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CorruptPrerequisite {
    pub detail: String,
    pub raw: RawPrerequisiteContext,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StalePrerequisite {
    pub expected: EntityRevision,
    pub observed: EntityRevision,
    pub raw: RawPrerequisiteContext,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClosedOutcome {
    Unaccepted {
        identity: Option<EntityIdentity>,
    },
    Accepted {
        identity: EntityIdentity,
        proof_generation: ProofRevision,
    },
    Revoked {
        identity: EntityIdentity,
        proof_generation: ProofRevision,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyObservation {
    pub edge_id: DependencyId,
    pub edge_revision: EntityRevision,
    pub predecessor: EntityIdentity,
    pub outcome: UpstreamOutcome,
    pub waiver: Option<EdgeWaiver>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UnmetReason {
    ObservationMissing,
    MalformedObservation {
        diagnostic: Box<DependencyEvaluationError>,
    },
    NotAcceptedClosedOutcome,
    ClosedOutcomeUnaccepted,
    ClosedOutcomeRevoked,
    ClosedIdentityMismatch,
    PrerequisiteUnreadable {
        diagnostic: UnreadablePrerequisite,
    },
    PrerequisiteCorrupt {
        diagnostic: CorruptPrerequisite,
    },
    PrerequisiteStale {
        diagnostic: StalePrerequisite,
    },
    WaiverNotYetValid,
    WaiverRevoked,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EdgeSatisfaction {
    AcceptedClosed {
        identity: EntityIdentity,
        proof_generation: ProofRevision,
    },
    Waived {
        waiver: EdgeWaiver,
    },
    Unmet {
        reason: UnmetReason,
    },
}

impl EdgeSatisfaction {
    pub fn is_satisfied(&self) -> bool {
        matches!(self, Self::AcceptedClosed { .. } | Self::Waived { .. })
    }
}

/// Per-edge readback retains the raw prerequisite and exception context even
/// when an edge is satisfied by a waiver.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EdgeEvaluation {
    pub edge: DependencyEdge,
    pub predecessor: Option<EntityIdentity>,
    pub outcome: Option<UpstreamOutcome>,
    pub waiver: Option<EdgeWaiver>,
    pub raw_observations: Vec<DependencyObservation>,
    pub diagnostic: Option<DependencyObservationDiagnostic>,
    pub satisfaction: EdgeSatisfaction,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyEvaluation {
    pub edges: Vec<EdgeEvaluation>,
    pub diagnostics: Vec<DependencyObservationDiagnostic>,
}

impl DependencyEvaluation {
    pub fn satisfied(&self) -> bool {
        self.diagnostics.is_empty()
            && self
                .edges
                .iter()
                .all(|edge| edge.satisfaction.is_satisfied())
    }

    pub fn unmet(&self) -> impl Iterator<Item = &EdgeEvaluation> {
        self.edges
            .iter()
            .filter(|edge| !edge.satisfaction.is_satisfied())
    }
}

/// A malformed observation is retained as data rather than aborting all
/// dependency evaluation.  `raw` is never used as proof of satisfaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyObservationDiagnostic {
    pub error: DependencyEvaluationError,
    pub raw: DependencyObservation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DependencyEvaluationError {
    UnknownObservationEdge {
        edge_id: DependencyId,
    },
    DuplicateObservation {
        edge_id: DependencyId,
    },
    ObservationEdgeRevisionMismatch {
        edge_id: DependencyId,
        expected: EntityRevision,
        observed: EntityRevision,
    },
    ObservationPredecessorMismatch {
        edge_id: DependencyId,
        expected: WorkId,
        observed: WorkId,
    },
    ObservationProjectScopeMismatch {
        edge_id: DependencyId,
        expected: ProjectId,
        observed: ProjectId,
    },
    WaiverOutOfScope {
        edge_id: DependencyId,
    },
    InvalidWaiverWindow {
        edge_id: DependencyId,
    },
}

impl DependencyEvaluationError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownObservationEdge { .. } => "unknown_dependency_edge",
            Self::DuplicateObservation { .. } => "duplicate_dependency_observation",
            Self::ObservationEdgeRevisionMismatch { .. } => "stale_dependency_edge",
            Self::ObservationPredecessorMismatch { .. } => "dependency_predecessor_mismatch",
            Self::ObservationProjectScopeMismatch { .. } => "cross_project_dependency",
            Self::WaiverOutOfScope { .. } => "dependency_waiver_scope_mismatch",
            Self::InvalidWaiverWindow { .. } => "dependency_waiver_window_invalid",
        }
    }
}

impl fmt::Display for DependencyEvaluationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownObservationEdge { edge_id } => {
                write!(formatter, "unknown dependency edge observation: {edge_id}")
            }
            Self::DuplicateObservation { edge_id } => {
                write!(formatter, "duplicate dependency observation: {edge_id}")
            }
            Self::ObservationEdgeRevisionMismatch { edge_id, expected, observed } => write!(
                formatter,
                "dependency edge {edge_id} revision mismatch: expected {expected}, observed {observed}"
            ),
            Self::ObservationPredecessorMismatch { edge_id, expected, observed } => write!(
                formatter,
                "dependency edge {edge_id} predecessor mismatch: expected {expected}, observed {observed}"
            ),
            Self::ObservationProjectScopeMismatch { edge_id, expected, observed } => write!(
                formatter,
                "dependency observation {edge_id} belongs to project {observed}, expected {expected}"
            ),
            Self::WaiverOutOfScope { edge_id } => {
                write!(formatter, "dependency waiver is outside edge scope: {edge_id}")
            }
            Self::InvalidWaiverWindow { edge_id } => {
                write!(formatter, "dependency waiver has an invalid validity window: {edge_id}")
            }
        }
    }
}

impl std::error::Error for DependencyEvaluationError {}

/// Evaluate all edges in canonical graph order.  Missing observations and
/// malformed observations remain visible per edge.  A malformed observation
/// can never satisfy an edge, and unknown observations are retained in the
/// aggregate diagnostics so they also make the evaluation fail closed.
pub fn evaluate_dependencies(
    graph: &DependencyGraph,
    observations: &[DependencyObservation],
    at_revision: EntityRevision,
) -> Result<DependencyEvaluation, DependencyEvaluationError> {
    let mut ordered_observations = observations.to_vec();
    ordered_observations.sort_by(observation_order);

    let mut by_edge = BTreeMap::<DependencyId, Vec<DependencyObservation>>::new();
    let mut diagnostics = Vec::new();
    for observation in ordered_observations {
        let Some(edge) = graph.edge(&observation.edge_id) else {
            diagnostics.push(DependencyObservationDiagnostic {
                error: DependencyEvaluationError::UnknownObservationEdge {
                    edge_id: observation.edge_id.clone(),
                },
                raw: observation,
            });
            continue;
        };
        by_edge
            .entry(observation.edge_id.clone())
            .or_default()
            .push(observation.clone());
        if let Some(error) = validate_observation(graph, edge, &observation) {
            diagnostics.push(DependencyObservationDiagnostic {
                error,
                raw: observation,
            });
        }
    }

    let edges = graph
        .edges
        .iter()
        .map(|edge| {
            let raw_observations = by_edge.remove(&edge.id).unwrap_or_default();
            if raw_observations.is_empty() {
                return EdgeEvaluation {
                    edge: edge.clone(),
                    predecessor: None,
                    outcome: None,
                    waiver: None,
                    raw_observations,
                    diagnostic: None,
                    satisfaction: EdgeSatisfaction::Unmet {
                        reason: UnmetReason::ObservationMissing,
                    },
                };
            }

            let mut edge_diagnostics = diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.raw.edge_id == edge.id)
                .cloned()
                .collect::<Vec<_>>();
            if raw_observations.len() > 1 {
                let duplicate = DependencyObservationDiagnostic {
                    error: DependencyEvaluationError::DuplicateObservation {
                        edge_id: edge.id.clone(),
                    },
                    raw: raw_observations[1].clone(),
                };
                diagnostics.push(duplicate.clone());
                edge_diagnostics.push(duplicate);
            }
            edge_diagnostics.sort_by(|left, right| {
                left.error
                    .code()
                    .cmp(right.error.code())
                    .then_with(|| observation_order(&left.raw, &right.raw))
            });

            let observation = &raw_observations[0];
            let diagnostic = edge_diagnostics.first().cloned();
            let satisfaction = diagnostic.as_ref().map_or_else(
                || evaluate_edge(edge, observation, at_revision),
                |diagnostic| EdgeSatisfaction::Unmet {
                    reason: UnmetReason::MalformedObservation {
                        diagnostic: Box::new(diagnostic.error.clone()),
                    },
                },
            );
            EdgeEvaluation {
                edge: edge.clone(),
                predecessor: Some(observation.predecessor.clone()),
                outcome: Some(observation.outcome.clone()),
                waiver: observation.waiver.clone(),
                raw_observations,
                diagnostic,
                satisfaction,
            }
        })
        .collect();
    diagnostics.sort_by(|left, right| {
        left.raw
            .edge_id
            .cmp(&right.raw.edge_id)
            .then_with(|| left.error.code().cmp(right.error.code()))
            .then_with(|| observation_order(&left.raw, &right.raw))
    });
    Ok(DependencyEvaluation { edges, diagnostics })
}

fn observation_order(left: &DependencyObservation, right: &DependencyObservation) -> Ordering {
    left.edge_id
        .cmp(&right.edge_id)
        .then_with(|| left.edge_revision.cmp(&right.edge_revision))
        .then_with(|| left.predecessor.cmp(&right.predecessor))
        .then_with(|| format!("{:?}", left.outcome).cmp(&format!("{:?}", right.outcome)))
        .then_with(|| left.waiver.cmp(&right.waiver))
}

fn validate_observation(
    graph: &DependencyGraph,
    edge: &DependencyEdge,
    observation: &DependencyObservation,
) -> Option<DependencyEvaluationError> {
    if observation.edge_revision != edge.revision {
        return Some(DependencyEvaluationError::ObservationEdgeRevisionMismatch {
            edge_id: observation.edge_id.clone(),
            expected: edge.revision,
            observed: observation.edge_revision,
        });
    }
    if observation.predecessor.project_id != graph.project_id {
        return Some(DependencyEvaluationError::ObservationProjectScopeMismatch {
            edge_id: observation.edge_id.clone(),
            expected: graph.project_id.clone(),
            observed: observation.predecessor.project_id.clone(),
        });
    }
    if observation.predecessor.work_id != edge.predecessor {
        return Some(DependencyEvaluationError::ObservationPredecessorMismatch {
            edge_id: observation.edge_id.clone(),
            expected: edge.predecessor.clone(),
            observed: observation.predecessor.work_id.clone(),
        });
    }
    if let Some(waiver) = &observation.waiver {
        if !waiver.scope_matches(edge) {
            return Some(DependencyEvaluationError::WaiverOutOfScope {
                edge_id: observation.edge_id.clone(),
            });
        }
        if let Some(error) = waiver.validity_error() {
            return Some(error);
        }
    }
    None
}

fn evaluate_edge(
    edge: &DependencyEdge,
    observation: &DependencyObservation,
    at_revision: EntityRevision,
) -> EdgeSatisfaction {
    match &observation.outcome {
        UpstreamOutcome::Unreadable(diagnostic) => {
            return EdgeSatisfaction::Unmet {
                reason: UnmetReason::PrerequisiteUnreadable {
                    diagnostic: diagnostic.clone(),
                },
            };
        }
        UpstreamOutcome::Corrupt(diagnostic) => {
            return EdgeSatisfaction::Unmet {
                reason: UnmetReason::PrerequisiteCorrupt {
                    diagnostic: diagnostic.clone(),
                },
            };
        }
        UpstreamOutcome::Stale(diagnostic) => {
            return EdgeSatisfaction::Unmet {
                reason: UnmetReason::PrerequisiteStale {
                    diagnostic: diagnostic.clone(),
                },
            };
        }
        UpstreamOutcome::Open
        | UpstreamOutcome::Complete
        | UpstreamOutcome::Verified
        | UpstreamOutcome::Cancelled
        | UpstreamOutcome::Failed
        | UpstreamOutcome::Closed(_) => {}
    }
    let closed = match &observation.outcome {
        UpstreamOutcome::Closed(closed) => Some(closed),
        _ => None,
    };
    if let Some(ClosedOutcome::Accepted {
        identity,
        proof_generation,
    }) = closed
    {
        if identity == &observation.predecessor && identity.work_id == edge.predecessor {
            return EdgeSatisfaction::AcceptedClosed {
                identity: identity.clone(),
                proof_generation: *proof_generation,
            };
        }
    }

    if let Some(waiver) = &observation.waiver {
        if waiver.applies_to(edge, at_revision) {
            return EdgeSatisfaction::Waived {
                waiver: waiver.clone(),
            };
        }
    }

    let reason = match closed {
        Some(ClosedOutcome::Unaccepted { .. }) => UnmetReason::ClosedOutcomeUnaccepted,
        Some(ClosedOutcome::Revoked { .. }) => UnmetReason::ClosedOutcomeRevoked,
        Some(ClosedOutcome::Accepted { .. }) => UnmetReason::ClosedIdentityMismatch,
        None => {
            if observation
                .waiver
                .as_ref()
                .is_some_and(|waiver| waiver.valid_from > at_revision)
            {
                UnmetReason::WaiverNotYetValid
            } else if observation
                .waiver
                .as_ref()
                .and_then(|waiver| waiver.revoked_at)
                .is_some_and(|revoked_at| revoked_at <= at_revision)
            {
                UnmetReason::WaiverRevoked
            } else {
                UnmetReason::NotAcceptedClosedOutcome
            }
        }
    };
    EdgeSatisfaction::Unmet { reason }
}

/// Deterministic structural closure of all dependents of the supplied roots.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectedSubgraph {
    pub roots: Vec<WorkId>,
    pub nodes: Vec<AffectedSubgraphNode>,
    pub edges: Vec<DependencyEdge>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectedSubgraphNode {
    pub work_id: WorkId,
    pub distance: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AffectedSubgraphError {
    UnknownRoot(WorkId),
}

impl fmt::Display for AffectedSubgraphError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownRoot(work_id) => {
                write!(formatter, "unknown affected-subgraph root: {work_id}")
            }
        }
    }
}

impl std::error::Error for AffectedSubgraphError {}

pub fn affected_subgraph(
    graph: &DependencyGraph,
    roots: &[WorkId],
) -> Result<AffectedSubgraph, AffectedSubgraphError> {
    let mut canonical_roots = roots.to_vec();
    canonical_roots.sort();
    canonical_roots.dedup();
    for root in &canonical_roots {
        if !graph.has_work(root) {
            return Err(AffectedSubgraphError::UnknownRoot(root.clone()));
        }
    }

    let mut distance = BTreeMap::<WorkId, usize>::new();
    let mut queue = VecDeque::new();
    for root in &canonical_roots {
        distance.insert(root.clone(), 0);
        queue.push_back(root.clone());
    }
    while let Some(current) = queue.pop_front() {
        let next_distance = distance[&current] + 1;
        for edge in graph.outgoing(&current) {
            if distance.contains_key(&edge.successor) {
                continue;
            }
            distance.insert(edge.successor.clone(), next_distance);
            queue.push_back(edge.successor.clone());
        }
    }

    let nodes = distance
        .iter()
        .filter(|(work_id, _)| !canonical_roots.contains(work_id))
        .map(|(work_id, distance)| AffectedSubgraphNode {
            work_id: work_id.clone(),
            distance: *distance,
        })
        .collect::<Vec<_>>();
    let edges = graph
        .edges
        .iter()
        .filter(|edge| {
            distance.contains_key(&edge.predecessor)
                && distance.contains_key(&edge.successor)
                && !canonical_roots.contains(&edge.successor)
        })
        .cloned()
        .collect();
    Ok(AffectedSubgraph {
        roots: canonical_roots,
        nodes,
        edges,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvalidationKind {
    Reopened,
    Revoked,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvalidatedOutcome {
    pub identity: EntityIdentity,
    pub proof_generation: ProofRevision,
    pub kind: InvalidationKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DependencyInvalidation {
    Outcome(InvalidatedOutcome),
    WaiverRevoked {
        edge_id: DependencyId,
        edge_revision: EntityRevision,
        project_id: ProjectId,
        successor: WorkId,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SuccessorImpactState {
    Pending,
    Active,
    HistoricallyClosed,
    HistoricallyCancelled,
    FactsUnavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuccessorFacts {
    pub work_id: WorkId,
    pub lifecycle: PersistedLifecycle,
    pub active_attempt: bool,
    pub pending_close_intent: bool,
    pub pending_review: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuccessorImpact {
    pub work_id: WorkId,
    pub distance: usize,
    pub via_edges: Vec<DependencyId>,
    pub state: SuccessorImpactState,
    pub active_attempt: bool,
    pub pending_close_intent: bool,
    pub pending_review: bool,
    pub requires_reconciliation: bool,
    pub history_preserved: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyImpact {
    pub invalidation: DependencyInvalidation,
    pub affected_subgraph: AffectedSubgraph,
    pub invalidated_edges: Vec<DependencyId>,
    pub successors: Vec<SuccessorImpact>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DependencyImpactError {
    Evaluation(DependencyEvaluationError),
    AffectedSubgraph(AffectedSubgraphError),
    EvaluationDiagnostics(Vec<DependencyObservationDiagnostic>),
    DuplicateSuccessorFacts(WorkId),
    UnknownWaiverEdge(DependencyId),
    WaiverNotCurrent {
        edge_id: DependencyId,
        at_revision: EntityRevision,
    },
    InvalidationProjectScopeMismatch(ProjectId),
}

impl fmt::Display for DependencyImpactError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Evaluation(error) => error.fmt(formatter),
            Self::AffectedSubgraph(error) => error.fmt(formatter),
            Self::EvaluationDiagnostics(diagnostics) => write!(
                formatter,
                "dependency evaluation contains {} malformed observation diagnostic(s)",
                diagnostics.len()
            ),
            Self::DuplicateSuccessorFacts(work_id) => {
                write!(formatter, "duplicate successor facts: {work_id}")
            }
            Self::UnknownWaiverEdge(edge_id) => write!(formatter, "unknown waiver edge: {edge_id}"),
            Self::WaiverNotCurrent {
                edge_id,
                at_revision,
            } => write!(
                formatter,
                "waiver for dependency edge {edge_id} is not currently satisfied at revision {at_revision}"
            ),
            Self::InvalidationProjectScopeMismatch(project_id) => {
                write!(
                    formatter,
                    "invalidation belongs to another project: {project_id}"
                )
            }
        }
    }
}

impl std::error::Error for DependencyImpactError {}

impl From<DependencyEvaluationError> for DependencyImpactError {
    fn from(error: DependencyEvaluationError) -> Self {
        Self::Evaluation(error)
    }
}

impl From<AffectedSubgraphError> for DependencyImpactError {
    fn from(error: AffectedSubgraphError) -> Self {
        Self::AffectedSubgraph(error)
    }
}

/// Produce a pure, deterministic impact preview.  The structural subgraph is
/// returned for authorization/preview, while `invalidated_edges` and
/// `successors` identify the current acceptance references that need
/// reconciliation.  Closed/cancelled successors remain historical facts.
pub fn dependency_impact(
    graph: &DependencyGraph,
    observations: &[DependencyObservation],
    successor_facts: &[SuccessorFacts],
    invalidation: DependencyInvalidation,
    at_revision: EntityRevision,
) -> Result<DependencyImpact, DependencyImpactError> {
    let evaluation = evaluate_dependencies(graph, observations, at_revision)?;
    if !evaluation.diagnostics.is_empty() {
        return Err(DependencyImpactError::EvaluationDiagnostics(
            evaluation.diagnostics.clone(),
        ));
    }
    let mut facts_by_id = BTreeMap::new();
    for facts in successor_facts {
        if facts_by_id.insert(facts.work_id.clone(), facts).is_some() {
            return Err(DependencyImpactError::DuplicateSuccessorFacts(
                facts.work_id.clone(),
            ));
        }
    }

    let root = match &invalidation {
        DependencyInvalidation::Outcome(outcome) => {
            if outcome.identity.project_id != *graph.project_id() {
                return Err(DependencyImpactError::InvalidationProjectScopeMismatch(
                    outcome.identity.project_id.clone(),
                ));
            }
            outcome.identity.work_id.clone()
        }
        DependencyInvalidation::WaiverRevoked {
            edge_id,
            edge_revision,
            project_id,
            successor,
        } => {
            if project_id != graph.project_id() {
                return Err(DependencyImpactError::InvalidationProjectScopeMismatch(
                    project_id.clone(),
                ));
            }
            let Some(edge) = graph.edge(edge_id) else {
                return Err(DependencyImpactError::UnknownWaiverEdge(edge_id.clone()));
            };
            if edge.revision != *edge_revision || edge.successor != *successor {
                return Err(DependencyImpactError::UnknownWaiverEdge(edge_id.clone()));
            }
            let Some(edge_evaluation) = evaluation
                .edges
                .iter()
                .find(|edge_evaluation| edge_evaluation.edge.id == *edge_id)
            else {
                return Err(DependencyImpactError::UnknownWaiverEdge(edge_id.clone()));
            };
            if !matches!(
                &edge_evaluation.satisfaction,
                EdgeSatisfaction::Waived { waiver }
                    if waiver.applies_to(edge, at_revision)
            ) {
                return Err(DependencyImpactError::WaiverNotCurrent {
                    edge_id: edge_id.clone(),
                    at_revision,
                });
            }
            edge.successor.clone()
        }
    };
    let affected_subgraph = affected_subgraph(graph, std::slice::from_ref(&root))?;

    let mut evaluations = BTreeMap::<DependencyId, &EdgeEvaluation>::new();
    for edge in &evaluation.edges {
        evaluations.insert(edge.edge.id.clone(), edge);
    }
    let mut invalidated_edges = BTreeSet::new();
    match &invalidation {
        DependencyInvalidation::Outcome(outcome) => {
            for edge in &evaluation.edges {
                if let EdgeSatisfaction::AcceptedClosed {
                    identity,
                    proof_generation,
                } = &edge.satisfaction
                {
                    if identity == &outcome.identity
                        && proof_generation == &outcome.proof_generation
                    {
                        invalidated_edges.insert(edge.edge.id.clone());
                    }
                }
            }
        }
        DependencyInvalidation::WaiverRevoked { edge_id, .. } => {
            invalidated_edges.insert(edge_id.clone());
        }
    }

    // A successor's accepted close can itself be the prerequisite for another
    // successor.  Propagate only through current accepted-close edges; a
    // waiver or an already-open prerequisite deliberately stops the proof
    // dependency chain.
    let mut node_distance = BTreeMap::<WorkId, usize>::new();
    let mut queue = VecDeque::new();
    for edge in &evaluation.edges {
        if invalidated_edges.contains(&edge.edge.id) {
            let distance = 1;
            node_distance
                .entry(edge.edge.successor.clone())
                .and_modify(|current| *current = (*current).min(distance))
                .or_insert(distance);
            queue.push_back(edge.edge.successor.clone());
        }
    }
    while let Some(predecessor) = queue.pop_front() {
        let predecessor_distance = node_distance[&predecessor];
        for edge in graph.outgoing(&predecessor) {
            let Some(edge_evaluation) = evaluations.get(&edge.id) else {
                continue;
            };
            if !matches!(
                edge_evaluation.satisfaction,
                EdgeSatisfaction::AcceptedClosed { .. }
            ) {
                continue;
            }
            let inserted = invalidated_edges.insert(edge.id.clone());
            let next_distance = predecessor_distance + 1;
            let distance_changed = node_distance
                .get(&edge.successor)
                .is_none_or(|current| next_distance < *current);
            if distance_changed {
                node_distance.insert(edge.successor.clone(), next_distance);
            }
            if inserted || distance_changed {
                queue.push_back(edge.successor.clone());
            }
        }
    }

    let mut successors = node_distance
        .iter()
        .map(|(work_id, distance)| {
            let mut via_edges = evaluation
                .edges
                .iter()
                .filter(|edge| {
                    edge.edge.successor == *work_id && invalidated_edges.contains(&edge.edge.id)
                })
                .map(|edge| edge.edge.id.clone())
                .collect::<Vec<_>>();
            via_edges.sort();
            via_edges.dedup();
            let facts = facts_by_id.get(work_id).copied();
            let (state, active_attempt, pending_close_intent, pending_review, history_preserved) =
                match facts {
                    Some(facts) => match facts.lifecycle {
                        PersistedLifecycle::Closed => (
                            SuccessorImpactState::HistoricallyClosed,
                            facts.active_attempt,
                            facts.pending_close_intent,
                            facts.pending_review,
                            true,
                        ),
                        PersistedLifecycle::Cancelled => (
                            SuccessorImpactState::HistoricallyCancelled,
                            facts.active_attempt,
                            facts.pending_close_intent,
                            facts.pending_review,
                            true,
                        ),
                        PersistedLifecycle::Draft | PersistedLifecycle::Open
                            if facts.active_attempt
                                || facts.pending_close_intent
                                || facts.pending_review =>
                        {
                            (
                                SuccessorImpactState::Active,
                                facts.active_attempt,
                                facts.pending_close_intent,
                                facts.pending_review,
                                true,
                            )
                        }
                        PersistedLifecycle::Draft | PersistedLifecycle::Open => (
                            SuccessorImpactState::Pending,
                            facts.active_attempt,
                            facts.pending_close_intent,
                            facts.pending_review,
                            true,
                        ),
                    },
                    None => (
                        SuccessorImpactState::FactsUnavailable,
                        false,
                        false,
                        false,
                        false,
                    ),
                };
            SuccessorImpact {
                work_id: work_id.clone(),
                distance: *distance,
                via_edges,
                state,
                active_attempt,
                pending_close_intent,
                pending_review,
                requires_reconciliation: !matches!(
                    state,
                    SuccessorImpactState::HistoricallyClosed
                        | SuccessorImpactState::HistoricallyCancelled
                ),
                history_preserved,
            }
        })
        .collect::<Vec<_>>();
    successors.sort_by(|left, right| {
        left.distance
            .cmp(&right.distance)
            .then_with(|| left.work_id.cmp(&right.work_id))
    });

    Ok(DependencyImpact {
        invalidation,
        affected_subgraph,
        invalidated_edges: invalidated_edges.into_iter().collect(),
        successors,
    })
}

//! Focused pure-domain coverage for PF-S03-T05.
//!
pub use boreal_domain::{DependencyPolicy, PersistedLifecycle, ProjectId, WorkId};

pub mod decision_inputs {
    pub use boreal_domain::decision_inputs::{
        DecisionId, DependencyId, EntityIdentity, EntityRevision, ProofRevision, UnreadableReason,
    };
}

use boreal_domain::dependencies::{
    affected_subgraph, dependency_impact, evaluate_dependencies, validate_dependency_graph,
    AffectedSubgraph, ClosedOutcome, CorruptPrerequisite, DependencyEdge, DependencyEndpoint,
    DependencyEndpointKind, DependencyEvaluationError, DependencyGraphError,
    DependencyInvalidation, DependencyObservation, EdgeSatisfaction, EdgeWaiver,
    InvalidatedOutcome, InvalidationKind, RawPrerequisiteContext, StalePrerequisite,
    SuccessorFacts, SuccessorImpactState, UnmetReason, UnreadablePrerequisite, UpstreamOutcome,
};
use decision_inputs::{
    DecisionId, DependencyId, EntityIdentity, EntityRevision, ProofRevision, UnreadableReason,
};

fn project(value: &str) -> ProjectId {
    ProjectId::new(value)
}

fn work(value: &str) -> WorkId {
    WorkId::new(value)
}

fn dependency(value: &str) -> DependencyId {
    DependencyId::from(value)
}

fn revision(value: u64) -> EntityRevision {
    EntityRevision::new(value)
}

fn proof(value: u64) -> ProofRevision {
    ProofRevision::new(value)
}

fn identity(project_id: &str, work_id: &str, entity_revision: u64) -> EntityIdentity {
    EntityIdentity::new(
        project(project_id),
        work(work_id),
        revision(entity_revision),
    )
}

fn node(project_id: &str, work_id: &str) -> DependencyEndpoint {
    DependencyEndpoint::direct_task(project(project_id), work(work_id))
}

fn edge(id: &str, predecessor: &str, successor: &str) -> DependencyEdge {
    DependencyEdge::closed_only(
        dependency(id),
        project("p1"),
        work(predecessor),
        work(successor),
        revision(1),
    )
}

fn graph(
    work_ids: &[&str],
    edges: &[DependencyEdge],
) -> boreal_domain::dependencies::DependencyGraph {
    let nodes = work_ids.iter().map(|id| node("p1", id)).collect::<Vec<_>>();
    validate_dependency_graph(project("p1"), &nodes, edges).expect("fixture graph is valid")
}

fn observation(
    edge: &DependencyEdge,
    predecessor: EntityIdentity,
    outcome: UpstreamOutcome,
    waiver: Option<EdgeWaiver>,
) -> DependencyObservation {
    DependencyObservation {
        edge_id: edge.id.clone(),
        edge_revision: edge.revision,
        predecessor,
        outcome,
        waiver,
    }
}

fn accepted(predecessor: EntityIdentity, generation: u64) -> UpstreamOutcome {
    UpstreamOutcome::Closed(ClosedOutcome::Accepted {
        identity: predecessor,
        proof_generation: proof(generation),
    })
}

fn waiver(edge: &DependencyEdge, decision: &str) -> EdgeWaiver {
    EdgeWaiver {
        decision_id: DecisionId::from(decision),
        edge_id: edge.id.clone(),
        edge_revision: edge.revision,
        project_id: project("p1"),
        successor: edge.successor.clone(),
        valid_from: revision(1),
        revoked_at: None,
    }
}

fn raw_prerequisite(
    edge: &DependencyEdge,
    predecessor: &EntityIdentity,
    payload: &str,
) -> RawPrerequisiteContext {
    RawPrerequisiteContext::new(edge.id.clone(), edge.revision, predecessor.clone(), payload)
}

#[test]
fn endpoint_validation_rejects_scope_missing_and_non_direct_endpoints() {
    let edge = edge("e1", "a", "b");
    let foreign_nodes = [node("p1", "a"), node("p2", "b")];
    assert!(matches!(
        validate_dependency_graph(project("p1"), &foreign_nodes, std::slice::from_ref(&edge)),
        Err(DependencyGraphError::NodeProjectScopeMismatch { .. })
    ));

    let foreign_edge = DependencyEdge {
        project_id: project("p2"),
        ..edge.clone()
    };
    assert_eq!(
        validate_dependency_graph(
            project("p1"),
            &[node("p1", "a"), node("p1", "b")],
            &[foreign_edge],
        )
        .expect_err("foreign edge must be rejected")
        .code(),
        "cross_project_dependency"
    );

    let missing = DependencyEdge {
        predecessor: work("missing"),
        ..edge.clone()
    };
    assert!(matches!(
        validate_dependency_graph(project("p1"), &[node("p1", "b")], &[missing],),
        Err(DependencyGraphError::MissingEndpoint { .. })
    ));

    let non_direct = [
        node("p1", "a"),
        DependencyEndpoint::new(project("p1"), work("b"), DependencyEndpointKind::Milestone),
    ];
    assert_eq!(
        validate_dependency_graph(project("p1"), &non_direct, &[edge])
            .expect_err("container endpoint must be rejected")
            .code(),
        "dependency_endpoint_not_direct"
    );

    for kind in [
        DependencyEndpointKind::ContainerTask,
        DependencyEndpointKind::CompatibilitySprint,
    ] {
        let unsupported = [
            node("p1", "a"),
            DependencyEndpoint::new(project("p1"), work("b"), kind),
        ];
        assert!(matches!(
            validate_dependency_graph(
                project("p1"),
                &unsupported,
                &[DependencyEdge::closed_only(
                    dependency("e-kind"),
                    project("p1"),
                    work("a"),
                    work("b"),
                    revision(1),
                )],
            ),
            Err(DependencyGraphError::EndpointNotDirect { .. })
        ));
    }
}

#[test]
fn duplicate_self_and_cycle_rejections_are_order_independent() {
    let nodes = [node("p1", "a"), node("p1", "b"), node("p1", "c")];
    let duplicate = [edge("e1", "a", "b"), edge("e1", "a", "b")];
    assert_eq!(
        validate_dependency_graph(project("p1"), &nodes, &duplicate)
            .expect_err("duplicate edge id must be rejected"),
        validate_dependency_graph(
            project("p1"),
            &nodes,
            &[duplicate[1].clone(), duplicate[0].clone()],
        )
        .expect_err("reordering cannot change duplicate rejection")
    );

    let duplicate_endpoints = [edge("e2", "a", "b"), edge("e1", "a", "b")];
    assert!(matches!(
        validate_dependency_graph(project("p1"), &nodes, &duplicate_endpoints),
        Err(DependencyGraphError::DuplicateEndpoints {
            first_edge,
            second_edge,
            ..
        }) if first_edge == dependency("e1") && second_edge == dependency("e2")
    ));

    let self_edge = edge("self", "a", "a");
    assert!(matches!(
        validate_dependency_graph(project("p1"), &nodes, &[self_edge]),
        Err(DependencyGraphError::SelfDependency { .. })
    ));

    let cycle = [
        edge("e3", "c", "a"),
        edge("e1", "a", "b"),
        edge("e2", "b", "c"),
    ];
    let first = validate_dependency_graph(project("p1"), &nodes, &cycle)
        .expect_err("cycle must be rejected");
    let second = validate_dependency_graph(
        project("p1"),
        &nodes,
        &[cycle[1].clone(), cycle[2].clone(), cycle[0].clone()],
    )
    .expect_err("cycle result must not depend on insertion order");
    assert_eq!(first, second);
    assert_eq!(first.code(), "dependency_cycle");
}

#[test]
fn only_current_accepted_closed_outcomes_satisfy_default_edges() {
    let edge = edge("e1", "a", "b");
    let graph = graph(&["a", "b"], std::slice::from_ref(&edge));
    let predecessor = identity("p1", "a", 4);

    let cases = [
        (
            UpstreamOutcome::Open,
            Some(UnmetReason::NotAcceptedClosedOutcome),
        ),
        (
            UpstreamOutcome::Complete,
            Some(UnmetReason::NotAcceptedClosedOutcome),
        ),
        (
            UpstreamOutcome::Verified,
            Some(UnmetReason::NotAcceptedClosedOutcome),
        ),
        (
            UpstreamOutcome::Cancelled,
            Some(UnmetReason::NotAcceptedClosedOutcome),
        ),
        (
            UpstreamOutcome::Failed,
            Some(UnmetReason::NotAcceptedClosedOutcome),
        ),
        (
            UpstreamOutcome::Closed(ClosedOutcome::Unaccepted {
                identity: Some(predecessor.clone()),
            }),
            Some(UnmetReason::ClosedOutcomeUnaccepted),
        ),
        (
            UpstreamOutcome::Closed(ClosedOutcome::Revoked {
                identity: predecessor.clone(),
                proof_generation: proof(8),
            }),
            Some(UnmetReason::ClosedOutcomeRevoked),
        ),
    ];
    for (outcome, reason) in cases {
        let evaluation = evaluate_dependencies(
            &graph,
            &[observation(&edge, predecessor.clone(), outcome, None)],
            revision(10),
        )
        .expect("well-shaped observations are evaluable");
        assert!(!evaluation.satisfied());
        let EdgeSatisfaction::Unmet { reason: actual } = &evaluation.edges[0].satisfaction else {
            panic!("non-closed outcome unexpectedly satisfied the edge");
        };
        assert_eq!(Some(actual.clone()), reason);
    }

    let accepted_evaluation = evaluate_dependencies(
        &graph,
        &[observation(
            &edge,
            predecessor.clone(),
            accepted(predecessor.clone(), 8),
            None,
        )],
        revision(10),
    )
    .expect("accepted close is evaluable");
    assert!(accepted_evaluation.satisfied());
    assert!(matches!(
        accepted_evaluation.edges[0].satisfaction,
        EdgeSatisfaction::AcceptedClosed { .. }
    ));

    let wrong_generation_identity = identity("p1", "a", 5);
    let stale = evaluate_dependencies(
        &graph,
        &[observation(
            &edge,
            predecessor,
            accepted(wrong_generation_identity, 8),
            None,
        )],
        revision(10),
    )
    .expect("stale close remains readable");
    assert!(matches!(
        stale.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::ClosedIdentityMismatch
        }
    ));
}

#[test]
fn waiver_is_edge_scoped_and_keeps_raw_unmet_context() {
    let first = edge("e1", "a", "b");
    let second = edge("e2", "a", "c");
    let graph = graph(&["a", "b", "c"], &[first.clone(), second.clone()]);
    let raw = observation(
        &first,
        identity("p1", "a", 2),
        UpstreamOutcome::Open,
        Some(waiver(&first, "decision-1")),
    );
    let evaluation =
        evaluate_dependencies(&graph, &[raw], revision(2)).expect("edge-specific waiver is valid");
    assert!(!evaluation.satisfied());
    assert!(matches!(
        evaluation.edges[0].satisfaction,
        EdgeSatisfaction::Waived { .. }
    ));
    assert_eq!(evaluation.edges[0].outcome, Some(UpstreamOutcome::Open));
    assert!(evaluation.edges[0].waiver.is_some());
    assert!(matches!(
        evaluation.edges[1].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::ObservationMissing
        }
    ));

    let wrong_scope = EdgeWaiver {
        successor: second.successor.clone(),
        ..waiver(&first, "decision-2")
    };
    let wrong_scope_evaluation = evaluate_dependencies(
        &graph,
        &[observation(
            &first,
            identity("p1", "a", 2),
            UpstreamOutcome::Open,
            Some(wrong_scope),
        )],
        revision(2),
    )
    .expect("out-of-scope waiver remains a per-edge diagnostic");
    assert!(matches!(
        &wrong_scope_evaluation.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::MalformedObservation { diagnostic }
        } if diagnostic.code() == "dependency_waiver_scope_mismatch"
    ));
    assert_eq!(wrong_scope_evaluation.diagnostics.len(), 1);

    let mut revoked = waiver(&first, "decision-3");
    revoked.revoked_at = Some(revision(3));
    let revoked_evaluation = evaluate_dependencies(
        &graph,
        &[observation(
            &first,
            identity("p1", "a", 2),
            UpstreamOutcome::Open,
            Some(revoked),
        )],
        revision(3),
    )
    .expect("revocation is a readable edge fact");
    assert!(matches!(
        revoked_evaluation.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::WaiverRevoked
        }
    ));
}

#[test]
fn affected_subgraph_is_canonical_across_root_and_edge_insertion_orders() {
    let edges = [
        edge("e3", "b", "d"),
        edge("e5", "d", "e"),
        edge("e2", "a", "c"),
        edge("e4", "c", "d"),
        edge("e1", "a", "b"),
    ];
    let first_graph = graph(&["a", "b", "c", "d", "e"], &edges);
    let second_graph = graph(
        &["e", "d", "c", "b", "a"],
        &[
            edges[4].clone(),
            edges[1].clone(),
            edges[3].clone(),
            edges[0].clone(),
            edges[2].clone(),
        ],
    );
    let first = affected_subgraph(&first_graph, &[work("a")]).expect("root is known");
    let second = affected_subgraph(&second_graph, &[work("a")]).expect("root is known");
    assert_eq!(first, second);
    assert_eq!(
        first
            .nodes
            .iter()
            .map(|node| (node.work_id.as_str(), node.distance))
            .collect::<Vec<_>>(),
        vec![("b", 1), ("c", 1), ("d", 2), ("e", 3)]
    );
    assert_eq!(
        first
            .edges
            .iter()
            .map(|edge| edge.id.as_str())
            .collect::<Vec<_>>(),
        vec!["e1", "e2", "e3", "e4", "e5"]
    );
}

#[test]
fn reopen_impact_classifies_pending_active_and_historical_successors_without_mutation() {
    let edges = [
        edge("e1", "a", "b"),
        edge("e2", "b", "c"),
        edge("e3", "c", "d"),
    ];
    let graph = graph(&["a", "b", "c", "d"], &edges);
    let a = identity("p1", "a", 10);
    let b = identity("p1", "b", 20);
    let c = identity("p1", "c", 30);
    let d = identity("p1", "d", 40);
    let observations = [
        observation(&edges[0], a.clone(), accepted(a.clone(), 101), None),
        observation(&edges[1], b.clone(), accepted(b.clone(), 102), None),
        observation(&edges[2], c.clone(), accepted(c.clone(), 103), None),
    ];
    let facts = [
        SuccessorFacts {
            work_id: work("b"),
            lifecycle: PersistedLifecycle::Open,
            active_attempt: false,
            pending_close_intent: false,
            pending_review: false,
        },
        SuccessorFacts {
            work_id: work("c"),
            lifecycle: PersistedLifecycle::Open,
            active_attempt: true,
            pending_close_intent: true,
            pending_review: true,
        },
        SuccessorFacts {
            work_id: work("d"),
            lifecycle: PersistedLifecycle::Closed,
            active_attempt: false,
            pending_close_intent: false,
            pending_review: false,
        },
    ];
    let impact = dependency_impact(
        &graph,
        &observations,
        &facts,
        DependencyInvalidation::Outcome(InvalidatedOutcome {
            identity: a.clone(),
            proof_generation: proof(101),
            kind: InvalidationKind::Reopened,
        }),
        revision(11),
    )
    .expect("reopen impact is pure and deterministic");

    assert_eq!(
        impact.invalidated_edges,
        vec![dependency("e1"), dependency("e2"), dependency("e3")]
    );
    assert_eq!(
        impact
            .successors
            .iter()
            .map(|successor| (&successor.work_id, successor.distance, successor.state))
            .collect::<Vec<_>>(),
        vec![
            (&work("b"), 1, SuccessorImpactState::Pending),
            (&work("c"), 2, SuccessorImpactState::Active),
            (&work("d"), 3, SuccessorImpactState::HistoricallyClosed),
        ]
    );
    assert!(impact.successors[0].requires_reconciliation);
    assert!(impact.successors[1].active_attempt);
    assert!(impact.successors[1].pending_close_intent);
    assert!(impact.successors[1].pending_review);
    assert!(!impact.successors[2].requires_reconciliation);
    assert!(impact.successors[2].history_preserved);
    assert_eq!(impact.affected_subgraph.nodes.len(), 3);
    assert_eq!(d.work_id, work("d"));

    let revoked_impact = dependency_impact(
        &graph,
        &observations,
        &facts,
        DependencyInvalidation::Outcome(InvalidatedOutcome {
            identity: a,
            proof_generation: proof(101),
            kind: InvalidationKind::Revoked,
        }),
        revision(11),
    )
    .expect("revoked accepted outcome has the same bounded impact");
    assert_eq!(revoked_impact.invalidated_edges, impact.invalidated_edges);
    assert_eq!(revoked_impact.successors, impact.successors);
}

#[test]
fn waiver_revocation_propagates_only_through_current_accepted_close_edges() {
    let edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    let graph = graph(&["a", "b", "c"], &edges);
    let a = identity("p1", "a", 1);
    let b = identity("p1", "b", 2);
    let waiver = waiver(&edges[0], "waiver-1");
    let observations = [
        observation(&edges[0], a, UpstreamOutcome::Open, Some(waiver)),
        observation(&edges[1], b.clone(), accepted(b, 9), None),
    ];
    let impact = dependency_impact(
        &graph,
        &observations,
        &[
            SuccessorFacts {
                work_id: work("b"),
                lifecycle: PersistedLifecycle::Open,
                active_attempt: false,
                pending_close_intent: false,
                pending_review: false,
            },
            SuccessorFacts {
                work_id: work("c"),
                lifecycle: PersistedLifecycle::Closed,
                active_attempt: false,
                pending_close_intent: false,
                pending_review: false,
            },
        ],
        DependencyInvalidation::WaiverRevoked {
            edge_id: dependency("e1"),
            edge_revision: revision(1),
            project_id: project("p1"),
            successor: work("b"),
        },
        revision(3),
    )
    .expect("waiver revocation impact is evaluable");
    assert_eq!(
        impact.invalidated_edges,
        vec![dependency("e1"), dependency("e2")]
    );
    assert_eq!(impact.successors[0].work_id, work("b"));
    assert_eq!(impact.successors[1].work_id, work("c"));
    assert_eq!(
        impact.successors[1].state,
        SuccessorImpactState::HistoricallyClosed
    );
}

#[test]
fn malformed_observations_are_retained_per_edge_and_fail_closed() {
    let edges = [edge("e1", "a", "b"), edge("e2", "a", "c")];
    let graph = graph(&["a", "b", "c"], &edges);
    let valid = observation(
        &edges[0],
        identity("p1", "a", 1),
        UpstreamOutcome::Open,
        None,
    );
    let duplicate = evaluate_dependencies(
        &graph,
        &[
            valid.clone(),
            valid,
            observation(
                &edges[1],
                identity("p1", "a", 1),
                accepted(identity("p1", "a", 1), 2),
                None,
            ),
        ],
        revision(1),
    )
    .expect("malformed observations remain readable per edge");
    assert!(matches!(
        &duplicate.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::MalformedObservation { diagnostic }
        } if diagnostic.code() == "duplicate_dependency_observation"
    ));
    assert_eq!(duplicate.edges[0].raw_observations.len(), 2);
    assert!(duplicate.edges[0].diagnostic.is_some());
    assert!(!duplicate.satisfied());
    assert!(duplicate.edges[1].satisfaction.is_satisfied());

    let stale = DependencyObservation {
        edge_revision: revision(2),
        ..observation(
            &edges[0],
            identity("p1", "a", 1),
            UpstreamOutcome::Open,
            None,
        )
    };
    let stale_evaluation = evaluate_dependencies(&graph, &[stale.clone()], revision(2))
        .expect("stale edge observations remain readable");
    assert!(matches!(
        &stale_evaluation.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::MalformedObservation { diagnostic }
        } if matches!(**diagnostic, DependencyEvaluationError::ObservationEdgeRevisionMismatch { .. })
    ));
    assert_eq!(stale_evaluation.edges[0].raw_observations, vec![stale]);
    assert_eq!(stale_evaluation.diagnostics.len(), 1);

    let unknown = DependencyObservation {
        edge_id: dependency("unknown"),
        ..observation(
            &edges[0],
            identity("p1", "a", 1),
            UpstreamOutcome::Open,
            None,
        )
    };
    let unknown_evaluation = evaluate_dependencies(&graph, &[unknown.clone()], revision(1))
        .expect("unknown observations remain in aggregate diagnostics");
    assert!(!unknown_evaluation.satisfied());
    assert_eq!(unknown_evaluation.diagnostics[0].raw, unknown);
}

#[test]
fn unreadable_corrupt_and_stale_prerequisites_retain_typed_raw_context_without_progress() {
    let edge = edge("e1", "a", "b");
    let graph = graph(&["a", "b"], std::slice::from_ref(&edge));
    let predecessor = identity("p1", "a", 4);
    let cases = [
        UpstreamOutcome::Unreadable(UnreadablePrerequisite {
            reason: UnreadableReason::Corrupt,
            raw: raw_prerequisite(&edge, &predecessor, "truncated-close-row"),
        }),
        UpstreamOutcome::Corrupt(CorruptPrerequisite {
            detail: "accepted outcome payload checksum mismatch".to_owned(),
            raw: raw_prerequisite(&edge, &predecessor, "checksum:mismatch"),
        }),
        UpstreamOutcome::Stale(StalePrerequisite {
            expected: revision(5),
            observed: revision(4),
            raw: raw_prerequisite(&edge, &predecessor, "snapshot:4"),
        }),
    ];

    for outcome in cases {
        let expected_payload = match &outcome {
            UpstreamOutcome::Unreadable(diagnostic) => diagnostic.raw.payload.clone(),
            UpstreamOutcome::Corrupt(diagnostic) => diagnostic.raw.payload.clone(),
            UpstreamOutcome::Stale(diagnostic) => diagnostic.raw.payload.clone(),
            _ => unreachable!("fixture only contains integrity diagnostics"),
        };
        let evaluation = evaluate_dependencies(
            &graph,
            &[observation(
                &edge,
                predecessor.clone(),
                outcome,
                Some(waiver(&edge, "must-not-override-integrity")),
            )],
            revision(10),
        )
        .expect("typed prerequisite diagnostics remain readable");
        assert!(!evaluation.satisfied());
        assert_eq!(evaluation.edges[0].raw_observations.len(), 1);
        assert_eq!(
            evaluation.edges[0].raw_observations[0].outcome.clone(),
            evaluation.edges[0].outcome.clone().expect("raw outcome")
        );
        assert!(evaluation.edges[0].outcome.as_ref().is_some_and(|outcome| {
            match outcome {
                UpstreamOutcome::Unreadable(diagnostic) => {
                    diagnostic.raw.payload == expected_payload
                }
                UpstreamOutcome::Corrupt(diagnostic) => diagnostic.raw.payload == expected_payload,
                UpstreamOutcome::Stale(diagnostic) => diagnostic.raw.payload == expected_payload,
                _ => false,
            }
        }));
        assert!(matches!(
            evaluation.edges[0].satisfaction,
            EdgeSatisfaction::Unmet {
                reason: UnmetReason::PrerequisiteUnreadable { .. }
                    | UnmetReason::PrerequisiteCorrupt { .. }
                    | UnmetReason::PrerequisiteStale { .. }
            }
        ));
    }
}

#[test]
fn waiver_revocation_requires_current_matching_waived_satisfaction() {
    let edge = edge("e1", "a", "b");
    let graph = graph(&["a", "b"], std::slice::from_ref(&edge));
    let facts = [SuccessorFacts {
        work_id: work("b"),
        lifecycle: PersistedLifecycle::Open,
        active_attempt: false,
        pending_close_intent: false,
        pending_review: false,
    }];
    let invalidation = DependencyInvalidation::WaiverRevoked {
        edge_id: dependency("e1"),
        edge_revision: revision(1),
        project_id: project("p1"),
        successor: work("b"),
    };

    let no_waiver = dependency_impact(
        &graph,
        &[observation(
            &edge,
            identity("p1", "a", 1),
            UpstreamOutcome::Open,
            None,
        )],
        &facts,
        invalidation.clone(),
        revision(2),
    )
    .expect_err("nonexistent waiver cannot invalidate an edge");
    assert!(matches!(
        no_waiver,
        boreal_domain::dependencies::DependencyImpactError::WaiverNotCurrent { .. }
    ));

    let accepted_with_stale_waiver = dependency_impact(
        &graph,
        &[observation(
            &edge,
            identity("p1", "a", 1),
            accepted(identity("p1", "a", 1), 2),
            Some(waiver(&edge, "not-currently-satisfying")),
        )],
        &facts,
        invalidation.clone(),
        revision(2),
    )
    .expect_err("an accepted close with a non-current waiver is not revocation target");
    assert!(matches!(
        accepted_with_stale_waiver,
        boreal_domain::dependencies::DependencyImpactError::WaiverNotCurrent { .. }
    ));

    let valid = dependency_impact(
        &graph,
        &[observation(
            &edge,
            identity("p1", "a", 1),
            UpstreamOutcome::Open,
            Some(waiver(&edge, "current")),
        )],
        &facts,
        invalidation,
        revision(2),
    )
    .expect("current waived satisfaction can be revoked");
    assert_eq!(valid.invalidated_edges, vec![dependency("e1")]);
}

#[test]
fn waiver_revocation_roots_successor_and_excludes_predecessor_siblings() {
    let edges = [
        edge("e1", "a", "b"),
        edge("e2", "a", "x"),
        edge("e3", "b", "c"),
    ];
    let graph = graph(&["a", "b", "c", "x"], &edges);
    let a = identity("p1", "a", 1);
    let b = identity("p1", "b", 2);
    let observations = [
        observation(
            &edges[0],
            a.clone(),
            UpstreamOutcome::Open,
            Some(waiver(&edges[0], "current")),
        ),
        observation(&edges[1], a, accepted(identity("p1", "a", 1), 3), None),
        observation(&edges[2], b.clone(), accepted(b, 4), None),
    ];
    let facts = [
        SuccessorFacts {
            work_id: work("b"),
            lifecycle: PersistedLifecycle::Open,
            active_attempt: false,
            pending_close_intent: false,
            pending_review: false,
        },
        SuccessorFacts {
            work_id: work("c"),
            lifecycle: PersistedLifecycle::Closed,
            active_attempt: false,
            pending_close_intent: false,
            pending_review: false,
        },
        SuccessorFacts {
            work_id: work("x"),
            lifecycle: PersistedLifecycle::Closed,
            active_attempt: false,
            pending_close_intent: false,
            pending_review: false,
        },
    ];
    let impact = dependency_impact(
        &graph,
        &observations,
        &facts,
        DependencyInvalidation::WaiverRevoked {
            edge_id: dependency("e1"),
            edge_revision: revision(1),
            project_id: project("p1"),
            successor: work("b"),
        },
        revision(2),
    )
    .expect("current waiver revocation has bounded impact");

    assert_eq!(impact.affected_subgraph.roots, vec![work("b")]);
    assert_eq!(
        impact
            .affected_subgraph
            .nodes
            .iter()
            .map(|node| node.work_id.clone())
            .collect::<Vec<_>>(),
        vec![work("c")]
    );
    assert_eq!(
        impact
            .affected_subgraph
            .edges
            .iter()
            .map(|edge| edge.id.clone())
            .collect::<Vec<_>>(),
        vec![dependency("e3")]
    );
    assert_eq!(
        impact.invalidated_edges,
        vec![dependency("e1"), dependency("e3")]
    );
    assert!(!impact
        .successors
        .iter()
        .any(|successor| successor.work_id == work("x")));
}

#[test]
fn missing_observation_is_a_deterministic_unmet_prerequisite() {
    let edge = edge("e1", "a", "b");
    let graph = graph(&["a", "b"], std::slice::from_ref(&edge));
    let evaluation = evaluate_dependencies(&graph, &[], revision(1)).expect("missing is readable");
    assert!(!evaluation.satisfied());
    assert_eq!(evaluation.unmet().count(), 1);
    assert!(matches!(
        evaluation.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::ObservationMissing
        }
    ));
}

#[test]
fn deterministic_graph_keeps_all_nodes_and_edges_canonical() {
    let edges = [edge("e2", "b", "c"), edge("e1", "a", "b")];
    let graph = graph(&["c", "a", "b"], &edges);
    assert_eq!(
        graph
            .nodes()
            .iter()
            .map(|node| node.work_id.as_str())
            .collect::<Vec<_>>(),
        vec!["a", "b", "c"]
    );
    assert_eq!(
        graph
            .edges()
            .iter()
            .map(|edge| edge.id.as_str())
            .collect::<Vec<_>>(),
        vec!["e1", "e2"]
    );
}

#[test]
fn structural_preview_can_be_used_without_mutating_any_successor_fact() {
    let edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    let graph = graph(&["a", "b", "c"], &edges);
    let preview = affected_subgraph(&graph, &[work("a")]).expect("root is known");
    let snapshot = preview.clone();
    assert_eq!(preview, snapshot);
    assert_eq!(
        preview
            .nodes
            .iter()
            .map(|node| node.work_id.as_str())
            .collect::<Vec<_>>(),
        vec!["b", "c"]
    );
}

#[allow(dead_code)]
fn _type_check_only() -> Option<AffectedSubgraph> {
    None
}

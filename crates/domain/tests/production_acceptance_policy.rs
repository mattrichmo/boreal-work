//! Focused pure-domain acceptance interpretation coverage for PF-S03-T04.
//!
use std::collections::BTreeSet;

use boreal_domain::acceptance::*;
use boreal_domain::decision_inputs::{
    AttemptFence, AttemptIdentity, ContentDigest, EntityIdentity, EntityRevision, ProfileIdentity,
    ProofIdentity, ProofRevision, RequirementId, ReviewId, ReviewRequirementPolicy, SubmissionId,
    VerifierPolicy, VerifierPolicyId,
};
use boreal_domain::{
    ActorId, ActorRole, AttemptId, ConfigIdentity, GateId, GateKind, ProjectId, SourceVersionId,
    TimestampMs, WorkId,
};

fn profile() -> ProfileIdentity {
    ProfileIdentity::new(
        boreal_domain::ProfileId::new("reviewed"),
        "1",
        ContentDigest::new("sha256:profile"),
    )
}

fn task_subject() -> AcceptanceSubject {
    let attempt = AttemptIdentity::new(AttemptId::new("attempt-1"), AttemptFence::new(4));
    let proof = ProofIdentity::new(
        EntityIdentity::new(
            ProjectId::new("project-1"),
            WorkId::new("task-1"),
            EntityRevision::new(7),
        ),
        ProofRevision::new(3),
        Some(attempt.clone()),
        SourceVersionId::new("source-1"),
        ConfigIdentity::new("config-1"),
        profile(),
        "policy-1",
    );
    AcceptanceSubject::task(proof, attempt).unwrap()
}

fn container_subject() -> AcceptanceSubject {
    let proof = ProofIdentity::new(
        EntityIdentity::new(
            ProjectId::new("project-1"),
            WorkId::new("milestone-1"),
            EntityRevision::new(2),
        ),
        ProofRevision::new(5),
        None,
        SourceVersionId::new("source-1"),
        ConfigIdentity::new("config-1"),
        profile(),
        "policy-1",
    );
    AcceptanceSubject::container(proof, CloseoutId::new("closeout-1"), EntityRevision::new(9))
        .unwrap()
}

fn reference(
    subject: &AcceptanceSubject,
    id: &str,
    gate: &str,
    kind: GateKind,
) -> RequirementReference {
    RequirementReference {
        id: RequirementId::new(id),
        gate_id: GateId::new(gate),
        kind,
        profile: subject.proof.profile.clone(),
        declaration_digest: ContentDigest::new(format!("sha256:decl-{id}")),
    }
}

fn declaration(
    subject: &AcceptanceSubject,
    id: &str,
    gate: &str,
    kind: GateKind,
    purpose: RequirementPurpose,
) -> RequirementDeclaration {
    RequirementDeclaration::present(RequirementDeclarationBody {
        reference: reference(subject, id, gate, kind),
        subject: subject.clone(),
        purpose,
        required: true,
        verifier_policy: VerifierPolicy {
            id: VerifierPolicyId::new("trusted"),
            version: "1".to_owned(),
        },
        required_observables: BTreeSet::from(["exit_status".to_owned()]),
        review_policy: if kind == GateKind::Review {
            ReviewRequirementPolicy::Independent
        } else {
            ReviewRequirementPolicy::NotRequired
        },
    })
}

fn evidence(
    subject: &AcceptanceSubject,
    requirement: RequirementReference,
    id: &str,
    observed_at: u64,
    result: EvidenceResult,
) -> EvidenceObservation {
    EvidenceObservation {
        id: EvidenceId::new(id),
        requirement,
        subject: subject.clone(),
        observed_at: TimestampMs::from_millis(observed_at),
        result,
        disposition: EvidenceDisposition::Current,
        observables: BTreeSet::from(["exit_status".to_owned()]),
        artifact_digest: Some(ContentDigest::new("sha256:artifact")),
        attested: true,
    }
}

fn input(
    subject: AcceptanceSubject,
    declarations: Vec<RequirementDeclaration>,
    evidence: Vec<EvidenceObservation>,
) -> AcceptanceInput {
    AcceptanceInput {
        subject,
        current_submission_id: SubmissionId::new("submission-1"),
        declarations,
        evidence,
        reviews: Vec::new(),
        exceptions: Vec::new(),
        evaluated_at: TimestampMs::from_millis(100),
    }
}

#[test]
fn complete_subject_filter_precedes_recency_and_keeps_unrelated_receipt_irrelevant() {
    let subject = task_subject();
    let requirement = reference(&subject, "verify", "verification", GateKind::Verification);
    let mut foreign = subject.clone();
    foreign.proof.entity.work_id = WorkId::new("other-task");
    let current = evidence(
        &subject,
        requirement.clone(),
        "current-pass",
        10,
        EvidenceResult::Passed,
    );
    let unrelated = evidence(
        &foreign,
        requirement.clone(),
        "newer-foreign-pass",
        99,
        EvidenceResult::Passed,
    );
    let interpretation = interpret_acceptance(&input(
        subject.clone(),
        vec![declaration(
            &subject,
            "verify",
            "verification",
            GateKind::Verification,
            RequirementPurpose::TaskProof,
        )],
        vec![current, unrelated],
    ));

    let assessment = interpretation
        .assessment(&RequirementId::new("verify"))
        .unwrap();
    assert_eq!(
        assessment.raw,
        RawRequirementState::Passed(EvidenceId::new("current-pass"))
    );
    assert!(interpretation.diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        AcceptanceDiagnostic::IrrelevantEvidence { evidence_id, reason: IrrelevantProofReason::ForeignWork }
            if evidence_id.as_str() == "newer-foreign-pass"
    )));
}

#[test]
fn deleted_and_mismatched_declarations_fail_closed_without_zero_gate_profile() {
    let subject = task_subject();
    let deleted_ref = reference(&subject, "deleted", "verification", GateKind::Verification);
    let expected = reference(&subject, "changed", "verification", GateKind::Verification);
    let observed = reference(&subject, "changed", "verification", GateKind::Checkpoint);
    let interpretation = interpret_acceptance(&input(
        subject.clone(),
        vec![
            RequirementDeclaration::deleted(deleted_ref.clone()),
            RequirementDeclaration::mismatched(expected.clone(), observed.clone()),
        ],
        Vec::new(),
    ));

    assert!(!interpretation.required_satisfied());
    assert!(interpretation.requirements.iter().any(|item| matches!(
        item.raw,
        RawRequirementState::Declaration(DeclarationProblem::Deleted)
    )));
    assert!(interpretation.requirements.iter().any(|item| matches!(
        item.raw,
        RawRequirementState::Declaration(DeclarationProblem::Mismatched)
    )));
    assert!(interpretation.diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        AcceptanceDiagnostic::DeclarationMismatch { requirement, observed: actual }
            if requirement == &expected && actual == &observed
    )));
}

#[test]
fn evidence_with_wrong_version_is_mismatched_not_a_new_passing_gate() {
    let subject = task_subject();
    let declared = reference(&subject, "verify", "verification", GateKind::Verification);
    let mut observed = declared;
    observed.profile.version = "2".to_owned();
    let interpretation = interpret_acceptance(&input(
        subject.clone(),
        vec![declaration(
            &subject,
            "verify",
            "verification",
            GateKind::Verification,
            RequirementPurpose::TaskProof,
        )],
        vec![evidence(
            &subject,
            observed,
            "wrong-version",
            10,
            EvidenceResult::Passed,
        )],
    ));
    assert!(matches!(
        interpretation
            .assessment(&RequirementId::new("verify"))
            .unwrap()
            .raw,
        RawRequirementState::Declaration(DeclarationProblem::Mismatched)
    ));
    assert!(!interpretation.required_satisfied());
}

#[test]
fn duplicate_pinned_declarations_fail_closed() {
    let subject = task_subject();
    let requirement = declaration(
        &subject,
        "verify",
        "verification",
        GateKind::Verification,
        RequirementPurpose::TaskProof,
    );
    let interpretation = interpret_acceptance(&input(
        subject,
        vec![requirement.clone(), requirement],
        Vec::new(),
    ));
    assert!(!interpretation.required_satisfied());
    assert!(interpretation
        .diagnostics
        .iter()
        .any(|diagnostic| matches!(diagnostic, AcceptanceDiagnostic::DuplicateRequirement(_))));
}

#[test]
fn failed_stale_altered_and_missing_proof_are_distinct() {
    let subject = task_subject();
    let failed_ref = reference(&subject, "failed", "failed", GateKind::Verification);
    let stale_ref = reference(&subject, "stale", "stale", GateKind::Verification);
    let altered_ref = reference(&subject, "altered", "altered", GateKind::Verification);
    let stale = evidence(
        &subject,
        stale_ref.clone(),
        "stale-proof",
        2,
        EvidenceResult::Stale,
    );
    let interpretation = interpret_acceptance(&input(
        subject.clone(),
        vec![
            declaration(
                &subject,
                "failed",
                "failed",
                GateKind::Verification,
                RequirementPurpose::TaskProof,
            ),
            declaration(
                &subject,
                "stale",
                "stale",
                GateKind::Verification,
                RequirementPurpose::TaskProof,
            ),
            declaration(
                &subject,
                "altered",
                "altered",
                GateKind::Verification,
                RequirementPurpose::TaskProof,
            ),
            declaration(
                &subject,
                "missing",
                "missing",
                GateKind::Verification,
                RequirementPurpose::TaskProof,
            ),
        ],
        vec![
            evidence(
                &subject,
                failed_ref,
                "failed-proof",
                3,
                EvidenceResult::Failed(EvidenceFailureReason::NonZeroExit),
            ),
            stale,
            evidence(
                &subject,
                altered_ref,
                "altered-proof",
                4,
                EvidenceResult::Altered,
            ),
        ],
    ));

    assert!(matches!(
        interpretation
            .assessment(&RequirementId::new("failed"))
            .unwrap()
            .raw,
        RawRequirementState::Failed { .. }
    ));
    assert!(matches!(
        interpretation
            .assessment(&RequirementId::new("stale"))
            .unwrap()
            .raw,
        RawRequirementState::Stale { .. }
    ));
    assert!(matches!(
        interpretation
            .assessment(&RequirementId::new("altered"))
            .unwrap()
            .raw,
        RawRequirementState::Altered(_)
    ));
    assert_eq!(
        interpretation
            .assessment(&RequirementId::new("missing"))
            .unwrap()
            .raw,
        RawRequirementState::Missing
    );
}

#[test]
fn newer_invalidated_exact_observations_do_not_shadow_older_valid_pass() {
    for (disposition, expected_diagnostic) in [
        (
            EvidenceDisposition::Superseded,
            AcceptanceDiagnostic::StaleEvidence {
                evidence_id: EvidenceId::new("invalidated-proof"),
                reason: StaleProofReason::Superseded,
            },
        ),
        (
            EvidenceDisposition::Late,
            AcceptanceDiagnostic::StaleEvidence {
                evidence_id: EvidenceId::new("invalidated-proof"),
                reason: StaleProofReason::Late,
            },
        ),
        (
            EvidenceDisposition::Revoked,
            AcceptanceDiagnostic::AlteredEvidence(EvidenceId::new("invalidated-proof")),
        ),
    ] {
        let subject = task_subject();
        let requirement = reference(&subject, "verify", "verification", GateKind::Verification);
        let mut invalidated = evidence(
            &subject,
            requirement.clone(),
            "invalidated-proof",
            99,
            EvidenceResult::Passed,
        );
        invalidated.disposition = disposition;
        let interpretation = interpret_acceptance(&input(
            subject.clone(),
            vec![declaration(
                &subject,
                "verify",
                "verification",
                GateKind::Verification,
                RequirementPurpose::TaskProof,
            )],
            vec![
                evidence(
                    &subject,
                    requirement,
                    "valid-proof",
                    10,
                    EvidenceResult::Passed,
                ),
                invalidated,
            ],
        ));

        let assessment = interpretation
            .assessment(&RequirementId::new("verify"))
            .unwrap();
        assert_eq!(
            assessment.raw,
            RawRequirementState::Passed(EvidenceId::new("valid-proof"))
        );
        assert!(interpretation.required_satisfied());
        assert!(interpretation
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic == &expected_diagnostic));
    }
}

#[test]
fn valid_force_exception_satisfies_effective_gate_but_retains_raw_failure() {
    let subject = task_subject();
    let requirement = reference(&subject, "verify", "verification", GateKind::Verification);
    let mut acceptance = input(
        subject.clone(),
        vec![declaration(
            &subject,
            "verify",
            "verification",
            GateKind::Verification,
            RequirementPurpose::TaskProof,
        )],
        vec![evidence(
            &subject,
            requirement.clone(),
            "failed-proof",
            3,
            EvidenceResult::Failed(EvidenceFailureReason::VerifierRejected),
        )],
    );
    acceptance.exceptions.push(ForceException {
        id: ExceptionId::new("EX-17"),
        requirement,
        subject: subject.clone(),
        actor_id: ActorId::new("operator-1"),
        actor_role: ActorRole::Operator,
        reason: ExceptionReason::RiskAccepted,
        comment: "bounded risk accepted for this proof generation".to_owned(),
        expires_at: None,
        revoked: false,
    });

    let interpretation = interpret_acceptance(&acceptance);
    let assessment = interpretation
        .assessment(&RequirementId::new("verify"))
        .unwrap();
    assert!(matches!(assessment.raw, RawRequirementState::Failed { .. }));
    assert_eq!(
        assessment.effective,
        EffectiveRequirementState::SatisfiedByException(ExceptionId::new("EX-17"))
    );
    assert!(interpretation.required_satisfied());
}

#[test]
fn invalid_force_exception_does_not_bypass_failure() {
    let subject = task_subject();
    let requirement = reference(&subject, "verify", "verification", GateKind::Verification);
    let mut acceptance = input(
        subject.clone(),
        vec![declaration(
            &subject,
            "verify",
            "verification",
            GateKind::Verification,
            RequirementPurpose::TaskProof,
        )],
        vec![evidence(
            &subject,
            requirement.clone(),
            "failed-proof",
            3,
            EvidenceResult::Failed(EvidenceFailureReason::NonZeroExit),
        )],
    );
    acceptance.exceptions.push(ForceException {
        id: ExceptionId::new("EX-bad"),
        requirement,
        subject,
        actor_id: ActorId::new("agent-1"),
        actor_role: ActorRole::Agent,
        reason: ExceptionReason::RiskAccepted,
        comment: "not an operator decision".to_owned(),
        expires_at: None,
        revoked: false,
    });

    let interpretation = interpret_acceptance(&acceptance);
    assert!(!interpretation.required_satisfied());
    assert!(interpretation.diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        AcceptanceDiagnostic::InvalidException { exception_id, reason: ExceptionInvalidReason::WrongRole }
            if exception_id.as_str() == "EX-bad"
    )));
}

#[test]
fn self_review_is_rejected_and_not_reported_as_missing_review() {
    let subject = task_subject();
    let requirement = reference(&subject, "review", "independent-review", GateKind::Review);
    let mut acceptance = input(
        subject.clone(),
        vec![declaration(
            &subject,
            "review",
            "independent-review",
            GateKind::Review,
            RequirementPurpose::TaskProof,
        )],
        Vec::new(),
    );
    acceptance.reviews.push(ReviewDecision {
        id: ReviewId::new("review-1"),
        requirement,
        subject,
        submission_id: SubmissionId::new("submission-1"),
        reviewer_id: ActorId::new("agent-1"),
        reviewer_role: ActorRole::Reviewer,
        attempt_actor_id: ActorId::new("agent-1"),
        outcome: ReviewOutcome::Approved,
        decided_at: TimestampMs::from_millis(4),
        reason: "self approval".to_owned(),
    });

    let interpretation = interpret_acceptance(&acceptance);
    let assessment = interpretation
        .assessment(&RequirementId::new("review"))
        .unwrap();
    assert_eq!(
        assessment.raw,
        RawRequirementState::Review(ReviewState::SelfReviewRejected(ReviewId::new("review-1")))
    );
    assert!(!interpretation.required_satisfied());
    assert!(!matches!(
        assessment.raw,
        RawRequirementState::Review(ReviewState::Missing)
    ));
}

#[test]
fn newer_approval_for_another_submission_cannot_satisfy_current_review() {
    let subject = task_subject();
    let requirement = reference(&subject, "review", "independent-review", GateKind::Review);
    let mut acceptance = input(
        subject.clone(),
        vec![declaration(
            &subject,
            "review",
            "independent-review",
            GateKind::Review,
            RequirementPurpose::TaskProof,
        )],
        Vec::new(),
    );
    acceptance.reviews.push(ReviewDecision {
        id: ReviewId::new("foreign-review"),
        requirement,
        subject,
        submission_id: SubmissionId::new("newer-submission"),
        reviewer_id: ActorId::new("reviewer-1"),
        reviewer_role: ActorRole::Reviewer,
        attempt_actor_id: ActorId::new("agent-1"),
        outcome: ReviewOutcome::Approved,
        decided_at: TimestampMs::from_millis(99),
        reason: "approved a different sealed submission".to_owned(),
    });

    let interpretation = interpret_acceptance(&acceptance);
    let assessment = interpretation
        .assessment(&RequirementId::new("review"))
        .unwrap();
    assert_eq!(
        assessment.raw,
        RawRequirementState::Review(ReviewState::Irrelevant(ReviewId::new("foreign-review")))
    );
    assert!(!interpretation.required_satisfied());
}

#[test]
fn task_and_container_closeout_requirements_cannot_substitute_for_each_other() {
    let task = task_subject();
    let task_interpretation = interpret_acceptance(&input(
        task.clone(),
        vec![declaration(
            &task,
            "scope",
            "scope",
            GateKind::Checkpoint,
            RequirementPurpose::ContainerScope,
        )],
        Vec::new(),
    ));
    assert!(matches!(
        task_interpretation.closeout,
        CloseoutAssessment::Task { .. }
    ));
    assert!(!task_interpretation.required_satisfied());
    assert!(task_interpretation
        .diagnostics
        .iter()
        .any(|diagnostic| matches!(
            diagnostic,
            AcceptanceDiagnostic::InvalidCloseoutRequirement(id) if id.as_str() == "scope"
        )));

    let container = container_subject();
    let container_interpretation = interpret_acceptance(&input(
        container.clone(),
        vec![
            declaration(
                &container,
                "scope",
                "scope",
                GateKind::Checkpoint,
                RequirementPurpose::ContainerScope,
            ),
            declaration(
                &container,
                "summary",
                "summary",
                GateKind::Summary,
                RequirementPurpose::CloseoutSummary,
            ),
        ],
        Vec::new(),
    ));
    assert!(matches!(
        container_interpretation.closeout,
        CloseoutAssessment::Container {
            attempt_policy: ContainerAttemptPolicy::Forbidden,
            ..
        }
    ));
    assert_eq!(
        container_interpretation.closeout.container_attempt_policy(),
        Some(ContainerAttemptPolicy::Forbidden)
    );
}

#[test]
fn container_subject_rejects_attempt_bound_proof_at_construction() {
    let subject = task_subject();
    assert_eq!(
        AcceptanceSubject::container(
            subject.proof,
            CloseoutId::new("closeout-1"),
            EntityRevision::new(1),
        )
        .unwrap_err(),
        SubjectValidationError::ContainerProofCannotBindAttempt
    );
}

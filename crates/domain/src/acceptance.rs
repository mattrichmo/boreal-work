//! Pure interpretation of pinned requirements, proof, reviews, and closeout.
//!
//! This module is intentionally narrower than the application/store evidence
//! runners.  It receives immutable, typed facts and decides which facts are
//! relevant to one complete proof subject.  It never turns a failure into a
//! passing observation: a scoped exception can change the effective result,
//! but the raw failure and exception identity remain visible.

use std::collections::BTreeSet;

use crate::decision_inputs::{
    AttemptFence, AttemptIdentity, ContentDigest, EntityRevision, ProfileIdentity, ProofIdentity,
    RequirementId, ReviewId, ReviewRequirementPolicy, SubmissionId, VerifierPolicy,
};
use crate::{ActorId, ActorRole, GateId, GateKind, ProjectId, TimestampMs, WorkId};

macro_rules! acceptance_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self::new(value)
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self::new(value)
            }
        }
    };
}

acceptance_id!(EvidenceId);
acceptance_id!(CloseoutId);
acceptance_id!(ExceptionId);

/// Proof may be produced by a fenced task attempt or by a container's own
/// closeout evaluation.  The two contexts are deliberately not interchangeable.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ProofContext {
    TaskAttempt {
        attempt: AttemptIdentity,
    },
    ContainerCloseout {
        closeout_id: CloseoutId,
        scope_revision: EntityRevision,
    },
}

impl ProofContext {
    pub fn task(attempt: AttemptIdentity) -> Self {
        Self::TaskAttempt { attempt }
    }

    pub fn container(closeout_id: CloseoutId, scope_revision: EntityRevision) -> Self {
        Self::ContainerCloseout {
            closeout_id,
            scope_revision,
        }
    }

    pub fn is_task(&self) -> bool {
        matches!(self, Self::TaskAttempt { .. })
    }

    pub fn is_container(&self) -> bool {
        matches!(self, Self::ContainerCloseout { .. })
    }
}

/// The complete subject required before proof recency is considered.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AcceptanceSubject {
    pub proof: ProofIdentity,
    pub context: ProofContext,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubjectValidationError {
    TaskProofMustBindAttempt,
    ContainerProofCannotBindAttempt,
}

impl AcceptanceSubject {
    pub fn task(
        proof: ProofIdentity,
        attempt: AttemptIdentity,
    ) -> Result<Self, SubjectValidationError> {
        if proof.attempt.as_ref() != Some(&attempt) {
            return Err(SubjectValidationError::TaskProofMustBindAttempt);
        }
        Ok(Self {
            proof,
            context: ProofContext::TaskAttempt { attempt },
        })
    }

    pub fn container(
        proof: ProofIdentity,
        closeout_id: CloseoutId,
        scope_revision: EntityRevision,
    ) -> Result<Self, SubjectValidationError> {
        if proof.attempt.is_some() {
            return Err(SubjectValidationError::ContainerProofCannotBindAttempt);
        }
        Ok(Self {
            proof,
            context: ProofContext::ContainerCloseout {
                closeout_id,
                scope_revision,
            },
        })
    }

    pub fn project_id(&self) -> &ProjectId {
        &self.proof.entity.project_id
    }

    pub fn work_id(&self) -> &WorkId {
        &self.proof.entity.work_id
    }

    pub fn is_task(&self) -> bool {
        self.context.is_task()
    }

    pub fn is_container(&self) -> bool {
        self.context.is_container()
    }

    fn same_work_and_attempt(&self, other: &Self) -> bool {
        self.proof.entity.project_id == other.proof.entity.project_id
            && self.proof.entity.work_id == other.proof.entity.work_id
            && matches!(
                (&self.context, &other.context),
                (
                    ProofContext::TaskAttempt { .. },
                    ProofContext::TaskAttempt { .. }
                ) | (
                    ProofContext::ContainerCloseout { .. },
                    ProofContext::ContainerCloseout { .. },
                )
            )
    }
}

/// The immutable identity of one pinned declaration.  A receipt/review must
/// carry the complete identity, not only a local gate string.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequirementReference {
    pub id: RequirementId,
    pub gate_id: GateId,
    pub kind: GateKind,
    pub profile: ProfileIdentity,
    pub declaration_digest: ContentDigest,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum RequirementPurpose {
    TaskProof,
    ContainerScope,
    CloseoutSummary,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequirementDeclarationBody {
    pub reference: RequirementReference,
    pub subject: AcceptanceSubject,
    pub purpose: RequirementPurpose,
    pub required: bool,
    pub verifier_policy: VerifierPolicy,
    pub required_observables: BTreeSet<String>,
    pub review_policy: ReviewRequirementPolicy,
}

/// A deleted declaration is retained as a typed historical fact.  It does not
/// silently become an empty profile, and an altered definition never matches a
/// result written under the previous identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequirementDeclaration {
    Present(RequirementDeclarationBody),
    Deleted {
        expected: RequirementReference,
    },
    Mismatched {
        expected: RequirementReference,
        observed: RequirementReference,
    },
}

impl RequirementDeclaration {
    pub fn present(body: RequirementDeclarationBody) -> Self {
        Self::Present(body)
    }

    pub fn deleted(expected: RequirementReference) -> Self {
        Self::Deleted { expected }
    }

    pub fn mismatched(expected: RequirementReference, observed: RequirementReference) -> Self {
        Self::Mismatched { expected, observed }
    }

    pub fn reference(&self) -> &RequirementReference {
        match self {
            Self::Present(body) => &body.reference,
            Self::Deleted { expected } | Self::Mismatched { expected, .. } => expected,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvidenceFailureReason {
    NonZeroExit,
    VerifierRejected,
    UnknownOutcome,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvidenceDisposition {
    Current,
    Superseded,
    Revoked,
    Late,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvidenceResult {
    Passed,
    Failed(EvidenceFailureReason),
    Stale,
    Altered,
}

/// An immutable observation.  Mismatched observations are retained and are
/// classified by the interpreter; they are never removed before selection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceObservation {
    pub id: EvidenceId,
    pub requirement: RequirementReference,
    pub subject: AcceptanceSubject,
    pub observed_at: TimestampMs,
    pub result: EvidenceResult,
    pub disposition: EvidenceDisposition,
    pub observables: BTreeSet<String>,
    pub artifact_digest: Option<ContentDigest>,
    pub attested: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewOutcome {
    Pending,
    Approved,
    Rejected,
    Returned,
    Revoked,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewDecision {
    pub id: ReviewId,
    pub requirement: RequirementReference,
    pub subject: AcceptanceSubject,
    pub submission_id: SubmissionId,
    pub reviewer_id: ActorId,
    pub reviewer_role: ActorRole,
    pub attempt_actor_id: ActorId,
    pub outcome: ReviewOutcome,
    pub decided_at: TimestampMs,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExceptionReason {
    RiskAccepted,
    ExternalEvidence,
    SupersededWork,
    DuplicateWork,
    MigrationDisposition,
}

impl ExceptionReason {
    pub const fn code(self) -> &'static str {
        match self {
            Self::RiskAccepted => "risk_accepted",
            Self::ExternalEvidence => "external_evidence",
            Self::SupersededWork => "superseded_work",
            Self::DuplicateWork => "duplicate_work",
            Self::MigrationDisposition => "migration_disposition",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ForceException {
    pub id: ExceptionId,
    pub requirement: RequirementReference,
    pub subject: AcceptanceSubject,
    pub actor_id: ActorId,
    pub actor_role: ActorRole,
    pub reason: ExceptionReason,
    pub comment: String,
    pub expires_at: Option<TimestampMs>,
    pub revoked: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeclarationProblem {
    Missing,
    Deleted,
    Mismatched,
    Duplicate,
    WrongSubject,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StaleProofReason {
    Superseded,
    Late,
    SubjectRevision,
    ProofRevision,
    AttemptFence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IrrelevantProofReason {
    ForeignWork,
    WrongGate,
    WrongProfile,
    WrongContext,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReviewState {
    Missing,
    Pending(ReviewId),
    Approved(ReviewId),
    Rejected(ReviewId),
    Returned(ReviewId),
    Revoked(ReviewId),
    SelfReviewRejected(ReviewId),
    Unauthorized(ReviewId),
    Irrelevant(ReviewId),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RawRequirementState {
    Missing,
    Passed(EvidenceId),
    Failed {
        evidence_id: EvidenceId,
        reason: EvidenceFailureReason,
    },
    Stale {
        evidence_id: EvidenceId,
        reason: StaleProofReason,
    },
    Altered(EvidenceId),
    Irrelevant {
        evidence_id: EvidenceId,
        reason: IrrelevantProofReason,
    },
    Declaration(DeclarationProblem),
    Review(ReviewState),
}

impl RawRequirementState {
    pub fn is_unsatisfied(&self) -> bool {
        !matches!(
            self,
            Self::Passed(_) | Self::Review(ReviewState::Approved(_))
        )
    }

    pub fn evidence_id(&self) -> Option<&EvidenceId> {
        match self {
            Self::Passed(id)
            | Self::Altered(id)
            | Self::Failed {
                evidence_id: id, ..
            }
            | Self::Stale {
                evidence_id: id, ..
            }
            | Self::Irrelevant {
                evidence_id: id, ..
            } => Some(id),
            Self::Missing | Self::Declaration(_) | Self::Review(_) => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EffectiveRequirementState {
    Satisfied,
    SatisfiedByException(ExceptionId),
    Unsatisfied,
    NotRequired,
}

impl EffectiveRequirementState {
    pub fn is_satisfied(&self) -> bool {
        matches!(self, Self::Satisfied | Self::SatisfiedByException(_))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequirementAssessment {
    pub reference: RequirementReference,
    pub purpose: RequirementPurpose,
    pub required: bool,
    pub raw: RawRequirementState,
    pub effective: EffectiveRequirementState,
    pub exception_id: Option<ExceptionId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AcceptanceDiagnostic {
    EmptyRequirementSet,
    Declaration {
        requirement: RequirementReference,
        problem: DeclarationProblem,
    },
    DeclarationMismatch {
        requirement: RequirementReference,
        observed: RequirementReference,
    },
    WrongRequirementSubject(RequirementId),
    DuplicateRequirement(RequirementId),
    DuplicateEvidence(EvidenceId),
    DuplicateReview(ReviewId),
    IrrelevantEvidence {
        evidence_id: EvidenceId,
        reason: IrrelevantProofReason,
    },
    StaleEvidence {
        evidence_id: EvidenceId,
        reason: StaleProofReason,
    },
    AlteredEvidence(EvidenceId),
    SelfReviewRejected(ReviewId),
    ReviewUnauthorized(ReviewId),
    ReviewRejected(ReviewId),
    ReviewReturned(ReviewId),
    ReviewRevoked(ReviewId),
    InvalidException {
        exception_id: ExceptionId,
        reason: ExceptionInvalidReason,
    },
    InvalidCloseoutRequirement(RequirementId),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExceptionInvalidReason {
    WrongRole,
    EmptyComment,
    Expired,
    Revoked,
    WrongRequirement,
    WrongSubject,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CloseoutKind {
    Task,
    Container,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContainerAttemptPolicy {
    Forbidden,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CloseoutAssessment {
    Task {
        proof_requirements: Vec<RequirementId>,
        summary_requirements: Vec<RequirementId>,
        proof_satisfied: bool,
        summary_satisfied: bool,
    },
    Container {
        scope_requirements: Vec<RequirementId>,
        summary_requirements: Vec<RequirementId>,
        scope_satisfied: bool,
        summary_satisfied: bool,
        attempt_policy: ContainerAttemptPolicy,
    },
}

impl CloseoutAssessment {
    pub fn kind(&self) -> CloseoutKind {
        match self {
            Self::Task { .. } => CloseoutKind::Task,
            Self::Container { .. } => CloseoutKind::Container,
        }
    }

    pub fn container_attempt_policy(&self) -> Option<ContainerAttemptPolicy> {
        match self {
            Self::Container { attempt_policy, .. } => Some(*attempt_policy),
            Self::Task { .. } => None,
        }
    }

    pub fn is_ready(&self) -> bool {
        match self {
            Self::Task {
                proof_satisfied,
                summary_satisfied,
                ..
            } => *proof_satisfied && *summary_satisfied,
            Self::Container {
                scope_satisfied,
                summary_satisfied,
                ..
            } => *scope_satisfied && *summary_satisfied,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceInput {
    pub subject: AcceptanceSubject,
    /// The sealed submission whose evidence and review decisions are current.
    /// Review decisions for any other submission remain historical and cannot
    /// satisfy the declared review requirement.
    pub current_submission_id: SubmissionId,
    pub declarations: Vec<RequirementDeclaration>,
    pub evidence: Vec<EvidenceObservation>,
    pub reviews: Vec<ReviewDecision>,
    pub exceptions: Vec<ForceException>,
    pub evaluated_at: TimestampMs,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceInterpretation {
    pub subject: AcceptanceSubject,
    pub requirements: Vec<RequirementAssessment>,
    pub diagnostics: Vec<AcceptanceDiagnostic>,
    pub closeout: CloseoutAssessment,
}

impl AcceptanceInterpretation {
    pub fn required_satisfied(&self) -> bool {
        !self.has_blocking_declaration_issue()
            && self
                .requirements
                .iter()
                .filter(|item| item.required)
                .all(|item| item.effective.is_satisfied())
    }

    pub fn has_failures(&self) -> bool {
        self.requirements
            .iter()
            .any(|item| item.required && item.raw.is_unsatisfied())
    }

    pub fn assessment(&self, id: &RequirementId) -> Option<&RequirementAssessment> {
        self.requirements
            .iter()
            .find(|item| &item.reference.id == id)
    }

    pub fn effectively_satisfied(&self, id: &RequirementId) -> bool {
        self.assessment(id)
            .is_some_and(|item| item.effective.is_satisfied())
    }

    pub fn closeout_ready(&self) -> bool {
        self.required_satisfied() && self.closeout.is_ready()
    }

    fn has_blocking_declaration_issue(&self) -> bool {
        self.diagnostics.iter().any(|diagnostic| {
            matches!(
                diagnostic,
                AcceptanceDiagnostic::EmptyRequirementSet
                    | AcceptanceDiagnostic::Declaration { .. }
                    | AcceptanceDiagnostic::DeclarationMismatch { .. }
                    | AcceptanceDiagnostic::WrongRequirementSubject(_)
                    | AcceptanceDiagnostic::DuplicateRequirement(_)
                    | AcceptanceDiagnostic::DuplicateEvidence(_)
                    | AcceptanceDiagnostic::DuplicateReview(_)
                    | AcceptanceDiagnostic::InvalidCloseoutRequirement(_)
            )
        })
    }
}

/// Interpret all facts for one pinned proof subject.  Candidate filtering is
/// completed before recency ordering, so a newer foreign receipt cannot shadow
/// valid current-subject proof.
pub fn interpret_acceptance(input: &AcceptanceInput) -> AcceptanceInterpretation {
    let mut diagnostics = Vec::new();
    let mut seen_requirements = BTreeSet::new();
    let mut seen_evidence = BTreeSet::new();
    let mut seen_reviews = BTreeSet::new();

    if input.declarations.is_empty() {
        diagnostics.push(AcceptanceDiagnostic::EmptyRequirementSet);
    }

    for declaration in &input.declarations {
        let id = declaration.reference().id.clone();
        if !seen_requirements.insert(id.clone()) {
            diagnostics.push(AcceptanceDiagnostic::DuplicateRequirement(id));
        }
        if let RequirementDeclaration::Present(body) = declaration {
            if body.subject != input.subject {
                diagnostics.push(AcceptanceDiagnostic::WrongRequirementSubject(
                    body.reference.id.clone(),
                ));
            }
            if !purpose_matches_subject(body.purpose, &body.subject) {
                diagnostics.push(AcceptanceDiagnostic::InvalidCloseoutRequirement(
                    body.reference.id.clone(),
                ));
            }
        }
    }

    for evidence in &input.evidence {
        if !seen_evidence.insert(evidence.id.clone()) {
            diagnostics.push(AcceptanceDiagnostic::DuplicateEvidence(evidence.id.clone()));
        }
    }
    for review in &input.reviews {
        if !seen_reviews.insert(review.id.clone()) {
            diagnostics.push(AcceptanceDiagnostic::DuplicateReview(review.id.clone()));
        }
    }
    validate_exception_records(input, &mut diagnostics);

    let mut requirements = Vec::new();
    for declaration in &input.declarations {
        match declaration {
            RequirementDeclaration::Present(body) => {
                let (raw, requirement_diagnostics) = if body.subject != input.subject
                    || !purpose_matches_subject(body.purpose, &body.subject)
                {
                    (
                        RawRequirementState::Declaration(DeclarationProblem::WrongSubject),
                        Vec::new(),
                    )
                } else if body.reference.kind == GateKind::Review {
                    interpret_review(body, input, &mut diagnostics)
                } else {
                    interpret_evidence(body, input)
                };
                diagnostics.extend(requirement_diagnostics);
                requirements.push(assessment_for(
                    body.reference.clone(),
                    body.purpose,
                    body.required,
                    raw,
                    body,
                    input,
                    &mut diagnostics,
                ));
            }
            RequirementDeclaration::Deleted { expected } => {
                diagnostics.push(AcceptanceDiagnostic::Declaration {
                    requirement: expected.clone(),
                    problem: DeclarationProblem::Deleted,
                });
                requirements.push(RequirementAssessment {
                    reference: expected.clone(),
                    purpose: purpose_for_kind(expected.kind, input.subject.is_container()),
                    required: true,
                    raw: RawRequirementState::Declaration(DeclarationProblem::Deleted),
                    effective: EffectiveRequirementState::Unsatisfied,
                    exception_id: None,
                });
            }
            RequirementDeclaration::Mismatched { expected, observed } => {
                diagnostics.push(AcceptanceDiagnostic::DeclarationMismatch {
                    requirement: expected.clone(),
                    observed: observed.clone(),
                });
                requirements.push(RequirementAssessment {
                    reference: expected.clone(),
                    purpose: purpose_for_kind(expected.kind, input.subject.is_container()),
                    required: true,
                    raw: RawRequirementState::Declaration(DeclarationProblem::Mismatched),
                    effective: EffectiveRequirementState::Unsatisfied,
                    exception_id: None,
                });
            }
        }
    }

    // Evidence for an unknown requirement is retained as a diagnostic rather
    // than being allowed to create a new gate by observation alone.
    for evidence in &input.evidence {
        let declaration = input
            .declarations
            .iter()
            .find(|item| item.reference().id == evidence.requirement.id);
        match declaration {
            None if evidence.subject == input.subject => {
                diagnostics.push(AcceptanceDiagnostic::Declaration {
                    requirement: evidence.requirement.clone(),
                    problem: DeclarationProblem::Missing,
                })
            }
            None => diagnostics.push(AcceptanceDiagnostic::IrrelevantEvidence {
                evidence_id: evidence.id.clone(),
                reason: unmatched_evidence_reason(evidence, input),
            }),
            Some(RequirementDeclaration::Present(body))
                if body.reference != evidence.requirement =>
            {
                diagnostics.push(AcceptanceDiagnostic::DeclarationMismatch {
                    requirement: body.reference.clone(),
                    observed: evidence.requirement.clone(),
                });
            }
            Some(RequirementDeclaration::Deleted { expected }) => {
                diagnostics.push(AcceptanceDiagnostic::Declaration {
                    requirement: expected.clone(),
                    problem: DeclarationProblem::Deleted,
                });
            }
            Some(RequirementDeclaration::Mismatched { expected, observed }) => {
                diagnostics.push(AcceptanceDiagnostic::DeclarationMismatch {
                    requirement: expected.clone(),
                    observed: observed.clone(),
                });
            }
            Some(RequirementDeclaration::Present(_)) => {}
        }
    }

    let closeout = build_closeout(&requirements, input.subject.is_container());
    AcceptanceInterpretation {
        subject: input.subject.clone(),
        requirements,
        diagnostics,
        closeout,
    }
}

pub fn evaluate_acceptance(input: &AcceptanceInput) -> AcceptanceInterpretation {
    interpret_acceptance(input)
}

fn purpose_matches_subject(purpose: RequirementPurpose, subject: &AcceptanceSubject) -> bool {
    match purpose {
        RequirementPurpose::TaskProof => subject.is_task(),
        RequirementPurpose::ContainerScope => subject.is_container(),
        RequirementPurpose::CloseoutSummary => true,
    }
}

fn purpose_for_kind(kind: GateKind, container: bool) -> RequirementPurpose {
    if kind == GateKind::Summary {
        RequirementPurpose::CloseoutSummary
    } else if container {
        RequirementPurpose::ContainerScope
    } else {
        RequirementPurpose::TaskProof
    }
}

fn interpret_evidence(
    body: &RequirementDeclarationBody,
    input: &AcceptanceInput,
) -> (RawRequirementState, Vec<AcceptanceDiagnostic>) {
    let mut local = Vec::new();
    let mut exact = Vec::new();
    let mut invalidated = Vec::new();
    let mut stale = Vec::new();
    let mut irrelevant = Vec::new();
    let mut mismatched = Vec::new();

    for evidence in input
        .evidence
        .iter()
        .filter(|item| item.requirement.id == body.reference.id)
    {
        if evidence.requirement != body.reference {
            mismatched.push(evidence);
            continue;
        }
        if evidence.subject == input.subject {
            if evidence.disposition == EvidenceDisposition::Current {
                exact.push(evidence);
            } else {
                invalidated.push(evidence);
            }
        } else if evidence.subject.same_work_and_attempt(&input.subject) {
            stale.push(evidence);
        } else {
            irrelevant.push(evidence);
        }
    }

    exact.sort_by(|left, right| {
        left.observed_at
            .cmp(&right.observed_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    invalidated.sort_by(|left, right| {
        left.observed_at
            .cmp(&right.observed_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    stale.sort_by(|left, right| {
        left.observed_at
            .cmp(&right.observed_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    irrelevant.sort_by(|left, right| {
        left.observed_at
            .cmp(&right.observed_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    for evidence in &stale {
        local.push(AcceptanceDiagnostic::StaleEvidence {
            evidence_id: evidence.id.clone(),
            reason: stale_reason(evidence, input),
        });
    }
    for evidence in &invalidated {
        match evidence.disposition {
            EvidenceDisposition::Superseded => {
                local.push(AcceptanceDiagnostic::StaleEvidence {
                    evidence_id: evidence.id.clone(),
                    reason: StaleProofReason::Superseded,
                });
            }
            EvidenceDisposition::Late => {
                local.push(AcceptanceDiagnostic::StaleEvidence {
                    evidence_id: evidence.id.clone(),
                    reason: StaleProofReason::Late,
                });
            }
            EvidenceDisposition::Revoked => {
                local.push(AcceptanceDiagnostic::AlteredEvidence(evidence.id.clone()));
            }
            EvidenceDisposition::Current => unreachable!("current evidence is authoritative"),
        }
    }
    for evidence in &irrelevant {
        local.push(AcceptanceDiagnostic::IrrelevantEvidence {
            evidence_id: evidence.id.clone(),
            reason: irrelevant_reason(evidence, input, body),
        });
    }
    if let Some(evidence) = mismatched.last() {
        local.push(AcceptanceDiagnostic::DeclarationMismatch {
            requirement: body.reference.clone(),
            observed: evidence.requirement.clone(),
        });
    }

    if let Some(evidence) = exact.last() {
        let raw = match evidence.disposition {
            EvidenceDisposition::Current => match evidence.result {
                EvidenceResult::Passed => {
                    if body.required_observables.is_subset(&evidence.observables)
                        && evidence.artifact_digest.is_some()
                        && (!matches!(body.reference.kind, GateKind::Verification)
                            || evidence.attested)
                    {
                        RawRequirementState::Passed(evidence.id.clone())
                    } else {
                        local.push(AcceptanceDiagnostic::AlteredEvidence(evidence.id.clone()));
                        RawRequirementState::Altered(evidence.id.clone())
                    }
                }
                EvidenceResult::Failed(reason) => RawRequirementState::Failed {
                    evidence_id: evidence.id.clone(),
                    reason,
                },
                EvidenceResult::Stale => RawRequirementState::Stale {
                    evidence_id: evidence.id.clone(),
                    reason: StaleProofReason::ProofRevision,
                },
                EvidenceResult::Altered => RawRequirementState::Altered(evidence.id.clone()),
            },
            EvidenceDisposition::Superseded => RawRequirementState::Stale {
                evidence_id: evidence.id.clone(),
                reason: StaleProofReason::Superseded,
            },
            EvidenceDisposition::Late => RawRequirementState::Stale {
                evidence_id: evidence.id.clone(),
                reason: StaleProofReason::Late,
            },
            EvidenceDisposition::Revoked => RawRequirementState::Altered(evidence.id.clone()),
        };
        emit_raw_diagnostic(&raw, &mut local);
        return (raw, local);
    }

    if let Some(evidence) = stale.last() {
        let raw = RawRequirementState::Stale {
            evidence_id: evidence.id.clone(),
            reason: stale_reason(evidence, input),
        };
        return (raw, local);
    }

    if let Some(evidence) = irrelevant.last() {
        let reason = irrelevant_reason(evidence, input, body);
        let raw = RawRequirementState::Irrelevant {
            evidence_id: evidence.id.clone(),
            reason,
        };
        return (raw, local);
    }

    if !mismatched.is_empty() {
        return (
            RawRequirementState::Declaration(DeclarationProblem::Mismatched),
            local,
        );
    }

    (RawRequirementState::Missing, local)
}

fn irrelevant_reason(
    evidence: &EvidenceObservation,
    input: &AcceptanceInput,
    body: &RequirementDeclarationBody,
) -> IrrelevantProofReason {
    if evidence.subject.project_id() != input.subject.project_id()
        || evidence.subject.work_id() != input.subject.work_id()
    {
        IrrelevantProofReason::ForeignWork
    } else if evidence.subject.is_task() != input.subject.is_task() {
        IrrelevantProofReason::WrongContext
    } else if evidence.requirement.profile != body.reference.profile {
        IrrelevantProofReason::WrongProfile
    } else {
        IrrelevantProofReason::WrongGate
    }
}

fn unmatched_evidence_reason(
    evidence: &EvidenceObservation,
    input: &AcceptanceInput,
) -> IrrelevantProofReason {
    if evidence.subject.project_id() != input.subject.project_id()
        || evidence.subject.work_id() != input.subject.work_id()
    {
        IrrelevantProofReason::ForeignWork
    } else if evidence.subject.is_task() != input.subject.is_task() {
        IrrelevantProofReason::WrongContext
    } else {
        IrrelevantProofReason::WrongGate
    }
}

fn stale_reason(evidence: &EvidenceObservation, input: &AcceptanceInput) -> StaleProofReason {
    match (&evidence.subject.context, &input.subject.context) {
        (
            ProofContext::TaskAttempt { attempt: old },
            ProofContext::TaskAttempt { attempt: current },
        ) if old.attempt_id == current.attempt_id && old.fence != current.fence => {
            StaleProofReason::AttemptFence
        }
        _ if evidence.subject.proof.proof_revision != input.subject.proof.proof_revision => {
            StaleProofReason::ProofRevision
        }
        _ => StaleProofReason::SubjectRevision,
    }
}

fn interpret_review(
    body: &RequirementDeclarationBody,
    input: &AcceptanceInput,
    diagnostics: &mut Vec<AcceptanceDiagnostic>,
) -> (RawRequirementState, Vec<AcceptanceDiagnostic>) {
    let mut local = Vec::new();
    let mut exact = Vec::new();
    let mut irrelevant = Vec::new();
    for review in input
        .reviews
        .iter()
        .filter(|item| item.requirement.id == body.reference.id)
    {
        if review.requirement != body.reference {
            continue;
        }
        if review.subject == input.subject && review.submission_id == input.current_submission_id {
            exact.push(review);
        } else {
            irrelevant.push(review);
        }
    }
    exact.sort_by(|left, right| {
        left.decided_at
            .cmp(&right.decided_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    if let Some(review) = exact.last() {
        let state = if review.reviewer_id == review.attempt_actor_id {
            diagnostics.push(AcceptanceDiagnostic::SelfReviewRejected(review.id.clone()));
            local.push(AcceptanceDiagnostic::SelfReviewRejected(review.id.clone()));
            ReviewState::SelfReviewRejected(review.id.clone())
        } else if !review_is_authorized(review, body.review_policy) {
            diagnostics.push(AcceptanceDiagnostic::ReviewUnauthorized(review.id.clone()));
            local.push(AcceptanceDiagnostic::ReviewUnauthorized(review.id.clone()));
            ReviewState::Unauthorized(review.id.clone())
        } else {
            match review.outcome {
                ReviewOutcome::Pending => ReviewState::Pending(review.id.clone()),
                ReviewOutcome::Approved => ReviewState::Approved(review.id.clone()),
                ReviewOutcome::Rejected => {
                    diagnostics.push(AcceptanceDiagnostic::ReviewRejected(review.id.clone()));
                    local.push(AcceptanceDiagnostic::ReviewRejected(review.id.clone()));
                    ReviewState::Rejected(review.id.clone())
                }
                ReviewOutcome::Returned => {
                    diagnostics.push(AcceptanceDiagnostic::ReviewReturned(review.id.clone()));
                    local.push(AcceptanceDiagnostic::ReviewReturned(review.id.clone()));
                    ReviewState::Returned(review.id.clone())
                }
                ReviewOutcome::Revoked => {
                    diagnostics.push(AcceptanceDiagnostic::ReviewRevoked(review.id.clone()));
                    local.push(AcceptanceDiagnostic::ReviewRevoked(review.id.clone()));
                    ReviewState::Revoked(review.id.clone())
                }
            }
        };
        return (RawRequirementState::Review(state), local);
    }
    if let Some(review) = irrelevant.last() {
        return (
            RawRequirementState::Review(ReviewState::Irrelevant(review.id.clone())),
            local,
        );
    }
    (RawRequirementState::Review(ReviewState::Missing), local)
}

fn review_is_authorized(review: &ReviewDecision, policy: ReviewRequirementPolicy) -> bool {
    match policy {
        ReviewRequirementPolicy::NotRequired => false,
        ReviewRequirementPolicy::Independent => review.reviewer_role == ActorRole::Reviewer,
        ReviewRequirementPolicy::OperatorAllowed => review.reviewer_role == ActorRole::Operator,
    }
}

fn assessment_for(
    reference: RequirementReference,
    purpose: RequirementPurpose,
    required: bool,
    raw: RawRequirementState,
    body: &RequirementDeclarationBody,
    input: &AcceptanceInput,
    diagnostics: &mut Vec<AcceptanceDiagnostic>,
) -> RequirementAssessment {
    let exception = input
        .exceptions
        .iter()
        .filter(|item| item.requirement == reference && item.subject == input.subject)
        .max_by(|left, right| left.id.cmp(&right.id));

    let mut exception_id = None;
    let effective = if !required {
        EffectiveRequirementState::NotRequired
    } else if raw.is_unsatisfied()
        && exception.is_some_and(|item| exception_is_valid(item, input))
        && exception_applies_to_raw(&raw)
    {
        let id = exception.expect("checked above").id.clone();
        exception_id = Some(id.clone());
        EffectiveRequirementState::SatisfiedByException(id)
    } else if raw.is_unsatisfied() {
        EffectiveRequirementState::Unsatisfied
    } else {
        EffectiveRequirementState::Satisfied
    };

    // The review policy is a declaration fact; it does not transform a review
    // gate into an ordinary passing receipt.  Keeping this check here makes a
    // contradictory declaration visible even when its review is approved.
    if body.reference.kind == GateKind::Review
        && body.review_policy == ReviewRequirementPolicy::NotRequired
    {
        diagnostics.push(AcceptanceDiagnostic::InvalidCloseoutRequirement(
            body.reference.id.clone(),
        ));
    }

    RequirementAssessment {
        reference,
        purpose,
        required,
        raw,
        effective,
        exception_id,
    }
}

fn validate_exception_records(
    input: &AcceptanceInput,
    diagnostics: &mut Vec<AcceptanceDiagnostic>,
) {
    for exception in &input.exceptions {
        let reason = if exception.actor_role != ActorRole::Operator {
            Some(ExceptionInvalidReason::WrongRole)
        } else if exception.comment.trim().is_empty() {
            Some(ExceptionInvalidReason::EmptyComment)
        } else if exception.revoked {
            Some(ExceptionInvalidReason::Revoked)
        } else if exception
            .expires_at
            .is_some_and(|at| at <= input.evaluated_at)
        {
            Some(ExceptionInvalidReason::Expired)
        } else if exception.subject != input.subject {
            Some(ExceptionInvalidReason::WrongSubject)
        } else if !input.declarations.iter().any(|declaration| {
            matches!(
                declaration,
                RequirementDeclaration::Present(body) if body.reference == exception.requirement
            )
        }) {
            Some(ExceptionInvalidReason::WrongRequirement)
        } else {
            None
        };
        if let Some(reason) = reason {
            diagnostics.push(AcceptanceDiagnostic::InvalidException {
                exception_id: exception.id.clone(),
                reason,
            });
        }
    }
}

fn exception_is_valid(exception: &ForceException, input: &AcceptanceInput) -> bool {
    exception.actor_role == ActorRole::Operator
        && !exception.comment.trim().is_empty()
        && !exception.revoked
        && exception
            .expires_at
            .is_none_or(|at| at > input.evaluated_at)
        && exception.requirement
            == input
                .declarations
                .iter()
                .find_map(|item| match item {
                    RequirementDeclaration::Present(body)
                        if body.reference == exception.requirement =>
                    {
                        Some(body.reference.clone())
                    }
                    _ => None,
                })
                .unwrap_or_else(|| exception.requirement.clone())
        && exception.subject == input.subject
}

fn exception_applies_to_raw(raw: &RawRequirementState) -> bool {
    matches!(
        raw,
        RawRequirementState::Failed { .. }
            | RawRequirementState::Stale { .. }
            | RawRequirementState::Altered(_)
            | RawRequirementState::Review(ReviewState::Rejected(_))
            | RawRequirementState::Review(ReviewState::Returned(_))
            | RawRequirementState::Review(ReviewState::Revoked(_))
    )
}

fn emit_raw_diagnostic(raw: &RawRequirementState, diagnostics: &mut Vec<AcceptanceDiagnostic>) {
    match raw {
        RawRequirementState::Stale {
            evidence_id,
            reason,
        } => diagnostics.push(AcceptanceDiagnostic::StaleEvidence {
            evidence_id: evidence_id.clone(),
            reason: *reason,
        }),
        RawRequirementState::Altered(id) => {
            diagnostics.push(AcceptanceDiagnostic::AlteredEvidence(id.clone()))
        }
        RawRequirementState::Irrelevant {
            evidence_id,
            reason,
        } => diagnostics.push(AcceptanceDiagnostic::IrrelevantEvidence {
            evidence_id: evidence_id.clone(),
            reason: *reason,
        }),
        RawRequirementState::Missing
        | RawRequirementState::Passed(_)
        | RawRequirementState::Failed { .. }
        | RawRequirementState::Declaration(_)
        | RawRequirementState::Review(_) => {}
    }
}

fn build_closeout(requirements: &[RequirementAssessment], container: bool) -> CloseoutAssessment {
    let ids = |purpose: RequirementPurpose| {
        requirements
            .iter()
            .filter(|item| item.purpose == purpose && item.required)
            .map(|item| item.reference.id.clone())
            .collect::<Vec<_>>()
    };
    let satisfied = |purpose: RequirementPurpose| {
        requirements
            .iter()
            .filter(|item| item.purpose == purpose && item.required)
            .all(|item| item.effective.is_satisfied())
    };
    if container {
        CloseoutAssessment::Container {
            scope_requirements: ids(RequirementPurpose::ContainerScope),
            summary_requirements: ids(RequirementPurpose::CloseoutSummary),
            scope_satisfied: satisfied(RequirementPurpose::ContainerScope),
            summary_satisfied: satisfied(RequirementPurpose::CloseoutSummary),
            attempt_policy: ContainerAttemptPolicy::Forbidden,
        }
    } else {
        CloseoutAssessment::Task {
            proof_requirements: ids(RequirementPurpose::TaskProof),
            summary_requirements: ids(RequirementPurpose::CloseoutSummary),
            proof_satisfied: satisfied(RequirementPurpose::TaskProof),
            summary_satisfied: satisfied(RequirementPurpose::CloseoutSummary),
        }
    }
}

// Keep the imported identity types visible in generated rustdoc for adapters
// that construct the accepted subject without reaching into implementation
// details.  These aliases are additive and do not create a second identity.
pub type TaskAttempt = AttemptIdentity;
pub type Fence = AttemptFence;
pub type ProofSubject = AcceptanceSubject;
pub type Requirement = RequirementDeclarationBody;
pub type Evidence = EvidenceObservation;

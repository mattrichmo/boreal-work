//! Typed completion commands. Transport parsing and persistence stay outside
//! this module; every command maps to the same server action vocabulary.
use crate::acceptance::ExceptionReason;
use crate::actions::ActionKind;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompletionKind {
    Checkpoint,
    Approve,
    Reject,
    Return,
    RevokeReview,
    GateException,
    WaiveDependency,
    RevokeException,
    Reopen,
    Cancel,
    Retry,
    Publish,
}
impl CompletionKind {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "work.checkpoint" => Self::Checkpoint,
            "review.approve" => Self::Approve,
            "review.reject" => Self::Reject,
            "review.return" => Self::Return,
            "review.revoke" => Self::RevokeReview,
            "exception.grant" => Self::GateException,
            "dep.waive" => Self::WaiveDependency,
            "exception.revoke" => Self::RevokeException,
            "work.reopen" => Self::Reopen,
            "work.cancel" => Self::Cancel,
            "work.retry" => Self::Retry,
            "work.publish" => Self::Publish,
            _ => return None,
        })
    }
    pub const fn command(self) -> &'static str {
        match self {
            Self::Checkpoint => "work.checkpoint",
            Self::Approve => "review.approve",
            Self::Reject => "review.reject",
            Self::Return => "review.return",
            Self::RevokeReview => "review.revoke",
            Self::GateException => "exception.grant",
            Self::WaiveDependency => "dep.waive",
            Self::RevokeException => "exception.revoke",
            Self::Reopen => "work.reopen",
            Self::Cancel => "work.cancel",
            Self::Retry => "work.retry",
            Self::Publish => "work.publish",
        }
    }
    pub const fn action(self) -> ActionKind {
        match self {
            Self::Checkpoint => ActionKind::Checkpoint,
            Self::Approve | Self::Reject | Self::Return => ActionKind::Review,
            Self::RevokeReview => ActionKind::RevokeReview,
            Self::GateException => ActionKind::ForceGate,
            Self::WaiveDependency => ActionKind::WaiveDependency,
            Self::RevokeException => ActionKind::RevokeException,
            Self::Reopen => ActionKind::Reopen,
            Self::Cancel => ActionKind::Cancel,
            Self::Retry => ActionKind::Retry,
            Self::Publish => ActionKind::Publish,
        }
    }
}

pub fn exception_reason(value: &str) -> Option<ExceptionReason> {
    Some(match value {
        "risk_accepted" => ExceptionReason::RiskAccepted,
        "external_evidence" => ExceptionReason::ExternalEvidence,
        "superseded_work" => ExceptionReason::SupersededWork,
        "duplicate_work" => ExceptionReason::DuplicateWork,
        "migration_disposition" => ExceptionReason::MigrationDisposition,
        _ => return None,
    })
}

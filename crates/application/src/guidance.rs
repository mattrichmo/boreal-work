//! Trusted, versioned guidance selection. Authored text is never executable.

use boreal_domain::DerivedStatus;

const SAFE_RUNNERS: &[&str] = &["boreal_cli", "bounded_declared_gate"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DirectiveSeverity {
    Blocking,
    Required,
    Advisory,
}

impl DirectiveSeverity {
    pub const fn requires_action(self) -> bool {
        matches!(self, Self::Blocking | Self::Required)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DirectiveValidationError {
    EmptyField(&'static str),
    EmptySafeArgv,
    MissingJsonFlag,
    UnsafeSafeArg,
    ShellExecution,
    UnsupportedRunner,
    InconsistentSeverity,
}

impl std::fmt::Display for DirectiveValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyField(field) => write!(formatter, "directive field {field} is empty"),
            Self::EmptySafeArgv => formatter.write_str("directive safe_argv is empty"),
            Self::MissingJsonFlag => formatter.write_str("directive safe_argv must include --json"),
            Self::UnsafeSafeArg => {
                formatter.write_str("directive safe_argv contains an unsafe argument")
            }
            Self::ShellExecution => formatter.write_str("directive shell execution is not allowed"),
            Self::UnsupportedRunner => formatter.write_str("directive runner is not allowlisted"),
            Self::InconsistentSeverity => {
                formatter.write_str("directive action_required does not match its severity")
            }
        }
    }
}

impl std::error::Error for DirectiveValidationError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GuidanceContext<'a> {
    pub work_id: &'a str,
    pub status: DerivedStatus,
    pub reason_codes: &'a [String],
    pub has_goal: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Directive {
    pub registry_id: &'static str,
    pub version: &'static str,
    pub explanation: &'static str,
    pub safe_argv: &'static [&'static str],
    pub severity: DirectiveSeverity,
    pub action_required: bool,
    pub runner: &'static str,
    pub shell: bool,
}

impl Directive {
    /// Validate the boundary an unfamiliar harness must honor before acting.
    ///
    /// Display text is never parsed into a command, and no directive can opt
    /// into shell execution or omit the machine-readable response flag.
    pub fn validate(&self) -> Result<(), DirectiveValidationError> {
        for (name, value) in [
            ("registry_id", self.registry_id),
            ("version", self.version),
            ("explanation", self.explanation),
        ] {
            if value.trim().is_empty() {
                return Err(DirectiveValidationError::EmptyField(name));
            }
        }
        if self.safe_argv.is_empty() {
            return Err(DirectiveValidationError::EmptySafeArgv);
        }
        if self.safe_argv[0] != "bwrk" {
            return Err(DirectiveValidationError::UnsafeSafeArg);
        }
        if !self.safe_argv.iter().any(|arg| *arg == "--json") {
            return Err(DirectiveValidationError::MissingJsonFlag);
        }
        if self.safe_argv.iter().any(|arg| !is_safe_arg(arg)) {
            return Err(DirectiveValidationError::UnsafeSafeArg);
        }
        if !SAFE_RUNNERS.contains(&self.runner) {
            return Err(DirectiveValidationError::UnsupportedRunner);
        }
        if self.shell {
            return Err(DirectiveValidationError::ShellExecution);
        }
        if self.action_required != self.severity.requires_action() {
            return Err(DirectiveValidationError::InconsistentSeverity);
        }
        Ok(())
    }
}

fn is_safe_arg(argument: &str) -> bool {
    if argument.is_empty() || argument.contains('\0') {
        return false;
    }
    if argument.starts_with('<') && argument.ends_with('>') {
        return argument[1..argument.len() - 1]
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'));
    }
    !argument.chars().any(is_shell_metacharacter)
}

const fn is_shell_metacharacter(character: char) -> bool {
    matches!(
        character,
        ';' | '|' | '&' | '$' | '`' | '\n' | '\r' | '<' | '>'
    )
}

pub fn guide(context: GuidanceContext<'_>) -> Directive {
    if !context.has_goal {
        return Directive {
            registry_id: "guidance.no_goal",
            version: "1",
            explanation: "create or select a project goal before mutating work",
            safe_argv: &["bwrk", "init", "<project>", "--json"],
            severity: DirectiveSeverity::Required,
            action_required: true,
            runner: "boreal_cli",
            shell: false,
        };
    }
    match context.status {
        DerivedStatus::Queued => Directive {
            registry_id: "guidance.wait_prerequisite",
            version: "1",
            explanation: "wait for the close-only prerequisite",
            safe_argv: &["bwrk", "status", "<project>", "--json"],
            severity: DirectiveSeverity::Advisory,
            action_required: false,
            runner: "boreal_cli",
            shell: false,
        },
        DerivedStatus::Blocked | DerivedStatus::Paused => Directive {
            registry_id: "guidance.resolve_hold",
            version: "1",
            explanation: "resolve the operator hold before claiming",
            safe_argv: &["bwrk", "status", "<project>", "--json"],
            severity: DirectiveSeverity::Blocking,
            action_required: true,
            runner: "boreal_cli",
            shell: false,
        },
        DerivedStatus::ExpiredReview => Directive {
            registry_id: "guidance.review_expiry",
            version: "1",
            explanation: "review the expired attempt before redispatch",
            safe_argv: &["bwrk", "status", "<project>", "--json"],
            severity: DirectiveSeverity::Blocking,
            action_required: true,
            runner: "boreal_cli",
            shell: false,
        },
        DerivedStatus::Ready => Directive {
            registry_id: "guidance.claim",
            version: "1",
            explanation: "claim the eligible work with a fenced attempt",
            safe_argv: &["bwrk", "work", "claim", "<project>", "<work>", "--json"],
            severity: DirectiveSeverity::Required,
            action_required: true,
            runner: "boreal_cli",
            shell: false,
        },
        DerivedStatus::Closed | DerivedStatus::Cancelled => Directive {
            registry_id: "guidance.inspect",
            version: "1",
            explanation: "inspect the terminal work history",
            safe_argv: &["bwrk", "work", "show", "<project>", "<work>", "--json"],
            severity: DirectiveSeverity::Advisory,
            action_required: false,
            runner: "boreal_cli",
            shell: false,
        },
        _ => Directive {
            registry_id: "guidance.inspect",
            version: "1",
            explanation: "inspect the current attempt and required gates",
            safe_argv: &["bwrk", "status", "<project>", "--json"],
            severity: DirectiveSeverity::Required,
            action_required: true,
            runner: "boreal_cli",
            shell: false,
        },
    }
}

/// Select guidance and fail closed if its trusted action contract is invalid.
pub fn guide_checked(context: GuidanceContext<'_>) -> Result<Directive, DirectiveValidationError> {
    let directive = guide(context);
    directive.validate()?;
    Ok(directive)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn guidance_is_trusted_and_status_specific() {
        let no_goal = guide(GuidanceContext {
            work_id: "w",
            status: DerivedStatus::Ready,
            reason_codes: &[],
            has_goal: false,
        });
        assert_eq!(no_goal.registry_id, "guidance.no_goal");
        assert_eq!(no_goal.severity, DirectiveSeverity::Required);
        assert!(no_goal.action_required);
        let blocked = guide(GuidanceContext {
            work_id: "w",
            status: DerivedStatus::Blocked,
            reason_codes: &[],
            has_goal: true,
        });
        assert_eq!(blocked.registry_id, "guidance.resolve_hold");
        let discovery = guide(GuidanceContext {
            work_id: "w",
            status: DerivedStatus::Queued,
            reason_codes: &[],
            has_goal: true,
        });
        assert_eq!(discovery.severity, DirectiveSeverity::Advisory);
        assert!(!discovery.action_required);
        assert!(blocked.safe_argv.iter().all(|arg| !arg.contains(";")));
        assert!(guide_checked(GuidanceContext {
            work_id: "w",
            status: DerivedStatus::Ready,
            reason_codes: &[],
            has_goal: true,
        })
        .is_ok());
    }

    #[test]
    fn unfamiliar_harness_must_honor_required_action_boundary() {
        let directive = guide_checked(GuidanceContext {
            work_id: "unknown-to-harness",
            status: DerivedStatus::Ready,
            reason_codes: &[],
            has_goal: false,
        })
        .expect("trusted no-goal guidance validates");

        assert_eq!(directive.severity, DirectiveSeverity::Required);
        assert!(directive.action_required);
        assert_eq!(directive.runner, "boreal_cli");
        assert!(!directive.shell);
        assert_eq!(
            directive.safe_argv,
            &["bwrk", "init", "<project>", "--json"]
        );
    }

    #[test]
    fn validation_rejects_untrusted_or_incomplete_action_shapes() {
        let mut directive = guide(GuidanceContext {
            work_id: "w",
            status: DerivedStatus::Queued,
            reason_codes: &[],
            has_goal: true,
        });
        directive.safe_argv = &["bwrk", "status", "<project>", "; rm -rf", "--json"];
        assert_eq!(
            directive.validate(),
            Err(DirectiveValidationError::UnsafeSafeArg)
        );

        directive.safe_argv = &["bwrk", "status", "<project>"];
        assert_eq!(
            directive.validate(),
            Err(DirectiveValidationError::MissingJsonFlag)
        );

        directive.safe_argv = &["bwrk", "status", "<project>", "--json"];
        directive.shell = true;
        assert_eq!(
            directive.validate(),
            Err(DirectiveValidationError::ShellExecution)
        );

        directive.shell = false;
        directive.action_required = true;
        assert_eq!(
            directive.validate(),
            Err(DirectiveValidationError::InconsistentSeverity)
        );

        directive.action_required = false;
        directive.runner = "untrusted_runner";
        assert_eq!(
            directive.validate(),
            Err(DirectiveValidationError::UnsupportedRunner)
        );
    }
}

/// Return a selected work item and its authoritative revision. Paginated reads
/// must agree on the revision; a changing project is explicitly retried by the caller.
pub fn guidance_subject(
    store: &boreal_store::SqliteStore,
    project: &boreal_domain::ProjectId,
    actor: &boreal_domain::ActorContext,
    session: Option<&str>,
    at: boreal_domain::TimestampMs,
    work_id: &str,
) -> Result<(boreal_domain::Revision, crate::StatusWork), String> {
    let mut offset = 0;
    let mut revision = None;
    loop {
        let snapshot = crate::project_status_from_store_for_session(
            store,
            project,
            actor,
            session,
            at,
            crate::MAX_STATUS_ROWS,
            offset,
        )?;
        if revision.is_some_and(|value| value != snapshot.project_revision) {
            return Err("project changed while selecting guidance; refresh the snapshot".into());
        }
        revision = Some(snapshot.project_revision);
        if snapshot
            .diagnostics
            .iter()
            .any(|row| row.work_id == work_id)
        {
            return Err(
                "selected work is quarantined; inspect its diagnostics before requesting guidance"
                    .into(),
            );
        }
        if let Some(item) = snapshot
            .items
            .iter()
            .find(|item| item.work.id.as_str() == work_id)
        {
            return Ok((snapshot.project_revision, item.clone()));
        }
        match snapshot.next_offset() {
            Some(next) if next > offset => offset = next,
            _ => return Err("selected work is not present in this project".into()),
        }
    }
}

/// Guidance selects among already-authorized descriptors; status prose cannot
/// authorize an action and imported workflow files are never executed.
pub fn guided_action(item: &crate::StatusWork) -> Option<boreal_domain::actions::ActionKind> {
    use boreal_domain::actions::ActionKind;
    let actions = item.actions.as_ref()?;
    let order = [
        ActionKind::Claim,
        ActionKind::AcceptAttempt,
        ActionKind::StartAttempt,
        ActionKind::FinishClose,
        ActionKind::Review,
        ActionKind::Recover,
        ActionKind::Inspect,
    ];
    order.into_iter().find(|kind| actions.allows(*kind))
}

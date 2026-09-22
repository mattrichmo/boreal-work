//! Machine update adapter for release-installed Boreal binaries.
//!
//! The release archive carries the same verified installer used for the
//! initial install. Keeping the update operation here means users can run
//! `bwrk update` (or the v1-compatible `bwrk upgrade --machine`) without
//! remembering a curl command, while the installer remains responsible for
//! archive verification and atomic replacement.

use super::{CliError, CliResult, ParsedCommand};
use boreal_protocol::{ApplicationOutcome, ErrorCode};
use serde_json::json;
use std::{env, path::PathBuf, process::Command};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum UpdateJobState {
    Registered,
    Running,
    Pending,
    ReadbackRequired,
    Reconciled,
    Rejected,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UpdateJobRequest {
    pub project_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub target_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UpdateJobRecord {
    pub project_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub state: UpdateJobState,
    pub version: Option<String>,
    pub side_effect_ref: Option<String>,
    pub result_digest: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum UpdateJobObservation {
    Pending,
    ReadbackRequired {
        side_effect_ref: String,
    },
    Reconciled {
        side_effect_ref: String,
        result_digest: String,
        version: String,
    },
    Rejected {
        reason: String,
    },
    Failed {
        reason: String,
    },
}

pub(crate) trait UpdateJobPort {
    fn register(&self, request: &UpdateJobRequest) -> Result<UpdateJobRecord, String>;
    fn start(&self, operation_id: &str) -> Result<UpdateJobRecord, String>;
    fn readback(&self, operation_id: &str) -> Result<UpdateJobRecord, String>;
    fn reconcile(
        &self,
        operation_id: &str,
        side_effect_ref: &str,
        result_digest: &str,
        version: &str,
    ) -> Result<UpdateJobRecord, String>;
    fn reject(&self, operation_id: &str, reason: &str) -> Result<UpdateJobRecord, String>;
    fn fail(&self, operation_id: &str, reason: &str) -> Result<UpdateJobRecord, String>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum UpdateJobOutcome {
    Pending(UpdateJobRecord),
    ReadbackRequired(UpdateJobRecord),
    Reconciled(UpdateJobRecord),
    Rejected(UpdateJobRecord),
    Failed(UpdateJobRecord),
}

impl UpdateJobOutcome {
    pub(crate) const fn is_resolved(&self) -> bool {
        matches!(self, Self::Reconciled(_))
    }

    pub(crate) fn record(&self) -> &UpdateJobRecord {
        match self {
            Self::Pending(record)
            | Self::ReadbackRequired(record)
            | Self::Reconciled(record)
            | Self::Rejected(record)
            | Self::Failed(record) => record,
        }
    }
}

/// Execute an update only after the application/store has admitted its
/// operation. The adapter is generic so the protected CLI root can later
/// connect it to the canonical identity-bound SQLite job port without moving
/// installer policy into the parser or command handler.
pub(crate) fn run_with_durable_job<J, F>(
    jobs: &J,
    request: &UpdateJobRequest,
    execute: F,
) -> Result<UpdateJobOutcome, String>
where
    J: UpdateJobPort,
    F: FnOnce(&UpdateJobRecord) -> Result<UpdateJobObservation, String>,
{
    let admitted = jobs.register(request)?;
    if admitted.state != UpdateJobState::Registered {
        return Ok(outcome_from_record(admitted));
    }
    let running = jobs.start(&request.operation_id)?;
    if running.state != UpdateJobState::Running {
        return Ok(outcome_from_record(running));
    }
    match execute(&running)? {
        UpdateJobObservation::Pending => Ok(UpdateJobOutcome::Pending(running)),
        UpdateJobObservation::ReadbackRequired { .. } => Ok(UpdateJobOutcome::ReadbackRequired(
            jobs.readback(&request.operation_id)?,
        )),
        UpdateJobObservation::Reconciled {
            side_effect_ref,
            result_digest,
            version,
        } => Ok(UpdateJobOutcome::Reconciled(jobs.reconcile(
            &request.operation_id,
            &side_effect_ref,
            &result_digest,
            &version,
        )?)),
        UpdateJobObservation::Rejected { reason } => Ok(UpdateJobOutcome::Rejected(
            jobs.reject(&request.operation_id, &reason)?,
        )),
        UpdateJobObservation::Failed { reason } => Ok(UpdateJobOutcome::Failed(
            jobs.fail(&request.operation_id, &reason)?,
        )),
    }
}

fn outcome_from_record(record: UpdateJobRecord) -> UpdateJobOutcome {
    match record.state {
        UpdateJobState::Reconciled => UpdateJobOutcome::Reconciled(record),
        UpdateJobState::ReadbackRequired | UpdateJobState::Running => {
            UpdateJobOutcome::ReadbackRequired(record)
        }
        UpdateJobState::Pending | UpdateJobState::Registered => UpdateJobOutcome::Pending(record),
        UpdateJobState::Rejected => UpdateJobOutcome::Rejected(record),
        UpdateJobState::Failed => UpdateJobOutcome::Failed(record),
    }
}

pub(super) fn run(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
    let executable = env::current_exe().map_err(|error| {
        update_error(format!(
            "could not locate the running bwrk executable: {error}"
        ))
    })?;
    let executable = executable.canonicalize().unwrap_or(executable);
    let prefix = executable
        .parent()
        .and_then(|bin| bin.parent())
        .map(PathBuf::from)
        .ok_or_else(|| update_error("could not determine the Boreal installation prefix"))?;
    let installer = prefix.join("share/boreal/install.sh");
    if !installer.is_file() {
        if executable.to_string_lossy().contains("/Cellar/") {
            return Err(update_error(
                "this bwrk installation is managed by Homebrew; run `brew upgrade boreal`",
            ));
        }
        return Err(update_error(format!(
            "this bwrk installation does not include its updater ({}); rerun the official installer once, then use `bwrk update`",
            installer.display()
        )));
    }

    let output = Command::new("sh")
        .arg(&installer)
        .arg("--prefix")
        .arg(&prefix)
        .output()
        .map_err(|error| update_error(format!("could not start the Boreal updater: {error}")))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let message = if detail.is_empty() {
            format!("Boreal update failed with {}", output.status)
        } else {
            format!("Boreal update failed: {detail}")
        };
        return Err(update_error(message));
    }

    let version = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix("Boreal "))
        .and_then(|line| line.split_whitespace().next())
        .unwrap_or("latest")
        .to_owned();
    Ok(CliResult {
        outcome: ApplicationOutcome::Changed,
        data: parsed
            .options
            .json
            .then(|| json!({"command": "update", "version": version, "prefix": prefix})),
        human: (!parsed.options.json)
            .then(|| format!("Boreal updated successfully ({version}).\n")),
        ..CliResult::default()
    })
}

fn update_error(message: impl Into<String>) -> CliError {
    CliError::with(
        ErrorCode::ServiceUnavailable,
        ApplicationOutcome::Failed,
        message,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct FakeJobs {
        record: RefCell<UpdateJobRecord>,
        events: RefCell<Vec<&'static str>>,
    }

    impl FakeJobs {
        fn new(state: UpdateJobState) -> Self {
            Self {
                record: RefCell::new(UpdateJobRecord {
                    project_id: "project-update".to_owned(),
                    operation_id: "op-update".to_owned(),
                    request_digest: "sha256:update".to_owned(),
                    state,
                    version: None,
                    side_effect_ref: None,
                    result_digest: None,
                    error: None,
                }),
                events: RefCell::new(Vec::new()),
            }
        }

        fn snapshot(&self) -> UpdateJobRecord {
            self.record.borrow().clone()
        }
    }

    impl UpdateJobPort for FakeJobs {
        fn register(&self, request: &UpdateJobRequest) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("register");
            let record = self.snapshot();
            if record.project_id != request.project_id
                || record.operation_id != request.operation_id
                || record.request_digest != request.request_digest
            {
                return Err("update identity mismatch".to_owned());
            }
            Ok(record)
        }

        fn start(&self, operation_id: &str) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("start");
            let mut record = self.record.borrow_mut();
            if record.operation_id != operation_id {
                return Err("update operation mismatch".to_owned());
            }
            if record.state == UpdateJobState::Registered {
                record.state = UpdateJobState::Running;
            }
            Ok(record.clone())
        }

        fn readback(&self, operation_id: &str) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("readback");
            let mut record = self.record.borrow_mut();
            if record.operation_id != operation_id {
                return Err("update operation mismatch".to_owned());
            }
            record.state = UpdateJobState::ReadbackRequired;
            Ok(record.clone())
        }

        fn reconcile(
            &self,
            operation_id: &str,
            side_effect_ref: &str,
            result_digest: &str,
            version: &str,
        ) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("reconcile");
            let mut record = self.record.borrow_mut();
            if record.operation_id != operation_id {
                return Err("update operation mismatch".to_owned());
            }
            record.state = UpdateJobState::Reconciled;
            record.side_effect_ref = Some(side_effect_ref.to_owned());
            record.result_digest = Some(result_digest.to_owned());
            record.version = Some(version.to_owned());
            Ok(record.clone())
        }

        fn reject(&self, operation_id: &str, reason: &str) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("reject");
            let mut record = self.record.borrow_mut();
            if record.operation_id != operation_id {
                return Err("update operation mismatch".to_owned());
            }
            record.state = UpdateJobState::Rejected;
            record.error = Some(reason.to_owned());
            Ok(record.clone())
        }

        fn fail(&self, operation_id: &str, reason: &str) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("fail");
            let mut record = self.record.borrow_mut();
            if record.operation_id != operation_id {
                return Err("update operation mismatch".to_owned());
            }
            record.state = UpdateJobState::Failed;
            record.error = Some(reason.to_owned());
            Ok(record.clone())
        }
    }

    fn request() -> UpdateJobRequest {
        UpdateJobRequest {
            project_id: "project-update".to_owned(),
            operation_id: "op-update".to_owned(),
            request_digest: "sha256:update".to_owned(),
            target_identity: "target-binary".to_owned(),
        }
    }

    #[test]
    fn update_job_registers_and_leaves_pending_before_claiming_success() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let outcome = run_with_durable_job(&jobs, &request(), |running| {
            assert_eq!(running.state, UpdateJobState::Running);
            assert_eq!(jobs.events.borrow().as_slice(), ["register", "start"]);
            Ok(UpdateJobObservation::Pending)
        })
        .expect("pending update");

        assert!(matches!(outcome, UpdateJobOutcome::Pending(_)));
        assert!(!outcome.is_resolved());
        assert_eq!(jobs.events.borrow().as_slice(), ["register", "start"]);
    }

    #[test]
    fn update_job_readback_is_required_after_interrupted_installer() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let outcome = run_with_durable_job(&jobs, &request(), |_| {
            Ok(UpdateJobObservation::ReadbackRequired {
                side_effect_ref: "installer:pid-1".to_owned(),
            })
        })
        .expect("readback-required update");

        assert!(matches!(outcome, UpdateJobOutcome::ReadbackRequired(_)));
        assert!(!outcome.is_resolved());
        assert_eq!(
            jobs.events.borrow().as_slice(),
            ["register", "start", "readback"]
        );
    }

    #[test]
    fn update_job_reconciles_only_from_attributable_installer_readback() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let outcome = run_with_durable_job(&jobs, &request(), |_| {
            Ok(UpdateJobObservation::Reconciled {
                side_effect_ref: "installer:pid-1".to_owned(),
                result_digest: "sha256:installed".to_owned(),
                version: "2.0.0".to_owned(),
            })
        })
        .expect("reconciled update");

        assert!(outcome.is_resolved());
        assert_eq!(outcome.record().version.as_deref(), Some("2.0.0"));
        assert_eq!(
            jobs.events.borrow().as_slice(),
            ["register", "start", "reconcile"]
        );
    }

    #[test]
    fn update_job_rejection_is_durable_and_not_success() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let outcome = run_with_durable_job(&jobs, &request(), |_| {
            Ok(UpdateJobObservation::Rejected {
                reason: "target identity mismatch".to_owned(),
            })
        })
        .expect("rejected update");

        assert!(matches!(outcome, UpdateJobOutcome::Rejected(_)));
        assert!(!outcome.is_resolved());
        assert_eq!(
            outcome.record().error.as_deref(),
            Some("target identity mismatch")
        );
        assert_eq!(
            jobs.events.borrow().as_slice(),
            ["register", "start", "reject"]
        );
    }

    #[test]
    fn update_job_restart_reads_running_state_without_reinvoking_installer() {
        let jobs = FakeJobs::new(UpdateJobState::Running);
        let outcome = run_with_durable_job(&jobs, &request(), |_| {
            Err("installer must not run during restart readback".to_owned())
        })
        .expect("restart readback");

        assert!(matches!(outcome, UpdateJobOutcome::ReadbackRequired(_)));
        assert_eq!(jobs.events.borrow().as_slice(), ["register"]);
    }
}

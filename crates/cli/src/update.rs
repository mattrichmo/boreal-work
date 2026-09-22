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

# R-UPDATE — crates/cli/src/update.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/cli/src/update.rs:L1–L79`  
**File SHA-256:** `0a3c680ed8dabaab392d4f9e4fb536662cd6300b37a8ed69259541abd5663da2`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Update/upgrade implementations exist; installer invocation and reported identity need supported-platform validation.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,79p' 'crates/cli/src/update.rs'
```

## Exact baseline excerpt

````text
    1 | //! Machine update adapter for release-installed Boreal binaries.
    2 | //!
    3 | //! The release archive carries the same verified installer used for the
    4 | //! initial install. Keeping the update operation here means users can run
    5 | //! `bwrk update` (or the v1-compatible `bwrk upgrade --machine`) without
    6 | //! remembering a curl command, while the installer remains responsible for
    7 | //! archive verification and atomic replacement.
    8 | 
    9 | use super::{CliError, CliResult, ParsedCommand};
   10 | use boreal_protocol::{ApplicationOutcome, ErrorCode};
   11 | use serde_json::json;
   12 | use std::{env, path::PathBuf, process::Command};
   13 | 
   14 | pub(super) fn run(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
   15 |     let executable = env::current_exe().map_err(|error| {
   16 |         update_error(format!(
   17 |             "could not locate the running bwrk executable: {error}"
   18 |         ))
   19 |     })?;
   20 |     let executable = executable.canonicalize().unwrap_or(executable);
   21 |     let prefix = executable
   22 |         .parent()
   23 |         .and_then(|bin| bin.parent())
   24 |         .map(PathBuf::from)
   25 |         .ok_or_else(|| update_error("could not determine the Boreal installation prefix"))?;
   26 |     let installer = prefix.join("share/boreal/install.sh");
   27 |     if !installer.is_file() {
   28 |         if executable.to_string_lossy().contains("/Cellar/") {
   29 |             return Err(update_error(
   30 |                 "this bwrk installation is managed by Homebrew; run `brew upgrade boreal`",
   31 |             ));
   32 |         }
   33 |         return Err(update_error(format!(
   34 |             "this bwrk installation does not include its updater ({}); rerun the official installer once, then use `bwrk update`",
   35 |             installer.display()
   36 |         )));
   37 |     }
   38 | 
   39 |     let output = Command::new("sh")
   40 |         .arg(&installer)
   41 |         .arg("--prefix")
   42 |         .arg(&prefix)
   43 |         .output()
   44 |         .map_err(|error| update_error(format!("could not start the Boreal updater: {error}")))?;
   45 |     if !output.status.success() {
   46 |         let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
   47 |         let message = if detail.is_empty() {
   48 |             format!("Boreal update failed with {}", output.status)
   49 |         } else {
   50 |             format!("Boreal update failed: {detail}")
   51 |         };
   52 |         return Err(update_error(message));
   53 |     }
   54 | 
   55 |     let version = String::from_utf8_lossy(&output.stdout)
   56 |         .lines()
   57 |         .find_map(|line| line.strip_prefix("Boreal "))
   58 |         .and_then(|line| line.split_whitespace().next())
   59 |         .unwrap_or("latest")
   60 |         .to_owned();
   61 |     Ok(CliResult {
   62 |         outcome: ApplicationOutcome::Changed,
   63 |         data: parsed
   64 |             .options
   65 |             .json
   66 |             .then(|| json!({"command": "update", "version": version, "prefix": prefix})),
   67 |         human: (!parsed.options.json)
   68 |             .then(|| format!("Boreal updated successfully ({version}).\n")),
   69 |         ..CliResult::default()
   70 |     })
   71 | }
   72 | 
   73 | fn update_error(message: impl Into<String>) -> CliError {
   74 |     CliError::with(
   75 |         ErrorCode::ServiceUnavailable,
   76 |         ApplicationOutcome::Failed,
   77 |         message,
   78 |     )
   79 | }
````

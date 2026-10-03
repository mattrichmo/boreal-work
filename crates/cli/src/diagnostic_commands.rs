//! Read-only installation and project diagnostics plus bounded skill install.
//!
//! These helpers are intentionally adapter-facing. Schema and SQLite checks
//! delegate to the store's read-only contract/diagnostic APIs; skill payloads
//! come from the same embedded package as `bwrk init`.

use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

use super::{
    project_context, setup, ApplicationOutcome, CliError, CliResult, ParsedCommand, SqliteStore,
};

const MAX_SKILL_FILE: u64 = 2 * 1024 * 1024;

fn error(message: impl Into<String>) -> CliError {
    CliError::invalid(message)
}

fn option<'a>(parsed: &'a ParsedCommand, key: &str) -> Option<&'a str> {
    parsed
        .options
        .extra
        .get(key)
        .and_then(|values| values.last())
        .map(String::as_str)
}

fn path_is(path: &[String], expected: &[&str]) -> bool {
    path.len() == expected.len()
        && path
            .iter()
            .zip(expected)
            .all(|(actual, expected)| actual == expected)
}

pub(crate) fn supported(path: &[String]) -> bool {
    path_is(path, &["install", "status"])
        || path_is(path, &["integrations"])
        || path_is(path, &["integrations", "status"])
        || path_is(path, &["integrations", "add"])
        || path_is(path, &["doctor", "skills"])
        || path_is(path, &["schema", "validate"])
        || path_is(path, &["docs", "check"])
        || path_is(path, &["gate"])
        || path_is(path, &["gate", "closeout"])
}

pub(crate) fn pre_project(path: &[String]) -> bool {
    path_is(path, &["install", "status"])
        || path_is(path, &["docs", "check"])
        || path_is(path, &["integrations", "status"])
        || path_is(path, &["integrations", "add"])
        || path_is(path, &["integrations"])
        || path_is(path, &["doctor", "skills"])
}

pub(crate) fn run_pre(parsed: &ParsedCommand, _operation: &str) -> Result<CliResult, CliError> {
    let path = parsed.path.iter().map(String::as_str).collect::<Vec<_>>();
    let data = match path.as_slice() {
        ["install", "status"] => install_status()?,
        ["docs", "check"] => docs_check()?,
        ["integrations"]
        | ["integrations", "status"]
        | ["doctor", "skills"]
        | ["integrations", "add"] => {
            let user_scope = match option(parsed, "--scope").unwrap_or("project") {
                "project" => false,
                "user" => true,
                _ => return Err(error("--scope accepts project or user")),
            };
            let agent = option(parsed, "--agent").unwrap_or("codex");
            if path_is(&parsed.path, &["integrations", "add"]) && !parsed.options.setup.yes {
                return Err(error(
                    "integrations add requires explicit --yes confirmation",
                ));
            }
            let project_root = if user_scope {
                env::current_dir().map_err(|e| error(e.to_string()))?
            } else {
                project_context::resolve(parsed)?.root
            };
            let root = integration_root(&project_root, agent, user_scope)?;
            let (manifest_root, manifest) = integration_manifest(&project_root, user_scope)?;
            if path_is(&parsed.path, &["integrations", "add"]) {
                add_skills(&root, &manifest, &manifest_root, agent)?
            } else {
                skills_status(&root, &manifest, &manifest_root, agent)?
            }
        }
        _ => {
            return Err(CliError::invalid(
                "command does not support pre-project diagnostics",
            ));
        }
    };
    let passed = data
        .get("passed")
        .and_then(Value::as_bool)
        .or_else(|| {
            data.get("state")
                .and_then(Value::as_str)
                .map(|s| s == "current")
        })
        .unwrap_or(true);
    let changed = path_is(&parsed.path, &["integrations", "add"])
        && (data["created"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
            || data["updated"]
                .as_array()
                .is_some_and(|items| !items.is_empty()));
    let human = if path_is(&parsed.path, &["integrations", "add"]) {
        format!(
            "created {} files; updated {}; preserved {}",
            data["created"].as_array().map_or(0, Vec::len),
            data["updated"].as_array().map_or(0, Vec::len),
            data["preserved"].as_u64().unwrap_or(0)
        )
    } else if path_is(&parsed.path, &["install", "status"]) {
        format!(
            "bwrk {} at {}",
            env!("CARGO_PKG_VERSION"),
            data["running_binary"].as_str().unwrap_or("unknown")
        )
    } else if passed {
        "embedded docs and workflows are consistent".to_owned()
    } else {
        "embedded docs, workflows, or command registry have drift".to_owned()
    };
    Ok(CliResult {
        outcome: if !passed {
            ApplicationOutcome::Rejected
        } else if changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        },
        data: Some(data),
        human: Some(human),
        ..CliResult::default()
    })
}

pub(crate) fn run(
    parsed: &ParsedCommand,
    _operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let path = parsed.path.iter().map(String::as_str).collect::<Vec<_>>();
    let data = match path.as_slice() {
        ["gate"] | ["gate", "closeout"] | ["schema", "validate"] => {
            let context = project_context::resolve(parsed)?;
            project_context::validate_store(&context, store)?;
            if path_is(&parsed.path, &["schema", "validate"]) {
                schema_validate_store(&context.database, store)?
            } else {
                let agent = option(parsed, "--agent").unwrap_or("codex");
                let root = integration_root(&context.root, agent, false)?;
                let (manifest_root, manifest) = integration_manifest(&context.root, false)?;
                gate(
                    &context.database,
                    &root,
                    &manifest,
                    &manifest_root,
                    agent,
                    store,
                )?
            }
        }
        _ => return Err(CliError::invalid("unknown diagnostic command")),
    };
    let success = if let Some(value) = data.get("passed").and_then(Value::as_bool) {
        value
    } else if let Some(value) = data.get("state").and_then(Value::as_str) {
        value == "current"
    } else {
        true
    };
    let human = if success {
        "diagnostic gate passed"
    } else {
        "diagnostic gate reported failures"
    };
    Ok(CliResult {
        outcome: if !success {
            ApplicationOutcome::Rejected
        } else {
            ApplicationOutcome::Unchanged
        },
        data: Some(data),
        human: Some(human.to_owned()),
        ..CliResult::default()
    })
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, CliError> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|e| error(format!("read {}: {e}", path.display())))?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| error(e.to_string()))?;
    if bytes.len() as u64 > limit {
        return Err(error(format!(
            "{} exceeds diagnostic read bound",
            path.display()
        )));
    }
    Ok(bytes)
}

/// Report the running binary and any other `bwrk` found on PATH.
pub(super) fn install_status() -> Result<Value, CliError> {
    let executable =
        env::current_exe().map_err(|e| error(format!("cannot resolve running binary: {e}")))?;
    let executable_canonical = fs::canonicalize(&executable).unwrap_or_else(|_| executable.clone());
    let mut path_matches = Vec::new();
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path).take(512) {
            let candidate = directory.join(if cfg!(windows) { "bwrk.exe" } else { "bwrk" });
            if candidate.is_file() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if fs::metadata(&candidate)
                        .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 == 0)
                    {
                        continue;
                    }
                }
                let canonical = fs::canonicalize(&candidate).unwrap_or(candidate.clone());
                if path_matches
                    .iter()
                    .any(|entry: &Value| entry["canonical_path"].as_str() == canonical.to_str())
                {
                    continue;
                }
                path_matches.push(json!({"path": candidate, "canonical_path": canonical,
                    "is_running_binary": canonical == executable_canonical}));
            }
        }
    }
    let path_winner = path_matches.first().cloned();
    let path_conflict = path_winner
        .as_ref()
        .is_some_and(|x| !x["is_running_binary"].as_bool().unwrap_or(false));
    Ok(
        json!({"running_binary": executable, "running_binary_canonical":executable_canonical,
        "version": env!("CARGO_PKG_VERSION"),"path_winner":path_winner,
        "path_matches": path_matches, "path_conflict": path_conflict}),
    )
}

/// Resolve one harness's project-local (default) or explicitly user-wide root.
pub(super) fn integration_root(
    project_root: &Path,
    agent: &str,
    user_scope: bool,
) -> Result<PathBuf, CliError> {
    let suffix = match agent {
        "codex" => PathBuf::from(".agents/skills"),
        "claude" => PathBuf::from(".claude/skills"),
        _ => return Err(error("integration agent must be codex or claude")),
    };
    let scope_root = if user_scope {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| error("HOME is not available for user-scope installation"))?;
        fs::canonicalize(home).map_err(|e| error(format!("user scope root unavailable: {e}")))?
    } else {
        if !project_root.join(".boreal/project.json").is_file() {
            return Err(error(
                "project-scope integrations require an initialized current folder; run bwrk init first",
            ));
        }
        fs::canonicalize(project_root)
            .map_err(|e| error(format!("project root unavailable: {e}")))?
    };
    let manifest = scope_root.join(".boreal/skills.json");
    match fs::symlink_metadata(&manifest) {
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err(error("skill root manifest may not be a symbolic link"));
        }
        Ok(meta) if !meta.is_file() => {
            return Err(error("skill root manifest is not a regular file"));
        }
        Ok(_) => {
            let bytes = read_bounded(&manifest, 256 * 1024)?;
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|e| error(format!("skill root manifest is invalid JSON: {e}")))?;
            if let Some(stored) = value["roots"]
                .as_array()
                .and_then(|roots| {
                    roots
                        .iter()
                        .find(|entry| entry["agent"].as_str() == Some(agent))
                })
                .and_then(|entry| entry["path"].as_str())
            {
                let candidate = PathBuf::from(stored);
                if candidate
                    .components()
                    .any(|component| matches!(component, std::path::Component::ParentDir))
                {
                    return Err(error("skill root manifest contains parent traversal"));
                }
                let candidate = if candidate.is_absolute() {
                    candidate
                } else {
                    scope_root.join(candidate)
                };
                if !candidate.starts_with(&scope_root) {
                    return Err(error("skill root manifest escapes its scope root"));
                }
                return root_without_symlinks(&candidate);
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(error(format!("inspect skill root manifest: {e}"))),
    }
    root_without_symlinks(&scope_root.join(suffix))
}

pub(super) fn integration_manifest(
    project_root: &Path,
    user_scope: bool,
) -> Result<(PathBuf, PathBuf), CliError> {
    let manifest_root = if user_scope {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| error("HOME is not available for user-scope installation"))?;
        fs::canonicalize(home).map_err(|e| error(format!("user scope root unavailable: {e}")))?
    } else {
        if !project_root.join(".boreal/project.json").is_file() {
            return Err(error(
                "project-scope integrations require an initialized current folder; run bwrk init first",
            ));
        }
        fs::canonicalize(project_root)
            .map_err(|e| error(format!("project root unavailable: {e}")))?
    };
    let manifest = manifest_root.join(".boreal/skills.json");
    Ok((manifest_root, manifest))
}

fn package_files(agent: &str) -> Result<Vec<(PathBuf, &'static str)>, CliError> {
    let mut out = Vec::new();
    for (skill, files) in setup::SKILL_ASSETS {
        for (name, contents) in *files {
            if agent == "claude" && *name == "agents/openai.yaml" {
                continue;
            }
            let relative = PathBuf::from(skill).join(name);
            if contents.len() as u64 > MAX_SKILL_FILE {
                return Err(error("embedded skill asset exceeds the installation bound"));
            }
            out.push((relative, *contents));
        }
    }
    Ok(out)
}

fn root_without_symlinks(path: &Path) -> Result<PathBuf, CliError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .map_err(|e| error(e.to_string()))?
            .join(path)
    };
    let mut cursor = PathBuf::new();
    for component in absolute.components() {
        cursor.push(component.as_os_str());
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(error(format!(
                    "skill install path contains a symbolic link: {}",
                    cursor.display()
                )));
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(error(format!("inspect {}: {e}", cursor.display()))),
        }
    }
    if absolute.exists() {
        if !absolute.is_dir() {
            return Err(error("skill install root is not a directory"));
        }
        fs::canonicalize(absolute).map_err(|e| error(e.to_string()))
    } else {
        Ok(absolute)
    }
}

fn confined_asset(root: &Path, rel: &Path) -> Result<PathBuf, CliError> {
    if rel
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(error("invalid embedded skill path"));
    }
    let mut cursor = root.to_path_buf();
    for component in rel.components() {
        cursor.push(component.as_os_str());
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(error(format!(
                    "skill path contains a symbolic link: {}",
                    cursor.display()
                )));
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(error(format!("inspect {}: {e}", cursor.display()))),
        }
    }
    Ok(cursor)
}

/// Inspect exactly the embedded package's files under one install root.
pub(super) fn skills_status(
    install_root: &Path,
    manifest_path: &Path,
    manifest_root: &Path,
    agent: &str,
) -> Result<Value, CliError> {
    if !matches!(agent, "codex" | "claude") {
        return Err(error("integration agent must be codex or claude"));
    }
    let root = root_without_symlinks(install_root)?;
    let manifest_root = root_without_symlinks(manifest_root)?;
    let manifest_rel = manifest_path
        .strip_prefix(&manifest_root)
        .map_err(|_| error("skill manifest escapes its scope root"))?;
    let safe_manifest = confined_asset(&manifest_root, manifest_rel)?;
    let manifest: Value = match fs::symlink_metadata(&safe_manifest) {
        Ok(meta) if !meta.is_file() => Value::Null,
        Ok(_) => read_bounded(&safe_manifest, 256 * 1024)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Value::Null,
        Err(e) => return Err(error(format!("inspect skill manifest: {e}"))),
    };
    let expected_manifest: Value =
        serde_json::from_str(include_str!("../../../skills/manifest.json"))
            .map_err(|e| error(format!("embedded skill manifest is invalid: {e}")))?;
    let mut files = Vec::new();
    for (rel, contents) in package_files(agent)? {
        let path = confined_asset(&root, &rel)?;
        let state = match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(error(format!(
                    "skill path contains a symbolic link: {}",
                    path.display()
                )));
            }
            Ok(meta) if !meta.is_file() => "wrong_type",
            Ok(meta) if meta.len() > MAX_SKILL_FILE => "oversized",
            Ok(_) => match read_bounded(&path, MAX_SKILL_FILE) {
                Ok(bytes) if bytes == contents.as_bytes() => "current",
                Ok(_) => "modified",
                Err(_) => "oversized",
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing",
            Err(e) => return Err(error(format!("inspect {}: {e}", path.display()))),
        };
        files.push(json!({"path": rel, "state": state,
            "expected_digest": boreal_store::checksum(contents.as_bytes())}));
    }
    let current_version = expected_manifest["package_version"].as_str();
    let installed_version = manifest["package_version"].as_str();
    let all_current = files.iter().all(|f| f["state"] == "current");
    let identity_matches = manifest["schema_version"] == "boreal.skill-install.v1"
        && manifest["package"] == expected_manifest["package_id"]
        && installed_version == current_version
        && manifest["agents"]
            .as_array()
            .is_some_and(|agents| agents.iter().any(|entry| entry == agent))
        && manifest["workflow_package"] == expected_manifest["workflow_package"]
        && manifest["roots"].as_array().is_some_and(|roots| {
            roots.iter().any(|entry| {
                entry["agent"] == agent
                    && entry["path"].as_str() == Some(root.to_string_lossy().as_ref())
            })
        })
        && manifest["files"].as_array().is_some_and(|installed| {
            files.iter().all(|expected| {
                let expected_path = root.join(expected["path"].as_str().unwrap_or(""));
                let manifest_key = expected_path
                    .strip_prefix(&manifest_root)
                    .ok()
                    .map(|p| p.to_string_lossy());
                installed.iter().any(|entry| {
                    entry["path"].as_str() == manifest_key.as_deref()
                        && entry["package_digest"] == expected["expected_digest"]
                })
            })
        });
    Ok(
        json!({"install_root": root, "package_id": expected_manifest["package_id"],
        "installed_package_version": installed_version, "available_package_version": current_version,
        "manifest_identity_matches": identity_matches,
        "state": if all_current && identity_matches {"current"} else {"drifted"},
        "files": files}),
    )
}

/// Install built-in skills without touching work data or overwriting edited files.
pub(super) fn add_skills(
    install_root: &Path,
    manifest_path: &Path,
    manifest_root: &Path,
    agent: &str,
) -> Result<Value, CliError> {
    setup::install_skill_package(install_root, manifest_path, manifest_root, agent)
}

/// Validate checked-in user-facing docs and the exact embedded skill package.
pub(super) fn docs_check() -> Result<Value, CliError> {
    let mut route_checks = Vec::new();
    let docs = include_str!("../../../docs/CLI_DIAGNOSTICS.md");
    for route in [
        "install status",
        "integrations",
        "integrations status",
        "integrations add",
        "doctor skills",
        "schema validate",
        "docs check",
        "gate",
        "gate closeout",
    ] {
        let documented = docs.contains(route);
        let path = route
            .split_whitespace()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let available = super::command_registry::is_available_path(&path);
        route_checks.push(json!({"route":route,"documented":documented,"available":available,"passed":documented && available}));
    }
    let skill_package: Value = serde_json::from_str(include_str!("../../../skills/manifest.json"))
        .map_err(|e| error(format!("embedded skill manifest is invalid: {e}")))?;
    let workflow_manifest: Value = serde_json::from_str(include_str!(
        "../../../project/spec/workflows/manifest.json"
    ))
    .map_err(|e| error(format!("embedded workflow manifest is invalid: {e}")))?;
    let workflow_package: Value =
        serde_json::from_str(include_str!("../../../project/spec/workflows/package.json"))
            .map_err(|e| error(format!("embedded workflow package is invalid: {e}")))?;
    let expected_version = workflow_package["package_version"].as_str();
    let mut workflow_checks = Vec::new();
    for (filename, content) in embedded_workflows() {
        let recipe: Value = serde_json::from_str(content)
            .map_err(|e| error(format!("embedded workflow {filename} is invalid: {e}")))?;
        let reference = recipe["ref"].as_str().unwrap_or("");
        let registered = workflow_manifest["workflow_refs"]
            .as_array()
            .is_some_and(|refs| refs.iter().any(|r| r.as_str() == Some(reference)));
        let mut missing_commands = Vec::new();
        let mut invalid_flags = Vec::new();
        if let Some(commands) = recipe["allowed_commands"].as_array() {
            for command in commands.iter().filter_map(Value::as_str) {
                let tokens = command.split_whitespace().collect::<Vec<_>>();
                if tokens.first().copied() != Some("bwrk") {
                    missing_commands.push(command);
                    continue;
                }
                let route_end = (1..tokens.len())
                    .take_while(|index| {
                        !tokens[*index].starts_with('-') && !tokens[*index].starts_with('<')
                    })
                    .filter(|end| {
                        let route = tokens[1..*end + 1]
                            .iter()
                            .map(|s| (*s).to_owned())
                            .collect::<Vec<_>>();
                        super::command_registry::is_available_path(&route)
                    })
                    .max();
                let Some(route_end) = route_end else {
                    missing_commands.push(command);
                    continue;
                };
                let route = tokens[1..=route_end]
                    .iter()
                    .map(|s| (*s).to_owned())
                    .collect::<Vec<_>>();
                let Some(syntax) = super::command_registry::syntax_for(&route) else {
                    missing_commands.push(command);
                    continue;
                };
                let accepted_flags = syntax
                    .split_whitespace()
                    .map(|token| {
                        token.trim_matches(|c: char| {
                            !c.is_ascii_alphanumeric() && c != '-' && c != '_'
                        })
                    })
                    .filter(|token| token.starts_with("--"))
                    .chain([
                        "--json",
                        "--socket",
                        "--project",
                        "--actor",
                        "--session",
                        "--db",
                        "--operation-id",
                    ])
                    .collect::<std::collections::HashSet<_>>();
                for flag in tokens
                    .iter()
                    .skip(route_end + 1)
                    .filter(|token| token.starts_with("--"))
                {
                    if !accepted_flags.contains(flag) {
                        invalid_flags.push(format!("{command}: {flag}"));
                    }
                }
            }
        } else {
            missing_commands.push("<missing allowed_commands>");
        }
        workflow_checks.push(
            json!({"file":filename,"ref":reference,"registered":registered,
            "missing_commands":missing_commands,"invalid_flags":invalid_flags,
            "passed":registered && missing_commands.is_empty() && invalid_flags.is_empty()}),
        );
    }
    let mut skill_checks = Vec::new();
    if let Some(skills) = skill_package["skills"].as_array() {
        for skill in skills {
            let name = skill["name"].as_str().unwrap_or("");
            let yaml = embedded_skill_metadata(name)
                .ok_or_else(|| error(format!("embedded metadata is missing for {name}")))?;
            let yaml_version = yaml.lines().find_map(|line| {
                line.trim()
                    .strip_prefix("workflow_package_version:")
                    .map(str::trim)
            });
            let yaml_ref = yaml.lines().enumerate().find_map(|(index, line)| {
                if line.trim() != "workflows:" {
                    return None;
                }
                yaml.lines().skip(index + 1).find_map(|next| {
                    if next.trim().is_empty() {
                        return None;
                    }
                    next.trim().strip_prefix("- ").map(str::trim)
                })
            });
            let package_ref = skill["workflows"]
                .as_array()
                .and_then(|refs| refs.first())
                .and_then(Value::as_str);
            let version_ok = yaml_version == expected_version;
            let ref_ok = yaml_ref == package_ref;
            skill_checks.push(json!({"skill":name,"workflow_ref_matches":ref_ok,"workflow_version_matches":version_ok,"passed":ref_ok && version_ok}));
        }
    }
    let passed = route_checks.iter().all(|c| c["passed"] == true)
        && workflow_checks.iter().all(|c| c["passed"] == true)
        && skill_checks.iter().all(|c| c["passed"] == true)
        && skill_package["schema_version"] == "boreal.skill_package.v2"
        && workflow_manifest["schema_version"] == "boreal.workflow_asset.v1"
        && workflow_package["schema_version"] == "boreal.workflow_package.v1"
        && skill_package["workflow_package"]["package_version"].as_str() == expected_version;
    Ok(
        json!({"read_only":true,"passed":passed,"routes":route_checks,"workflows":workflow_checks,
        "skill_metadata":skill_checks,"embedded_versions":{"skills":skill_package["package_version"],
        "workflows":expected_version,"workflow_registry":workflow_manifest["registry_version"],
        "skill_workflow_package":skill_package["workflow_package"]["package_version"]}}),
    )
}

fn embedded_workflows() -> &'static [(&'static str, &'static str)] {
    &[
        (
            "route",
            include_str!("../../../project/spec/workflows/route.json"),
        ),
        (
            "context",
            include_str!("../../../project/spec/workflows/context.json"),
        ),
        (
            "plan",
            include_str!("../../../project/spec/workflows/plan.json"),
        ),
        (
            "claim",
            include_str!("../../../project/spec/workflows/claim.json"),
        ),
        (
            "finish",
            include_str!("../../../project/spec/workflows/finish.json"),
        ),
        (
            "review",
            include_str!("../../../project/spec/workflows/review.json"),
        ),
        (
            "audit",
            include_str!("../../../project/spec/workflows/audit.json"),
        ),
        (
            "handoff",
            include_str!("../../../project/spec/workflows/handoff.json"),
        ),
        (
            "health",
            include_str!("../../../project/spec/workflows/health.json"),
        ),
        (
            "memory",
            include_str!("../../../project/spec/workflows/memory.json"),
        ),
    ]
}

fn embedded_skill_metadata(name: &str) -> Option<&'static str> {
    Some(match name {
        "boreal-route" => include_str!("../../../skills/boreal-route/boreal.yaml"),
        "boreal-context" => include_str!("../../../skills/boreal-context/boreal.yaml"),
        "boreal-plan" => include_str!("../../../skills/boreal-plan/boreal.yaml"),
        "boreal-claim" => include_str!("../../../skills/boreal-claim/boreal.yaml"),
        "boreal-finish" => include_str!("../../../skills/boreal-finish/boreal.yaml"),
        "boreal-review" => include_str!("../../../skills/boreal-review/boreal.yaml"),
        "boreal-audit" => include_str!("../../../skills/boreal-audit/boreal.yaml"),
        "boreal-handoff" => include_str!("../../../skills/boreal-handoff/boreal.yaml"),
        "boreal-health" => include_str!("../../../skills/boreal-health/boreal.yaml"),
        "boreal-memory" => include_str!("../../../skills/boreal-memory/boreal.yaml"),
        _ => return None,
    })
}

pub(super) fn gate(
    database: &Path,
    install_root: &Path,
    manifest_path: &Path,
    manifest_root: &Path,
    agent: &str,
    store: &SqliteStore,
) -> Result<Value, CliError> {
    let schema = schema_validate_store(database, store)?;
    let docs = docs_check()?;
    let skills = skills_status(install_root, manifest_path, manifest_root, agent)?;
    let v3_enabled = store
        .work_model_v3_enabled()
        .map_err(|e| error(e.to_string()))?;
    let doctor_health = json!({
        "database_open":"pass",
        "schema_contract":schema["contract"],
        "work_model_v3":if v3_enabled {"enabled"} else {"not_enabled"},
        "sqlite_runtime":store.sqlite_runtime_identity().as_json(),
        "integrity":schema["details"],
        "passed":schema["passed"] == true && v3_enabled,
    });
    Ok(
        json!({"read_only":true,"checks":{"health":doctor_health,"database_schema":schema,"docs":docs,"project_skills":skills},
        "passed": doctor_health["passed"] == true && docs["passed"] == true && skills["state"] == "current"}),
    )
}

fn schema_validate_store(database: &Path, store: &SqliteStore) -> Result<Value, CliError> {
    let contract = store
        .validate_contract_for_inspection()
        .map_err(|e| e.to_string());
    let version = store.schema_version().map_err(|e| error(e.to_string()))?;
    let integrity = store
        .diagnostic_checks()
        .map_err(|e| error(e.to_string()))?;
    let quick_ok = integrity["quick_check"]
        .as_array()
        .is_some_and(|rows| rows.len() == 1 && rows[0] == "ok");
    let fk_ok = integrity["foreign_key_violations"]
        .as_array()
        .is_some_and(|rows| rows.is_empty());
    Ok(
        json!({"database":database,"read_only":true,"schema_version":version,
        "contract":if contract.is_ok(){"valid"}else{"invalid"},"contract_error":contract.as_ref().err(),"quick_check":if quick_ok {"pass"} else {"fail"},
        "foreign_key_check":if fk_ok {"pass"} else {"fail"},"details":integrity,
        "passed":contract.is_ok() && quick_ok && fk_ok}),
    )
}

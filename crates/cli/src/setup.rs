//! Local project setup for the user-facing `bwrk init` flow.
//!
//! The SQLite project remains owned by the application/store boundary. This
//! module owns only adapter concerns: choosing setup options, creating the
//! project files, and installing the checked-in harness adapters.

use super::{CliError, ParsedCommand, SetupCliOptions};
use boreal_protocol::{ApplicationOutcome, ErrorCode};
use serde_json::{Value, json};
use std::{
    env, fs,
    io::{self, IsTerminal, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const DEFAULT_DB: &str = ".boreal/boreal.sqlite";
const SETUP_SCHEMA: &str = "boreal.project-setup.v2";
const SKILL_INSTALL_SCHEMA: &str = "boreal.skill-install.v1";
const GITIGNORE_MARKER: &str = "# Boreal managed local runtime";
const MEMORY_GITIGNORE_MARKER: &str = "# Boreal managed memory runtime";
const MEMORY_DIRECTORIES: &[&str] = &["notes"];

const MEMORY_FILES: &[(&str, &str)] = &[(
    "index.md",
    "# Boreal Project Memory\n\nPublished curated notes live in notes/ and manifest.json. Use the Boreal memory draft, review, publish, and reconcile workflow. Raw sources and live work belong in the local .boreal/ store.\n",
)];

pub(super) const SKILL_ASSETS: &[(&str, &[(&str, &str)])] = &[
    (
        "boreal-route",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-route/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-route/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-route/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-context",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-context/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-context/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-context/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-plan",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-plan/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-plan/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-plan/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-claim",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-claim/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-claim/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-claim/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-finish",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-finish/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-finish/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-finish/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-review",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-review/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-review/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-review/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-audit",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-audit/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-audit/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-audit/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-handoff",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-handoff/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-handoff/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-handoff/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-health",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-health/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-health/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-health/agents/openai.yaml"),
            ),
        ],
    ),
    (
        "boreal-memory",
        &[
            (
                "SKILL.md",
                include_str!("../../../skills/boreal-memory/SKILL.md"),
            ),
            (
                "boreal.yaml",
                include_str!("../../../skills/boreal-memory/boreal.yaml"),
            ),
            (
                "agents/openai.yaml",
                include_str!("../../../skills/boreal-memory/agents/openai.yaml"),
            ),
        ],
    ),
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct SetupPlan {
    pub(super) command: String,
    pub(super) project_id: String,
    pub(super) project_root: PathBuf,
    pub(super) database: PathBuf,
    pub(super) memory_root: PathBuf,
    pub(super) memory_layout: String,
    pub(super) agents: Vec<String>,
    pub(super) skill_roots: Vec<(String, PathBuf)>,
    pub(super) dry_run: bool,
    pub(super) operator_actor: String,
    pub(super) operator_session: String,
    metadata_digest: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct SetupResult {
    pub(super) created_files: Vec<String>,
    pub(super) updated_files: Vec<String>,
    pub(super) existing_files: Vec<String>,
    pub(super) created_directories: Vec<String>,
    pub(super) existing_directories: Vec<String>,
    pub(super) skill_files: usize,
    pub(super) skill_files_created: usize,
    pub(super) skill_files_updated: usize,
    pub(super) skill_files_preserved: usize,
    pub(super) skill_conflicts: Vec<String>,
    pub(super) memory_git: &'static str,
    pub(super) memory_publication_ready: bool,
    pub(super) changed: bool,
}

/// Install one harness's embedded files using the same digest-aware,
/// symlink-rejecting write rules and manifest shape as `bwrk init`.
pub(super) fn install_skill_package(
    install_root: &Path,
    manifest_path: &Path,
    manifest_root: &Path,
    agent: &str,
) -> Result<Value, CliError> {
    if !matches!(agent, "codex" | "claude") {
        return Err(CliError::invalid(
            "integration agent must be codex or claude",
        ));
    }
    let install_root = install_root.to_path_buf();
    let mut result = SetupResult::default();
    ensure_directory(&install_root, manifest_root, &mut result)?;
    ensure_directory(
        manifest_path
            .parent()
            .ok_or_else(|| setup_error("manifest path has no parent"))?,
        manifest_root,
        &mut result,
    )?;
    validate_destination(manifest_root, manifest_path, false)?;
    let previous: Value = fs::metadata(manifest_path)
        .ok()
        .filter(|m| m.len() <= 256 * 1024)
        .and_then(|_| fs::read(manifest_path).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let assets = SKILL_ASSETS
        .iter()
        .flat_map(|(skill, files)| {
            files.iter().filter_map(move |(name, contents)| {
                if agent == "claude" && *name == "agents/openai.yaml" {
                    None
                } else {
                    Some((PathBuf::from(skill).join(name), *contents))
                }
            })
        })
        .collect::<Vec<_>>();
    for (relative_path, contents) in &assets {
        let path = install_root.join(relative_path);
        ensure_directory(
            path.parent().unwrap_or(&install_root),
            manifest_root,
            &mut result,
        )?;
        let key = relative(manifest_root, &path);
        let known = previous["files"]
            .as_array()
            .and_then(|files| files.iter().find(|f| f["path"].as_str() == Some(&key)))
            .and_then(|f| f["package_digest"].as_str());
        let metadata = fs::symlink_metadata(&path);
        let existing = match metadata {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(setup_error(format!(
                    "skill path contains a symbolic link: {}",
                    path.display()
                )));
            }
            Ok(meta) if !meta.is_file() => {
                return Err(setup_error(format!(
                    "skill path is not a file: {}",
                    path.display()
                )));
            }
            Ok(meta) if meta.len() > 2 * 1024 * 1024 => {
                result.skill_conflicts.push(key);
                result.skill_files_preserved += 1;
                result.skill_files += 1;
                continue;
            }
            Ok(_) => Some(fs::read(&path).map_err(|e| setup_error(e.to_string()))?),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(setup_error(format!("inspect {}: {error}", path.display()))),
        };
        if existing.as_ref().is_some_and(|bytes| {
            bytes != contents.as_bytes() && known != Some(boreal_store::checksum(bytes).as_str())
        }) {
            result.skill_conflicts.push(key);
            result.skill_files_preserved += 1;
        } else {
            let before = (result.created_files.len(), result.updated_files.len());
            write_managed(&path, contents, manifest_root, &mut result)?;
            if result.created_files.len() > before.0 {
                result.skill_files_created += 1;
            } else if result.updated_files.len() > before.1 {
                result.skill_files_updated += 1;
            } else {
                result.skill_files_preserved += 1;
            }
        }
        result.skill_files += 1;
    }
    let package: Value = serde_json::from_str(include_str!("../../../skills/manifest.json"))
        .map_err(|e| setup_error(e.to_string()))?;
    let current_prefix = format!("{}/", relative(manifest_root, &install_root));
    let mut preserved_files = previous["files"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| {
            entry["path"]
                .as_str()
                .is_some_and(|path| !path.starts_with(&current_prefix))
        })
        .collect::<Vec<_>>();
    let mut current_files = assets
        .iter()
        .map(|(path, contents)| {
            json!({
                "path": relative(manifest_root, &install_root.join(path)),
                "package_digest": boreal_store::checksum(contents.as_bytes())
            })
        })
        .collect::<Vec<_>>();
    preserved_files.append(&mut current_files);
    let mut preserved_roots = previous["roots"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| entry["agent"].as_str() != Some(agent))
        .collect::<Vec<_>>();
    preserved_roots.push(json!({"agent":agent,"path":install_root}));
    let mut agents = previous["agents"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| entry.as_str() != Some(agent))
        .collect::<Vec<_>>();
    agents.push(json!(agent));
    let manifest = json!({
        "schema_version": SKILL_INSTALL_SCHEMA,
        "package": package["package_id"],
        "package_version": package["package_version"],
        "workflow_package": package["workflow_package"],
        "files": preserved_files,
        "agents": agents,
        "roots": preserved_roots,
    });
    write_managed(
        manifest_path,
        &format!("{}\n", serde_json::to_string_pretty(&manifest).unwrap()),
        manifest_root,
        &mut result,
    )?;
    Ok(
        json!({"install_root":install_root,"manifest":manifest_path,"agent":agent,
        "created":result.created_files,"updated":result.updated_files,"preserved":result.skill_files_preserved,
        "conflicts":result.skill_conflicts,"package_version":package["package_version"]}),
    )
}

pub(super) fn is_setup_command(path: &[String]) -> bool {
    matches!(path, [command] if matches!(command.as_str(), "init" | "setup" | "install"))
}

pub(super) fn project_id(parsed: &ParsedCommand, project_root: &Path) -> Result<String, CliError> {
    if parsed.options.positionals.len() > 1 {
        return Err(CliError::invalid(
            "project setup accepts at most one folder",
        ));
    }
    if let Some(project) = parsed.options.project.as_deref() {
        let project = project.trim();
        if project.is_empty() {
            return Err(CliError::invalid("project identifier must not be empty"));
        }
        return Ok(project.to_owned());
    }
    let name = project_root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("project");
    Ok(name.to_owned())
}

pub(super) fn prepare(parsed: &ParsedCommand) -> Result<SetupPlan, CliError> {
    let mut restored = parsed.clone();
    let mut saved_skill_roots = Vec::new();
    let root = resolve_project_root(parsed)?;
    let committed = root.join(".boreal/project.json");
    let pending = root.join(".boreal/setup-pending.json");
    validate_destination(&root, &pending, false)?;
    let metadata = if committed.exists() {
        committed
    } else {
        pending
    };
    validate_destination(&root, &metadata, false)?;
    let metadata_digest = if metadata.is_file() {
        Some(boreal_store::checksum(
            &fs::read(&metadata).map_err(|e| setup_error(e.to_string()))?,
        ))
    } else {
        None
    };
    if metadata.is_file() {
        let saved: Value =
            serde_json::from_slice(&fs::read(&metadata).map_err(|e| setup_error(e.to_string()))?)
                .map_err(|e| setup_error(format!("invalid project setup metadata: {e}")))?;
        if saved["schema_version"] != SETUP_SCHEMA
            || saved["project_root"].as_str() != root.to_str()
        {
            return Err(setup_error(
                "project metadata does not match this folder; explicit migration is required",
            ));
        }
        let id = saved["project_id"]
            .as_str()
            .ok_or_else(|| setup_error("missing saved project identity"))?;
        if parsed.options.project.as_deref().is_some_and(|p| p != id) {
            return Err(setup_error(
                "init cannot change an existing project's identity",
            ));
        }
        restored.options.project = Some(id.to_owned());
        if parsed.options.actor_explicit
            && saved["operator_actor"]
                .as_str()
                .is_some_and(|actor| actor != parsed.options.actor)
        {
            return Err(setup_error(
                "init cannot change the saved operator; use auth key and auth grant to add actors",
            ));
        }
        if parsed.options.db == DEFAULT_DB {
            restored.options.db = saved["database"]
                .as_str()
                .ok_or_else(|| setup_error("missing saved database"))?
                .to_owned();
        } else if saved["database"].as_str()
            != confined_setup_path(&root, Path::new(&parsed.options.db))?.to_str()
        {
            return Err(setup_error(
                "init cannot change an existing project's database",
            ));
        }
        if parsed
            .options
            .setup
            .memory_layout
            .as_deref()
            .is_some_and(|v| Some(v) != saved["memory_layout"].as_str())
        {
            return Err(setup_error(
                "changing memory layout requires an explicit migration",
            ));
        }
        restored.options.setup.memory_layout = saved["memory_layout"].as_str().map(str::to_owned);
        if restored.options.setup.agents.is_none() {
            restored.options.setup.agents = saved["skill_targets"].as_array().map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(",")
            });
        }
        if let Some(roots) = saved["skill_roots"].as_array() {
            for entry in roots {
                let agent = entry["agent"]
                    .as_str()
                    .ok_or_else(|| setup_error("invalid saved skill target"))?;
                let path = entry["path"]
                    .as_str()
                    .ok_or_else(|| setup_error("invalid saved skill root"))?;
                saved_skill_roots.push((agent.to_owned(), PathBuf::from(path)));
            }
        }
        if !restored.options.actor_explicit {
            if let Some(actor) = saved["operator_actor"].as_str() {
                restored.options.actor = actor.to_owned();
            } else {
                restored.options.actor = "agent-1".to_owned();
            }
        }
        if !restored.options.session_explicit {
            restored.options.session = saved["operator_session"]
                .as_str()
                .unwrap_or("session-cli")
                .to_owned();
        }
    }
    let parsed = &restored;
    if parsed.options.setup.interactive && parsed.options.json {
        return Err(CliError::invalid(
            "--interactive cannot be combined with --json",
        ));
    }
    if parsed.options.setup.interactive && parsed.options.setup.yes {
        return Err(CliError::invalid(
            "--interactive cannot be combined with --yes",
        ));
    }
    if parsed.options.setup.yes && parsed.options.setup.dry_run {
        return Err(CliError::invalid("--yes cannot be combined with --dry-run"));
    }
    let project_root = resolve_project_root(parsed)?;
    let project_id = project_id(parsed, &project_root)?;
    let command = parsed.path[0].clone();
    let database = if parsed.options.db == DEFAULT_DB {
        project_root.join(DEFAULT_DB)
    } else {
        PathBuf::from(&parsed.options.db)
    };
    let database = confined_setup_path(&project_root, &database)?;
    let mut memory_layout = parsed
        .options
        .setup
        .memory_layout
        .as_deref()
        .unwrap_or("child")
        .to_owned();
    if !matches!(memory_layout.as_str(), "child" | "in-repo") {
        return Err(CliError::invalid(
            "--memory-layout must be child or in-repo",
        ));
    }

    let interactive = is_interactive(&parsed.options.setup, parsed.options.json);
    if interactive && (!io::stdin().is_terminal() || !io::stdout().is_terminal()) {
        return Err(CliError::invalid(
            "--interactive requires a TTY; use --yes or --agents for automation",
        ));
    }
    let selected = if interactive {
        premium_setup_choices(
            parsed,
            &project_root,
            &project_id,
            &database,
            &memory_layout,
        )?
    } else {
        None
    };
    let used_premium_wizard = selected.is_some();
    let agents = match selected {
        Some(choices) => {
            memory_layout = choices.memory_layout;
            choices.agents
        }
        None => choose_agents(&parsed.options.setup, parsed.options.json)?,
    };
    let mut skill_roots = skill_roots(
        &project_root,
        &agents,
        parsed.options.setup.install_root.as_deref(),
    )?;
    if parsed.options.setup.install_root.is_none() {
        for (agent, root) in &mut skill_roots {
            if let Some((_, saved)) = saved_skill_roots
                .iter()
                .find(|(saved_agent, _)| saved_agent == agent)
            {
                *root = saved.clone();
            }
        }
    }
    let plan = SetupPlan {
        command,
        project_id,
        project_root: project_root.clone(),
        database,
        memory_root: project_root.join("memory"),
        memory_layout,
        agents,
        skill_roots,
        dry_run: parsed.options.setup.dry_run,
        operator_actor: parsed.options.actor.clone(),
        operator_session: parsed.options.session.clone(),
        metadata_digest,
    };
    if interactive && !used_premium_wizard {
        confirm_plan(&plan)?;
    }
    preflight(&plan)?;
    Ok(plan)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PremiumSetupChoices {
    confirmed: bool,
    agents: Vec<String>,
    memory_layout: String,
}

/// A thin human-facing chooser. The Node wizard is embedded in this binary, not
/// fetched or resolved from the current project. It never writes project data.
/// A missing/unsupported Node runtime falls back to the existing line prompts.
fn premium_setup_choices(
    parsed: &ParsedCommand,
    project_root: &Path,
    project_id: &str,
    database: &Path,
    memory_layout: &str,
) -> Result<Option<PremiumSetupChoices>, CliError> {
    if env::var_os("BOREAL_PLAIN").is_some() || matches!(env::var("TERM").as_deref(), Ok("dumb")) {
        return Ok(None);
    }
    let node = env::var_os("BOREAL_NODE").unwrap_or_else(|| "node".into());
    let probe = Command::new(&node)
        .args([
            "-e",
            "const n=+process.versions.node.split('.')[0];process.exit(n>=20&&n<27?0:1)",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if !matches!(probe, Ok(status) if status.success()) {
        eprintln!("Boreal: Node.js 20–26 is unavailable; using the basic setup prompts.");
        return Ok(None);
    }
    let agents = match parsed.options.setup.agents.as_deref() {
        Some(value) => parse_agents(value)?,
        None => vec!["codex".to_owned()],
    };
    let install_root = parsed.options.setup.install_root.as_deref().map(|value| {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            path
        } else {
            project_root.join(path)
        }
    });
    let initial = json!({
        "project_id": project_id,
        "project_root": project_root,
        "database": database,
        "memory_root": project_root.join("memory"),
        "memory_layout": memory_layout,
        "agents": agents,
        "agents_locked": parsed.options.setup.agents.is_some(),
        "memory_locked": parsed.options.setup.memory_layout.is_some(),
        "install_root": install_root,
    });
    let output = Command::new(&node)
        .arg("-e")
        .arg(include_str!("../../../apps/tui/installer/wizard.cjs"))
        .arg("project")
        .arg(initial.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()
        .map_err(|error| setup_error(format!("cannot start project setup: {error}")))?;
    if !output.status.success() {
        return Err(CliError::with(
            ErrorCode::InvalidArgument,
            ApplicationOutcome::Rejected,
            "project setup was cancelled or could not start; no changes were applied",
        ));
    }
    if output.stdout.len() > 8_192 {
        return Err(setup_error(
            "setup screen returned an oversized selection".to_owned(),
        ));
    }
    let mut selection: PremiumSetupChoices = serde_json::from_slice(&output.stdout)
        .map_err(|error| setup_error(format!("invalid setup screen result: {error}")))?;
    if !selection.confirmed {
        return Err(setup_error("project setup was not confirmed".to_owned()));
    }
    selection.agents = parse_agents(&selection.agents.join(","))?;
    if !matches!(selection.memory_layout.as_str(), "child" | "in-repo") {
        return Err(CliError::invalid(
            "setup screen returned an unsupported memory choice",
        ));
    }
    // Explicit CLI choices remain authoritative even if a UI regression occurs.
    if let Some(value) = parsed.options.setup.agents.as_deref() {
        if selection.agents != parse_agents(value)? {
            return Err(CliError::invalid(
                "project setup changed an explicit assistant choice",
            ));
        }
    }
    if let Some(value) = parsed.options.setup.memory_layout.as_deref() {
        if selection.memory_layout != value {
            return Err(CliError::invalid(
                "project setup changed an explicit memory choice",
            ));
        }
    }
    Ok(Some(selection))
}

pub(super) fn apply(plan: &SetupPlan) -> Result<SetupResult, CliError> {
    preflight(plan)?;
    let mut result = SetupResult::default();
    ensure_directory(&plan.project_root, &plan.project_root, &mut result)?;
    let boreal_root = plan.project_root.join(".boreal");
    ensure_directory(&boreal_root, &plan.project_root, &mut result)?;
    ensure_directory(&plan.memory_root, &plan.project_root, &mut result)?;
    for directory in MEMORY_DIRECTORIES {
        ensure_directory(
            &plan.memory_root.join(directory),
            &plan.project_root,
            &mut result,
        )?;
    }
    for (_, root) in &plan.skill_roots {
        ensure_directory(root, &plan.project_root, &mut result)?;
    }

    let config_path = boreal_root.join("project.json");
    let config = project_config(plan, &config_path)?;

    for (relative, contents) in MEMORY_FILES {
        let path = plan.memory_root.join(relative);
        ensure_directory(
            path.parent().unwrap_or(&plan.memory_root),
            &plan.project_root,
            &mut result,
        )?;
        write_if_missing(&path, contents, &plan.project_root, &mut result)?;
    }
    append_block(
        &plan.project_root.join(".gitignore"),
        &project_gitignore_block(plan),
        &plan.project_root,
        &mut result,
    )?;
    append_block(
        &plan.memory_root.join(".gitignore"),
        &memory_gitignore_block(),
        &plan.project_root,
        &mut result,
    )?;

    let previous_manifest: Value = fs::read(boreal_root.join("skills.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    for (agent, root) in &plan.skill_roots {
        for (skill, files) in SKILL_ASSETS {
            let skill_root = root.join(skill);
            ensure_directory(&skill_root, &plan.project_root, &mut result)?;
            for (filename, contents) in files
                .iter()
                .filter(|(name, _)| agent != "claude" || *name != "agents/openai.yaml")
            {
                let path = skill_root.join(filename);
                ensure_directory(
                    path.parent().unwrap_or(&skill_root),
                    &plan.project_root,
                    &mut result,
                )?;
                let before = (result.created_files.len(), result.updated_files.len());
                let existing = fs::read(&path).ok();
                let key = relative(&plan.project_root, &path);
                let known = previous_manifest["files"]
                    .as_array()
                    .and_then(|files| files.iter().find(|f| f["path"].as_str() == Some(&key)))
                    .and_then(|f| f["package_digest"].as_str());
                if let Some(existing) = &existing {
                    if existing != contents.as_bytes()
                        && known != Some(boreal_store::checksum(existing).as_str())
                    {
                        result.skill_conflicts.push(key);
                        write_if_missing(&path, contents, &plan.project_root, &mut result)?;
                    } else {
                        write_managed(&path, contents, &plan.project_root, &mut result)?;
                    }
                } else {
                    write_managed(&path, contents, &plan.project_root, &mut result)?;
                }
                if result.created_files.len() > before.0 {
                    result.skill_files_created += 1;
                } else if result.updated_files.len() > before.1 {
                    result.skill_files_updated += 1;
                } else {
                    result.skill_files_preserved += 1;
                }
                result.skill_files += 1;
            }
        }
    }
    let package: Value = serde_json::from_str(include_str!("../../../skills/manifest.json"))
        .map_err(|e| setup_error(e.to_string()))?;
    let install_manifest = json!({
        "schema_version": SKILL_INSTALL_SCHEMA,
        "package": package["package_id"],
        "package_version": package["package_version"],
        "workflow_package": package["workflow_package"],
        "files": plan.skill_roots.iter().flat_map(|(agent, root)| SKILL_ASSETS.iter().flat_map(move |(skill, files)| files.iter().filter(move |(name, _)| agent != "claude" || *name != "agents/openai.yaml").map(move |(name, contents)| json!({"path": relative(&plan.project_root, &root.join(skill).join(name)), "package_digest": boreal_store::checksum(contents.as_bytes())})))).collect::<Vec<_>>(),
        "agents": &plan.agents,
        "roots": plan.skill_roots.iter().map(|(agent, root)| json!({
            "agent": agent,
            "path": root,
        })).collect::<Vec<_>>(),
    });
    write_managed(
        &boreal_root.join("skills.json"),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(&install_manifest).unwrap()
        ),
        &plan.project_root,
        &mut result,
    )?;
    let pending: Value = fs::read(boreal_root.join("setup-pending.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null);
    let mut baseline_files = result.created_files.clone();
    if let Some(files) = pending["new_memory_files"].as_array() {
        for name in files.iter().filter_map(Value::as_str) {
            if !baseline_files.iter().any(|p| p == name) {
                baseline_files.push(name.to_owned());
            }
        }
    }
    baseline_files.retain(|name| {
        let Some(expected) = pending["scaffold_digests"][name].as_str() else {
            return true;
        };
        fs::read(plan.project_root.join(name))
            .is_ok_and(|bytes| boreal_store::checksum(&bytes) == expected)
    });
    if plan.memory_layout == "child" {
        result.memory_git =
            ensure_memory_git(&plan.memory_root, &plan.project_root, &baseline_files)?;
    } else {
        let files: Vec<PathBuf> = baseline_files
            .iter()
            .filter(|p| !p.starts_with(".boreal/"))
            .map(PathBuf::from)
            .collect();
        if !files.is_empty() {
            boreal_memory::initialize_scaffold_baseline(&plan.project_root, &files)
                .map_err(|e| setup_error(e.to_string()))?;
        }
        result.memory_git = "in-repo";
    }

    // The binding marker is published last. A failed attempt remains resumable
    // through the immutable database identity and preserves existing files.
    write_managed(&config_path, &config, &plan.project_root, &mut result)?;
    let pending = boreal_root.join("setup-pending.json");
    if pending.is_file() {
        fs::remove_file(&pending)
            .map_err(|e| setup_error(format!("complete setup journal: {e}")))?;
    }
    result.changed = !result.created_files.is_empty()
        || !result.updated_files.is_empty()
        || !result.created_directories.is_empty();
    let git_root = if plan.memory_layout == "child" {
        &plan.memory_root
    } else {
        &plan.project_root
    };
    result.memory_publication_ready = git(git_root, &["status", "--porcelain"])?.trim().is_empty();
    Ok(result)
}

pub(super) fn plan_value(plan: &SetupPlan) -> Value {
    json!({
        "command": &plan.command,
        "project_id": &plan.project_id,
        "project_root": &plan.project_root,
        "database": &plan.database,
        "memory_root": &plan.memory_root,
        "memory_layout": &plan.memory_layout,
        "agents": &plan.agents,
        "skill_roots": plan.skill_roots.iter().map(|(agent, root)| json!({"agent": agent, "path": root})).collect::<Vec<_>>(),
        "dry_run": plan.dry_run,
    })
}

pub(super) fn result_value(plan: &SetupPlan, result: &SetupResult) -> Value {
    json!({
        "setup": plan_value(plan),
        "result": {
            "changed": result.changed,
            "created_files": result.created_files,
            "updated_files": result.updated_files,
            "existing_files": result.existing_files,
            "created_directories": result.created_directories,
            "existing_directories": result.existing_directories,
            "skill_files": result.skill_files,
            "skill_files_created": result.skill_files_created,
            "skill_files_updated": result.skill_files_updated,
            "skill_files_preserved": result.skill_files_preserved,
            "skill_conflicts": result.skill_conflicts,
            "memory_git": result.memory_git,
            "memory_publication_ready": result.memory_publication_ready,
        }
    })
}

pub(super) fn render(plan: &SetupPlan, result: Option<&SetupResult>) -> String {
    let safe = |value: String| {
        value
            .chars()
            .map(|c| {
                if c.is_control() || matches!(c as u32, 0x202a..=0x202e | 0x2066..=0x2069) {
                    '�'
                } else {
                    c
                }
            })
            .collect::<String>()
    };
    let mut lines = vec![
        String::new(),
        "  BOREAL / WORK".to_owned(),
        format!(
            "  {}",
            if result.is_some() {
                "Boreal setup complete"
            } else {
                "Boreal setup plan"
            }
        ),
        String::new(),
        format!("  Project   {}", safe(plan.project_id.clone())),
        format!(
            "  Folder    {}",
            safe(plan.project_root.display().to_string())
        ),
        format!("  Database  {}", safe(plan.database.display().to_string())),
        format!("  Agents    {}", plan.agents.join(", ")),
        format!(
            "  Memory    {} ({})",
            safe(plan.memory_root.display().to_string()),
            if plan.memory_layout == "child" {
                "separate repository"
            } else {
                "this repository"
            }
        ),
    ];
    for (agent, root) in &plan.skill_roots {
        lines.push(format!(
            "  Skills    {} → {}",
            agent,
            safe(root.display().to_string())
        ));
    }
    if let Some(result) = result {
        lines.push(String::new());
        lines.push(format!(
            "  Files     {} created · {} updated · {} preserved",
            result.created_files.len(),
            result.updated_files.len(),
            result.existing_files.len()
        ));
        lines.push(format!(
            "  Support   {} created · {} updated · {} preserved",
            result.skill_files_created, result.skill_files_updated, result.skill_files_preserved
        ));
        lines.push(format!("  Memory    {}", result.memory_git));
        if !result.memory_publication_ready {
            lines.push(
                "            Commit existing repository changes before publishing curated memory."
                    .to_owned(),
            );
        }
        lines.push(String::new());
        if !result.skill_conflicts.is_empty() {
            lines.push(format!(
                "  Skills    {} locally edited files preserved; review skills.json package digests",
                result.skill_conflicts.len()
            ));
        }
        lines.push(format!(
            "  Operator  {} (saved for commands in this project)",
            safe(plan.operator_actor.clone())
        ));
        lines.push(format!(
            "  Next      cd {}",
            safe(plan.project_root.display().to_string())
        ));
        lines.push("            bwrk doctor; bwrk dashboard".to_owned());
        lines.push("  Agents    Enroll distinct workers with auth key and auth grant; pass --actor ID --session ID for each worker. See bwrk help auth grant.".to_owned());
    } else {
        lines.push(String::new());
        lines.push("  No project files will be changed until setup is confirmed.".to_owned());
    }
    format!("{}\n", lines.join("\n"))
}

fn resolve_project_root(parsed: &ParsedCommand) -> Result<PathBuf, CliError> {
    let options = &parsed.options.setup;
    if options.project_root.is_some() && !parsed.options.positionals.is_empty() {
        return Err(CliError::invalid(
            "pass the project folder either positionally or with --project-root, not both",
        ));
    }
    let cwd = env::current_dir()
        .map_err(|error| setup_error(format!("cannot resolve project folder: {error}")))?;
    let root = match parsed
        .options
        .positionals
        .first()
        .map(String::as_str)
        .or(options.project_root.as_deref())
    {
        Some(path) if path.trim().is_empty() => {
            return Err(CliError::invalid("project folder must not be empty"));
        }
        Some(path) => PathBuf::from(path),
        None => cwd.clone(),
    };

    let root = if root.is_absolute() {
        root
    } else {
        cwd.join(root)
    };
    if root.exists() {
        if !root.is_dir() {
            return Err(setup_error(format!(
                "project root is not a directory: {}",
                root.display()
            )));
        }
        return fs::canonicalize(&root).map_err(|error| {
            setup_error(format!(
                "cannot resolve project folder {}: {error}",
                root.display()
            ))
        });
    }

    let existing_parent = root
        .ancestors()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| setup_error(format!("project folder is unavailable: {}", root.display())))?;
    if !existing_parent.is_dir() {
        return Err(setup_error(format!(
            "project folder parent is not a directory: {}",
            existing_parent.display()
        )));
    }
    let remainder = root.strip_prefix(existing_parent).map_err(|error| {
        setup_error(format!(
            "cannot resolve project folder {}: {error}",
            root.display()
        ))
    })?;
    if remainder
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(CliError::invalid(
            "project folder contains unsupported path traversal",
        ));
    }
    let existing_parent = fs::canonicalize(existing_parent).map_err(|error| {
        setup_error(format!(
            "cannot resolve project folder parent {}: {error}",
            existing_parent.display()
        ))
    })?;
    Ok(existing_parent.join(remainder))
}

fn confined_setup_path(root: &Path, path: &Path) -> Result<PathBuf, CliError> {
    if root.exists() {
        return super::project_context::confined_path(root, path, true);
    }
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(CliError::invalid(
            "parent traversal is not permitted in project paths",
        ));
    }
    let target = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    if !target.starts_with(root) {
        return Err(CliError::invalid(format!(
            "path {} lies outside the selected project {}",
            target.display(),
            root.display()
        )));
    }
    Ok(target)
}

fn choose_agents(options: &SetupCliOptions, json_output: bool) -> Result<Vec<String>, CliError> {
    if let Some(value) = options.agents.as_deref() {
        return parse_agents(value);
    }
    let interactive = is_interactive(options, json_output);
    if options.interactive && (!io::stdin().is_terminal() || !io::stdout().is_terminal()) {
        return Err(CliError::invalid(
            "--interactive requires a TTY; use --yes or --agents for automation",
        ));
    }
    if !interactive {
        return Ok(vec!["codex".to_owned()]);
    }
    println!();
    println!("╭────────────────────────────────────────────────────────────╮");
    println!("│ Boreal project setup                                       │");
    println!("├────────────────────────────────────────────────────────────┤");
    println!("│ Choose which assistants should receive Boreal support.     │");
    println!("│   1) Codex   (recommended)                                 │");
    println!("│   2) Claude                                               │");
    println!("│   3) Both                                                  │");
    println!("╰────────────────────────────────────────────────────────────╯");
    print!("Select [1]: ");
    io::stdout()
        .flush()
        .map_err(|error| setup_error(error.to_string()))?;
    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .map_err(|error| setup_error(error.to_string()))?;
    match input.trim() {
        "" | "1" | "codex" => Ok(vec!["codex".to_owned()]),
        "2" | "claude" => Ok(vec!["claude".to_owned()]),
        "3" | "both" | "1,2" | "codex,claude" | "claude,codex" => {
            Ok(vec!["codex".to_owned(), "claude".to_owned()])
        }
        other => parse_agents(other),
    }
}

fn is_interactive(options: &SetupCliOptions, json_output: bool) -> bool {
    options.interactive
        || (!options.yes
            && !options.dry_run
            && !json_output
            && io::stdin().is_terminal()
            && io::stdout().is_terminal())
}

fn parse_agents(value: &str) -> Result<Vec<String>, CliError> {
    let mut agents = Vec::new();
    for item in value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if !matches!(item, "codex" | "claude") {
            return Err(CliError::invalid("--agents accepts codex, claude, or both"));
        }
        if !agents.iter().any(|agent| agent == item) {
            agents.push(item.to_owned());
        }
    }
    if agents.is_empty() {
        return Err(CliError::invalid("--agents must select at least one agent"));
    }
    Ok(agents)
}

fn skill_roots(
    root: &Path,
    agents: &[String],
    explicit: Option<&str>,
) -> Result<Vec<(String, PathBuf)>, CliError> {
    if explicit.is_some() && agents.len() > 1 {
        return Err(CliError::invalid(
            "--install-root is supported when selecting one agent; omit it when installing both",
        ));
    }
    agents
        .iter()
        .map(|agent| {
            let path = if let Some(explicit) = explicit {
                let explicit = PathBuf::from(explicit);
                if explicit.is_absolute() {
                    explicit
                } else {
                    root.join(explicit)
                }
            } else if agent == "codex" {
                root.join(".agents/skills")
            } else {
                root.join(".claude/skills")
            };
            Ok((agent.clone(), path))
        })
        .collect()
}

fn confirm_plan(plan: &SetupPlan) -> Result<(), CliError> {
    println!();
    println!("{}", render(plan, None));
    print!("Apply this setup? [Y/n]: ");
    io::stdout()
        .flush()
        .map_err(|error| setup_error(error.to_string()))?;
    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .map_err(|error| setup_error(error.to_string()))?;
    if matches!(input.trim().to_ascii_lowercase().as_str(), "n" | "no") {
        return Err(CliError::with(
            ErrorCode::InvalidArgument,
            ApplicationOutcome::Rejected,
            "setup cancelled",
        ));
    }
    Ok(())
}

fn project_config(plan: &SetupPlan, existing: &Path) -> Result<String, CliError> {
    let pending = plan.project_root.join(".boreal/setup-pending.json");
    let existing = if existing.is_file() {
        existing
    } else {
        &pending
    };
    let created_at = if existing.is_file() {
        fs::read_to_string(existing)
            .ok()
            .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
            .and_then(|value| {
                value
                    .get("created_at")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(super::now)
    } else {
        super::now()
    };
    let config = json!({
        "schema_version": SETUP_SCHEMA,
        "project_id": &plan.project_id,
        "project_root": &plan.project_root,
        "database": &plan.database,
        "memory_root": &plan.memory_root,
        "memory_layout": &plan.memory_layout,
        "skill_targets": &plan.agents,
        "operator_actor": &plan.operator_actor,
        "operator_session": &plan.operator_session,
        "skill_roots": plan.skill_roots.iter().map(|(agent, root)| json!({"agent": agent, "path": root})).collect::<Vec<_>>(),
        "created_at": created_at,
    });
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&config).unwrap()
    ))
}

fn project_gitignore_block(plan: &SetupPlan) -> String {
    let database = relative(&plan.project_root, &plan.database);
    let literal: String = database
        .chars()
        .flat_map(|c| {
            if matches!(c, ' ' | '#' | '!' | '*' | '?' | '[' | ']' | '\\') {
                vec!['\\', c]
            } else {
                vec![c]
            }
        })
        .collect();
    let source = relative(
        &plan.project_root,
        &plan
            .database
            .parent()
            .unwrap_or(&plan.project_root)
            .join("source"),
    );
    let memory_ignore = if plan.memory_layout == "child" {
        "/memory/\n"
    } else {
        ""
    };
    format!(
        "{GITIGNORE_MARKER}\n.boreal/\n.boreal-service-runtime/\n/{literal}\n/{literal}-*\n/{source}/\n{memory_ignore}memory.publication.lock\n.memory.publication-recovery\n# End Boreal managed local runtime\n"
    )
}

fn memory_gitignore_block() -> String {
    format!(
        "{MEMORY_GITIGNORE_MARKER}\n.boreal/db/\n.boreal/cache/\n.boreal/locks/\n.boreal/tmp/\n.boreal/results/\n.DS_Store\n"
    )
}

fn ensure_memory_git(
    memory_root: &Path,
    project_root: &Path,
    created: &[String],
) -> Result<&'static str, CliError> {
    if memory_root.join(".git").exists() {
        git(memory_root, &["rev-parse", "--git-dir"])?;
    } else {
        git(memory_root, &["init", "--quiet", "--template="])?;
    }
    let files: Vec<PathBuf> = created
        .iter()
        .filter_map(|p| {
            project_root
                .join(p)
                .strip_prefix(memory_root)
                .ok()
                .map(Path::to_path_buf)
        })
        .collect();
    if !files.is_empty() {
        boreal_memory::initialize_scaffold_baseline(memory_root, &files)
            .map_err(|e| setup_error(e.to_string()))?;
    }
    Ok("ready")
}

fn git(root: &Path, args: &[&str]) -> Result<String, CliError> {
    let mut command = Command::new("git");
    command
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
        ])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null");
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_CONFIG_COUNT",
        "GIT_TEMPLATE_DIR",
    ] {
        command.env_remove(key);
    }
    let output = command
        .output()
        .map_err(|e| setup_error(format!("Git is required for memory: {e}")))?;
    if !output.status.success() {
        return Err(setup_error(format!(
            "memory Git setup failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn ensure_directory(path: &Path, root: &Path, result: &mut SetupResult) -> Result<(), CliError> {
    validate_destination(root, path, true)?;
    if path.is_dir() {
        result.existing_directories.push(relative(root, path));
        return Ok(());
    }
    if path.exists() {
        return Err(setup_error(format!(
            "expected directory but found a file: {}",
            path.display()
        )));
    }
    fs::create_dir_all(path)
        .map_err(|error| setup_error(format!("create {}: {error}", path.display())))?;
    result.created_directories.push(relative(root, path));
    Ok(())
}

fn write_if_missing(
    path: &Path,
    contents: &str,
    root: &Path,
    result: &mut SetupResult,
) -> Result<(), CliError> {
    if path.is_file() {
        result.existing_files.push(relative(root, path));
        return Ok(());
    }
    write_contents(path, contents, root, result, false)
}

fn write_managed(
    path: &Path,
    contents: &str,
    root: &Path,
    result: &mut SetupResult,
) -> Result<(), CliError> {
    write_contents(path, contents, root, result, true)
}

fn write_contents(
    path: &Path,
    contents: &str,
    root: &Path,
    result: &mut SetupResult,
    overwrite: bool,
) -> Result<(), CliError> {
    validate_destination(root, path, false)?;
    if path.is_file() {
        let existing = fs::read_to_string(path)
            .map_err(|error| setup_error(format!("read {}: {error}", path.display())))?;
        if existing == contents || !overwrite {
            result.existing_files.push(relative(root, path));
            return Ok(());
        }
        atomic_write(path, contents)?;
        result.updated_files.push(relative(root, path));
        return Ok(());
    }
    atomic_write(path, contents)?;
    result.created_files.push(relative(root, path));
    Ok(())
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), CliError> {
    let parent = path
        .parent()
        .ok_or_else(|| setup_error("missing destination parent"))?;
    let temp = parent.join(format!(
        ".boreal-write-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| setup_error(e.to_string()))?
            .as_nanos()
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| setup_error(e.to_string()))?;
        file.write_all(contents.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| setup_error(e.to_string()))?;
        fs::rename(&temp, path).map_err(|e| setup_error(format!("publish {}: {e}", path.display())))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn append_block(
    path: &Path,
    block: &str,
    root: &Path,
    result: &mut SetupResult,
) -> Result<(), CliError> {
    let existing = if path.is_file() {
        fs::read_to_string(path)
            .map_err(|error| setup_error(format!("read {}: {error}", path.display())))?
    } else {
        String::new()
    };
    if block
        .lines()
        .all(|line| existing.lines().any(|old| old == line))
    {
        result.existing_files.push(relative(root, path));
        return Ok(());
    }
    let mut contents = existing;
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    if !contents.is_empty() {
        contents.push('\n');
    }
    // Reconcile additions without removing user rules or older managed rules.
    for line in block.lines() {
        if !contents.lines().any(|old| old == line) {
            contents.push_str(line);
            contents.push('\n');
        }
    }
    write_managed(path, &contents, root, result)
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

fn setup_error(message: impl Into<String>) -> CliError {
    CliError::with(
        ErrorCode::InvalidArgument,
        ApplicationOutcome::Rejected,
        message,
    )
}

// Reject links at every component, including links whose targets do not exist.
// This is deliberately stricter than canonicalization of the final path.
fn validate_destination(root: &Path, path: &Path, directory: bool) -> Result<(), CliError> {
    let suffix = path.strip_prefix(root).map_err(|_| {
        setup_error(format!(
            "setup destination is outside the project: {}",
            path.display()
        ))
    })?;
    let mut cursor = root.to_path_buf();
    for component in suffix.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err(setup_error("setup path traversal is not permitted"));
        }
        cursor.push(component);
        match fs::symlink_metadata(&cursor) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(setup_error(format!(
                        "setup destination contains a symbolic link: {}",
                        cursor.display()
                    )));
                }
                let is_final = cursor == path;
                if (!is_final || directory) && !metadata.is_dir()
                    || is_final && !directory && !metadata.is_file()
                {
                    return Err(setup_error(format!(
                        "setup destination has the wrong file type: {}",
                        cursor.display()
                    )));
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(setup_error(format!("inspect {}: {e}", cursor.display()))),
        }
    }
    Ok(())
}

pub(super) fn preflight(plan: &SetupPlan) -> Result<(), CliError> {
    validate_destination(
        &plan.project_root,
        &plan.project_root.join(".boreal/runtime/setup"),
        true,
    )?;
    for path in [plan.project_root.join(".boreal"), plan.memory_root.clone()] {
        validate_destination(&plan.project_root, &path, true)?;
    }
    for name in ["project.json", "skills.json", "setup-pending.json"] {
        validate_destination(
            &plan.project_root,
            &plan.project_root.join(".boreal").join(name),
            false,
        )?;
    }
    for directory in MEMORY_DIRECTORIES {
        validate_destination(&plan.project_root, &plan.memory_root.join(directory), true)?;
    }
    for (name, _) in MEMORY_FILES {
        validate_destination(&plan.project_root, &plan.memory_root.join(name), false)?;
    }
    for path in [
        plan.project_root.join(".gitignore"),
        plan.memory_root.join(".gitignore"),
    ] {
        validate_destination(&plan.project_root, &path, false)?;
    }
    for (agent, root) in &plan.skill_roots {
        validate_destination(&plan.project_root, root, true)?;
        for (skill, files) in SKILL_ASSETS {
            for (name, _) in files
                .iter()
                .filter(|(name, _)| agent != "claude" || *name != "agents/openai.yaml")
            {
                validate_destination(&plan.project_root, &root.join(skill).join(name), false)?;
            }
        }
    }
    // Check dependencies before any canonical state or credential is created.
    let git_root = plan
        .project_root
        .ancestors()
        .find(|p| p.is_dir())
        .ok_or_else(|| setup_error("project parent unavailable"))?;
    git(git_root, &["--version"])?;
    if plan.memory_layout == "in-repo" {
        git(&plan.project_root, &["rev-parse", "--show-toplevel"])?;
        if plan.memory_root.join(".git").exists() {
            return Err(setup_error(
                "in-repo memory cannot contain a separate Git repository",
            ));
        }
    } else {
        validate_destination(&plan.project_root, &plan.memory_root.join(".git"), true)?;
        if plan.memory_root.join(".git").is_dir() {
            git(&plan.memory_root, &["rev-parse", "--git-dir"])?;
        }
    }
    Ok(())
}

pub(super) fn begin(plan: &SetupPlan) -> Result<(), CliError> {
    preflight(plan)?;
    let marker = if plan.project_root.join(".boreal/project.json").is_file() {
        "project.json"
    } else {
        "setup-pending.json"
    };
    for name in [marker] {
        let path = plan.project_root.join(".boreal").join(name);
        if path.is_file() {
            let bytes = fs::read(&path).map_err(|e| setup_error(e.to_string()))?;
            if plan.metadata_digest.as_deref() != Some(boreal_store::checksum(&bytes).as_str()) {
                return Err(setup_error(
                    "project setup changed while preparing; rerun init",
                ));
            }
            let saved: Value =
                serde_json::from_slice(&bytes).map_err(|e| setup_error(e.to_string()))?;
            if saved["project_id"].as_str() != Some(&plan.project_id)
                || saved["database"].as_str() != plan.database.to_str()
                || saved["memory_layout"].as_str() != Some(&plan.memory_layout)
            {
                return Err(setup_error(
                    "project setup binding changed; rerun init to read the current configuration",
                ));
            }
        }
    }
    if plan.project_root.join(".boreal/project.json").exists() {
        return Ok(());
    }
    let mut result = SetupResult::default();
    ensure_directory(
        &plan.project_root.join(".boreal"),
        &plan.project_root,
        &mut result,
    )?;
    let path = plan.project_root.join(".boreal/setup-pending.json");
    if path.exists() {
        return Ok(());
    }
    let mut config: Value = serde_json::from_str(&project_config(plan, &path)?)
        .map_err(|e| setup_error(e.to_string()))?;
    let mut candidates: Vec<PathBuf> = MEMORY_FILES
        .iter()
        .map(|(name, _)| plan.memory_root.join(name))
        .collect();
    candidates.extend([
        plan.memory_root.join(".gitignore"),
        plan.project_root.join(".gitignore"),
    ]);
    for (agent, root) in &plan.skill_roots {
        for (skill, files) in SKILL_ASSETS {
            for (name, _) in files
                .iter()
                .filter(|(name, _)| agent != "claude" || *name != "agents/openai.yaml")
            {
                candidates.push(root.join(skill).join(name));
            }
        }
    }
    config["new_memory_files"] = json!(
        candidates
            .iter()
            .filter(|p| !p.exists())
            .map(|p| relative(&plan.project_root, p))
            .collect::<Vec<_>>()
    );
    let mut digests = serde_json::Map::new();
    for (name, contents) in MEMORY_FILES {
        digests.insert(
            format!("memory/{name}"),
            json!(boreal_store::checksum(contents.as_bytes())),
        );
    }
    digests.insert(
        ".gitignore".to_owned(),
        json!(boreal_store::checksum(
            project_gitignore_block(plan).as_bytes()
        )),
    );
    digests.insert(
        "memory/.gitignore".to_owned(),
        json!(boreal_store::checksum(memory_gitignore_block().as_bytes())),
    );
    for (agent, root) in &plan.skill_roots {
        for (skill, files) in SKILL_ASSETS {
            for (name, contents) in files
                .iter()
                .filter(|(name, _)| agent != "claude" || *name != "agents/openai.yaml")
            {
                digests.insert(
                    relative(&plan.project_root, &root.join(skill).join(name)),
                    json!(boreal_store::checksum(contents.as_bytes())),
                );
            }
        }
    }
    config["scaffold_digests"] = Value::Object(digests);
    write_managed(
        &path,
        &format!(
            "{}\n",
            serde_json::to_string_pretty(&config).map_err(|e| setup_error(e.to_string()))?
        ),
        &plan.project_root,
        &mut result,
    )
}

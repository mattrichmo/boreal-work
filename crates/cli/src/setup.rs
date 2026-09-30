//! Local project setup for the user-facing `bwrk init` flow.
//!
//! The SQLite project remains owned by the application/store boundary. This
//! module owns only adapter concerns: choosing setup options, creating the
//! project files, and installing the checked-in harness adapters.

use super::{CliError, ParsedCommand, SetupCliOptions};
use boreal_protocol::{ApplicationOutcome, ErrorCode};
use serde_json::{json, Value};
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
const MEMORY_DIRECTORIES: &[&str] = &[
    "raw",
    "wiki",
    "work",
    "graph",
    "ledgers",
    "dashboards",
    "entries",
];

const MEMORY_FILES: &[(&str, &str)] = &[
    (
        "index.md",
        "# Boreal Project Memory\n\nThis directory is the curated memory surface for this project.\n",
    ),
    (
        "raw/index.jsonl",
        "",
    ),
    (
        "wiki/index.md",
        "# Wiki\n\nProject knowledge captured by Boreal.\n",
    ),
    (
        "work/index.md",
        "# Work Memory\n\nDurable notes connected to project work.\n",
    ),
    (
        "graph/relationships.jsonl",
        "",
    ),
    (
        "ledgers/events.jsonl",
        "",
    ),
    (
        "dashboards/index.md",
        "# Dashboards\n\nCurated project dashboard views.\n",
    ),
];

const SKILL_ASSETS: &[(&str, &[(&str, &str)])] = &[
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
}

#[derive(Clone, Debug, Default)]
pub(super) struct SetupResult {
    pub(super) created_files: Vec<String>,
    pub(super) updated_files: Vec<String>,
    pub(super) existing_files: Vec<String>,
    pub(super) created_directories: Vec<String>,
    pub(super) existing_directories: Vec<String>,
    pub(super) skill_files: usize,
    pub(super) memory_git: &'static str,
    pub(super) changed: bool,
}

pub(super) fn is_setup_command(path: &[String]) -> bool {
    matches!(path, [command] if matches!(command.as_str(), "init" | "setup" | "install"))
}

pub(super) fn should_setup(parsed: &ParsedCommand) -> bool {
    if !is_setup_command(&parsed.path) {
        return false;
    }
    parsed.path[0] != "init"
        || parsed.options.db == DEFAULT_DB
        || parsed.options.setup.interactive
        || parsed.options.setup.yes
        || parsed.options.setup.dry_run
        || parsed.options.setup.agents.is_some()
        || parsed.options.setup.project_root.is_some()
        || parsed.options.setup.memory_layout.is_some()
        || parsed.options.setup.install_root.is_some()
}

pub(super) fn project_id(parsed: &ParsedCommand, project_root: &Path) -> Result<String, CliError> {
    if parsed.options.positionals.len() > 1 {
        return Err(CliError::invalid(
            "init accepts at most one project identifier",
        ));
    }
    if let Some(project) = parsed.options.positionals.first() {
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
    let project_root = resolve_project_root(&parsed.options.setup)?;
    let project_id = project_id(parsed, &project_root)?;
    let command = parsed.path[0].clone();
    let database = if parsed.options.db == DEFAULT_DB {
        project_root.join(DEFAULT_DB)
    } else {
        PathBuf::from(&parsed.options.db)
    };
    let database = super::project_context::confined_path(&project_root, &database, true)?;
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
    let skill_roots = skill_roots(
        &project_root,
        &agents,
        parsed.options.setup.install_root.as_deref(),
    )?;
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
    };
    if interactive && !used_premium_wizard {
        confirm_plan(&plan)?;
    }
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
    write_managed(&config_path, &config, &plan.project_root, &mut result)?;

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
        &project_gitignore_block(),
        &plan.project_root,
        &mut result,
    )?;
    append_block(
        &plan.memory_root.join(".gitignore"),
        &memory_gitignore_block(),
        &plan.project_root,
        &mut result,
    )?;

    if plan.memory_layout == "child" {
        result.memory_git = ensure_memory_git(&plan.memory_root)?;
    } else {
        result.memory_git = "in-repo";
    }

    for (agent, root) in &plan.skill_roots {
        for (skill, files) in SKILL_ASSETS {
            let skill_root = root.join(skill);
            ensure_directory(&skill_root, &plan.project_root, &mut result)?;
            for (relative, contents) in *files {
                let path = skill_root.join(relative);
                ensure_directory(
                    path.parent().unwrap_or(&skill_root),
                    &plan.project_root,
                    &mut result,
                )?;
                write_managed(&path, contents, &plan.project_root, &mut result)?;
                result.skill_files += 1;
            }
        }
        let _ = agent;
    }
    let install_manifest = json!({
        "schema_version": SKILL_INSTALL_SCHEMA,
        "package": "boreal.core-skills",
        "package_version": "1.0.0",
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
    result.changed = !result.created_files.is_empty()
        || !result.updated_files.is_empty()
        || !result.created_directories.is_empty();
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
            "memory_git": result.memory_git,
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
            "  Support   {} assistant support files installed",
            result.skill_files
        ));
        lines.push(format!("  Memory    {}", result.memory_git));
        lines.push(String::new());
        lines.push("  Next      bwrk dashboard".to_owned());
    } else {
        lines.push(String::new());
        lines.push("  No project files will be changed until setup is confirmed.".to_owned());
    }
    format!("{}\n", lines.join("\n"))
}

fn resolve_project_root(options: &SetupCliOptions) -> Result<PathBuf, CliError> {
    let root = match options.project_root.as_deref() {
        Some(path) => PathBuf::from(path),
        None => env::current_dir()
            .map_err(|error| setup_error(format!("cannot resolve project folder: {error}")))?,
    };
    if root.exists() && !root.is_dir() {
        return Err(setup_error(format!(
            "project root is not a directory: {}",
            root.display()
        )));
    }
    Ok(root)
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
        "skill_roots": plan.skill_roots.iter().map(|(agent, root)| json!({"agent": agent, "path": root})).collect::<Vec<_>>(),
        "created_at": created_at,
    });
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&config).unwrap()
    ))
}

fn project_gitignore_block() -> String {
    format!(
        "{GITIGNORE_MARKER}\n.boreal/credentials/\n.boreal/runtime/\n.boreal/cache/\n.boreal/tmp/\n.boreal/results/\n.boreal/gates/\n.boreal/boreal.sqlite\n.boreal/boreal.sqlite-*\n"
    )
}

fn memory_gitignore_block() -> String {
    format!(
        "{MEMORY_GITIGNORE_MARKER}\n.boreal/db/\n.boreal/cache/\n.boreal/locks/\n.boreal/tmp/\n.boreal/results/\n.DS_Store\n"
    )
}

fn ensure_memory_git(memory_root: &Path) -> Result<&'static str, CliError> {
    if memory_root.join(".git").exists() {
        return Ok("existing");
    }
    let status = Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(memory_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(status) if status.success() => Ok("initialized"),
        Ok(_) | Err(_) => Ok("skipped (git unavailable)"),
    }
}

fn ensure_directory(path: &Path, root: &Path, result: &mut SetupResult) -> Result<(), CliError> {
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
    if path.is_file() {
        let existing = fs::read_to_string(path)
            .map_err(|error| setup_error(format!("read {}: {error}", path.display())))?;
        if existing == contents || !overwrite {
            result.existing_files.push(relative(root, path));
            return Ok(());
        }
        fs::write(path, contents)
            .map_err(|error| setup_error(format!("update {}: {error}", path.display())))?;
        result.updated_files.push(relative(root, path));
        return Ok(());
    }
    fs::write(path, contents)
        .map_err(|error| setup_error(format!("write {}: {error}", path.display())))?;
    result.created_files.push(relative(root, path));
    Ok(())
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
    if existing.contains(block.lines().next().unwrap_or_default()) {
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
    contents.push_str(block);
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
